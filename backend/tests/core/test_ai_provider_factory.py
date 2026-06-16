import app.core.ai_provider_factory as f
from app.core.gemini_client import GeminiClient
from app.core.openrouter_client import OpenRouterClient


def test_factory_returns_gemini_when_flag_gemini(monkeypatch):
    monkeypatch.setattr(f.settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(f.settings, "GEMINI_API_KEY", "x")
    f._reset()
    assert isinstance(f.get_ai_provider(), GeminiClient)


def test_factory_returns_openrouter_when_flag_openrouter(monkeypatch):
    monkeypatch.setattr(f.settings, "AI_PROVIDER", "openrouter")
    f._reset()
    assert isinstance(f.get_ai_provider(), OpenRouterClient)
