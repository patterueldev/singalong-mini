import sys

from .ytdlp.naming import build_saved_filename, normalize_song_title


def normalize_title(title: str) -> str:
    print(f"[FILE_NAMING] Normalizing title: {title}", file=sys.stderr, flush=True)
    normalized = normalize_song_title(title)
    print(f"[FILE_NAMING] Normalized to: {normalized}", file=sys.stderr, flush=True)
    return normalized


def generate_song_filename(title: str, source_id: str, ext: str) -> str:
    """
    Generate filename following convention: {normalized_title}[{source_id}].{ext}

    Delegates to the canonical naming logic in ytdlp/naming.py.
    Any char with ord > 127 (e.g. Kanji) is replaced with 'K'.

    Example: 未熟DREAMER (Mijuku DREAMER) → KKdreamer_KKmijuku_dreamer[x_6nob9_WLc].mp4
    """
    return build_saved_filename(title, source_id, ext)
