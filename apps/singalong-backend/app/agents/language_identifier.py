"""Language Identifier Agent - Detect language using an LLM."""
import json
import logging
import sys
from typing import Optional

from app.services.llm_client import LLMClient, create_llm_client

logger = logging.getLogger(__name__)


class LanguageIdentifierAgent:
    """Detects language from song metadata using an LLM."""

    def __init__(self, llm_client: LLMClient | None = None):
        """Initialize the Language Identifier agent."""
        self.llm = llm_client or create_llm_client("language_identifier")

    async def detect(
        self,
        title: str,
        artist: Optional[str] = None,
        youtube_title: str = "",
    ) -> dict:
        """
        Detect language from song metadata using an LLM.

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
            print(
                f"[LANGUAGE_IDENTIFIER] detect() called - title={title[:60] if title else ''} artist={artist} youtube_title={youtube_title[:60] if youtube_title else ''}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[LANGUAGE_IDENTIFIER] detect() called - title=%s artist=%s youtube_title=%s",
                title[:60] if title else "",
                artist,
                youtube_title[:60] if youtube_title else "",
            )

            if not self.llm:
                print(
                    "[LANGUAGE_IDENTIFIER] No LLM client, using fallback",
                    file=sys.stderr,
                    flush=True,
                )
                logger.warning("[LANGUAGE_IDENTIFIER] No LLM client")
                return {
                    "language": "en",
                    "confidence": 0.1,
                }

            # Combine text sources for analysis
            text_sources = [title]
            if artist:
                text_sources.append(artist)
            if youtube_title:
                text_sources.append(youtube_title)

            combined_text = " ".join(text_sources)
            print(
                f"[LANGUAGE_IDENTIFIER] combined_text for analysis={combined_text[:100]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[LANGUAGE_IDENTIFIER] combined_text for analysis=%s",
                combined_text[:100],
            )

            # Use LLM to detect language
            prompt = f"""You are a language detection expert. Identify the language of the song title and artist.

Song Title: {title}
Artist: {artist if artist else "(not provided)"}
YouTube Title: {youtube_title if youtube_title else "(not provided)"}

Your job:
1. Identify what language the song title is in
2. Return ISO 639-1 language code (e.g., "en", "ja", "ko", "fr", "es", etc.)
3. Rate your confidence 0.0-1.0

Return ONLY valid JSON:
{{
  "language": "ISO 639-1 code (e.g. 'ja', 'en', 'ko')",
  "confidence": 0.95
}}

Guidelines:
- Be precise with ISO 639-1 codes
- For mixed language titles, use the primary language
- Confidence reflects how certain you are about the language"""

            print(
                "[LANGUAGE_IDENTIFIER] Calling LLM to detect language...",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[LANGUAGE_IDENTIFIER] Calling LLM to detect language")

            response = self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=150,
            )

            response_text = response.choices[0].message.content.strip()
            print(
                f"[LANGUAGE_IDENTIFIER] LLM response - raw={response_text[:150]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[LANGUAGE_IDENTIFIER] LLM response - raw=%s", response_text[:150])

            if not response_text:
                print(
                    "[LANGUAGE_IDENTIFIER] Empty response from LLM, using fallback",
                    file=sys.stderr,
                    flush=True,
                )
                logger.warning("[LANGUAGE_IDENTIFIER] Empty response from LLM")
                return {"language": "en", "confidence": 0.1}

            result = json.loads(response_text)
            detected_lang = result.get("language", "en")
            confidence = float(result.get("confidence", 0.5))

            print(
                f"[LANGUAGE_IDENTIFIER] Parsed - language={detected_lang} confidence={confidence}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[LANGUAGE_IDENTIFIER] Parsed - language=%s confidence=%.2f",
                detected_lang,
                confidence,
            )

            return {
                "language": detected_lang,
                "confidence": confidence,
            }

        except json.JSONDecodeError as e:
            print(f"[LANGUAGE_IDENTIFIER] JSON parse failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[LANGUAGE_IDENTIFIER] JSON parse failed: %s", e)
            return {
                "language": "en",
                "confidence": 0.1,
            }
        except Exception as e:
            print(f"[LANGUAGE_IDENTIFIER] detect() failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[LANGUAGE_IDENTIFIER] detect() failed: %s", e)
            return {
                "language": "en",
                "confidence": 0.1,
            }
