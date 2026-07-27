# PLAN: AI Orchestration v2 — Multi-Agent Enhancement Pipeline

## Motivation

The current pipeline has 3 agents (`TitleGuesser`, `WebResearcher`, `LanguageIdentifier`) with a single consolidation step. The "Web Researcher" is a monolithic LLM prompt that tries to return artist, genre, *and* tags in one shot — without access to existing DB values. Genre and tags are stored as plain strings on the `songs` table with no deduplication. Lyrics are never touched by any agent.

This plan splits responsibilities into focused, single-purpose agents, introduces a wave-based parallelism model, feeds existing DB values into classification agents, and lays groundwork for real web search (lyrics).

---

## Current Architecture (reference)

```
POST /enhance
  │
  ├─ [Step 1 - SYNC]  TitleGuesser.extract(title, description)
  │     → { extracted_title, extracted_artist, is_off_vocal, video_has_lyrics, confidence }
  │
  ├─ [Step 2 - PARALLEL]  asyncio.gather(
  │     WebResearcher.research(title, artist)   → { genre, tags, verified_artist, year, confidence }
  │     LanguageIdentifier.detect(title, artist) → { language, confidence }
  │   )
  │
  └─ [Step 3 - SYNC]  _consolidate_results(original, tg, wr, li)
        → enhanced dict with priority rules per field
```

### Pain Points

1. **WebResearcher is too broad** — artist verification, genre labeling, and tag assignment in one prompt degrades each result.
2. **No DB context** — genre/tags agents don't know what genres and tags already exist in the songbook, so they can't match against them.
3. **No lyrics pipeline** — lyrics are never suggested, let alone searched for.
4. **Off-vocal/lyrics detection is embedded in TitleGuesser** — can't run in parallel with title extraction even though it only needs the YouTube title.
5. **No real web search** — all "research" is LLM training knowledge.

---

## Target Architecture

```
POST /enhance
  │
  ├─ [Wave 1 - PARALLEL]  ──────────────────────────────────────────
  │  TitleGuesser.extract(youtube_title, youtube_description)
  │    → { extracted_title, extracted_artist, confidence }
  │
  │  OffVocalDetector.detect(youtube_title)
  │    → { is_off_vocal, video_has_lyrics, confidence }
  │
  ├─ [Wave 2 - PARALLEL]  ──────────────────────────────────────────
  │  (all depend on Wave 1 title + artist)
  │
  │  ArtistResearcher.research(title, artist, youtube_title)
  │    → { verified_artist, confidence }
  │
  │  GenreClassifier.classify(title, artist, existing_genres[])
  │    → { matched_genre | new_genre, is_new, confidence }
  │
  │  TagsSuggester.suggest(title, artist, existing_tags[])
  │    → { matched_tags[], new_tags[], confidence }
  │
  │  LanguageIdentifier.detect(title, artist)
  │    → { language, confidence }   ← (unchanged)
  │
  ├─ [Wave 3 - SEQUENTIAL]  ────────────────────────────────────────
  │  (depends on consolidated title + artist from Waves 1+2)
  │
  │  LyricsResearcher.research(title, artist)
  │    → { lyrics, source_url, confidence }
  │
  └─ Consolidation
       → enhanced dict with priority rules + confidence gates
```

### Wave Dependency Graph

```
                    ┌──────────────┐
                    │  youtube_url │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            │            ▼
     ┌────────────┐        │   ┌──────────────────┐
     │TitleGuesser│        │   │OffVocalDetector  │
     │ (existing) │        │   │ (split from TG)  │
     └─────┬──────┘        │   └────────┬─────────┘
           │               │            │
           ▼               │            │
     extracted_title       │     is_off_vocal
     extracted_artist      │     video_has_lyrics
           │               │
           ├───────────────┴───────────────────────────────┐
           │                                               │
    ┌──────┴──────┬────────────────┬──────────────────────┐│
    ▼             ▼                ▼                      ▼│
┌────────┐ ┌────────────┐ ┌──────────────┐ ┌────────────────┐
│Artist  │ │Genre       │ │Tags          │ │Language        │
│Researcher│ │Classifier  │ │Suggester     │ │Identifier      │
└───┬────┘ └─────┬──────┘ └──────┬───────┘ └───────┬────────┘
    │            │               │                  │
    ▼            ▼               ▼                  ▼
verified_artist  matched_genre   matched_tags       language
                new_genre?       new_tags?

              ┌────────────────────┐
              │  Consolidation      │
              │  (title + artist)   │
              └────────┬───────────┘
                       │
                       ▼
              ┌────────────────────┐
              │  LyricsResearcher   │
              │  (future: web)     │
              └────────┬───────────┘
                       │
                       ▼
              ┌────────────────────┐
              │  Final Merge        │
              │  → enhanced payload │
              └────────────────────┘
```

