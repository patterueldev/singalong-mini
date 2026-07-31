"""Tags Suggester Agent - Suggest tags for a song, matching existing songbook tags when possible."""
import json
import logging
import sys
from typing import Optional

from app.services.llm_client import LLMClient, create_llm_client

logger = logging.getLogger(__name__)


class TagsSuggesterAgent:
    """Suggests tags for songs, preferring tags already used in the songbook."""

    def __init__(self, llm_client: LLMClient | None = None):
        """Initialize the Tags Suggester agent."""
        self.llm = llm_client or create_llm_client("tags_suggester")

    async def suggest(
        self,
        title: str,
        artist: Optional[str],
        existing_tags: list[str],
        web_context: Optional[list[str]] = None,
    ) -> dict:
        """
        Suggest tags for a song.

        Args:
            title: Song title
            artist: Song artist (optional)
            existing_tags: Distinct tags already used in the songbook
            web_context: Optional web search snippets ("title: description") for extra context

        Returns:
            Dictionary with:
            - matched_tags: list[str]
            - new_tags: list[str]
            - confidence: float (0.0-1.0)
        """
        try:
            print(
                f"[TAGS_SUGGESTER] suggest() called - title={title[:60] if title else ''} artist={artist} existing_tags_count={len(existing_tags)}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[TAGS_SUGGESTER] suggest() called - title=%s artist=%s existing_tags_count=%d",
                title[:60] if title else "",
                artist,
                len(existing_tags),
            )

            if not self.llm:
                print(
                    "[TAGS_SUGGESTER] No LLM client available, returning baseline",
                    file=sys.stderr,
                    flush=True,
                )
                logger.warning("[TAGS_SUGGESTER] No LLM client available")
                return {"matched_tags": [], "new_tags": [], "confidence": 0.0}

            tags_block = ", ".join(existing_tags) if existing_tags else "(none yet)"
            context_block = (
                "\n".join(f"- {c}" for c in web_context) if web_context else "(no web context available)"
            )

            prompt = f"""You suggest tags for songs in a karaoke/singalong songbook. Below are tags
already used in this songbook:
{tags_block}

Tags typically identify: anime/game/VN source, artist group, decade, style, mood.
Keep tags lowercase, prefer canonical names (e.g. "love live" not "Love Live! project").

Song: {title} by {artist or "Unknown"}

Web search context:
{context_block}

Return ONLY valid JSON:
{{
  "matched_tags": ["tags from the existing list that apply"],
  "new_tags": ["suggested new tags not in the existing list"],
  "confidence": 0.0-1.0
}}"""

            print("[TAGS_SUGGESTER] Calling LLM to suggest tags...", file=sys.stderr, flush=True)
            logger.info("[TAGS_SUGGESTER] Calling LLM to suggest tags")

            response = self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=400,
            )

            response_text = response.choices[0].message.content.strip()
            print(
                f"[TAGS_SUGGESTER] LLM response - raw={response_text[:200]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[TAGS_SUGGESTER] LLM response - raw=%s", response_text[:200])

            result = json.loads(response_text)
            matched_tags = [t for t in (result.get("matched_tags") or []) if isinstance(t, str)]
            new_tags = [t for t in (result.get("new_tags") or []) if isinstance(t, str)]
            confidence = float(result.get("confidence", 0.0))

            parsed = {"matched_tags": matched_tags, "new_tags": new_tags, "confidence": confidence}
            print(f"[TAGS_SUGGESTER] Parsed - {parsed}", file=sys.stderr, flush=True)
            logger.info("[TAGS_SUGGESTER] Parsed - %s", parsed)

            return parsed
        except json.JSONDecodeError as e:
            print(f"[TAGS_SUGGESTER] JSON parse failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[TAGS_SUGGESTER] JSON parse failed: %s", e)
            return {"matched_tags": [], "new_tags": [], "confidence": 0.0}
        except Exception as e:
            print(f"[TAGS_SUGGESTER] suggest() failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[TAGS_SUGGESTER] suggest() failed: %s", e)
            return {"matched_tags": [], "new_tags": [], "confidence": 0.0}
