import re

SAVED_SONG_FILENAME_PATTERN = re.compile(r"^(.+)\[([a-zA-Z0-9_-]+)\]\.(mp4|mkv|avi|mov)$")
YOUTUBE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")
ALLOWED_VIDEO_EXTENSIONS = {"mp4", "mkv", "avi", "mov"}


def normalize_song_title(raw_title: str) -> str:
    normalized_chars: list[str] = []
    for char in raw_title.strip():
        if "A" <= char <= "Z" or "a" <= char <= "z":
            normalized_chars.append(char.lower())
        elif "0" <= char <= "9":
            normalized_chars.append(char)
        elif char.isspace():
            normalized_chars.append("_")
        elif ord(char) > 127:
            normalized_chars.append("K")
        else:
            normalized_chars.append("_")

    normalized_title = "".join(normalized_chars)
    normalized_title = re.sub(r"_+", "_", normalized_title).strip("_")
    return normalized_title or "song"


def normalize_download_extension(suffix: str) -> str:
    extension = suffix.lstrip(".").lower()
    if extension == "":
        return "mp4"
    if extension not in ALLOWED_VIDEO_EXTENSIONS:
        raise RuntimeError(f"Unsupported downloaded media extension: {extension}")
    return extension


def build_saved_filename(raw_title: str, youtube_id: str, suffix: str) -> str:
    if YOUTUBE_ID_PATTERN.fullmatch(youtube_id) is None:
        raise RuntimeError(f"Invalid YouTube ID for filename: {youtube_id}")

    normalized_title = normalize_song_title(raw_title)
    extension = normalize_download_extension(suffix)
    filename = f"{normalized_title}[{youtube_id}].{extension}"
    if SAVED_SONG_FILENAME_PATTERN.fullmatch(filename) is None:
        raise RuntimeError(f"Normalized filename did not match expected pattern: {filename}")
    return filename

