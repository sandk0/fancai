"""
Тесты для OpenRouter клиента.

Покрывает:
- _inline_defs: разворачивание $defs/$ref в JSON Schema
- generate_text: успех, fallback при 5xx, все модели недоступны
- generate_structured: успех с Pydantic моделью
- fallback: только на httpx.HTTPStatusError и httpx.TimeoutException
- generate_image: success, missing choices, 400, 429, 500, logging
"""

import json
import logging
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
from pydantic import BaseModel
from typing import Optional, List

from app.core.retry import RateLimitError

# ---------------------------------------------------------------------------
# Helpers — создание мок-ответов httpx
# ---------------------------------------------------------------------------


def _make_response(status_code: int, body: dict | None = None) -> httpx.Response:
    """Создаёт объект httpx.Response с заданным статусом и телом."""
    content = json.dumps(body or {}).encode()
    request = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    return httpx.Response(
        status_code=status_code,
        content=content,
        headers={"content-type": "application/json"},
        request=request,
    )


def _make_text_response(text_content: str) -> httpx.Response:
    """Мок успешного ответа generate_text от OpenRouter."""
    body = {"choices": [{"message": {"content": text_content}}]}
    return _make_response(200, body)


def _make_json_response(data: dict) -> httpx.Response:
    """Мок успешного ответа с JSON контентом в choices[0].message.content."""
    return _make_text_response(json.dumps(data))


# ---------------------------------------------------------------------------
# Тесты _inline_defs
# ---------------------------------------------------------------------------


class TestInlineDefs:
    """Тесты для функции _inline_defs."""

    def test_flat_schema_unchanged(self):
        """Плоская схема без $defs не изменяется."""
        from app.core.openrouter_client import _inline_defs

        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "integer"},
            },
            "required": ["name"],
        }
        # Копируем для сравнения
        original = json.loads(json.dumps(schema))
        result = _inline_defs(schema)

        assert result["type"] == "object"
        assert result["properties"]["name"] == {"type": "string"}
        assert result["properties"]["age"] == {"type": "integer"}
        # $defs не появился
        assert "$defs" not in result

    def test_inline_defs_with_ref(self):
        """Схема с $defs/$ref корректно разворачивается."""
        from app.core.openrouter_client import _inline_defs

        schema = {
            "$defs": {
                "Address": {
                    "type": "object",
                    "properties": {
                        "street": {"type": "string"},
                        "city": {"type": "string"},
                    },
                }
            },
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "address": {"$ref": "#/$defs/Address"},
            },
        }
        result = _inline_defs(schema)

        # $defs должны исчезнуть
        assert "$defs" not in result
        # $ref должен быть заменён inline объектом
        assert "$ref" not in result["properties"]["address"]
        assert result["properties"]["address"]["type"] == "object"
        assert "street" in result["properties"]["address"]["properties"]

    def test_inline_defs_nested_refs(self):
        """Вложенные $ref (ссылки на другие $defs) разворачиваются рекурсивно."""
        from app.core.openrouter_client import _inline_defs

        schema = {
            "$defs": {
                "Tag": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                    },
                },
                "Item": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "tag": {"$ref": "#/$defs/Tag"},
                    },
                },
            },
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/Item"},
                }
            },
        }
        result = _inline_defs(schema)

        assert "$defs" not in result
        items_schema = result["properties"]["items"]["items"]
        assert "$ref" not in items_schema
        assert items_schema["type"] == "object"
        # После разворачивания Item — tag тоже должен быть inline
        assert "$ref" not in items_schema["properties"]["tag"]
        assert items_schema["properties"]["tag"]["type"] == "object"

    def test_pydantic_model_schema_inlined(self):
        """Схема Pydantic модели с вложенными типами разворачивается корректно."""
        from app.core.openrouter_client import _inline_defs

        class Inner(BaseModel):
            value: int
            label: str

        class Outer(BaseModel):
            name: str
            inner: Inner
            items: List[Inner]

        schema = Outer.model_json_schema()
        result = _inline_defs(schema)

        # После inlining нет $defs и $ref
        schema_str = json.dumps(result)
        assert "$defs" not in schema_str
        assert "$ref" not in schema_str


# ---------------------------------------------------------------------------
# Тесты generate_text
# ---------------------------------------------------------------------------


