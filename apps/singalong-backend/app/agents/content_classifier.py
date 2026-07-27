"""Content Classifier Agent - Detect whether a submission is actually music/song content.

Distinct from OffVocalDetectorAgent, which assumes the input is already a song and
only classifies karaoke sub-type (off-vocal/instrumental vs. full-vocal, on-screen
lyrics vs. not). This agent judges a prior, more basic question: is this a song at
all, as opposed to a random clip, vlog, meme, gameplay video, or other non-music
content that a friend pasted in by mistake (or as a joke).

Critically, this must judge content type only, never language — a real song in an
obscure or regional language (e.g. Hiligaynon/Ilonggo) is still a real song, even
though the LLM may have low confidence identifying the language itself elsewhere in
the pipeline (see language_identifier.py). Conflating "I don't recognize this
language" with "this isn't music" would punish exactly the legitimate submissions
this app needs to support.
"""
import json
import logging
import sys
from typing import Optional

from app.services.llm_client import LLMClient, create_llm_client

logger = logging.getLogger(__name__)


class SongContentClassifierAgent:
    """Classifies whether a YouTube video is likely music/song content at all."""

    def __init__(self, llm_client: LLMClient | None = None):
        """Initialize the Content Classifier agent."""
        self.llm = llm_client or create_llm_client("content_classifier")

    def classify(
        self,
        youtube_title: str,
        youtube_description: str = "",
        duration: Optional[int] = None,
        categories: Optional[list[str]] = None,
    ) -> dict:
        """
        Classify whether a YouTube video is likely a song/music video at all.

        Args:
            youtube_title: The YouTube video title
            youtube_description: The YouTube video description
            duration: Video duration in seconds, if known (extra context only)
            categories: YouTube's own video categories, if known (extra context only)

        Returns:
            Dictionary with:
            - is_likely_song: bool
            - confidence: float (0.0-1.0) that this IS legitimate music/song content
            - reason: Optional[str] short explanation, only meaningful when flagged
        """
        try:
            print(
                f"[CONTENT_CLASSIFIER] classify() called - input_title={youtube_title[:80] if youtube_title else ''}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[CONTENT_CLASSIFIER] classify() called - input_title=%s",
                youtube_title[:80] if youtube_title else "",
            )

            if not self.llm:
                print(
                    "[CONTENT_CLASSIFIER] No LLM client, failing open (assuming it is a song)",
                    file=sys.stderr,
                    flush=True,
                )
                logger.warning("[CONTENT_CLASSIFIER] No LLM client, failing open")
                return {"is_likely_song": True, "confidence": 0.0, "reason": None}

            result = self._classify_with_llm(youtube_title, youtube_description, duration, categories)
            print(
                f"[CONTENT_CLASSIFIER] classify() completed - is_likely_song={result['is_likely_song']} "
                f"confidence={result['confidence']:.2f}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[CONTENT_CLASSIFIER] classify() completed - is_likely_song=%s confidence=%.2f",
                result["is_likely_song"],
                result["confidence"],
            )
            return result
        except Exception as e:
            print(f"[CONTENT_CLASSIFIER] classify() failed, failing open: {e}", file=sys.stderr, flush=True)
            logger.exception("[CONTENT_CLASSIFIER] classify() failed, failing open: %s", e)
            return {"is_likely_song": True, "confidence": 0.0, "reason": None}

    def _classify_with_llm(
        self,
        youtube_title: str,
        youtube_description: str,
        duration: Optional[int],
        categories: Optional[list[str]],
    ) -> dict:
        try:
            duration_line = f"{duration} seconds" if duration else "(unknown)"
            categories_line = ", ".join(categories) if categories else "(unknown)"

            prompt = f"""You are a karaoke-app content moderator. Decide whether this YouTube video is
actually music/song content (in ANY form: official audio, music video, lyric video,
karaoke track, off-vocal/instrumental, cover, acoustic version, practice track) as
opposed to non-music content someone pasted in by mistake or as a joke — a vlog,
gameplay/let's-play, comedy skit or meme, tutorial, movie/show clip, sports
highlight, or other random clip.

CRITICAL RULE: Judge ONLY whether this is music/song content. NEVER use the title's
language as a signal either way. A real song in any language — including regional
or dialect languages you may not recognize, e.g. Hiligaynon/Ilonggo, Cebuano,
Tagalog — must be judged purely on whether it's music, not on whether you can
identify or read the language. Do not penalize a title just because it looks
unfamiliar or you can't confirm the language.

YouTube Title: {youtube_title}
YouTube Description (first 200 chars): {youtube_description[:200] if youtube_description else "(empty)"}
Duration: {duration_line}
YouTube Categories (context only, not authoritative): {categories_line}

Return ONLY valid JSON with these exact fields (no markdown, no extra text):
{{
  "is_likely_song": true/false,
  "confidence": 0.0-1.0,
  "reason": "Short reason only if is_likely_song is false, otherwise null"
}}

Examples:
- Input: "Aqours - 恋になりたいAQUARIUM [Karaoke]" -> {{"is_likely_song": true, "confidence": 0.95, "reason": null}}
- Input: "Bam Pyeonji (Karaoke Ver.) - IU" -> {{"is_likely_song": true, "confidence": 0.9, "reason": null}}
- Input: "Kanta sang Iloilo - Ilonggo Lyrics Video" -> {{"is_likely_song": true, "confidence": 0.85, "reason": null}}
- Input: "Guy Falls Off Skateboard (funny compilation)" -> {{"is_likely_song": false, "confidence": 0.9, "reason": "Comedy/fail compilation clip, not music"}}
- Input: "Minecraft Speedrun World Record Attempt #47" -> {{"is_likely_song": false, "confidence": 0.9, "reason": "Gameplay video, not music"}}
- Input: "How to fix a leaky faucet" -> {{"is_likely_song": false, "confidence": 0.85, "reason": "Tutorial video, not music"}}"""

            print(
                f"[CONTENT_CLASSIFIER] LLM request - prompt length={len(prompt)}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[CONTENT_CLASSIFIER] LLM request - prompt length=%d", len(prompt))

            response = self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=250,
            )

            response_text = response.choices[0].message.content.strip()
            print(
                f"[CONTENT_CLASSIFIER] LLM response - raw={response_text[:200]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[CONTENT_CLASSIFIER] LLM response - raw=%s", response_text[:200])

            result = json.loads(response_text)
            is_likely_song = bool(result.get("is_likely_song", True))
            confidence = float(result.get("confidence", 0.5))
            reason = result.get("reason") if not is_likely_song else None

            return {"is_likely_song": is_likely_song, "confidence": confidence, "reason": reason}
        except json.JSONDecodeError as e:
            print(f"[CONTENT_CLASSIFIER] LLM JSON parse failed, failing open: {e}", file=sys.stderr, flush=True)
            logger.exception("[CONTENT_CLASSIFIER] LLM JSON parse failed, failing open: %s", e)
            return {"is_likely_song": True, "confidence": 0.0, "reason": None}
        except Exception as e:
            print(f"[CONTENT_CLASSIFIER] LLM API call failed, failing open: {e}", file=sys.stderr, flush=True)
            logger.exception("[CONTENT_CLASSIFIER] LLM API call failed, failing open: %s", e)
            return {"is_likely_song": True, "confidence": 0.0, "reason": None}