---

## Agent Specifications

### 0. LLM Client — Add agent names

Register two new agents in `PROVIDER_CONFIG["deepseek"]["default_models"]` and `PROVIDER_CONFIG["openai"]["default_models"]`:

```
artist_researcher:    deepseek-v4-flash  |  gpt-4o-mini
genre_classifier:     deepseek-v4-flash  |  gpt-4o-mini
tags_suggester:       deepseek-v4-flash  |  gpt-4o-mini
off_vocal_detector:   deepseek-v4-flash  |  gpt-4o-mini
lyrics_researcher:    deepseek-v4-pro    |  gpt-4o
```

Add corresponding env var overrides `AI_ARTIST_RESEARCHER_MODEL`, `AI_GENRE_CLASSIFIER_MODEL`, etc.

---

### 1. OffVocalDetector (NEW — split from TitleGuesser)

**File:** `app/agents/off_vocal_detector.py`

**Input:** `youtube_title: str`

**Output:**
```json
{
  "is_off_vocal": bool,
  "video_has_lyrics": bool,
  "confidence": float
}
```

**Strategy:**
1. **Keyword match (fast, always runs):** Current `_detect_off_vocal()` and `_detect_lyrics()` methods extracted from TitleGuesser:
   - Off-vocal: `off-vocal`, `instrumental`, `karaoke`, `カラオケ`, `インスト`, `off vocal`, `伴奏`, `no vocal`, `no lyrics`
   - Has lyrics: `karaoke`, `lyrics`, `lyric`, `歌詞`, `字幕`, `practice`, `練習用`, `sing along`, `singalong`, `with lyrics`, `lyrics video`, `color coded`, `color-coded`
   - Keyword match returns confidence `0.9`
2. **LLM fallback (only if no keyword match):**
   - Prompt: "Analyze this YouTube video title. Is this video off-vocal/instrumental? Does it have lyrics embedded on screen? Return JSON."
   - `temperature=0.1`, `max_tokens=150`
   - Keyword-match clues passed in prompt as hints
3. **No LLM available →** both false, confidence 0.1

**Parallelism:** Runs in Wave 1 alongside TitleGuesser (only needs youtube_title).

**Migration:** Remove `_detect_off_vocal()`, `_detect_lyrics()` from `title_guesser.py`. TitleGuesser no longer returns `is_off_vocal` / `video_has_lyrics`.

---

### 2. TitleGuesser (MODIFIED — narrower scope)

**File:** `app/agents/title_guesser.py`

**Changes:**
- Remove off-vocal/lyrics keyword detection methods
- Output trimmed to only `{ extracted_title, extracted_artist, confidence }`
- Everything else untouched (LLM prompt, regex fallback, confidence)

---

### 3. ArtistResearcher (NEW)

**File:** `app/agents/artist_researcher.py`

**Input:**
```
title: str           ← from TitleGuesser (or original)
artist: str | None   ← from TitleGuesser (or original)
youtube_title: str   ← original YouTube title
```

**Output:**
```json
{
  "verified_artist": str | null,
  "confidence": float
}
```