class TestGenerateText:
    """Тесты для метода generate_text."""

    @pytest.mark.asyncio
    async def test_generate_text_success(self):
        """generate_text возвращает текст при успешном ответе API."""
        from app.core.openrouter_client import OpenRouterClient

        client = OpenRouterClient(api_key="test-key")
        expected_content = '{"result": "ok"}'

        mock_response = _make_text_response(expected_content)

        with patch.object(client, "_get_client") as mock_get_client:
            mock_http = MagicMock()
            mock_http.post = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_http

            result = await client.generate_text(
                prompt="test prompt",
                system_prompt="You are helpful.",
            )

        assert result == expected_content

    @pytest.mark.asyncio
    async def test_generate_text_fallback_on_500(self):
        """При 5xx первой модели переключается на fallback."""
        from app.core.openrouter_client import OpenRouterClient, FALLBACK_MODELS

        client = OpenRouterClient(api_key="test-key")
        expected_content = '{"result": "from_fallback"}'

        # Первый вызов — 500, второй — 200
        error_response = _make_response(500)
        success_response = _make_text_response(expected_content)

        call_count = 0

        async def mock_post(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # Симулируем httpx.HTTPStatusError для 500
                raise httpx.HTTPStatusError(
                    "500 Internal Server Error",
                    request=MagicMock(),
                    response=error_response,
                )
            return success_response

        with patch.object(client, "_get_client") as mock_get_client:
            mock_http = MagicMock()
            mock_http.post = mock_post
            mock_get_client.return_value = mock_http

            result = await client.generate_text(prompt="test prompt")

        assert result == expected_content
        assert call_count == 2  # Первая попытка + fallback

    @pytest.mark.asyncio
    async def test_generate_text_all_models_fail(self):
        """При сбое всех моделей пробрасывается исключение."""
        from app.core.openrouter_client import OpenRouterClient, FALLBACK_MODELS

        client = OpenRouterClient(api_key="test-key")

        async def mock_post(*args, **kwargs):
            raise httpx.HTTPStatusError(
                "503 Service Unavailable",
                request=MagicMock(),
                response=_make_response(503),
            )

        with patch.object(client, "_get_client") as mock_get_client:
            mock_http = MagicMock()
            mock_http.post = mock_post
            mock_get_client.return_value = mock_http

            with pytest.raises(httpx.HTTPStatusError):
                await client.generate_text(prompt="test prompt")

    @pytest.mark.asyncio
    async def test_generate_text_fallback_on_timeout(self):
        """Fallback срабатывает при httpx.TimeoutException."""
        from app.core.openrouter_client import OpenRouterClient

        client = OpenRouterClient(api_key="test-key")
        expected_content = '{"ok": true}'

        call_count = 0

        async def mock_post(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise httpx.TimeoutException("Connection timed out")
            return _make_text_response(expected_content)

        with patch.object(client, "_get_client") as mock_get_client:
            mock_http = MagicMock()
            mock_http.post = mock_post
            mock_get_client.return_value = mock_http

            result = await client.generate_text(prompt="test prompt")

        assert result == expected_content
        assert call_count == 2


# ---------------------------------------------------------------------------
# Тесты fallback — критичная логика
# ---------------------------------------------------------------------------


class TestFallbackBehavior:
    """Тесты для fallback chain — что вызывает fallback, а что нет."""

    @pytest.mark.asyncio
    async def test_json_decode_error_does_not_trigger_fallback(self):
        """json.JSONDecodeError НЕ вызывает fallback — ошибка парсинга пробрасывается вверх."""
        from app.core.openrouter_client import OpenRouterClient

        client = OpenRouterClient(api_key="test-key")

        # Ответ с невалидным JSON
        bad_json_response = _make_text_response("this is not valid json {{{")

        call_count = 0

        async def mock_post(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            return bad_json_response

        with patch.object(client, "_get_client") as mock_get_client:
            mock_http = MagicMock()
            mock_http.post = mock_post
            mock_get_client.return_value = mock_http

            # generate_structured должен бросить json.JSONDecodeError, не делая fallback
            with pytest.raises(json.JSONDecodeError):
                await client.generate_structured(
                    prompt="test",
                    schema_class=_SimpleSchema,
                )

        # Вызов был только один — fallback НЕ произошёл
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_http_status_error_triggers_fallback(self):
        """httpx.HTTPStatusError вызывает fallback."""
        from app.core.openrouter_client import OpenRouterClient

        client = OpenRouterClient(api_key="test-key")
        call_count = 0

        async def mock_post(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise httpx.HTTPStatusError(
                    "500",
                    request=MagicMock(),
                    response=_make_response(500),
                )
            return _make_text_response('{"ok": "fallback"}')

        with patch.object(client, "_get_client") as mock_get_client:
            mock_http = MagicMock()
            mock_http.post = mock_post
            mock_get_client.return_value = mock_http

            result = await client.generate_text(prompt="test")

        assert call_count == 2  # Fallback произошёл

    @pytest.mark.asyncio
    async def test_timeout_exception_triggers_fallback(self):
        """httpx.TimeoutException вызывает fallback."""
        from app.core.openrouter_client import OpenRouterClient

        client = OpenRouterClient(api_key="test-key")
        call_count = 0

        async def mock_post(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise httpx.TimeoutException("Timeout")
            return _make_text_response('{"ok": "fallback"}')

        with patch.object(client, "_get_client") as mock_get_client:
            mock_http = MagicMock()
            mock_http.post = mock_post
            mock_get_client.return_value = mock_http

            result = await client.generate_text(prompt="test")

        assert call_count == 2

    @pytest.mark.asyncio
    async def test_broad_exception_propagates_without_fallback(self):
        """Произвольное Exception (не HTTPStatusError/TimeoutException) пробрасывается без fallback."""
        from app.core.openrouter_client import OpenRouterClient

        client = OpenRouterClient(api_key="test-key")
        call_count = 0

        async def mock_post(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            raise ValueError("Unexpected error — not a network issue")

        with patch.object(client, "_get_client") as mock_get_client:
            mock_http = MagicMock()
            mock_http.post = mock_post
            mock_get_client.return_value = mock_http

            with pytest.raises(ValueError):
                await client.generate_text(prompt="test")

        # Fallback не произошёл — только один вызов
        assert call_count == 1


# ---------------------------------------------------------------------------
# Тесты generate_structured
# ---------------------------------------------------------------------------


class _SimpleSchema(BaseModel):
    """Простая тестовая Pydantic схема."""

    name: str
    value: int
    tags: Optional[List[str]] = None


class TestGenerateStructured:
    """Тесты для метода generate_structured."""

    @pytest.mark.asyncio
    async def test_generate_structured_success(self):
        """generate_structured возвращает dict, соответствующий Pydantic модели."""
        from app.core.openrouter_client import OpenRouterClient

        client = OpenRouterClient(api_key="test-key")
        expected_data = {"name": "Тест", "value": 42, "tags": ["a", "b"]}
        response = _make_json_response(expected_data)

        with patch.object(client, "_get_client") as mock_get_client:
            mock_http = MagicMock()
            mock_http.post = AsyncMock(return_value=response)
            mock_get_client.return_value = mock_http

            result = await client.generate_structured(
                prompt="generate schema",
                schema_class=_SimpleSchema,
            )

        assert result == expected_data
        # Должен быть валиден для Pydantic
        parsed = _SimpleSchema.model_validate(result)
        assert parsed.name == "Тест"
        assert parsed.value == 42

    @pytest.mark.asyncio
    async def test_generate_structured_schema_has_no_defs(self):
        """generate_structured отправляет схему без $defs/$ref."""
        from app.core.openrouter_client import OpenRouterClient

        client = OpenRouterClient(api_key="test-key")

        class NestedModel(BaseModel):
            inner_val: str

        class OuterModel(BaseModel):
            name: str
            nested: NestedModel

        expected_data = {"name": "x", "nested": {"inner_val": "y"}}
        response = _make_json_response(expected_data)

        captured_body = {}

        async def mock_post(path, json=None, **kwargs):
            captured_body.update(json or {})
            return response

        with patch.object(client, "_get_client") as mock_get_client:
            mock_http = MagicMock()
            mock_http.post = mock_post
            mock_get_client.return_value = mock_http

            await client.generate_structured(
                prompt="test",
                schema_class=OuterModel,
            )

        # Проверяем что в отправленном теле нет $defs и $ref
        sent_schema_str = json.dumps(captured_body.get("response_format", {}))
        assert "$defs" not in sent_schema_str
        assert "$ref" not in sent_schema_str


# ---------------------------------------------------------------------------
# Тест экспортов модуля
# ---------------------------------------------------------------------------


class TestModuleExports:
    """Проверяет что модуль экспортирует необходимые символы."""

    def test_imports_available(self):
        """Все необходимые символы доступны для импорта."""
        from app.core.openrouter_client import (
            OpenRouterClient,
            get_openrouter_client,
            _inline_defs,
            FALLBACK_MODELS,
        )

        assert OpenRouterClient is not None
        assert callable(get_openrouter_client)
        assert callable(_inline_defs)
        assert isinstance(FALLBACK_MODELS, list)
        assert len(FALLBACK_MODELS) >= 2

    def test_fallback_models_are_strings(self):
        """FALLBACK_MODELS содержит строки — ID моделей."""
        from app.core.openrouter_client import FALLBACK_MODELS

        for model_id in FALLBACK_MODELS:
            assert isinstance(model_id, str)
            assert (
                "/" in model_id
            ), f"Model ID должен содержать '/' (provider/model): {model_id}"


# ---------------------------------------------------------------------------
# Helpers — generate_image
# ---------------------------------------------------------------------------


def _make_image_response(image_b64: str = "iVBORw0KGgo=") -> httpx.Response:
    """Мок успешного ответа generate_image от OpenRouter."""
    body = {
        "choices": [
            {
                "message": {
                    "images": [
                        {"image_url": {"url": f"data:image/png;base64,{image_b64}"}}
                    ]
                }
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 0},
    }
    return _make_response(200, body)


@pytest.fixture
def mock_client():
    """OpenRouterClient с замоканным _post_with_breaker."""
    from app.core.openrouter_client import OpenRouterClient

    client = OpenRouterClient.__new__(OpenRouterClient)
    client._post_with_breaker = AsyncMock()
    return client


# ---------------------------------------------------------------------------
# Тесты generate_image
# ---------------------------------------------------------------------------


class TestGenerateImage:
    """Тесты для метода generate_image — валидация ответа и обработка HTTP ошибок."""

    @pytest.mark.asyncio
    async def test_generate_image_success(self, mock_client):
        """generate_image возвращает bytes при успешном ответе с choices."""
        mock_client._post_with_breaker.return_value = _make_image_response()

        result = await mock_client.generate_image(prompt="a cat sitting on a chair")

        assert isinstance(result, bytes)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_generate_image_missing_choices(self, mock_client):
        """Ответ без choices бросает RuntimeError с 'no choices'."""
        error_body = {"error": {"message": "model busy"}}
        mock_client._post_with_breaker.return_value = _make_response(200, error_body)

        with pytest.raises(RuntimeError, match="no choices"):
            await mock_client.generate_image(prompt="a dog")

    @pytest.mark.asyncio
    async def test_generate_image_empty_choices(self, mock_client):
        """Ответ с пустым choices бросает RuntimeError с 'no choices'."""
        empty_choices_body = {"choices": []}
        mock_client._post_with_breaker.return_value = _make_response(
            200, empty_choices_body
        )

        with pytest.raises(RuntimeError, match="no choices"):
            await mock_client.generate_image(prompt="a dog")

    @pytest.mark.asyncio
    async def test_generate_image_400_bad_request(self, mock_client):
        """HTTP 400 бросает ValueError (non-retryable), НЕ httpx.HTTPStatusError."""
        error_resp = _make_response(400, {"error": {"message": "content moderation"}})
        mock_client._post_with_breaker.side_effect = httpx.HTTPStatusError(
            "400 Bad Request",
            request=httpx.Request(
                "POST", "https://openrouter.ai/api/v1/chat/completions"
            ),
            response=error_resp,
        )

        with pytest.raises(ValueError, match="rejected prompt") as exc_info:
            await mock_client.generate_image(prompt="bad prompt")
        assert "content moderation" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_generate_image_429_rate_limit(self, mock_client):
        """HTTP 429 бросает RateLimitError (retryable через tenacity)."""
        error_resp = _make_response(429, {"error": {"message": "rate limited"}})
        mock_client._post_with_breaker.side_effect = httpx.HTTPStatusError(
            "429 Too Many Requests",
            request=httpx.Request(
                "POST", "https://openrouter.ai/api/v1/chat/completions"
            ),
            response=error_resp,
        )

        with pytest.raises(RateLimitError):
            await mock_client.generate_image(prompt="a cat")

    @pytest.mark.asyncio
    async def test_generate_image_500_propagates(self, mock_client):
        """HTTP 500 пробрасывается как httpx.HTTPStatusError (retryable через tenacity)."""
        error_resp = _make_response(500, {"error": {"message": "server error"}})
        mock_client._post_with_breaker.side_effect = httpx.HTTPStatusError(
            "500 Internal Server Error",
            request=httpx.Request(
                "POST", "https://openrouter.ai/api/v1/chat/completions"
            ),
            response=error_resp,
        )

        with pytest.raises(httpx.HTTPStatusError):
            await mock_client.generate_image(prompt="a cat")

    @pytest.mark.asyncio
    async def test_generate_image_missing_choices_logs(self, mock_client, caplog):
        """Missing choices логируется с structured data: model, response_preview, prompt_preview."""
        error_body = {"error": {"message": "model busy"}}
        mock_client._post_with_breaker.return_value = _make_response(200, error_body)

        with caplog.at_level(logging.ERROR):
            with pytest.raises(RuntimeError):
                await mock_client.generate_image(prompt="test prompt for logging")

        # Проверяем что лог содержит structured extra
        assert len(caplog.records) >= 1
        log_record = caplog.records[-1]
        assert hasattr(log_record, "model")
        assert hasattr(log_record, "response_preview")
        assert hasattr(log_record, "prompt_preview")
