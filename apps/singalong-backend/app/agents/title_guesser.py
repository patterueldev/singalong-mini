"""Title Guesser Agent - Extract song title and artist from YouTube metadata."""
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)


class TitleGuesserAgent:
    """Extracts song title and artist from YouTube video title and description."""

    # Karaoke-related keywords (English and Japanese)
    KARAOKE_KEYWORDS = {
        "karaoke",
        "カラオケ",
        "acoustic",
        "cover",
    }

    OFF_VOCAL_KEYWORDS = {
        "instrumental",
        "off-vocal",
        "off vocal",
        "offvocal",
        "オフボーカル",
        "オフ・ボーカル",
        "インストルメンタル",
    }

    PRACTICE_KEYWORDS = {
        "practice",
        "練習用",
        "原曲キー",
        "key",
    }

    LYRICS_KEYWORDS = {
        "lyrics",
        "with lyrics",
        "歌詞",
    }

    def extract(
        self,
        youtube_title: str,
        youtube_description: str = "",
    ) -> dict:
        """
        Extract song title, artist, and karaoke flags from YouTube metadata.

        Args:
            youtube_title: The YouTube video title
            youtube_description: The YouTube video description

        Returns:
            Dictionary with:
            - extracted_title: str
            - extracted_artist: Optional[str]
            - is_off_vocal: bool
            - video_has_lyrics: bool
            - confidence: float (0.0-1.0)
        """
        import sys
        try:
            print(f"[TITLE_GUESSER] extract() called - input_title={youtube_title[:80] if youtube_title else ''}", file=sys.stderr, flush=True)
            logger.info("[TITLE_GUESSER] extract() called - input_title=%s", youtube_title[:80] if youtube_title else "")
            
            # Remove common YouTube suffixes and clean up
            cleaned_title = self._clean_title(youtube_title)
            print(f"[TITLE_GUESSER] cleaned_title={cleaned_title[:80] if cleaned_title else ''}", file=sys.stderr, flush=True)
            logger.info("[TITLE_GUESSER] cleaned_title=%s", cleaned_title[:80] if cleaned_title else "")

            # Detect karaoke/off-vocal flags
            is_off_vocal = self._detect_off_vocal(cleaned_title, youtube_description)
            video_has_lyrics = self._detect_lyrics(cleaned_title, youtube_description)
            print(f"[TITLE_GUESSER] flags detected - is_off_vocal={is_off_vocal} video_has_lyrics={video_has_lyrics}", file=sys.stderr, flush=True)
            logger.info("[TITLE_GUESSER] flags detected - is_off_vocal=%s video_has_lyrics=%s", is_off_vocal, video_has_lyrics)

            # Extract artist and title using heuristics
            extracted_artist = self._extract_artist(cleaned_title)
            extracted_title = self._extract_title(cleaned_title, extracted_artist)
            print(f"[TITLE_GUESSER] extraction - artist={extracted_artist} title={extracted_title[:80] if extracted_title else ''}", file=sys.stderr, flush=True)
            logger.info("[TITLE_GUESSER] extraction - artist=%s title=%s", extracted_artist, extracted_title[:80] if extracted_title else "")

            # Calculate confidence based on patterns found
            confidence = self._calculate_confidence(cleaned_title, extracted_artist, extracted_title)
            print(f"[TITLE_GUESSER] confidence={confidence:.2f}", file=sys.stderr, flush=True)
            logger.info("[TITLE_GUESSER] confidence=%.2f", confidence)

            result = {
                "extracted_title": extracted_title,
                "extracted_artist": extracted_artist,
                "is_off_vocal": is_off_vocal,
                "video_has_lyrics": video_has_lyrics,
                "confidence": confidence,
            }
            print("[TITLE_GUESSER] extract() completed successfully", file=sys.stderr, flush=True)
            logger.info("[TITLE_GUESSER] extract() completed successfully")
            return result
        except Exception as e:
            print(f"[TITLE_GUESSER] extract() failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[TITLE_GUESSER] extract() failed: %s", e)
            return {
                "extracted_title": youtube_title,
                "extracted_artist": None,
                "is_off_vocal": False,
                "video_has_lyrics": False,
                "confidence": 0.1,
            }

    def _clean_title(self, title: str) -> str:
        """Remove common YouTube suffixes and clean up the title."""
        # Remove common suffixes
        suffixes_pattern = r"\s*(?:\[.*?\]|\(.*?\))?\s*(?:HD|4K|Official|Lyric|Music Video|Audio|Full|Extended|Version|Remaster|2024|2023|2022|2021)?\s*$"
        cleaned = re.sub(suffixes_pattern, "", title, flags=re.IGNORECASE)
        return cleaned.strip()

    def _detect_off_vocal(self, title: str, description: str) -> bool:
        """Detect if the video is off-vocal/instrumental."""
        text = f"{title} {description}".lower()
        for keyword in self.OFF_VOCAL_KEYWORDS:
            if keyword.lower() in text:
                return True
        return False

    def _detect_lyrics(self, title: str, description: str) -> bool:
        """Detect if the video has lyrics displayed."""
        text = f"{title} {description}".lower()
        for keyword in self.KARAOKE_KEYWORDS:
            if keyword.lower() in text:
                return True
        for keyword in self.LYRICS_KEYWORDS:
            if keyword.lower() in text:
                return True
        for keyword in self.PRACTICE_KEYWORDS:
            if keyword.lower() in text:
                return True
        return False

    def _extract_artist(self, title: str) -> Optional[str]:
        """Extract artist name from title using common patterns."""
        # Pattern: "Artist - Song Title"
        match = re.match(r"^([^-|→]+?)\s*[-|→]\s*(.+)$", title)
        if match:
            artist = match.group(1).strip()
            if len(artist) > 2 and len(artist) < 100:  # Reasonable artist name length
                return artist
        return None

    def _extract_title(self, title: str, extracted_artist: Optional[str]) -> str:
        """Extract song title, removing artist if present."""
        if extracted_artist:
            # Remove artist prefix from title
            pattern = re.escape(extracted_artist) + r"\s*[-|→]\s*"
            cleaned = re.sub(pattern, "", title, flags=re.IGNORECASE).strip()
            if cleaned and len(cleaned) > 2:
                return cleaned

        # Fallback: use entire title
        return title

    def _calculate_confidence(self, title: str, artist: Optional[str], extracted_title: str) -> float:
        """Calculate confidence score based on extraction quality."""
        confidence = 0.5  # Base confidence

        # Boost if we extracted an artist
        if artist:
            confidence += 0.2

        # Boost if title looks reasonable
        if len(extracted_title) > 5 and len(extracted_title) < 200:
            confidence += 0.2

        # Check for suspicious patterns (all caps, repeated characters, etc.)
        if extracted_title.isupper() or extracted_title.islower():
            confidence -= 0.1

        # Clamp to [0, 1]
        return max(0.0, min(1.0, confidence))
