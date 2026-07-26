"""Title Guesser Agent - Extract song title and artist from YouTube metadata using an LLM."""
import json
import logging
import re
from typing import Optional

from app.services.llm_client import LLMClient, create_llm_client

logger = logging.getLogger(__name__)


class TitleGuesserAgent:
    """Extracts song title and artist from YouTube video title using OpenAI."""

    # Karaoke-related keywords (English and Japanese)
    KARAOKE_KEYWORDS = {
        "karaoke", "カラオケ", "acoustic", "cover",
        "練習用", "原曲キー",
    }

    OFF_VOCAL_KEYWORDS = {
        "off-vocal", "off vocal", "offvocal", "オフボーカル",
        "instrumental", "インストルメンタル", "インスト",
        "karaoke", "カラオケ",
    }

    LYRICS_KEYWORDS = {
        "lyrics", "lyric", "歌詞", "字幕",
        "karaoke", "カラオケ", "practice", "練習用",
    }

    PRACTICE_KEYWORDS = {
        "practice", "練習", "練習用", "原曲キー",
    }

    def __init__(self, llm_client: LLMClient | None = None):
        """Initialize the Title Guesser agent."""
        self.llm = llm_client or create_llm_client("title_guesser")

    def extract(
        self,
        youtube_title: str,
        youtube_description: str = "",
    ) -> dict:
        """
        Extract song title, artist, and karaoke flags from YouTube metadata using OpenAI.

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
            print(
                f"[TITLE_GUESSER] extract() called - input_title={youtube_title[:80] if youtube_title else ''}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[TITLE_GUESSER] extract() called - input_title=%s",
                youtube_title[:80] if youtube_title else "",
            )

            # First, detect flags using keyword patterns (fast heuristic)
            is_off_vocal = self._detect_off_vocal(youtube_title, youtube_description)
            video_has_lyrics = self._detect_lyrics(youtube_title, youtube_description)
            print(
                f"[TITLE_GUESSER] flags detected - is_off_vocal={is_off_vocal} video_has_lyrics={video_has_lyrics}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[TITLE_GUESSER] flags detected - is_off_vocal=%s video_has_lyrics=%s",
                is_off_vocal,
                video_has_lyrics,
            )

            # Use LLM to intelligently extract title and artist
            if self.llm:
                print(
                    "[TITLE_GUESSER] Calling LLM to extract title and artist...",
                    file=sys.stderr,
                    flush=True,
                )
                logger.info("[TITLE_GUESSER] Calling LLM to extract title and artist")

                extracted_title, extracted_artist, confidence = (
                    self._extract_with_openai(youtube_title, youtube_description)
                )
                print(
                    f"[TITLE_GUESSER] LLM extraction - artist={extracted_artist} title={extracted_title[:80] if extracted_title else ''} confidence={confidence:.2f}",
                    file=sys.stderr,
                    flush=True,
                )
                logger.info(
                    "[TITLE_GUESSER] LLM extraction - artist=%s title=%s confidence=%.2f",
                    extracted_artist,
                    extracted_title[:80] if extracted_title else "",
                    confidence,
                )
            else:
                print(
                    "[TITLE_GUESSER] No LLM client, using fallback extraction",
                    file=sys.stderr,
                    flush=True,
                )
                logger.warning("[TITLE_GUESSER] No LLM client, using fallback extraction")
                extracted_title, extracted_artist, confidence = self._extract_with_regex(
                    youtube_title
                )

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

    def _extract_with_openai(self, youtube_title: str, youtube_description: str) -> tuple:
        """
        Use LLM to extract song title and artist from YouTube metadata.

        Returns:
            Tuple of (extracted_title, extracted_artist, confidence)
        """
        import sys

        try:
            prompt = f"""You are a music metadata extraction expert. Extract the song title and artist from the YouTube video title.

YouTube Title: {youtube_title}
YouTube Description (first 200 chars): {youtube_description[:200] if youtube_description else "(empty)"}

Your job:
1. Extract the clean song TITLE
   - Remove [Karaoke], [Instrumental], [Practice] prefixes
   - Remove (Practice), (Instrumental), (Off-vocal) suffixes
   - KEEP romanized text in parentheses for Japanese/CJK titles! e.g. "(Romaji)" or "(English translation)"
   - Example: "恋になりたいAQUARIUM (Koi ni Naritai Aquarium)" - KEEP the parentheses!
2. Extract the ARTIST name (the performer/creator)
3. Rate your confidence 0.0-1.0 that this is correct

Return ONLY valid JSON with these exact fields (no markdown, no extra text):
{{
  "title": "The clean song title with romanization if present",
  "artist": "The artist name or null",
  "confidence": 0.85
}}

Examples:
- Input: "[Karaoke 0] Aqours - 未熟DREAMER ( Mijuku DREAMER )"
  Output: {{"title": "未熟DREAMER (Mijuku DREAMER)", "artist": "Aqours", "confidence": 0.95}}

- Input: "[歌詞・音程バーカラオケ/練習用] Aqours - 恋になりたいAQUARIUM (アニメ`ラブライブ! サンシャイン!!`OST)"
  Output: {{"title": "恋になりたいAQUARIUM (Koi ni Naritai Aquarium)", "artist": "Aqours", "confidence": 0.9}}

- Input: "Hoshizora Rin - Snow halation [Instrumental]"
  Output: {{"title": "Snow halation", "artist": "Hoshizora Rin", "confidence": 0.9}}

- Input: "Some random song"
  Output: {{"title": "Some random song", "artist": null, "confidence": 0.3}}"""

            print(
                f"[TITLE_GUESSER] LLM request - prompt length={len(prompt)}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[TITLE_GUESSER] LLM request - prompt length=%d", len(prompt))

            response = self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=200,
            )

            response_text = response.choices[0].message.content.strip()
            print(
                f"[TITLE_GUESSER] LLM response - raw={response_text[:200]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[TITLE_GUESSER] LLM response - raw=%s", response_text[:200])

            # Parse JSON response
            result = json.loads(response_text)
            extracted_title = result.get("title", "")
            extracted_artist = result.get("artist")
            confidence = float(result.get("confidence", 0.5))

            print(
                f"[TITLE_GUESSER] LLM parsed - title={extracted_title} artist={extracted_artist} confidence={confidence}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[TITLE_GUESSER] LLM parsed - title=%s artist=%s confidence=%.2f",
                extracted_title,
                extracted_artist,
                confidence,
            )

            return extracted_title or "", extracted_artist, confidence

        except json.JSONDecodeError as e:
            print(f"[TITLE_GUESSER] LLM JSON parse failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[TITLE_GUESSER] LLM JSON parse failed: %s", e)
            return self._extract_with_regex(youtube_title)
        except Exception as e:
            print(f"[TITLE_GUESSER] LLM API call failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[TITLE_GUESSER] LLM API call failed: %s", e)
            return self._extract_with_regex(youtube_title)

    def _extract_with_regex(self, title: str) -> tuple:
        """Fallback regex-based extraction if OpenAI fails."""
        print(f"[TITLE_GUESSER] Using regex fallback for: {title[:60]}", file=sys.stderr, flush=True)
        logger.info("[TITLE_GUESSER] Using regex fallback")

        cleaned_title = self._clean_title(title)
        extracted_artist = self._extract_artist(cleaned_title)
        extracted_title = self._extract_title(cleaned_title, extracted_artist)
        return extracted_title, extracted_artist, 0.4

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
