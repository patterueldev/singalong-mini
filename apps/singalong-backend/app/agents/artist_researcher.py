"""Artist Researcher Agent - Verify/normalize song artist using an LLM."""
import json
import logging
import sys
from typing import Optional

from app.services.llm_client import LLMClient, create_llm_client

logger = logging.getLogger(__name__)


class ArtistResearcherAgent:
    """Verifies and normalizes song artist names using an LLM."""

    def __init__(self, llm_client: LLMClient | None = None):
        """Initialize the Artist Researcher agent."""
        self.llm = llm_client or create_llm_client("artist_researcher")

    async def research(
        self,
        title: str,
        artist: Optional[str] = None,
        youtube_title: str = "",
        web_context: Optional[list[str]] = None,
    ) -> dict:
        """
        Verify the correct artist for a song using an LLM.

        Args:
            title: Song title
            artist: Preliminary artist guess (optional)
            youtube_title: Original YouTube title (optional)
            web_context: Optional web search snippets ("title: description") for extra context

        Returns:
            Dictionary with:
            - verified_artist: Optional[str]
            - confidence: float (0.0-1.0)
        """
        try:
            print(
                f"[ARTIST_RESEARCHER] research() called - title={title[:60] if title else ''} artist={artist}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[ARTIST_RESEARCHER] research() called - title=%s artist=%s",
                title[:60] if title else "",
                artist,
            )

            if not self.llm:
                print(
                    "[ARTIST_RESEARCHER] No LLM client available, returning baseline",
                    file=sys.stderr,
                    flush=True,
                )
                logger.warning("[ARTIST_RESEARCHER] No LLM client available")
                return {"verified_artist": artist, "confidence": 0.1}

            context_block = (
                "\n".join(f"- {c}" for c in web_context) if web_context else "(no web context available)"
            )

            prompt = f"""You are a music metadata curator specializing in anime, VTuber, and J-pop songs.

Given a song title and a preliminary artist guess, verify the correct artist.
If the artist seems correct, return it. If incorrect or missing, suggest the correct one.
Normalize artist names (e.g., "YOASOBI" not "Yoasobi", "Ado" not "ado").

Title: {title}
Preliminary Artist: {artist or "unknown"}
Original YouTube Title: {youtube_title or "(not provided)"}

Web search context:
{context_block}

Return ONLY valid JSON: {{ "verified_artist": "...", "confidence": 0.0-1.0 }}"""

            print(
                "[ARTIST_RESEARCHER] Calling LLM to verify artist...",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[ARTIST_RESEARCHER] Calling LLM to verify artist")

            response = self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=300,
            )

            response_text = response.choices[0].message.content.strip()
            print(
                f"[ARTIST_RESEARCHER] LLM response - raw={response_text[:200]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[ARTIST_RESEARCHER] LLM response - raw=%s", response_text[:200])

            result = json.loads(response_text)
            verified_artist = result.get("verified_artist") or artist
            confidence = float(result.get("confidence", 0.5))

            print(
                f"[ARTIST_RESEARCHER] Parsed - verified_artist={verified_artist} confidence={confidence}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[ARTIST_RESEARCHER] Parsed - verified_artist=%s confidence=%.2f",
                verified_artist,
                confidence,
            )

            return {"verified_artist": verified_artist, "confidence": confidence}
        except json.JSONDecodeError as e:
            print(f"[ARTIST_RESEARCHER] JSON parse failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[ARTIST_RESEARCHER] JSON parse failed: %s", e)
            return {"verified_artist": artist, "confidence": 0.1}
        except Exception as e:
            print(f"[ARTIST_RESEARCHER] research() failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[ARTIST_RESEARCHER] research() failed: %s", e)
            return {"verified_artist": artist, "confidence": 0.1}
