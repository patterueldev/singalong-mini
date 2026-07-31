"""Title Researcher Agent - Verify/correct song title using an LLM, informed by web search context."""
import json
import logging
import sys
from typing import Optional

from app.services.llm_client import LLMClient, create_llm_client
from app.services.title_format import compose_display_title, normalize_display_title

logger = logging.getLogger(__name__)


class TitleResearcherAgent:
    """Verifies and corrects song titles using an LLM, cross-checked against web search context."""

    def __init__(self, llm_client: LLMClient | None = None):
        """Initialize the Title Researcher agent."""
        self.llm = llm_client or create_llm_client("title_researcher")

    async def research(
        self,
        youtube_title: str,
        title_guess: str,
        artist_guess: Optional[str] = None,
        web_context: Optional[list[str]] = None,
    ) -> dict:
        """
        Verify the correct song title for a video using an LLM, cross-checked against web search context.

        Args:
            youtube_title: Raw YouTube video title
            title_guess: Preliminary title guess (from TitleGuesser)
            artist_guess: Preliminary artist guess (optional)
            web_context: Optional web search snippets ("title: description") for extra context

        Returns:
            Dictionary with:
            - verified_title: Optional[str]
            - confidence: float (0.0-1.0)
        """
        try:
            print(
                f"[TITLE_RESEARCHER] research() called - youtube_title={youtube_title[:80] if youtube_title else ''} "
                f"title_guess={title_guess[:60] if title_guess else ''} artist_guess={artist_guess}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[TITLE_RESEARCHER] research() called - youtube_title=%s title_guess=%s artist_guess=%s",
                youtube_title[:80] if youtube_title else "",
                title_guess[:60] if title_guess else "",
                artist_guess,
            )

            if not self.llm:
                print(
                    "[TITLE_RESEARCHER] No LLM client available, returning baseline",
                    file=sys.stderr,
                    flush=True,
                )
                logger.warning("[TITLE_RESEARCHER] No LLM client available")
                return {"verified_title": title_guess, "confidence": 0.1}

            context_block = (
                "\n".join(f"- {c}" for c in web_context) if web_context else "(no web context available)"
            )

            prompt = f"""You are a music metadata curator specializing in anime, VTuber, and J-pop songs.

Given the raw YouTube video title, a preliminary song-title guess, and web search context,
verify the correct song title. If the guess seems correct, return it. If incorrect, incomplete,
or mistranslated, correct it using the raw YouTube title and the web context below.

The preliminary title guess may already be in "<native> (<Romanization>)" form
— e.g. "恋になりたいAQUARIUM (Koi ni Naritai AQUARIUM)". Split it back into its
native and romanized parts, correct either part if needed, and return them
SEPARATELY — do not return the combined string.

- `verified_title`: the native title only, no parentheses.
- `verified_title_romanized`: required whenever `verified_title` contains
  Japanese, Chinese, or Korean characters (Hepburn romaji / Hanyu Pinyin
  without tone marks / Revised Romanization, respectively) — generate one
  yourself if the guess didn't provide it, or fix it if wrong. Copy any
  embedded Latin-script segment verbatim, including capitalization
  (e.g. native "恋になりたいAQUARIUM" -> romanized "Koi ni Naritai AQUARIUM",
  not "Aquarium"). Set to null only if `verified_title` is fully Latin script.
- Never return an English *translation* in `verified_title_romanized` — it
  must be a romanization of the native title's pronunciation, not its meaning.

Raw YouTube Title: {youtube_title or "(not provided)"}
Preliminary Title Guess: {title_guess or "unknown"}
Preliminary Artist: {artist_guess or "unknown"}

Web search context:
{context_block}

Return ONLY valid JSON: {{ "verified_title": "...", "verified_title_romanized": "... or null", "confidence": 0.0-1.0 }}"""

            print(
                "[TITLE_RESEARCHER] Calling LLM to verify title...",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[TITLE_RESEARCHER] Calling LLM to verify title")

            response = self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=300,
            )

            response_text = response.choices[0].message.content.strip()
            print(
                f"[TITLE_RESEARCHER] LLM response - raw={response_text[:200]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[TITLE_RESEARCHER] LLM response - raw=%s", response_text[:200])

            result = json.loads(response_text)
            native_title = result.get("verified_title")
            if native_title:
                verified_title = normalize_display_title(
                    compose_display_title(native_title, result.get("verified_title_romanized"))
                )
            else:
                verified_title = normalize_display_title(title_guess)
            confidence = float(result.get("confidence", 0.5))

            print(
                f"[TITLE_RESEARCHER] Parsed - verified_title={verified_title} "
                f"(native={native_title} romanized={result.get('verified_title_romanized')}) confidence={confidence}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[TITLE_RESEARCHER] Parsed - verified_title=%s (native=%s romanized=%s) confidence=%.2f",
                verified_title,
                native_title,
                result.get("verified_title_romanized"),
                confidence,
            )

            return {"verified_title": verified_title, "confidence": confidence}
        except json.JSONDecodeError as e:
            print(f"[TITLE_RESEARCHER] JSON parse failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[TITLE_RESEARCHER] JSON parse failed: %s", e)
            return {"verified_title": title_guess, "confidence": 0.1}
        except Exception as e:
            print(f"[TITLE_RESEARCHER] research() failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[TITLE_RESEARCHER] research() failed: %s", e)
            return {"verified_title": title_guess, "confidence": 0.1}
