from app.core.ai_provider import AIProvider
from app.core.openrouter_client import OpenRouterClient


def test_openrouter_client_satisfies_protocol():
    client = OpenRouterClient(api_key="x")
    assert isinstance(client, AIProvider)  # runtime_checkable Protocol


# Fix 5 — GeminiClient must also satisfy AIProvider protocol
def test_gemini_client_satisfies_protocol():
    from app.core.gemini_client import GeminiClient

    client = GeminiClient(api_key="x")
    assert isinstance(client, AIProvider)
