"""Language Identifier Agent - Detect language from song metadata."""
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)


class LanguageIdentifierAgent:
    """Detects language from song title, artist, and description."""

    # Language detection patterns (ISO 639-1 codes)
    LANGUAGE_PATTERNS = {
        "ja": {
            "name": "Japanese",
            "patterns": [
                r"[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]",  # Hiragana, Katakana, Kanji
            ],
        },
        "ko": {
            "name": "Korean",
            "patterns": [
                r"[\uAC00-\uD7AF]",  # Hangul
            ],
        },
        "zh": {
            "name": "Chinese",
            "patterns": [
                r"[\u4E00-\u9FFF]",  # CJK Unified Ideographs
            ],
        },
        "ru": {
            "name": "Russian",
            "patterns": [
                r"[\u0400-\u04FF]",  # Cyrillic
            ],
        },
        "ar": {
            "name": "Arabic",
            "patterns": [
                r"[\u0600-\u06FF]",  # Arabic
            ],
        },
        "en": {
            "name": "English",
            "patterns": [
                r"\b(?:the|a|an|and|or|is|are|have|has|been|be|to|of|in|for|on|at|with|by|from)\b",
            ],
        },
    }

    async def detect(
        self,
        title: str,
        artist: Optional[str] = None,
        youtube_title: str = "",
    ) -> dict:
        """
        Detect language from song metadata.

        Args:
            title: Song title
            artist: Song artist (optional)
            youtube_title: Original YouTube title (optional)

        Returns:
            Dictionary with:
            - language: str (ISO 639-1 code)
            - confidence: float (0.0-1.0)
        """
        try:
            # Combine text sources for analysis
            text_sources = [title]
            if artist:
                text_sources.append(artist)
            if youtube_title:
                text_sources.append(youtube_title)

            combined_text = " ".join(text_sources)

            # Detect language using pattern matching
            detected_lang, confidence = self._detect_by_patterns(combined_text)

            return {
                "language": detected_lang,
                "confidence": confidence,
            }
        except Exception as e:
            logger.exception("LanguageIdentifier.detect failed: %s", e)
            return {
                "language": "en",
                "confidence": 0.1,
            }

    def _detect_by_patterns(self, text: str) -> tuple[str, float]:
        """Detect language using character patterns and keywords."""
        if not text:
            return "en", 0.1

        # Check for CJK characters first (highest priority)
        cjk_chars = re.findall(r"[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]", text)
        if cjk_chars:
            # Count hiragana/katakana vs kanji to distinguish Japanese
            hiragana_katakana = re.findall(r"[\u3040-\u309F\u30A0-\u30FF]", text)
            kanji = re.findall(r"[\u4E00-\u9FFF]", text)

            if hiragana_katakana or kanji:
                # Likely Japanese if has hiragana/katakana or specific kanji patterns
                if hiragana_katakana:
                    return "ja", 0.9
                # Pure kanji is ambiguous (Chinese/Japanese)
                if kanji:
                    return "ja", 0.7

        # Check for Hangul (Korean)
        if re.search(r"[\uAC00-\uD7AF]", text):
            return "ko", 0.9

        # Check for Cyrillic (Russian/Ukrainian)
        if re.search(r"[\u0400-\u04FF]", text):
            return "ru", 0.85

        # Check for Arabic
        if re.search(r"[\u0600-\u06FF]", text):
            return "ar", 0.85

        # Default to English if no other patterns found
        return "en", 0.3
