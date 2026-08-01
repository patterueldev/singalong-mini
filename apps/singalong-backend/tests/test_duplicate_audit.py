"""Pure-function tests for app.services.duplicate_audit (issue #56).

No DB — find_duplicate_groups takes plain SongRef values built with a real
song_id on each, since the sweep (unlike single-candidate matching in
duplicate_match.py) needs stable identities to build pairs/clusters from.
score_pair itself is reused unchanged (already covered by
test_duplicate_match.py); these tests exercise only the new
enumeration/prefilter/clustering layer on top of it.
"""
from app.services.duplicate_audit import canonical_pair, find_duplicate_groups
from app.services.duplicate_match import SongRef


def ref(title: str, artist: str, song_id: str, **kwargs) -> SongRef:
    return SongRef(title=title, artist=artist, song_id=song_id, **kwargs)


def test_canonical_pair_is_order_independent():
    assert canonical_pair("b", "a") == canonical_pair("a", "b")


def test_high_tier_pair_forms_one_group():
    a = ref("Lemon karaoke", "Kenshi Yonezu", "s1")
    b = ref("Lemon", "Kenshi Yonezu", "s2")
    groups = find_duplicate_groups([a, b])
    assert len(groups) == 1
    assert groups[0].tier == "high"
    assert set(groups[0].song_ids) == {"s1", "s2"}


def test_unrelated_songs_produce_no_groups():
    a = ref("Yoasobi", "Unknown Artist", "s1")
    b = ref("Yorushika", "Unknown Artist", "s2")
    assert find_duplicate_groups([a, b]) == []


def test_dismissed_pair_is_excluded():
    a = ref("Lemon karaoke", "Kenshi Yonezu", "s1")
    b = ref("Lemon", "Kenshi Yonezu", "s2")
    groups = find_duplicate_groups([a, b], dismissed_pairs={canonical_pair("s1", "s2")})
    assert groups == []


def test_exact_source_id_bypasses_prefilter():
    # Wildly different normalized titles but the same source_id must still
    # surface, mirroring rank_candidates's own exact-tier carve-out.
    a = ref("Totally Different Title", "Artist A", "s1", source_id="vid1")
    b = ref("Another Title Entirely", "Artist B", "s2", source_id="vid1")
    groups = find_duplicate_groups([a, b])
    assert len(groups) == 1
    assert groups[0].tier == "exact"


def test_transitive_high_tier_pairs_form_one_three_member_group():
    # A (pure romanization) and C (pure native script) are two stored forms
    # of the same song that share no characters at all — A vs C doesn't
    # even clear the Jaccard prefilter (tier=None). But B is the composite
    # "native (romanization)" form, which scores "high" against both A and
    # C directly, so union-find must still merge all three via B.
    a = ref("Zankoku na Tenshi no Teze", "Yoko Takahashi", "s1")
    b = ref("残酷な天使のテーゼ (Zankoku na Tenshi no These)", "Yoko Takahashi", "s2")
    c = ref("残酷な天使のテーゼ", "Yoko Takahashi", "s3")
    groups = find_duplicate_groups([a, b, c])
    assert len(groups) == 1
    assert groups[0].tier == "high"
    assert set(groups[0].song_ids) == {"s1", "s2", "s3"}


def test_possible_tier_does_not_chain_unrelated_songs_into_mega_group():
    # Three different artists' "Lemon" covers: each pair is "possible"
    # (different-artist), never "high". These must NOT collapse into one
    # group — that would misrepresent three unrelated songs as duplicates.
    a = ref("Lemon", "Kenshi Yonezu", "s1")
    b = ref("Lemon", "Some Cover Band", "s2")
    c = ref("Lemon", "Another Random Group", "s3")
    groups = find_duplicate_groups([a, b, c])
    assert len(groups) == 3
    assert all(g.tier == "possible" and len(g.song_ids) == 2 for g in groups)


def test_possible_edge_into_existing_strong_cluster_is_attached_not_new_group():
    # x and z each pair "high" with y (a placeholder-artist bridge, so the
    # unknown-artist title-only rule applies to both), which unions all
    # three into one cluster. The direct x-z edge — real artists on both
    # sides, same title but different artist — only clears "possible". That
    # edge must be folded into the existing cluster as corroborating detail,
    # not surfaced as a second, redundant standalone group.
    x = ref("Lemon karaoke", "Kenshi Yonezu", "s1")
    y = ref("Lemon", "Unknown Artist", "s2")
    z = ref("Lemon karaoke", "Some Cover Band", "s3")
    groups = find_duplicate_groups([x, y, z])
    assert len(groups) == 1
    strong_group = groups[0]
    assert strong_group.tier == "high"
    assert set(strong_group.song_ids) == {"s1", "s2", "s3"}
    assert any(
        {edge.song_id_a, edge.song_id_b} == {"s1", "s3"} and edge.score.tier == "possible"
        for edge in strong_group.edges
    )


def test_groups_sorted_exact_before_high_before_possible():
    exact_a = ref("Totally Different Title", "Artist A", "s1", source_id="vid1")
    exact_b = ref("Another Title Entirely", "Artist B", "s2", source_id="vid1")
    high_a = ref("Lemon karaoke", "Kenshi Yonezu", "s3")
    high_b = ref("Lemon", "Kenshi Yonezu", "s4")
    possible_a = ref("Pretender", "Official Band", "s5")
    possible_b = ref("Pretender", "Some Cover Band", "s6")
    groups = find_duplicate_groups([exact_a, exact_b, high_a, high_b, possible_a, possible_b])
    assert [g.tier for g in groups] == ["exact", "high", "possible"]


def test_songs_without_song_id_are_ignored():
    a = ref("Lemon", "Kenshi Yonezu", None)
    b = ref("Lemon", "Kenshi Yonezu", "s2")
    assert find_duplicate_groups([a, b]) == []
