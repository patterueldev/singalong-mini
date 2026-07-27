"""Brave Search API client — used by LyricsResearcher (web fallback) and GenreClassifier/TagsSuggester (metadata context)."""
import logging
import re

import httpx
from bs4 import BeautifulSoup

from app.config import settings

logger = logging.getLogger(__name__)

BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
_TAG_STRIP_RE = re.compile(r"<[^>]+>")


class BraveSearchService:
    """Thin async wrapper around the Brave Search API. No-ops safely when unconfigured."""

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key if api_key is not None else settings.brave_api_key

    async def search(self, query: str, count: int = 5) -> list[dict]:
        if not self.api_key:
            logger.warning("[BRAVE_SEARCH] no api key configured, skipping query=%s", query[:60])
            return []
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    BRAVE_SEARCH_URL,
                    params={"q": query, "count": count},
                    headers={"Accept": "application/json", "X-Subscription-Token": self.api_key},
                )
                resp.raise_for_status()
                data = resp.json()

            results = []
            for item in (data.get("web", {}).get("results", []) or [])[:count]:
                results.append(
                    {
                        "title": _TAG_STRIP_RE.sub("", item.get("title", "")),
                        "url": item.get("url", ""),
                        "description": _TAG_STRIP_RE.sub("", item.get("description", "")),
                    }
                )
            logger.info("[BRAVE_SEARCH] query=%s results=%d", query[:60], len(results))
            return results
        except Exception as e:
            logger.exception("[BRAVE_SEARCH] search() failed query=%s: %s", query[:60], e)
            return []

    async def fetch_page_text(self, url: str, max_chars: int = 6000) -> str | None:
        if not url:
            return None
        try:
            async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
                resp = await client.get(
                    url, headers={"User-Agent": "Mozilla/5.0 (compatible; SingalongBot/1.0)"}
                )
                resp.raise_for_status()

            soup = BeautifulSoup(resp.text, "html.parser")
            for tag in soup(["script", "style", "nav", "header", "footer"]):
                tag.decompose()
            text = re.sub(r"\n{2,}", "\n", soup.get_text(separator="\n")).strip()
            return text[:max_chars] if text else None
        except Exception as e:
            logger.exception("[BRAVE_SEARCH] fetch_page_text() failed url=%s: %s", url, e)
            return None