**Prompt strategy:**
```
You are a music metadata curator specializing in anime, VTuber, and J-pop songs.

Given a song title and a preliminary artist guess, verify the correct artist.
If the artist seems correct, return it. If incorrect or missing, suggest the correct one.
Normalize artist names (e.g., "YOASOBI" not "Yoasobi", "Ado" not "ado").

Title: {title}
Preliminary Artist: {artist or "unknown"}
Original YouTube Title: {youtube_title}

Return JSON: { "verified_artist": "...", "confidence": 0.0-1.0 }
```

- `temperature=0.2`, `max_tokens=200`
- No LLM → return `{ verified_artist: artist or None, confidence: 0.1 }`

**Why separate from Web Researcher?** The current Web Researcher tries to return artist + genre + tags + year in one prompt. Splitting gives each role dedicated context and improves accuracy.

---

### 4. GenreClassifier (NEW)

**File:** `app/agents/genre_classifier.py`

**Input:**
```
title: str
artist: str | None
existing_genres: list[str]    ← distinct genres from songs table
```

**Output:**
```json
{
  "matched_genre": str | null,
  "is_new_genre": bool,
  "new_genre_suggestion": str | null,
  "confidence": float
}
```

**Prompt strategy:**
```
You classify songs into genres. Below are genres already used in this songbook:
{existing_genres}

Given a song, choose the best-fitting genre from this list.
If none fit, suggest a new genre. Keep genre names short (1-3 words, lowercase).
Examples: j-pop, anime, rock, electronic, city pop, vocaloid, enka, indie

Song: {title} by {artist or "Unknown"}

Return JSON:
{
  "matched_genre": "best genre from the list, or null if none fit",
  "is_new_genre": true/false,
  "new_genre_suggestion": "suggested new genre if is_new_genre, else null",
  "confidence": 0.0-1.0
}
```

- `temperature=0.2`, `max_tokens=200`
- No LLM → `{ null, false, null, 0.0 }`
- Existing genres fetched via `SELECT DISTINCT BTRIM(genre::text) FROM songs WHERE genre IS NOT NULL`

---

### 5. TagsSuggester (NEW)

**File:** `app/agents/tags_suggester.py`

**Input:**
```
title: str
artist: str | None
existing_tags: list[str]      ← distinct tags from songs table
```

**Output:**
```json
{
  "matched_tags": list[str],
  "new_tags": list[str],
  "confidence": float
}
```

**Prompt strategy:**
```
You suggest tags for songs in a karaoke/singalong songbook. Below are tags
already used in this songbook:
{existing_tags}

Tags typically identify: anime/game/VN source, artist group, decade, style, mood.
Keep tags lowercase, prefer canonical names (e.g. "love live" not "Love Live! project").

Song: {title} by {artist or "Unknown"}

Return JSON:
{
  "matched_tags": ["tags from the existing list that apply"],
  "new_tags": ["suggested new tags not in the existing list"],
  "confidence": 0.0-1.0
}
```

- `temperature=0.3`, `max_tokens=250`
- No LLM → `{ [], [], 0.0 }`
- Existing tags fetched via `UNNEST(STRING_TO_ARRAY(tags, ',')) DISTINCT ...`
- **Future:** could search the web to identify anime/game origin for obscure songs

---

### 6. LanguageIdentifier (UNCHANGED)

No modifications. Already works well.

---

### 7. LyricsResearcher (NEW — LLM phase, web search deferred)

**File:** `app/agents/lyrics_researcher.py`

**Input:**
```
title: str           ← consolidated from all prior agents
artist: str | None   ← consolidated from all prior agents
```

**Output:**
```json
{
  "lyrics": str | null,
  "source_url": str | null,
  "confidence": float
}
```

**Phase A (current — LLM knowledge only):**

```
You know song lyrics from your training data. Given a song title and artist,
provide the lyrics if you know them. ONLY return lyrics if you are highly
confident they are correct. Do NOT make up lyrics for songs you don't know.

Song: {title} by {artist or "Unknown"}

Return JSON:
{
  "lyrics": "full lyrics as a single string with \\n line breaks, or null if uncertain",
  "source_url": null,
  "confidence": 0.0-1.0
}
```

- `temperature=0.1`, `max_tokens=2000` (lyrics can be long)
- Use `deepseek-v4-pro` / `gpt-4o` (need the more capable model for accurate recall)
- No LLM → `{ null, null, 0.0 }`
- **Confidence gate:** Only accept lyrics if `confidence >= 0.7`

