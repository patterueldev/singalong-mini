"""Fuzzy title/artist duplicate detection against the songbook.

Split into three layers so the pure scoring core is reusable, unchanged, by a
future admin "audit the whole songbook for duplicates" sweep:

    load_match_refs(db, ...)              <- the only function touching a Session
    rank_candidates(candidate, refs, ...) <- pure
    score_pair(a, b)                      <- pure, symmetric; the reusable core

The motivating case (see GitHub issue #27): a song already stored as
"残酷な天使のテーゼ (Zankoku na Tenshi no These)" was not flagged as a duplicate
when a guest identified a *different* YouTube upload titled
"Zankoku na Tenshi no Teze" — the only existing check is exact source_id
equality. Comparing the two titles whole-string scores ~0.79; comparing the
candidate against the isolated romanization variant scores ~0.94. Variant
generation (title_variants) is therefore the core of this module.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Collection, Iterable, Literal

from sqlalchemy.orm import Session

from ..models import Song
from .song_quality import PLACEHOLDER_ARTISTS, is_placeholder
from .title_format import has_cjk_script, split_trailing_parentheticals

# Superset of SUGGEST_KEYWORD_REGEX (app/routers/songs.py) for stripping
# noise tokens before comparison. Deliberately NOT merged into that constant:
# SUGGEST_KEYWORD_REGEX decides whether to append "karaoke" to a YouTube
# search query, and widening it would suppress that augmentation for any
# query containing e.g. "live".
NOISE_TOKEN_REGEX = re.compile(
    r"\b("
    r"karaoke|instrumental|off[\s-]?vocal|cover|live|acoustic|"
    r"full\s?version|tv\s?size|mv|official(\s+music)?\s+video|"
    r"lyrics?\s+video|hd|4k|romaji"
    r")\b|カラオケ|オフボーカル|歌詞",
    re.IGNORECASE,
)

# Kept in sync with app/routers/songs.py's own normalizer contract: casefold +
# collapse non-word runs to a single space + trim. `\w` under re.UNICODE keeps
# Han/Kana/Hangul, so this is CJK-safe without any special-casing.
_SEARCH_NORMALIZER_REGEX = re.compile(r"[^\w]+", re.UNICODE)

MIN_VARIANT_LENGTH = 2
MAX_VARIANTS = 8
JACCARD_PREFILTER_FLOOR = 0.35
CONTAINMENT_LENGTH_RATIO_FLOOR = 0.60

HIGH_TITLE_FLOOR = 0.90
HIGH_TITLE_FLOOR_UNKNOWN_ARTIST = 0.95
HIGH_ARTIST_FLOOR = 0.80
HIGH_MIN_VARIANT_LENGTH_CJK = 4
# A single-character CJK edit swings the ratio far more than a single-letter
# Latin edit does (SequenceMatcher on "Idol"/"Idle" already lands at 0.75,
# well under HIGH_TITLE_FLOOR), so 4 is a safe floor for both scripts and
# does not block common short titles like "Lemon" (5 chars).
HIGH_MIN_VARIANT_LENGTH_LATIN = 4
POSSIBLE_TITLE_FLOOR = 0.72
POSSIBLE_DIFFERENT_ARTIST_TITLE_FLOOR = 0.85
POSSIBLE_DIFFERENT_ARTIST_CEILING = 0.55

Tier = Literal["exact", "high", "possible"]


def normalize_search_text(value: str | None) -> str:
    """Casefold + collapse non-word runs to a single space + trim.

    This is the shared normalizer also used (as `_normalize_search_text`) by
    the plain songbook search endpoint in app/routers/songs.py. NFKC folding
    is deliberately NOT applied here — this function has a SQL twin
    (`_search_normalized_expression`) that Postgres must be able to express,
    and Postgres cannot do NFKC. Adding it only here would silently diverge
    the two. NFKC lives in `normalize_for_match` below instead.
    """
    if not isinstance(value, str):
        return ""
    normalized = _SEARCH_NORMALIZER_REGEX.sub(" ", value.casefold()).strip()
    return re.sub(r"\s+", " ", normalized)


def normalize_for_match(value: str | None) -> str:
    """Fold a string down to a comparable form for fuzzy matching.

    1. NFKC — folds full-width Latin (ＬＥＭＯＮ) and half-width kana (ﾚﾓﾝ)
       onto their canonical forms.
    2. Accent-fold (NFKD + drop combining marks) — but ONLY when the string
       has no CJK/Hangul script. NFKD on Japanese strips dakuten
       (ゲーム -> ケーム), which would corrupt titles, so this step is
       skipped entirely for CJK strings.
    3. The shared casefold + non-word-collapse normalizer.
    """
    if not isinstance(value, str) or value == "":
        return ""
    folded = unicodedata.normalize("NFKC", value)
    if not has_cjk_script(folded):
        decomposed = unicodedata.normalize("NFKD", folded)
        folded = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return normalize_search_text(folded)


def _strip_noise(value: str) -> str:
    stripped = NOISE_TOKEN_REGEX.sub(" ", value)
    return re.sub(r"\s+", " ", stripped).strip()


def _dedupe_variants(variants: Iterable[str]) -> tuple[str, ...]:
    seen: set[str] = set()
    result: list[str] = []
    for variant in variants:
        if len(variant) < MIN_VARIANT_LENGTH or variant in seen:
            continue
        seen.add(variant)
        result.append(variant)
        if len(result) >= MAX_VARIANTS:
            break
    return tuple(result)


@dataclass(frozen=True)
class _TaggedVariant:
    value: str
    from_parenthetical: bool
    is_noise_stripped: bool


def _tagged_title_variants(title: str) -> tuple[_TaggedVariant, ...]:
    """Normalized comparison variants for one title, tagged with provenance.

    For a stored composite "残酷な天使のテーゼ (Zankoku na Tenshi no These)"
    this yields the full string, the native base, and the romanization on its
    own — so a romanization-only candidate can match at full strength instead
    of being diluted by the native half. Also yields a noise-stripped copy of
    each variant. Tags let `_title_score` report *why* a pair matched instead
    of re-deriving it from string equality after the fact.
    """
    candidates: list[_TaggedVariant] = []

    full = normalize_for_match(title)
    if full:
        candidates.append(_TaggedVariant(full, from_parenthetical=False, is_noise_stripped=False))

    base, parens = split_trailing_parentheticals(title or "")
    normalized_base = normalize_for_match(base)
    if normalized_base and normalized_base != full:
        candidates.append(_TaggedVariant(normalized_base, from_parenthetical=False, is_noise_stripped=False))

    # A trailing paren is only treated as an alternate-title variant (a
    # romanization) when the base title is CJK, per this codebase's own
    # storage contract (title_format.compose_display_title). On a Latin
    # title a trailing paren is a version qualifier ("Live", "TV Size") and
    # comparing it alone would manufacture false hits.
    if has_cjk_script(base):
        for paren in parens:
            if has_cjk_script(paren):
                continue
            normalized_paren = normalize_for_match(paren)
            if normalized_paren:
                candidates.append(_TaggedVariant(normalized_paren, from_parenthetical=True, is_noise_stripped=False))

    with_noise_stripped = list(candidates)
    for candidate in candidates:
        stripped = _strip_noise(candidate.value)
        if stripped and stripped != candidate.value:
            with_noise_stripped.append(
                _TaggedVariant(stripped, from_parenthetical=candidate.from_parenthetical, is_noise_stripped=True)
            )

    seen: set[str] = set()
    result: list[_TaggedVariant] = []
    for variant in with_noise_stripped:
        if len(variant.value) < MIN_VARIANT_LENGTH or variant.value in seen:
            continue
        seen.add(variant.value)
        result.append(variant)
        if len(result) >= MAX_VARIANTS:
            break
    return tuple(result)


def title_variants(title: str) -> tuple[str, ...]:
    """Normalized comparison variants for one title (plain strings).

    See `_tagged_title_variants` for the full behavior; this is the public,
    untagged view of the same variants.
    """
    return tuple(variant.value for variant in _tagged_title_variants(title))


def artist_variants(artist: str) -> tuple[str, ...]:
    """Normalized comparison variants for one artist.

    Yields the full normalized form, the primary artist before a
    feat./ft./&/, separator (in case only the first artist matches), and the
    token-sorted form (so "Hikaru Utada" and "Utada Hikaru" compare equal).
    """
    candidates: list[str] = []

    full = normalize_for_match(artist)
    if full:
        candidates.append(full)

    primary = re.split(r"\b(feat|ft|featuring)\b|[,&/]", artist or "", maxsplit=1)[0]
    normalized_primary = normalize_for_match(primary)
    if normalized_primary and normalized_primary != full:
        candidates.append(normalized_primary)

    return _dedupe_variants(candidates)


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _ratio3(a: str, b: str) -> float:
    """Symmetric similarity, taking the best of three signals.

    Plain difflib is word-order sensitive, so token-sorted comparison is
    added for artist name reordering ("Hikaru Utada" / "Utada Hikaru"). A
    containment bonus handles a variant that is a clean substring of the
    other, gated on length ratio so a short fragment like "Koi" doesn't
    score 1.0 against "Koi ni Naritai AQUARIUM".
    """
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0

    direct = _ratio(a, b)
    sorted_a = " ".join(sorted(a.split()))
    sorted_b = " ".join(sorted(b.split()))
    sorted_score = _ratio(sorted_a, sorted_b)

    containment = 0.0
    if a in b or b in a:
        length_ratio = min(len(a), len(b)) / max(len(a), len(b))
        if length_ratio >= CONTAINMENT_LENGTH_RATIO_FLOOR:
            containment = 0.90 + 0.10 * length_ratio

    return max(direct, sorted_score, containment)


def _char_jaccard(a: str, b: str) -> float:
    set_a, set_b = set(a), set(b)
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union else 0.0


@dataclass(frozen=True)
class SongRef:
    """Minimal identity of a song for duplicate comparison.

    Deliberately not the ORM Song: the pure scoring layer must be usable
    against hand-built refs in tests and against a lightweight column
    projection in the future admin audit sweep.
    """

    title: str
    artist: str
    song_id: str | None = None
    source_id: str | None = None
    source_url: str | None = None
    thumbnail_file: str | None = None
    status: str | None = None
    archived: bool = False


@dataclass(frozen=True)
class MatchScore:
    score: float
    title_score: float
    artist_score: float | None
    tier: Tier | None
    reasons: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class DuplicateMatch:
    ref: SongRef
    score: MatchScore


def _title_score(a: SongRef, b: SongRef) -> tuple[float, tuple[str, ...], int]:
    """Returns (best score, reasons, shorter-side length of the WINNING variant pair).

    The length is tracked per-winning-pair, not the shortest variant overall —
    a title's noise-stripped variant is often much shorter than its full form,
    and it's specifically the winning pair's granularity that the "high" tier
    length gate needs to reason about.
    """
    variants_a = _tagged_title_variants(a.title)
    variants_b = _tagged_title_variants(b.title)

    best = 0.0
    reasons: list[str] = []
    best_length = 0

    for variant_a in variants_a:
        for variant_b in variants_b:
            score = _ratio3(variant_a.value, variant_b.value)
            if score <= best:
                continue
            best = score
            best_length = min(len(variant_a.value), len(variant_b.value))
            reasons = []
            if variant_a.from_parenthetical or variant_b.from_parenthetical:
                reasons.append("romanization-variant")
            if variant_a.is_noise_stripped or variant_b.is_noise_stripped:
                reasons.append("noise-stripped")

    return best, tuple(reasons), best_length


def score_pair(a: SongRef, b: SongRef) -> MatchScore:
    """Pure symmetric similarity between two (title, artist) pairs.

    No I/O, no globals, no DB — this is the function a future admin
    duplicate-audit endpoint can reuse unchanged for its pairwise sweep.
    """
    if a.source_id and b.source_id and a.source_id == b.source_id:
        return MatchScore(score=1.0, title_score=1.0, artist_score=1.0, tier="exact", reasons=("source-id-match",))

    title_score, reasons, shortest_winning_length = _title_score(a, b)

    a_placeholder = is_placeholder(a.artist, PLACEHOLDER_ARTISTS)
    b_placeholder = is_placeholder(b.artist, PLACEHOLDER_ARTISTS)
    if a_placeholder or b_placeholder:
        artist_score: float | None = None
    else:
        artist_score = max(
            (_ratio3(va, vb) for va in artist_variants(a.artist) for vb in artist_variants(b.artist)),
            default=0.0,
        )

    reasons_list = list(reasons)
    tier: Tier | None = None

    min_variant_length = HIGH_MIN_VARIANT_LENGTH_CJK if has_cjk_script(a.title) or has_cjk_script(b.title) else HIGH_MIN_VARIANT_LENGTH_LATIN

    if artist_score is not None and artist_score < POSSIBLE_DIFFERENT_ARTIST_CEILING and title_score >= POSSIBLE_DIFFERENT_ARTIST_TITLE_FLOOR:
        reasons_list.append("different-artist")

    is_high = (
        title_score >= HIGH_TITLE_FLOOR
        # The length gate exists to stop a short-string coincidence from
        # crossing the high-confidence floor. A perfect (post-normalization)
        # title match carries no such coincidence risk regardless of length —
        # e.g. two identical 3-character CJK titles ("ゲーム" == "ゲーム")
        # must not be down-tiered just for being short.
        and (title_score >= 1.0 or shortest_winning_length >= min_variant_length)
        and (
            (artist_score is None and title_score >= HIGH_TITLE_FLOOR_UNKNOWN_ARTIST)
            or (artist_score is not None and artist_score >= HIGH_ARTIST_FLOOR)
        )
    )

    if is_high:
        tier = "high"
    elif title_score >= POSSIBLE_TITLE_FLOOR or "different-artist" in reasons_list:
        tier = "possible"

    return MatchScore(
        score=title_score,
        title_score=title_score,
        artist_score=artist_score,
        tier=tier,
        reasons=tuple(reasons_list),
    )


def rank_candidates(
    candidate: SongRef,
    refs: Iterable[SongRef],
    *,
    limit: int = 5,
    exclude_song_id: str | None = None,
) -> list[DuplicateMatch]:
    """Score `candidate` against `refs`, drop everything below the floor,
    sort by (tier rank, score desc, title). Pure — no I/O."""
    # Use the FULL normalized title (not the paren-stripped base) for the
    # prefilter: the full variant's character set always includes whatever
    # is inside a trailing parenthetical, which is exactly where a stored
    # song's romanization lives. Prefiltering on the base alone would compare
    # a Latin candidate against a bare CJK base and always miss — silently
    # dropping the motivating case (issue #27) before score_pair ever runs.
    candidate_norm = normalize_for_match(candidate.title or "")

    matches: list[DuplicateMatch] = []
    for ref in refs:
        if exclude_song_id is not None and ref.song_id == exclude_song_id:
            continue

        ref_norm = normalize_for_match(ref.title or "")
        if not (candidate.source_id and ref.source_id and candidate.source_id == ref.source_id):
            if _char_jaccard(candidate_norm, ref_norm) < JACCARD_PREFILTER_FLOOR:
                continue

        result = score_pair(candidate, ref)
        if result.tier is None:
            continue
        matches.append(DuplicateMatch(ref=ref, score=result))

    tier_rank = {"exact": 0, "high": 1, "possible": 2}
    matches.sort(key=lambda m: (tier_rank.get(m.score.tier, 3), -m.score.score, m.ref.title))
    return matches[:limit]


def load_match_refs(
    db: Session,
    *,
    include_archived: bool = True,
    statuses: Collection[str] | None = None,
) -> list[SongRef]:
    """Load the songbook as SongRefs.

    Column projection only — never loads `lyrics`/`extra_metadata` (unbounded
    Text) for every row, since that (not the Python scoring) is the real
    perf hazard at scale. No status/archived filter by default: the exact
    source_id checks elsewhere in this codebase filter nothing either, and a
    draft/downloading/archived/error row is exactly the kind of duplicate
    worth surfacing (see duplicate_match module docstring / plan notes).
    """
    query = db.query(
        Song.id,
        Song.title,
        Song.artist,
        Song.source_id,
        Song.source_url,
        Song.thumbnail_file,
        Song.status,
        Song.archived_at,
    )
    if statuses is not None:
        query = query.filter(Song.status.in_(statuses))
    if not include_archived:
        query = query.filter(Song.archived_at.is_(None))

    refs: list[SongRef] = []
    for row in query.limit(20000).all():
        refs.append(
            SongRef(
                title=row.title,
                artist=row.artist,
                song_id=str(row.id),
                source_id=row.source_id,
                source_url=row.source_url,
                thumbnail_file=row.thumbnail_file,
                status=row.status,
                archived=row.archived_at is not None,
            )
        )
    return refs


def find_duplicate_candidates(
    db: Session,
    candidate: SongRef,
    *,
    limit: int = 5,
    exclude_song_id: str | None = None,
) -> list[DuplicateMatch]:
    """Convenience wrapper: load_match_refs + rank_candidates."""
    refs = load_match_refs(db)
    return rank_candidates(candidate, refs, limit=limit, exclude_song_id=exclude_song_id)
