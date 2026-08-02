"""Фабрика AI-провайдера по feature-flag AI_PROVIDER (мгновенный rollback на cutover)."""

from typing import Optional

from app.core.ai_provider import AIProvider
from app.core.config import settings

_provider: Optional[AIProvider] = None


def get_ai_provider() -> AIProvider:
    global _provider
    provider = _provider
    if provider is None:
        if settings.AI_PROVIDER == "gemini":
            from app.core.gemini_client import get_gemini_client

            provider = get_gemini_client()
        else:
            from app.core.openrouter_client import get_openrouter_client

            provider = get_openrouter_client()
        _provider = provider
    return provider


def _reset() -> None:
    """Сброс singleton (для тестов и переключения флага)."""
    global _provider
    _provider = None
