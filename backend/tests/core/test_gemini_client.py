import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
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


@pytest.mark.asyncio
async def test_generate_structured_parses_and_maps_usage():
    client = GeminiClient(api_key="x")
    with patch.object(
        client._client.aio.models, "generate_content", new_callable=AsyncMock
    ) as gc, patch.object(GeminiClient, "_log"):
        gc.return_value = _fake_response('{"name": "Геральт"}')
        result = await client.generate_structured(
            "prompt", schema_class=_Schema, model="gemini-3.5-flash"
        )
    assert result == {"name": "Геральт"}


@pytest.mark.asyncio
async def test_generate_text_returns_plain_string():
    client = GeminiClient(api_key="x")
    with patch.object(
        client._client.aio.models, "generate_content", new_callable=AsyncMock
    ) as gc, patch.object(GeminiClient, "_log"):
        gc.return_value = _fake_response("Geralt of Rivia")
        out = await client.generate_text("Геральт из Ривии", model="gemini-3.5-flash")
    assert out == "Geralt of Rivia"


# Fix 1 — generate_structured crashes on blocked/empty response (text=None)
@pytest.mark.asyncio
async def test_generate_structured_raises_on_none_text():
    client = GeminiClient(api_key="x")
    with patch.object(
        client._client.aio.models, "generate_content", new_callable=AsyncMock
    ) as gc, patch.object(GeminiClient, "_log"):
        gc.return_value = _fake_response(None)
        with pytest.raises(RuntimeError):
            await client.generate_structured(
                "prompt", schema_class=_Schema, model="gemini-3.5-flash"
            )


# Fix 2 — generate_image crashes on empty candidates (safety block)
@pytest.mark.asyncio
async def test_generate_image_raises_on_empty_candidates():
    client = GeminiClient(api_key="x")
    fake_resp = SimpleNamespace(
        candidates=[],
        usage_metadata=SimpleNamespace(),
    )
    with patch.object(
        client._client.aio.models, "generate_content", new_callable=AsyncMock
    ) as gc, patch("app.core.gemini_client.asyncio.create_task"):
        gc.return_value = fake_resp
        with pytest.raises(RuntimeError):
            await client.generate_image("a cat", model="gemini-3.1-flash-image")


# aspect_ratio/image_size обязаны доезжать до SDK: без image_config модель
# генерирует в дефолтном соотношении, а compute_image_cost считает цену по
# запрошенному image_size — расхождение молчаливое.
@pytest.mark.asyncio
async def test_generate_image_passes_aspect_ratio_and_size_to_sdk():
    client = GeminiClient(api_key="x")
    inline = SimpleNamespace(data=b"PNGDATA")
    fake_resp = SimpleNamespace(
        candidates=[
            SimpleNamespace(
                content=SimpleNamespace(parts=[SimpleNamespace(inline_data=inline)])
            )
        ],
        usage_metadata=SimpleNamespace(),
    )
    with patch.object(
        client._client.aio.models, "generate_content", new_callable=AsyncMock
    ) as gc, patch("app.core.gemini_client.asyncio.create_task"):
        gc.return_value = fake_resp
        out = await client.generate_image(
            "a cat", model="gemini-3.1-flash-image", aspect_ratio="4:3", image_size="2K"
        )

    assert out == b"PNGDATA"
    config = gc.await_args.kwargs["config"]
    assert config.response_modalities == ["IMAGE"]
    assert config.image_config is not None
    assert config.image_config.aspect_ratio == "4:3"
    assert config.image_config.image_size == "2K"


# temperature в Gemini 3.x deprecated: в следующих поколениях даёт HTTP 400
@pytest.mark.asyncio
async def test_text_calls_do_not_send_temperature():
    client = GeminiClient(api_key="x")
    with patch.object(
        client._client.aio.models, "generate_content", new_callable=AsyncMock
    ) as gc, patch.object(GeminiClient, "_log"):
        gc.return_value = _fake_response("ok")
        await client.generate_text("prompt", model="gemini-3.6-flash")
        assert gc.await_args.kwargs["config"].temperature is None

        gc.return_value = _fake_response('{"name": "Геральт"}')
        await client.generate_structured(
            "prompt", schema_class=_Schema, model="gemini-3.6-flash"
        )
        assert gc.await_args.kwargs["config"].temperature is None


# Fix 5 — GeminiClient satisfies AIProvider protocol (tested here for proximity)
def test_gemini_client_satisfies_protocol():
    from app.core.ai_provider import AIProvider

    client = GeminiClient(api_key="x")
    assert isinstance(client, AIProvider)
