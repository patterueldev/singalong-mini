"""Off-Vocal Detector Agent - Detect off-vocal/instrumental and on-screen-lyrics flags from YouTube title."""
import json
import logging
import sys

from app.services.llm_client import LLMClient, create_llm_client

logger = logging.getLogger(__name__)


class OffVocalDetectorAgent:
    """Detects off-vocal/instrumental status and on-screen lyrics from YouTube metadata."""

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
        """Initialize the Off-Vocal Detector agent."""
        self.llm = llm_client or create_llm_client("off_vocal_detector")

    def detect(self, youtube_title: str, youtube_description: str = "") -> dict:
        """
        Detect off-vocal/instrumental status and on-screen lyrics from YouTube metadata.

        Args:
            youtube_title: The YouTube video title
            youtube_description: The YouTube video description

        Returns:
            Dictionary with:
            - is_off_vocal: bool
            - video_has_lyrics: bool
            - confidence: float (0.0-1.0)
        """
        try:
            print(
                f"[OFF_VOCAL_DETECTOR] detect() called - input_title={youtube_title[:80] if youtube_title else ''}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[OFF_VOCAL_DETECTOR] detect() called - input_title=%s",
                youtube_title[:80] if youtube_title else "",
            )

            is_off_vocal = self._detect_off_vocal(youtube_title, youtube_description)
            video_has_lyrics = self._detect_lyrics(youtube_title, youtube_description)

            if is_off_vocal or video_has_lyrics:
                print(
                    f"[OFF_VOCAL_DETECTOR] keyword match - is_off_vocal={is_off_vocal} video_has_lyrics={video_has_lyrics}",
                    file=sys.stderr,
                    flush=True,
                )
                logger.info(
                    "[OFF_VOCAL_DETECTOR] keyword match - is_off_vocal=%s video_has_lyrics=%s",
                    is_off_vocal,
                    video_has_lyrics,
                )
                return {
                    "is_off_vocal": is_off_vocal,
                    "video_has_lyrics": video_has_lyrics,
                    "confidence": 0.9,
                }

            if not self.llm:
                print(
                    "[OFF_VOCAL_DETECTOR] No LLM client and no keyword match, defaulting to false",
                    file=sys.stderr,
                    flush=True,
                )
                logger.warning("[OFF_VOCAL_DETECTOR] No LLM client and no keyword match")
                return {"is_off_vocal": False, "video_has_lyrics": False, "confidence": 0.1}

            return self._detect_with_llm(youtube_title)
        except Exception as e:
            print(f"[OFF_VOCAL_DETECTOR] detect() failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[OFF_VOCAL_DETECTOR] detect() failed: %s", e)
            return {"is_off_vocal": False, "video_has_lyrics": False, "confidence": 0.1}

    def _detect_with_llm(self, youtube_title: str) -> dict:
        try:
            prompt = f"""Analyze this YouTube video title. Is this video off-vocal/instrumental? Does it have lyrics embedded on screen?

YouTube Title: {youtube_title}

Return ONLY valid JSON with these exact fields (no markdown, no extra text):
{{
  "is_off_vocal": true/false,
  "video_has_lyrics": true/false,
  "confidence": 0.0-1.0
}}"""

            print(
                f"[OFF_VOCAL_DETECTOR] LLM request - prompt length={len(prompt)}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[OFF_VOCAL_DETECTOR] LLM request - prompt length=%d", len(prompt))

            response = self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=250,
            )

            response_text = response.choices[0].message.content.strip()
            print(
                f"[OFF_VOCAL_DETECTOR] LLM response - raw={response_text[:200]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[OFF_VOCAL_DETECTOR] LLM response - raw=%s", response_text[:200])

            result = json.loads(response_text)
            return {
                "is_off_vocal": bool(result.get("is_off_vocal", False)),
                "video_has_lyrics": bool(result.get("video_has_lyrics", False)),
                "confidence": float(result.get("confidence", 0.5)),
            }
        except Exception as e:
            print(f"[OFF_VOCAL_DETECTOR] LLM call failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[OFF_VOCAL_DETECTOR] LLM call failed: %s", e)
            return {"is_off_vocal": False, "video_has_lyrics": False, "confidence": 0.1}

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