**Phase B (future — real web search):**

```
1. LLM generates search queries: ["{title} {artist} lyrics", ...]
2. Search API (SerpAPI / Brave / Bing) → top 5 results
3. Fetch each page, LLM extracts lyrics from HTML
4. Cross-reference results, return highest-confidence match
5. Store source_url for audit
```

This is gated behind a config toggle `ENABLE_LYRICS_WEB_SEARCH=false` and a new `AI_LYRICS_RESEARCHER_MODEL` env var pointing to the more capable model.

---

## Orchestrator Rewrite

**File:** `app/agents/orchestrator.py`

### New `enhance()` method:

```python
async def enhance(self, payload: dict, db_session) -> dict:
    youtube_title = payload.get("title", "")
    youtube_description = payload.get("_youtube_description", "")

    # ── Wave 1: Title + Off-Vocal (parallel) ──
    tg_result, ov_result = await asyncio.gather(
        self._run_title_guesser(youtube_title, youtube_description),
        self._run_off_vocal_detector(youtube_title),
    )

    resolved_title = tg_result["extracted_title"] or payload.get("title", "")
    resolved_artist = tg_result["extracted_artist"] or payload.get("artist", "")

    # ── Fetch existing genres/tags from DB ──
    existing_genres = _fetch_distinct_genres(db_session)
    existing_tags = _fetch_distinct_tags(db_session)

    # ── Wave 2: Artist + Genre + Tags + Language (parallel) ──
    ar_result, gc_result, ts_result, li_result = await asyncio.gather(
        self._run_artist_researcher(resolved_title, resolved_artist, youtube_title),
        self._run_genre_classifier(resolved_title, resolved_artist, existing_genres),
        self._run_tags_suggester(resolved_title, resolved_artist, existing_tags),
        self._run_language_identifier(resolved_title, resolved_artist, youtube_title),
    )

    # ── Consolidate title + artist first ──
    partial = self._consolidate_waves_1_2(
        payload, tg_result, ov_result, ar_result, gc_result, ts_result, li_result
    )

    # ── Wave 3: Lyrics (needs final title + artist) ──
    lyrics_result = await self._run_lyrics_researcher(
        partial["title"], partial.get("artist")
    )

    # ── Final merge ──
    return self._final_consolidation(partial, lyrics_result)
```

### Key changes to orchestrator:
1. **TitleGuesser is now async** (or wrapped in `run_in_executor`).
2. **OffVocalDetector** runs in parallel with TitleGuesser in Wave 1.
3. **Existing genres/tags** are fetched from DB and passed to classifier agents.
4. **ArtistResearcher** replaces Web Researcher's artist role.
5. **GenreClassifier** replaces Web Researcher's genre role.
6. **TagsSuggester** replaces Web Researcher's tags role.
7. **LyricsResearcher** runs in Wave 3 after all other fields are consolidated.
8. **WebResearcherAgent is deleted** entirely.

### Consolidation Priority Rules (revised)

| Field | Priority Order |
|-------|---------------|
| `source_url`, `source_id`, `source`, `source_thumbnail` | Always preserved from original |
| `title` | TitleGuesser `extracted_title` → original |
| `artist` | ArtistResearcher `verified_artist` → TitleGuesser `extracted_artist` → original |
| `language` | LanguageIdentifier → original |
| `is_off_vocal` | OffVocalDetector (if confidence > 0.6) → original |
| `video_has_lyrics` | OffVocalDetector (if confidence > 0.6) → original |
| `genre` | GenreClassifier `matched_genre` or `new_genre_suggestion` → original |
| `tags` | TagsSuggester `matched_tags` + `new_tags` → original |
| `lyrics` | LyricsResearcher (if confidence ≥ 0.7) → original |

---

## Schema / Route Changes

### Enhance endpoint must accept a DB session or fetch genres/tags internally

Currently `POST /songs/suggest/enhance` does not touch the DB. The new flow needs existing genres and tags. Two options:

