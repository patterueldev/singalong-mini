"""Genre Classifier Agent - Classify a song into a genre, matching existing songbook genres when possible."""
import json
import logging
import sys
from typing import Optional

from app.services.llm_client import LLMClient, create_llm_client

logger = logging.getLogger(__name__)


class GenreClassifierAgent:
    """Classifies songs into genres, preferring genres already used in the songbook."""

    def __init__(self, llm_client: LLMClient | None = None):
        """Initialize the Genre Classifier agent."""
        self.llm = llm_client or create_llm_client("genre_classifier")

    async def classify(
        self,
        title: str,
        artist: Optional[str],
        existing_genres: list[str],
        web_context: Optional[list[str]] = None,
    ) -> dict:
        """
        Classify a song into a genre.

        Args:
            title: Song title
            artist: Song artist (optional)
            existing_genres: Distinct genres already used in the songbook
            web_context: Optional web search snippets ("title: description") for extra context

        Returns:
            Dictionary with:
            - matched_genre: Optional[str]
            - is_new_genre: bool
            - new_genre_suggestion: Optional[str]
            - confidence: float (0.0-1.0)
        """
        try:
            print(
                f"[GENRE_CLASSIFIER] classify() called - title={title[:60] if title else ''} artist={artist} existing_genres_count={len(existing_genres)}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[GENRE_CLASSIFIER] classify() called - title=%s artist=%s existing_genres_count=%d",
                title[:60] if title else "",
                artist,
                len(existing_genres),
            )

            if not self.llm:
                print(
                    "[GENRE_CLASSIFIER] No LLM client available, returning baseline",
                    file=sys.stderr,
                    flush=True,
                )
                logger.warning("[GENRE_CLASSIFIER] No LLM client available")
                return {
                    "matched_genre": None,
                    "is_new_genre": False,
                    "new_genre_suggestion": None,
                    "confidence": 0.0,
                }

            genres_block = ", ".join(existing_genres) if existing_genres else "(none yet)"
            context_block = (
                "\n".join(f"- {c}" for c in web_context) if web_context else "(no web context available)"
            )

            prompt = f"""You classify songs into genres. Below are genres already used in this songbook:
{genres_block}

Given a song, choose the best-fitting genre from this list.
If none fit, suggest a new genre. Keep genre names short (1-3 words, lowercase).
Examples: j-pop, anime, rock, electronic, city pop, vocaloid, enka, indie

Song: {title} by {artist or "Unknown"}

Web search context:
{context_block}

Return ONLY valid JSON:
{{
  "matched_genre": "best genre from the list, or null if none fit",
  "is_new_genre": true/false,
  "new_genre_suggestion": "suggested new genre if is_new_genre, else null",
  "confidence": 0.0-1.0
}}"""

            print("[GENRE_CLASSIFIER] Calling LLM to classify genre...", file=sys.stderr, flush=True)
            logger.info("[GENRE_CLASSIFIER] Calling LLM to classify genre")

            response = self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=200,
            )

            response_text = response.choices[0].message.content.strip()
            print(
                f"[GENRE_CLASSIFIER] LLM response - raw={response_text[:200]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[GENRE_CLASSIFIER] LLM response - raw=%s", response_text[:200])

            result = json.loads(response_text)
            parsed = {
                "matched_genre": result.get("matched_genre"),
                "is_new_genre": bool(result.get("is_new_genre", False)),
                "new_genre_suggestion": result.get("new_genre_suggestion"),
                "confidence": float(result.get("confidence", 0.0)),
            }

            print(f"[GENRE_CLASSIFIER] Parsed - {parsed}", file=sys.stderr, flush=True)
            logger.info("[GENRE_CLASSIFIER] Parsed - %s", parsed)

            return parsed
        except json.JSONDecodeError as e:
            print(f"[GENRE_CLASSIFIER] JSON parse failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[GENRE_CLASSIFIER] JSON parse failed: %s", e)
            return {
                "matched_genre": None,
                "is_new_genre": False,
                "new_genre_suggestion": None,
                "confidence": 0.0,
            }
        except Exception as e:
            print(f"[GENRE_CLASSIFIER] classify() failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[GENRE_CLASSIFIER] classify() failed: %s", e)
            return {
                "matched_genre": None,
                "is_new_genre": False,
                "new_genre_suggestion": None,
                "confidence": 0.0,
            }
