import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from app.core.gemini_client import GeminiClient
from app.services.nano_banana_generator import NanoBananaGenerator


def _img_response(data: bytes):
    part = SimpleNamespace(inline_data=SimpleNamespace(data=data))
    cand = SimpleNamespace(content=SimpleNamespace(parts=[part]))
    return SimpleNamespace(candidates=[cand], usage_metadata=SimpleNamespace())


@pytest.mark.asyncio
async def test_generate_returns_bytes():
    fake_client = GeminiClient(api_key="x")
    with patch(
        "app.services.nano_banana_generator.get_gemini_client",
        return_value=fake_client,
    ), patch.object(
        fake_client._client.aio.models, "generate_content", new_callable=AsyncMock
    ) as gc, patch(
        "app.core.gemini_client._log_usage_to_db", new_callable=AsyncMock
    ):
        gc.return_value = _img_response(b"\x89PNG_fake")
        gen = NanoBananaGenerator()
        out = await gen.generate(prompt="a knight in armor, book illustration")
    assert out == b"\x89PNG_fake"