1. **Pass `db: Session` to `OrchestratorAgent.enhance()`** — orchestrator queries DB internally.
2. **Fetch in the route, pass as args** — route queries DB, passes lists to orchestrator.

**Recommendation: Option 2** — keeps agents DB-agnostic, easier to test.

```python
# In router
existing_genres = _extract_distinct_genres(db)
existing_tags = _extract_distinct_tags(db)
enhanced = await orchestrator.enhance(payload, existing_genres, existing_tags)
```

### Identify endpoint (`/suggest/identify?enhance=true`) — same pattern

Already calls the orchestrator with `enhance=true`. Add the same DB context pass-through.

### No new Pydantic schemas needed

The output schema (`SongSuggestIdentifyResponse`) already has all the fields. Genre stays a single string; tags stays `list[str]`. The `is_new_genre` and agent confidence scores are internal — they guide consolidation but aren't exposed to the frontend.

---

## Files Changed

| File | Action |
|------|--------|
| `app/agents/off_vocal_detector.py` | **NEW** |
| `app/agents/artist_researcher.py` | **NEW** |
| `app/agents/genre_classifier.py` | **NEW** |
| `app/agents/tags_suggester.py` | **NEW** |
| `app/agents/lyrics_researcher.py` | **NEW** |
| `app/agents/title_guesser.py` | **MODIFY** — remove off-vocal/lyrics detection |
| `app/agents/web_researcher.py` | **DELETE** — functionality split across Artist/Genre/Tags agents |
| `app/agents/orchestrator.py` | **REWRITE** — wave-based parallelism, 6 agents, new consolidation |
| `app/services/llm_client.py` | **MODIFY** — add 5 new agent model defaults + env var overrides |
| `app/config.py` | **MODIFY** — add 5 new model override settings |
| `app/routers/songs.py` | **MODIFY** — pass existing_genres/existing_tags to orchestrator |
| `.env.example` | **MODIFY** — document new per-agent model env vars |

---

## Agent Count Summary

| Wave | Agent | Status | Model Tier |
|------|-------|--------|------------|
| 1 | TitleGuesser | Existing, scoped down | Pro (`deepseek-v4-pro`) |
| 1 | OffVocalDetector | New | Flash (`deepseek-v4-flash`) |
| 2 | ArtistResearcher | New (from Web Researcher) | Flash |
| 2 | GenreClassifier | New (from Web Researcher) | Flash |
| 2 | TagsSuggester | New (from Web Researcher) | Flash |
| 2 | LanguageIdentifier | Existing, unchanged | Flash |
| 3 | LyricsResearcher | New | Pro (`deepseek-v4-pro`) |

**LLM calls per enhance: max 7** (up from 3). But 6 of the 7 are Flash-tier (cheap), and 4 of the 7 run in parallel, so latency is roughly `max(wave1, wave2) + wave3` ≈ 2 sequential LLM latencies.

---

## Future: Real Web Search

| Milestone | Scope |
|-----------|-------|
| **M1 — Lyrics web search** | Add search API (Brave/SerpAPI), fetch candidate pages, LLM extract lyrics. Gated behind `ENABLE_LYRICS_WEB_SEARCH`. |
| **M2 — Tags web research** | Search web to identify anime/game/VN origin for obscure songs. Add source URLs to tags for audit. |
| **M3 — Artist cross-reference** | Search MusicBrainz / VocaDB / Spotify for artist disambiguation. |

---

## Success Criteria

1. **GenreClassifier** matches against existing DB genres ≥ 80% of the time (reducing genre sprawl).
2. **TagsSuggester** reuses existing tags ≥ 70% of the time.
3. **ArtistResearcher** provides a verified artist on ≥ 90% of well-known anime/pop songs.
4. **LyricsResearcher** returns lyrics with confidence ≥ 0.7 on ≥ 30% of popular songs (LLM knowledge only; higher with web search).
5. Pipeline completes within 5 seconds for Flash-tier agents, 10 seconds when Pro-tier Lyrics agent is involved.
6. Graceful degradation: if any agent fails, the field falls back to its original value.
