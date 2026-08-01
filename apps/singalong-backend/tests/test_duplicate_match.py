"""Pure-function tests for app.services.duplicate_match.

No DB, no app import, no fixtures — score_pair/rank_candidates take plain
SongRef values, so these are all deterministic asserts. `Song` uses a
Postgres UUID column and a Postgres enum type, so SQLite-in-memory can't
stand the ORM model up without dialect hacks; spinning real Postgres in CI
is disproportionate for one projected SELECT (load_match_refs), so that
thin DB layer is verified manually instead.

Every case below is anchored to a real measurement taken while building the
matcher (see the module docstring in duplicate_match.py for the motivating
issue, #27), not a hypothetical.
"""
from app.services.duplicate_match import (
    SongRef,
    normalize_for_match,
    rank_candidates,
    score_pair,
)


def ref(title: str, artist: str, **kwargs) -> SongRef:
    return SongRef(title=title, artist=artist, **kwargs)


def test_motivating_case_romanization_variant_is_high():
    # The exact bug from issue #27: a different YouTube upload of the same
    # song, identified only by its romanized title, must be flagged against
    # the songbook's stored "native (romanization)" composite.
    candidate = ref("Zankoku na Tenshi no Teze", "Yoko Takahashi")
    existing = ref("残酷な天使のテーゼ (Zankoku na Tenshi no These)", "Yoko Takahashi")
    result = score_pair(candidate, existing)
    assert result.tier == "high"
    assert result.title_score >= 0.90
    assert "romanization-variant" in result.reasons


def test_native_only_candidate_vs_composite_is_high():
    candidate = ref("残酷な天使のテーゼ", "Yoko Takahashi")
    existing = ref("残酷な天使のテーゼ (Zankoku na Tenshi no These)", "Yoko Takahashi")
    result = score_pair(candidate, existing)
    assert result.tier == "high"
    assert result.title_score == 1.0


def test_whole_string_comparison_would_have_missed_it():
    # Documents *why* variant generation exists: comparing the raw romanized
    # candidate against the whole stored composite string (not the isolated
    # romanization) scores well under the high floor.
    candidate_norm = normalize_for_match("Zankoku na Tenshi no Teze")
    existing_norm = normalize_for_match("残酷な天使のテーゼ (Zankoku na Tenshi no These)")
    from difflib import SequenceMatcher

    whole_string_score = SequenceMatcher(None, candidate_norm, existing_norm).ratio()
    assert whole_string_score < 0.85


def test_noise_stripped_title_is_high():
    result = score_pair(ref("Lemon karaoke", "Kenshi Yonezu"), ref("Lemon", "Kenshi Yonezu"))
    assert result.tier == "high"
    assert "noise-stripped" in result.reasons


def test_same_title_different_artist_is_possible_never_high():
    result = score_pair(ref("Lemon", "Kenshi Yonezu"), ref("Lemon", "Some Cover Band"))
    assert result.tier == "possible"
    assert "different-artist" in result.reasons


def test_artist_token_order_scores_full_agreement():
    result = score_pair(
        ref("Hikaru Utada Song", "Hikaru Utada"),
        ref("Hikaru Utada Song", "Utada Hikaru"),
    )
    assert result.artist_score == 1.0
    assert result.tier == "high"


def test_unrelated_titles_do_not_match():
    result = score_pair(ref("Yoasobi", "Unknown Artist"), ref("Yorushika", "Unknown Artist"))
    assert result.tier is None


def test_short_cjk_one_character_diff_is_not_high():
    result = score_pair(ref("紅蓮華", "LiSA"), ref("紅蓮花", "LiSA"))
    assert result.tier != "high"


def test_placeholder_artist_does_not_manufacture_agreement():
    result = score_pair(ref("Some Song", "Unknown Artist"), ref("Some Song", "Unknown Artist"))
    assert result.artist_score is None
    # Still high: identical title, and an unknown-vs-unknown artist isn't
    # penalized, but title_score must clear the stricter unknown-artist floor.
    assert result.tier == "high"


def test_containment_gate_rejects_short_fragment():
    result = score_pair(ref("Koi", "Someone"), ref("Koi ni Naritai AQUARIUM", "Someone"))
    assert result.tier is None


