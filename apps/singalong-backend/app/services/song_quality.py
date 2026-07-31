from __future__ import annotations

import json
import re
from typing import Any

from ..models import Song

PLACEHOLDER_ARTISTS = {
    "",
    "unknown",
    "unknown artist",
    "various artists",
    "various artist",
    "tba",
    "n/a",
    "na",
    "none",
    "unlisted",
}

PLACEHOLDER_TITLES = {
    "",
    "unknown",
    "unknown title",
    "untitled",
    "no title",
    "tba",
    "n/a",
    "na",
    "none",
}


def _normalize(value: str | None) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value.strip()).casefold()


def _flag(code: str, label: str, message: str, points: int, severity: str) -> dict[str, Any]:
    return {
        "code": code,
        "label": label,
        "message": message,
        "points": points,
        "severity": severity,
    }


def is_placeholder(value: str | None, placeholders: set[str]) -> bool:
    normalized = _normalize(value)
    return normalized in placeholders or normalized.startswith("unknown ")


def _parse_extra_metadata(raw: str | None) -> dict[str, Any]:
    if raw is None or raw.strip() == "":
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"_parse_error": True}
    return parsed if isinstance(parsed, dict) else {"_invalid_type": True}


def assess_song_quality(song: Song) -> tuple[int, list[dict[str, Any]]]:
    flags: list[dict[str, Any]] = []

    def add_flag(code: str, label: str, message: str, points: int, severity: str) -> None:
        flags.append(_flag(code, label, message, points, severity))

    metadata = _parse_extra_metadata(song.extra_metadata)
    if metadata.get("validated_by_admin") is True:
        return 0, []

    if song.status != "published":
        add_flag(
            "unpublished",
            "Not published",
            f"Song status is {song.status}; admins should review it before it is considered ready.",
            30,
            "high",
        )

    if song.archived_at is not None:
        add_flag(
            "archived",
            "Archived",
            "Song is archived and may no longer be usable in normal songbook flows.",
            20,
            "medium",
        )

    if metadata.get("_parse_error") is True or metadata.get("_invalid_type") is True:
        add_flag(
            "metadata-invalid",
            "Broken metadata",
            "extra_metadata cannot be parsed cleanly.",
            15,
            "medium",
        )

    if isinstance(metadata.get("error"), str) and metadata.get("error").strip() != "":
        add_flag(
            "download-error",
            "Download error",
            f"Stored error: {metadata['error'].strip()}",
            25,
            "high",
        )

    if song.source_url is None or song.source_url.strip() == "":
        add_flag(
            "missing-source-url",
            "Missing source URL",
            "Source URL is blank.",
            20,
            "high",
        )

    if song.source_id is None or song.source_id.strip() == "":
        add_flag(
            "missing-source-id",
            "Missing source ID",
            "Source ID is blank.",
            15,
            "medium",
        )

    if song.source.strip() == "":
        add_flag(
            "missing-source",
            "Missing source",
            "Source provider is blank.",
            8,
            "low",
        )

    if song.thumbnail_file is None or song.thumbnail_file.strip() == "":
        add_flag(
            "missing-thumbnail",
            "Missing thumbnail",
            "Thumbnail file is missing.",
            10,
            "medium",
        )

    if song.video_file is None or song.video_file.strip() == "":
        add_flag(
            "missing-video",
            "Missing video file",
            "Video file is missing.",
            15,
            "high",
        )

    content_check = metadata.get("content_check")
    if isinstance(content_check, dict) and content_check.get("is_likely_song") is False:
        reason = content_check.get("reason")
        add_flag(
            "not-likely-song",
            "Possibly not a real song",
            reason if isinstance(reason, str) and reason.strip() != "" else "Content classifier flagged this as unlikely to be music.",
            25,
            "high",
        )

    if is_placeholder(song.title, PLACEHOLDER_TITLES):
        add_flag(
            "placeholder-title",
            "Placeholder title",
            "Title looks like a placeholder.",
            20,
            "medium",
        )

    if is_placeholder(song.artist, PLACEHOLDER_ARTISTS):
        add_flag(
            "placeholder-artist",
            "Placeholder artist",
            "Artist looks unknown or generic.",
            25,
            "high",
        )

    duration = song.duration
    if duration is None or duration <= 0:
        add_flag(
            "missing-duration",
            "Missing duration",
            "Duration is missing or zero.",
            20,
            "high",
        )
    elif duration < 45:
        add_flag(
            "short-duration",
            "Very short duration",
            f"Duration is only {duration} seconds.",
            15,
            "medium",
        )
    elif duration > 20 * 60:
        add_flag(
            "long-duration",
            "Very long duration",
            f"Duration is {duration} seconds, which is unusually long.",
            10,
            "low",
        )

    lyrics = (song.lyrics or "").strip()
    if lyrics == "":
        add_flag(
            "empty-lyrics",
            "Empty lyrics",
            "No lyrics are stored for this song.",
            10,
            "medium",
        )

    if song.genre is None or song.genre.strip() == "":
        add_flag(
            "missing-genre",
            "Missing genre",
            "Genre is not set.",
            5,
            "low",
        )

    if song.language is None or song.language.strip() == "":
        add_flag(
            "missing-language",
            "Missing language",
            "Language is not set.",
            5,
            "low",
        )

    tags = (song.tags or "").strip()
    if tags == "":
        add_flag(
            "missing-tags",
            "Missing tags",
            "No tags are stored for this song.",
            5,
            "low",
        )

    score = min(100, sum(flag["points"] for flag in flags))
    return score, flags
