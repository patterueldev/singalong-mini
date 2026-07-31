from urllib.parse import parse_qs, urlparse

import yt_dlp

_YOUTUBE_SUBDOMAIN_PREFIXES = ("www.", "m.", "music.")
_YOUTUBE_ID_PATH_PREFIXES = ("/shorts/", "/live/", "/embed/")


def extract_youtube_video_id(url: str) -> str | None:
    if len(url) == 11 and all(char.isalnum() or char in "_-" for char in url):
        return url

    try:
        parsed = urlparse(url if "//" in url else f"//{url}")
    except Exception:
        return None

    host = parsed.netloc.lower()
    for prefix in _YOUTUBE_SUBDOMAIN_PREFIXES:
        host = host.removeprefix(prefix)

    if host == "youtu.be":
        return parsed.path.lstrip("/").split("/")[0] or None

    if host != "youtube.com":
        return None

    path = parsed.path.rstrip("/")
    if path == "/watch":
        values = parse_qs(parsed.query).get("v", [])
        return values[0] if values else None

    for prefix in _YOUTUBE_ID_PATH_PREFIXES:
        if path.startswith(prefix):
            return path[len(prefix):].split("/")[0] or None

    return None


def extract_canonical_youtube_url(url: str) -> str:
    video_id = extract_youtube_video_id(url)
    if video_id is None:
        return url
    return f"https://www.youtube.com/watch?v={video_id}"


def extract_single_video_info(url: str) -> dict[str, object]:
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        return ydl.extract_info(url, download=False)

