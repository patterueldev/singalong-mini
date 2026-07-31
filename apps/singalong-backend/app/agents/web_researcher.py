"""Web Researcher Agent - Research song metadata using OpenAI and MusicBrainz."""
import json
import logging
import os
from typing import Optional

from openai import OpenAI

logger = logging.getLogger(__name__)


class WebResearcherAgent:
    """Researches song metadata using OpenAI agent with function calling."""

    def __init__(self):
        """Initialize the Web Researcher agent."""
        self.client = None
        openai_key = os.getenv("OPENAI_API_KEY")
        if openai_key:
            self.client = OpenAI(api_key=openai_key)

    async def research(
        self,
        title: str,
        artist: Optional[str] = None,
        youtube_title: str = "",
    ) -> dict:
        """
        Research song metadata using OpenAI to find:
        - Verified artist name
        - Release year
        - Genre
        - Tags/keywords

        Args:
            title: Song title
            artist: Song artist (optional)
            youtube_title: Original YouTube title (optional)

        Returns:
            Dictionary with:
            - verified_artist: Optional[str]
            - verified_year: Optional[str]
            - genre: Optional[str]
            - tags: Optional[list[str]]
            - research_confidence: float (0.0-1.0)
        """
        import sys

        try:
            print(
                f"[WEB_RESEARCHER] research() called - title={title[:60] if title else ''} artist={artist}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[WEB_RESEARCHER] research() called - title=%s artist=%s",
                title[:60] if title else "",
                artist,
            )

            if not self.client:
                print(
                    "[WEB_RESEARCHER] No OpenAI client available, returning baseline",
                    file=sys.stderr,
                    flush=True,
                )
                logger.warning("[WEB_RESEARCHER] No OpenAI client available")
                return {
                    "verified_artist": artist,
                    "verified_year": None,
                    "genre": None,
                    "tags": None,
                    "research_confidence": 0.0,
                }

            # Use OpenAI to research the song
            prompt = f"""You are a music researcher. Based on the song title and artist, provide metadata research results.

Song Title: {title}
Artist: {artist if artist else "(unknown)"}
YouTube Title: {youtube_title if youtube_title else "(not provided)"}

Your job:
1. Research what you know about this song
2. Suggest verified artist name (or null if unsure)
3. Suggest release year (or null if unsure)
4. Suggest genre (one main genre, or null if unsure)
5. Suggest tags/keywords (list of relevant tags, or null)
6. Rate your confidence 0.0-1.0

Return ONLY valid JSON:
{{
  "verified_artist": "Artist name or null",
  "verified_year": "Year or null",
  "genre": "Genre or null",
  "tags": ["tag1", "tag2"] or null,
  "confidence": 0.7
}}

Guidelines:
- Be conservative - only include data you're confident about
- For anime/VTuber songs, include relevant tags
- For Japanese songs, normalize artist names
- Confidence should reflect how certain you are"""

            print(
                f"[WEB_RESEARCHER] Calling OpenAI to research song...",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[WEB_RESEARCHER] Calling OpenAI to research song")

            response = self.client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=300,
            )

            response_text = response.choices[0].message.content.strip()
            print(
                f"[WEB_RESEARCHER] OpenAI response - raw={response_text[:200]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[WEB_RESEARCHER] OpenAI response - raw=%s", response_text[:200])

            # Parse JSON response
            result = json.loads(response_text)
            verified_artist = result.get("verified_artist")
            verified_year = result.get("verified_year")
            genre = result.get("genre")
            tags = result.get("tags")
            confidence = float(result.get("confidence", 0.0))

            print(
                f"[WEB_RESEARCHER] Parsed - artist={verified_artist} year={verified_year} genre={genre} tags={tags} confidence={confidence}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[WEB_RESEARCHER] Parsed - artist=%s year=%s genre=%s tags=%s confidence=%.2f",
                verified_artist,
                verified_year,
                genre,
                tags,
                confidence,
            )

            return {
                "verified_artist": verified_artist,
                "verified_year": verified_year,
                "genre": genre,
                "tags": tags,
                "research_confidence": confidence,
            }

        except json.JSONDecodeError as e:
            print(f"[WEB_RESEARCHER] JSON parse failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[WEB_RESEARCHER] JSON parse failed: %s", e)
            return {
                "verified_artist": artist,
                "verified_year": None,
                "genre": None,
                "tags": None,
                "research_confidence": 0.0,
            }
        except Exception as e:
            print(f"[WEB_RESEARCHER] research() failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[WEB_RESEARCHER] research() failed: %s", e)
            return {
                "verified_artist": artist,
                "verified_year": None,
                "genre": None,
                "tags": None,
                "research_confidence": 0.0,
            }
