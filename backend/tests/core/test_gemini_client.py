import pytest
from types import SimpleNamespace
from unittest.mock import patch
from pydantic import BaseModel
from app.core.gemini_client import GeminiClient


class _Schema(BaseModel):
    name: str


def _fake_response(text: str):
    usage = SimpleNamespace(
        prompt_token_count=1000,
        candidates_token_count=50,
        cached_content_token_count=0,
        thoughts_token_count=0,
    )
    return SimpleNamespace(text=text, usage_metadata=usage)


async def _async_return(value):
    return value


@pytest.mark.asyncio
async def test_generate_structured_parses_and_maps_usage():
    client = GeminiClient(api_key="x")
    with patch.object(
        client._client.aio.models,
        "generate_content",
        return_value=_async_return(_fake_response('{"name": "Геральт"}')),
    ), patch("app.core.gemini_client.asyncio.create_task"):
        result = await client.generate_structured(
            "prompt", schema_class=_Schema, model="gemini-3.5-flash"
        )
    assert result == {"name": "Геральт"}


@pytest.mark.asyncio
async def test_generate_text_returns_plain_string():
    client = GeminiClient(api_key="x")
    with patch.object(
        client._client.aio.models,
        "generate_content",
        return_value=_async_return(_fake_response("Geralt of Rivia")),
    ), patch("app.core.gemini_client.asyncio.create_task"):
        out = await client.generate_text("Геральт из Ривии", model="gemini-3.5-flash")
    assert out == "Geralt of Rivia"
