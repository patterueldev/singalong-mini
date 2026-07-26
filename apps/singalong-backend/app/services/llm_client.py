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
            "web_researcher": "gpt-3.5-turbo",
            "language_identifier": "gpt-3.5-turbo",
        },
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com/v1",
        "api_key_env": "DEEPSEEK_API_KEY",
        "default_models": {
            "title_guesser": "deepseek-chat",
            "web_researcher": "deepseek-chat",
            "language_identifier": "deepseek-chat",
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
        return self._client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )


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
        "web_researcher": settings.ai_web_researcher_model,
        "language_identifier": settings.ai_language_identifier_model,
    }
    override = per_agent_models.get(agent_name, "")
    if override:
        return override
    return PROVIDER_CONFIG[provider]["default_models"].get(
        agent_name, PROVIDER_CONFIG[provider]["default_models"]["title_guesser"]
    )


@lru_cache(maxsize=4)
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
