"""Deterministic composition/normalization of romanized composite song titles.

Song titles that are natively CJK/Hangul script should be stored as
"<native> (<Romanization>)" so guests who can't read the script can still
follow along. The LLM agents (title_guesser, title_researcher) are asked to
produce the native title and a romanization as *separate* fields; this module
is the single place that composes them into the stored display string and
guards against a model that ignores the schema and jams both into one field,
double-parenthesizes, or returns a stray English translation instead of a
romanization.

Titles that are already fully Latin script (e.g. "TAKARAMONOZU") are never
touched.
"""
import re

# Han (CJK Unified Ideographs + Extension A), Hiragana, Katakana (+ phonetic
# extensions), and Hangul (syllables + Jamo blocks).
_CJK_RANGES = (
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs
    (0x3400, 0x4DBF),  # CJK Unified Ideographs Extension A
    (0x3040, 0x309F),  # Hiragana
    (0x30A0, 0x30FF),  # Katakana
    (0x31F0, 0x31FF),  # Katakana Phonetic Extensions
    (0xAC00, 0xD7AF),  # Hangul Syllables
    (0x1100, 0x11FF),  # Hangul Jamo
    (0x3130, 0x318F),  # Hangul Compatibility Jamo
)

_TRAILING_PAREN_PATTERN = re.compile(r"\s*\(([^()]*)\)\s*$")
_WHITESPACE_PATTERN = re.compile(r"\s+")

MAX_TITLE_LENGTH = 5000


def has_cjk_script(text: str) -> bool:
    """Return True if `text` contains any Han/Hiragana/Katakana/Hangul character."""
    if not text:
        return False
    for char in text:
        code_point = ord(char)
        for start, end in _CJK_RANGES:
            if start <= code_point <= end:
                return True
    return False


def _collapse_whitespace(text: str) -> str:
    return _WHITESPACE_PATTERN.sub(" ", text).strip()


def split_trailing_parentheticals(title: str) -> tuple[str, list[str]]:
    """
    Peel off zero or more trailing "(...)" groups from the end of `title`.

    Returns (base_title, [inner_contents_innermost_group_last_removed_first]),
    i.e. the parentheticals are returned in the order they appeared, left to
    right, reading the original string. Only groups anchored at the very end
    of the (progressively shortened) string are peeled — a parenthetical in
    the middle of the title is left alone.
    """
    remaining = title.strip()
    collected: list[str] = []
    while True:
        match = _TRAILING_PAREN_PATTERN.search(remaining)
        if match is None:
            break
        collected.append(match.group(1).strip())
        remaining = remaining[: match.start()].strip()
    collected.reverse()
    return remaining, collected


def compose_display_title(native: str, romanization: str | None) -> str:
    """
    Compose the stored display title from a native title and an optional
    romanization, e.g. ("恋になりたいAQUARIUM", "Koi ni Naritai AQUARIUM")
    -> "恋になりたいAQUARIUM (Koi ni Naritai AQUARIUM)".

    Titles with no CJK/Hangul script are returned unchanged (e.g.
    "TAKARAMONOZU" stays "TAKARAMONOZU") — romanization is meaningless for an
    already-Latin title, even if one was (incorrectly) supplied.
    """
    native = _collapse_whitespace(native or "")
    romanization = _collapse_whitespace(romanization or "")

    if not has_cjk_script(native):
        return native

    if not romanization or romanization.lower() == native.lower():
        return native

    base, existing_parens = split_trailing_parentheticals(native)
    if existing_parens:
        # Native title already carries a trailing parenthetical (a stale
        # romanization, or an English translation) — replace it rather than
        # stacking a second one.
        native = base

    return f"{native} ({romanization})"


def normalize_display_title(title: str) -> str:
    """
    Idempotent guard applied to whatever a title agent ultimately produced,
    in case the model ignored the schema and returned an already-composed
    (and possibly malformed) single string instead of separate fields.

    - Non-CJK titles pass through untouched.
    - Duplicate trailing parentheticals are collapsed to one.
    - At most one Latin-script parenthetical is kept (the first one, per the
      prompts' contract that romanization comes first).
    """
    title = _collapse_whitespace(title or "")
    if not title or not has_cjk_script(title):
        return title

    base, parens = split_trailing_parentheticals(title)
    if not parens:
        return title

    deduped: list[str] = []
    seen_lower: set[str] = set()
    for paren in parens:
        key = paren.lower()
        if key in seen_lower:
            continue
        seen_lower.add(key)
        deduped.append(paren)

    latin_only = [p for p in deduped if p and not has_cjk_script(p)]
    kept = latin_only[0] if latin_only else None

    if kept is None:
        return base
    return f"{base} ({kept})"


def clamp_title_length(title: str, max_length: int = MAX_TITLE_LENGTH) -> str:
    """
    Safety clamp for `title` to `max_length` characters. Composite titles
    run longer than plain ones, so prefer dropping the romanization
    parenthetical over a mid-word truncation.
    """
    if len(title) <= max_length:
        return title

    base, parens = split_trailing_parentheticals(title)
    if parens and len(base) <= max_length:
        return base

    return title[:max_length].rstrip()
