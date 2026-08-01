"""Whole-songbook duplicate sweep for the admin audit UI (issue #56).

Built entirely on duplicate_match.py's pure scoring core, reused UNCHANGED
per that issue's explicit instruction: this module adds only the
pairwise-enumeration/prefilter/clustering layer on top of `score_pair`.

`score_pair`/`rank_candidates` are single-candidate-oriented (one candidate
vs many refs). A full sweep instead needs each unique pair (i < j) scored
exactly once, so this module enumerates pairs directly against `score_pair`
rather than going through `rank_candidates`.

Clustering is two-tier and deliberately NOT one big union-find over every
edge:
  - exact/high edges are transitively trustworthy (duplicate_match.py's own
    tests guarantee "high" never fires for a same-title/different-artist
    coincidence), so they're unioned into multi-song clusters.
  - possible edges are kept as standalone pairs UNLESS both endpoints
    already landed in the same strong cluster (then the edge is just
    attached as corroborating detail). Unioning possible edges freely would
    collapse every same-titled-but-different-artist song ("Lemon" by five
    different artists) into one meaningless mega-group.
The actual admin actions (merge/dismiss) are pair-scoped regardless of how
songs get grouped for display, so grouping is a presentation concern only.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Collection, Literal, Sequence

from .duplicate_match import JACCARD_PREFILTER_FLOOR, MatchScore, SongRef, _char_jaccard, normalize_for_match, score_pair
from .ytdlp.url_utils import extract_youtube_video_id

Tier = Literal["exact", "high", "possible"]
_TIER_RANK = {"exact": 0, "high": 1, "possible": 2}
_STRONG_TIERS = ("exact", "high")


def canonical_pair(song_id_a: str, song_id_b: str) -> tuple[str, str]:
    """Order-independent pair key so (A, B) and (B, A) collide."""
    a, b = sorted((song_id_a, song_id_b))
    return (a, b)


def _effective_source_id(ref: SongRef) -> str | None:
    """Best-effort canonical video id for cross-matching two songbook rows.

    Two rows can be "the same video" without a raw `source_id ==
    source_id` check catching it: an older row may never have had
    `source_id` populated (only `source_url`), or may have `source_id`
    stored as a full URL rather than the bare id from an earlier ingestion
    path. `extract_youtube_video_id` already knows how to pull a bare id
    out of any of those shapes (or pass a clean id through unchanged), so
    it's reused here to resolve both sides to the same canonical form
    before comparing — falling back to the raw `source_id` only if it
    doesn't parse as anything recognizable, so a legitimate non-YouTube or
    non-standard id isn't discarded.
    """
    if ref.source_id:
        return extract_youtube_video_id(ref.source_id) or ref.source_id
    if ref.source_url:
        return extract_youtube_video_id(ref.source_url)
    return None


@dataclass(frozen=True)
class DuplicateEdge:
    song_id_a: str
    song_id_b: str
    score: MatchScore


@dataclass(frozen=True)
class DuplicateGroup:
    group_id: str
    tier: Tier
    song_ids: tuple[str, ...]
    edges: tuple[DuplicateEdge, ...]


class _UnionFind:
    def __init__(self) -> None:
        self._parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self._parent.setdefault(x, x)
        while self._parent[x] != x:
            self._parent[x] = self._parent[self._parent[x]]
            x = self._parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        root_a, root_b = self.find(a), self.find(b)
        if root_a != root_b:
            self._parent[root_a] = root_b


def find_duplicate_groups(
    refs: Sequence[SongRef],
    *,
    dismissed_pairs: Collection[tuple[str, str]] = frozenset(),
) -> list[DuplicateGroup]:
    """Pure, O(n^2)-worst-case pairwise sweep over the whole songbook.

    Every candidate pair is scored with `score_pair`, reused unchanged;
    only enumeration/prefilter/grouping is new here. Refs without a
    `song_id` are ignored — grouping needs stable identities to build pairs
    and clusters from, unlike single-candidate matching.

    Before scoring, each ref's source id is resolved to a canonical form
    (see `_effective_source_id`) so two rows for the exact same video are
    still recognized as an "exact" match even when their stored
    `source_id` values aren't byte-for-byte identical — e.g. one row only
    has `source_url`, or an older row's `source_id` was stored as a full
    URL. `score_pair` itself still only ever compares `SongRef.source_id`,
    unchanged — this just feeds it the resolved value.
    """
    usable = [ref for ref in refs if ref.song_id is not None]
    normalized_titles = [normalize_for_match(ref.title or "") for ref in usable]
    effective_source_ids = [_effective_source_id(ref) for ref in usable]

    strong_edges: list[DuplicateEdge] = []
    weak_edges: list[DuplicateEdge] = []
    count = len(usable)
    for i in range(count):
        song_a = usable[i]
        for j in range(i + 1, count):
            song_b = usable[j]
            if canonical_pair(song_a.song_id, song_b.song_id) in dismissed_pairs:
                continue

            source_id_a = effective_source_ids[i]
            source_id_b = effective_source_ids[j]
            is_exact_source = bool(source_id_a and source_id_b and source_id_a == source_id_b)
            if not is_exact_source and _char_jaccard(normalized_titles[i], normalized_titles[j]) < JACCARD_PREFILTER_FLOOR:
                continue

            scoring_a = song_a if source_id_a == song_a.source_id else replace(song_a, source_id=source_id_a)
            scoring_b = song_b if source_id_b == song_b.source_id else replace(song_b, source_id=source_id_b)
            result = score_pair(scoring_a, scoring_b)
            if result.tier is None:
                continue
            edge = DuplicateEdge(song_id_a=song_a.song_id, song_id_b=song_b.song_id, score=result)
            (strong_edges if result.tier in _STRONG_TIERS else weak_edges).append(edge)

    union_find = _UnionFind()
    for edge in strong_edges:
        union_find.union(edge.song_id_a, edge.song_id_b)

    strong_edges_by_root: dict[str, list[DuplicateEdge]] = {}
    member_root: dict[str, str] = {}
    for edge in strong_edges:
        root = union_find.find(edge.song_id_a)
        strong_edges_by_root.setdefault(root, []).append(edge)
        member_root[edge.song_id_a] = root
        member_root[edge.song_id_b] = root

    standalone_weak_edges: list[DuplicateEdge] = []
    for edge in weak_edges:
        root_a = member_root.get(edge.song_id_a)
        root_b = member_root.get(edge.song_id_b)
        if root_a is not None and root_a == root_b:
            strong_edges_by_root[root_a].append(edge)
        else:
            standalone_weak_edges.append(edge)

    groups: list[DuplicateGroup] = []
    for group_edges in strong_edges_by_root.values():
        song_ids = tuple(sorted({sid for edge in group_edges for sid in (edge.song_id_a, edge.song_id_b)}))
        tier: Tier = "exact" if any(edge.score.tier == "exact" for edge in group_edges) else "high"
        sorted_edges = tuple(
            sorted(group_edges, key=lambda edge: (_TIER_RANK[edge.score.tier], -edge.score.score))
        )
        groups.append(DuplicateGroup(group_id=song_ids[0], tier=tier, song_ids=song_ids, edges=sorted_edges))

    for edge in standalone_weak_edges:
        song_ids = tuple(sorted((edge.song_id_a, edge.song_id_b)))
        groups.append(DuplicateGroup(group_id=song_ids[0], tier="possible", song_ids=song_ids, edges=(edge,)))

    groups.sort(key=lambda group: (_TIER_RANK[group.tier], -max(edge.score.score for edge in group.edges), group.group_id))
    return groups