def test_identical_short_cjk_title_is_high_despite_length():
    # The length gate exists to stop short-string coincidences from crossing
    # the high floor — it must never suppress a literally perfect match.
    result = score_pair(ref("ゲーム", "Someone"), ref("ゲーム", "Someone"))
    assert result.tier == "high"
    assert result.title_score == 1.0


def test_fullwidth_and_halfwidth_fold_via_nfkc():
    result = score_pair(ref("ＬＥＭＯＮ", "Kenshi Yonezu"), ref("Lemon", "Kenshi Yonezu"))
    assert result.title_score == 1.0


def test_nfkd_accent_fold_does_not_corrupt_cjk_dakuten():
    # Regression guard: NFKD decomposition strips combining marks, which
    # would corrupt Japanese dakuten/handakuten if applied to CJK strings.
    # normalize_for_match must skip that step for CJK input.
    assert normalize_for_match("ゲーム") == "ゲーム"


def test_score_pair_is_symmetric():
    a = ref("A Title", "An Artist")
    b = ref("A Different Title", "A Different Artist")
    assert score_pair(a, b) == score_pair(b, a)


def test_exact_source_id_short_circuits():
    a = ref("Totally Different Title", "Totally Different Artist", source_id="abc123")
    b = ref("Another Title Entirely", "Another Artist Entirely", source_id="abc123")
    result = score_pair(a, b)
    assert result.tier == "exact"
    assert result.score == 1.0


def test_translated_artist_name_caps_identical_title_at_possible():
    # Real production case: two YouTube uploads of the same karaoke track
    # ("めにしゅき♡ラッシュっしゅ!", an Uma Musume character song) with a
    # byte-identical native title, but one stored with a romanized artist
    # ("Uma Musume") and the other with the native franchise name ("ウマ娘").
    # That's a *translation*, not a transliteration, so no string-similarity
    # signal bridges it — the pair must still surface as a 'possible' match
    # (not silently dropped) so the frontend can prompt a human.
    candidate = ref(
        "めにしゅき♡ラッシュっしゅ! (Meni Shuki♡Rasshu sshu!)",
        "ウマ娘",
        source_id="25TGT5-NJ_g",
    )
    existing = ref(
        "めにしゅき♡ラッシュっしゅ! (Meni Shuki♡Rush-sshu!)",
        "Uma Musume",
        source_id="ANqLXWMVCRU",
    )
    result = score_pair(candidate, existing)
    assert result.title_score == 1.0
    assert result.artist_score == 0.0
    assert result.tier == "possible"
    assert "different-artist" in result.reasons


def test_rank_candidates_prefilter_does_not_drop_the_motivating_case():
    # Regression guard for the Jaccard prefilter: it must compare full
    # normalized titles (which include a trailing parenthetical's contents),
    # not the paren-stripped base — otherwise a Latin-only candidate is
    # compared against a bare CJK base and always misses.
    existing = ref(
        "残酷な天使のテーゼ (Zankoku na Tenshi no These)",
        "Yoko Takahashi",
        song_id="song-1",
        source_id="existing-video-id",
        status="published",
    )
    candidate = ref("Zankoku na Tenshi no Teze", "Yoko Takahashi", source_id="new-video-id")

    matches = rank_candidates(candidate, [existing])

    assert len(matches) == 1
    assert matches[0].ref.song_id == "song-1"
    assert matches[0].score.tier == "high"


def test_rank_candidates_excludes_self_and_drops_no_matches():
    existing = ref("Completely Unrelated", "Nobody", song_id="song-2", status="published")
    candidate = ref("Zankoku na Tenshi no Teze", "Yoko Takahashi", source_id="new-video-id")

    matches = rank_candidates(candidate, [existing])

    assert matches == []


def test_rank_candidates_respects_exclude_song_id():
    existing = ref(
        "Zankoku na Tenshi no Teze",
        "Yoko Takahashi",
        song_id="self",
        source_id="same-id",
        status="published",
    )
    candidate = ref("Zankoku na Tenshi no Teze", "Yoko Takahashi", source_id="same-id")

    matches = rank_candidates(candidate, [existing], exclude_song_id="self")

    assert matches == []
