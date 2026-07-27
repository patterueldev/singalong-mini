"""Pluggable LLM client factory — supports OpenAI and DeepSeek via a single provider toggle."""

import logging
from functools import lru_cache
from openai import OpenAI

from app.config import settings

logger = logging.getLogger(__name__)

PROVIDER_CONFIG = {
    "openai": {
        "base_url": None,
        "api_key_env": "OPENAI_API_KEY",
        "default_models": {
            "title_guesser": "gpt-3.5-turbo",
            "off_vocal_detector": "gpt-4o-mini",
            "title_researcher": "gpt-4o-mini",
            "artist_researcher": "gpt-4o-mini",
            "genre_classifier": "gpt-4o-mini",
            "tags_suggester": "gpt-4o-mini",
            "language_identifier": "gpt-3.5-turbo",
            "lyrics_researcher": "gpt-4o",
        },
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com/v1",
        "api_key_env": "DEEPSEEK_API_KEY",
        "default_models": {
            "title_guesser": "deepseek-v4-pro",
            "off_vocal_detector": "deepseek-v4-flash",
            "title_researcher": "deepseek-v4-flash",
            "artist_researcher": "deepseek-v4-flash",
            "genre_classifier": "deepseek-v4-flash",
            "tags_suggester": "deepseek-v4-flash",
            "language_identifier": "deepseek-v4-flash",
            "lyrics_researcher": "deepseek-v4-pro",
        },
    },
}


class LLMClient:
    """Thin wrapper around the OpenAI SDK that supports multiple providers."""

    def __init__(self, provider: str, api_key: str, model: str) -> None:
        config = PROVIDER_CONFIG[provider]
        base_url = config["base_url"]
        if base_url:
            self._client = OpenAI(base_url=base_url, api_key=api_key)
        else:
            self._client = OpenAI(api_key=api_key)
        self.model = model
        self.provider = provider

    def chat_completion(
        self,
        messages: list[dict],
        temperature: float = 0.3,
        max_tokens: int = 300,
    ):
        # DeepSeek's reasoning models emit hidden chain-of-thought (reasoning_content)
        # that counts against the same max_tokens budget as the visible JSON content —
        # if thinking runs long, content comes back empty or truncated. None of this
        # pipeline's structured-extraction tasks need chain-of-thought, so disable it.
        extra_body = {"thinking": {"type": "disabled"}} if self.provider == "deepseek" else None

        response = None
        for attempt in range(2):
            response = self._client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
                **({"extra_body": extra_body} if extra_body else {}),
            )
            if response.choices[0].message.content and response.choices[0].message.content.strip():
                return response
            logger.warning(
                "Empty LLM response from model=%s (attempt %d/2), retrying...", self.model, attempt + 1
            )
        return response


def _resolve_api_key(provider: str) -> str:
    config = PROVIDER_CONFIG[provider]
    env_var = config["api_key_env"]
    if provider == "openai":
        return settings.openai_api_key
    elif provider == "deepseek":
        return settings.deepseek_api_key
    raise ValueError(f"Unknown AI provider: {provider}")


def _resolve_model(agent_name: str, provider: str) -> str:
    per_agent_models = {
        "title_guesser": settings.ai_title_guesser_model,
        "off_vocal_detector": settings.ai_off_vocal_detector_model,
        "title_researcher": settings.ai_title_researcher_model,
        "artist_researcher": settings.ai_artist_researcher_model,
        "genre_classifier": settings.ai_genre_classifier_model,
        "tags_suggester": settings.ai_tags_suggester_model,
        "language_identifier": settings.ai_language_identifier_model,
        "lyrics_researcher": settings.ai_lyrics_researcher_model,
    }
    override = per_agent_models.get(agent_name, "")
    if override:
        return override
    return PROVIDER_CONFIG[provider]["default_models"].get(
        agent_name, PROVIDER_CONFIG[provider]["default_models"]["title_guesser"]
    )


@lru_cache(maxsize=16)
def create_llm_client(agent_name: str) -> LLMClient | None:
    provider = settings.ai_provider
    if provider not in PROVIDER_CONFIG:
        logger.error("Unknown AI provider %s — skipping LLM client", provider)
        return None

    api_key = _resolve_api_key(provider)
    if not api_key:
        logger.warning(
            "AI provider %s selected but no API key configured — skipping LLM client",
            provider,
        )
        return None

    model = _resolve_model(agent_name, provider)
    logger.info(
        "Creating LLM client for agent=%s provider=%s model=%s",
        agent_name,
        provider,
        model,
    )
    return LLMClient(provider=provider, api_key=api_key, model=model)
