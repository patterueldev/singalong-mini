from urllib.parse import parse_qs, urlparse


def extract_youtube_video_id(url: str) -> str | None:
    if len(url) == 11 and all(char.isalnum() or char in "_-" for char in url):
        return url

    try:
        parsed = urlparse(url)
    except Exception:
        return None

    host = parsed.netloc.lower().removeprefix("www.")
    if host == "youtu.be":
        return parsed.path.lstrip("/").split("/")[0] or None

    if host not in ("youtube.com", "m.youtube.com"):
        return None

    path = parsed.path.rstrip("/")
    if path == "/watch":
        values = parse_qs(parsed.query).get("v", [])
        return values[0] if values else None

    if path.startswith("/shorts/"):
        return path[len("/shorts/"):].split("/")[0] or None

    return None


def extract_canonical_youtube_url(url: str) -> str:
    video_id = extract_youtube_video_id(url)
    if video_id is None:
        return url
    return f"https://www.youtube.com/watch?v={video_id}"

