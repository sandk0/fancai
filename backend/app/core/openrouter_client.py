"""
OpenRouter API клиент для fancai.

Единый клиент для всех AI-вызовов:
- generate_text()      — JSON mode через response_format (для entity_synthesis, consistency_manager)
- generate_structured() — JSON Schema mode с inlined schema (для gemini_extractor, entity_dedup)
- generate_image()     — /chat/completions с modalities=["image"] (для imagen_generator)

Реализует client-side fallback chain: Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite.
Fallback срабатывает ТОЛЬКО на httpx.HTTPStatusError и httpx.TimeoutException.
json.JSONDecodeError и ValidationError пробрасываются вверх без fallback.

Источники:
- OpenRouter API: https://openrouter.ai/docs
- Image generation: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- Structured outputs: https://openrouter.ai/docs/guides/features/structured-outputs
- $defs/$ref issue: https://github.com/pydantic/pydantic-ai/issues/3617
"""

import asyncio
import base64
import json
import logging
import time
from typing import Any, Optional, Type

import httpx
from pydantic import BaseModel

from app.monitoring.metrics import (
    record_llm_error,
    record_llm_request,
    record_llm_tokens,
    llm_cost_dollars_total,
    llm_fallback_total,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Константы
# ---------------------------------------------------------------------------

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Fallback chain для LLM (в порядке приоритета).
# Триггер переключения: httpx.HTTPStatusError (5xx) и httpx.TimeoutException.
# json.JSONDecodeError и ValidationError НЕ вызывают fallback (ошибка парсинга ответа).
FALLBACK_MODELS = [
    "google/gemini-3-flash-preview",  # основная — самая быстрая
    "anthropic/claude-haiku-4.5",  # первый fallback
    "google/gemini-2.5-flash-lite",  # последний fallback
]

# Image модели — FLUX.2 семейство.
# ВАЖНО: используется /chat/completions с modalities=["image"], НЕ /images/generations.
# Ответ: choices[0].message.images[0].image_url.url (base64 data URL).
DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b"


# ---------------------------------------------------------------------------
# _inline_defs — разворачивание $defs/$ref для Google моделей через OpenRouter
# ---------------------------------------------------------------------------


def _inline_defs(schema: dict) -> dict:
    """
    Рекурсивно разворачивает $defs/$ref в JSON Schema.

    Необходимо для Google Gemini через OpenRouter:
    Google модели через OpenRouter не поддерживают $defs/$ref —
    деградируют к строкам вместо объектов.
    Источник: https://github.com/pydantic/pydantic-ai/issues/3617

    Args:
        schema: JSON Schema dict (может содержать $defs и $ref)

    Returns:
        Новый dict без $defs и $ref — все ссылки заменены inline определениями.
    """
    # Извлекаем $defs (мутабельная операция на входной схеме)
    defs = schema.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                ref_name = node["$ref"].split("/")[-1]
                # Рекурсивно разворачиваем целевое определение
                return resolve(dict(defs.get(ref_name, {})))
            return {k: resolve(v) for k, v in node.items()}
        elif isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)


# ---------------------------------------------------------------------------
# Usage logging helper
# ---------------------------------------------------------------------------


async def _log_usage_to_db(
    model: str,
    service: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    cost: float,
    request_id: Optional[str],
) -> None:
    """
    Записывает использование LLM API в таблицу llm_usage_log.

    Вызывается через asyncio.create_task() — не блокирует основной поток.
    Использует прямой SQL INSERT через core.database (не зависит от DI).

    Args:
        model: Идентификатор модели OpenRouter
        service: Имя вызывающего сервиса (опционально)
        prompt_tokens: Количество input токенов
        completion_tokens: Количество output токенов
        cost: Стоимость вызова в USD
        request_id: OpenRouter request_id для корреляции
    """
    try:
        from app.core.database import AsyncSessionLocal
        from app.models.llm_usage_log import LlmUsageLog

        async with AsyncSessionLocal() as session:
            log_entry = LlmUsageLog(
                model=model,
                service=service,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_dollars=cost,
                request_id=request_id,
            )
            session.add(log_entry)
            await session.commit()
    except Exception as e:
        # Логируем ошибку но не пробрасываем — DB logging не должна ломать основной поток
        logger.warning(f"[OpenRouter] Не удалось записать usage в DB: {e}")


# ---------------------------------------------------------------------------
# OpenRouterClient
# ---------------------------------------------------------------------------


class OpenRouterClient:
    """
    Единый клиент для всех OpenRouter API вызовов.

    Использует httpx.AsyncClient напрямую (без OpenAI SDK).
    Реализует client-side fallback chain для LLM.
    Image generation использует /chat/completions с modalities.
    """

    def __init__(self, api_key: str, timeout: int = 120):
        self.api_key = api_key
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        """Lazy init httpx.AsyncClient с singleton семантикой."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=OPENROUTER_BASE_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://fancai.ru",
                    "X-Title": "fancai",
                },
                timeout=self.timeout,
            )
        return self._client

    async def generate_text(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        model: Optional[str] = None,
    ) -> str:
        """
        Простая генерация текста с JSON mode.

        Заменяет response_mime_type="application/json" в google-genai SDK.
        Для: entity_synthesis_service, consistency_manager.

        Fallback: httpx.HTTPStatusError и httpx.TimeoutException → следующая модель.
        json.JSONDecodeError → пробрасывается вверх (не fallback).

        Args:
            prompt: Текст запроса
            system_prompt: Системный промпт (опционально)
            temperature: Температура генерации (0.0 - 1.0)
            model: Конкретная модель (если None — используется FALLBACK_MODELS)

        Returns:
            Строка с ответом модели (обычно JSON).
        """
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        models = [model] if model else FALLBACK_MODELS

        last_exception: Optional[Exception] = None

        for i, current_model in enumerate(models):
            is_last = i == len(models) - 1
            start_time = time.time()
            try:
                body = {
                    "model": current_model,
                    "messages": messages,
                    "temperature": temperature,
                    "response_format": {"type": "json_object"},
                }

                resp = await self._get_client().post("/chat/completions", json=body)
                resp.raise_for_status()
                data = resp.json()
                content: str = data["choices"][0]["message"]["content"]

                duration = time.time() - start_time
                record_llm_request(
                    model=current_model, status="success", duration=duration
                )

                # Парсим usage/cost из ответа и записываем в метрики
                usage = data.get("usage", {})
                prompt_tokens = usage.get("prompt_tokens", 0)
                completion_tokens = usage.get("completion_tokens", 0)
                cost = usage.get("cost", 0.0) or 0.0
                request_id = data.get("id")

                record_llm_tokens(current_model, prompt_tokens, completion_tokens)
                if cost:
                    llm_cost_dollars_total.labels(model=current_model).inc(cost)

                # Fire-and-forget: записываем в DB без блокировки
                asyncio.create_task(
                    _log_usage_to_db(
                        model=current_model,
                        service=None,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        cost=cost,
                        request_id=request_id,
                    )
                )

                if i > 0:
                    logger.warning(
                        f"[OpenRouter] Fallback успешен: модель {current_model} "
                        f"(попытка {i + 1})"
                    )

                return content

            except (httpx.HTTPStatusError, httpx.TimeoutException) as e:
                # HTTP ошибки (5xx, timeout) — переключаемся на следующую модель
                duration = time.time() - start_time
                record_llm_error(model=current_model, error_type=type(e).__name__)
                record_llm_request(
                    model=current_model, status="error", duration=duration
                )
                last_exception = e

                # Записываем fallback переключение если есть следующая модель
                if not is_last:
                    next_model_name = (
                        FALLBACK_MODELS[i + 1]
                        if len(FALLBACK_MODELS) > i + 1
                        else "none"
                    )
                    llm_fallback_total.labels(
                        from_model=current_model, to_model=next_model_name
                    ).inc()

                next_model = FALLBACK_MODELS[i + 1] if not is_last else "none"
                logger.warning(
                    f"[OpenRouter] Модель {current_model} недоступна: {type(e).__name__}: {e}. "
                    f"{'Завершено — все модели исчерпаны.' if is_last else f'Fallback → {next_model}'}"
                )
                if is_last:
                    raise

    async def generate_structured(
        self,
        prompt: str,
        schema_class: Type[BaseModel],
        system_prompt: Optional[str] = None,
        temperature: float = 0.1,
        model: Optional[str] = None,
    ) -> dict:
        """
        Генерация со структурированным выводом (JSON Schema).

        Для: gemini_extractor, entity_deduplication_service.
        Использует JSON Schema inlining (без $defs/$ref) — обязательно для Google моделей.

        Fallback: httpx.HTTPStatusError и httpx.TimeoutException → следующая модель.
        json.JSONDecodeError и ValidationError → пробрасываются вверх без fallback.

        Args:
            prompt: Текст запроса
            schema_class: Pydantic модель (класс) для структуры ответа
            system_prompt: Системный промпт (опционально)
            temperature: Температура генерации
            model: Конкретная модель (если None — используется FALLBACK_MODELS)

        Returns:
            dict, соответствующий JSON Schema модели.

        Raises:
            json.JSONDecodeError: Если ответ модели — невалидный JSON (fallback НЕ вызывается)
        """
        raw_schema = schema_class.model_json_schema()
        inlined_schema = _inline_defs(raw_schema)

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        models = [model] if model else FALLBACK_MODELS

        for i, current_model in enumerate(models):
            is_last = i == len(models) - 1
            start_time = time.time()
            try:
                body = {
                    "model": current_model,
                    "messages": messages,
                    "temperature": temperature,
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": schema_class.__name__,
                            "strict": True,
                            "schema": inlined_schema,
                        },
                    },
                }

                resp = await self._get_client().post("/chat/completions", json=body)
                resp.raise_for_status()
                data = resp.json()
                content: str = data["choices"][0]["message"]["content"]

                # json.JSONDecodeError пробрасывается вверх БЕЗ fallback (ловушка 5 из RESEARCH.md)
                result = json.loads(content)

                duration = time.time() - start_time
                record_llm_request(
                    model=current_model, status="success", duration=duration
                )

                # Парсим usage/cost из ответа и записываем в метрики
                usage = data.get("usage", {})
                prompt_tokens = usage.get("prompt_tokens", 0)
                completion_tokens = usage.get("completion_tokens", 0)
                cost = usage.get("cost", 0.0) or 0.0
                request_id = data.get("id")

                record_llm_tokens(current_model, prompt_tokens, completion_tokens)
                if cost:
                    llm_cost_dollars_total.labels(model=current_model).inc(cost)

                asyncio.create_task(
                    _log_usage_to_db(
                        model=current_model,
                        service=None,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        cost=cost,
                        request_id=request_id,
                    )
                )

                if i > 0:
                    logger.warning(
                        f"[OpenRouter] Fallback успешен (structured): модель {current_model}"
                    )

                return result

            except (httpx.HTTPStatusError, httpx.TimeoutException) as e:
                # HTTP ошибки — переключаемся на следующую модель
                duration = time.time() - start_time
                record_llm_error(model=current_model, error_type=type(e).__name__)
                record_llm_request(
                    model=current_model, status="error", duration=duration
                )

                # Записываем fallback переключение если есть следующая модель
                if not is_last:
                    next_model_name = (
                        FALLBACK_MODELS[i + 1]
                        if len(FALLBACK_MODELS) > i + 1
                        else "none"
                    )
                    llm_fallback_total.labels(
                        from_model=current_model, to_model=next_model_name
                    ).inc()

                next_model = FALLBACK_MODELS[i + 1] if not is_last else "none"
                logger.warning(
                    f"[OpenRouter] Модель {current_model} ошибка при structured: "
                    f"{type(e).__name__}: {e}. "
                    f"{'Завершено.' if is_last else f'Fallback → {next_model}'}"
                )
                if is_last:
                    raise
            # json.JSONDecodeError и все остальные исключения — НЕ перехватываются здесь,
            # пробрасываются вверх без fallback

    async def generate_image(
        self,
        prompt: str,
        model: str = DEFAULT_IMAGE_MODEL,
        aspect_ratio: str = "4:3",  # landscape — хорошо для иллюстраций книг
        image_size: str = "1K",  # "1K" | "2K" | "4K" | "0.5K"
    ) -> bytes:
        """
        Генерация изображений через OpenRouter FLUX.2.

        Заменяет Google Imagen 4 в imagen_generator.py.

        КРИТИЧНО: Использует /chat/completions с modalities=["image"],
        НЕ /images/generations endpoint!

        Ответ: choices[0].message.images[0].image_url.url (base64 data URL).
        Источник: openrouter.ai/docs/guides/overview/multimodal/image-generation

        Args:
            prompt: Текстовое описание изображения (на английском для FLUX)
            model: ID модели (по умолчанию flux.2-klein-4b)
            aspect_ratio: Соотношение сторон ("4:3", "1:1", "16:9", etc.)
            image_size: Размер изображения ("1K", "2K", "4K", "0.5K")

        Returns:
            bytes — изображение в PNG/JPEG формате.
        """
        body = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "modalities": ["image"],  # image-only; для FLUX.2 нет text output
            "image_config": {
                "aspect_ratio": aspect_ratio,
                "image_size": image_size,
            },
        }

        start_time = time.time()
        try:
            resp = await self._get_client().post("/chat/completions", json=body)
            resp.raise_for_status()
            data = resp.json()

            # Ответ: choices[0].message.images[0].image_url.url
            # Формат: "data:image/png;base64,iVBORw0KGgo..."
            images = data["choices"][0]["message"].get("images", [])
            if not images:
                raise RuntimeError(
                    f"OpenRouter image model {model} вернул пустой список images"
                )

            data_url: str = images[0]["image_url"]["url"]
            # Убираем префикс "data:image/png;base64,"
            _, b64_data = data_url.split(",", 1)

            duration = time.time() - start_time
            record_llm_request(model=model, status="success", duration=duration)

            # Парсим usage/cost из ответа изображения (если доступно)
            usage = data.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)
            cost = usage.get("cost", 0.0) or 0.0
            request_id = data.get("id")

            if prompt_tokens or completion_tokens:
                record_llm_tokens(model, prompt_tokens, completion_tokens)
            if cost:
                llm_cost_dollars_total.labels(model=model).inc(cost)

            asyncio.create_task(
                _log_usage_to_db(
                    model=model,
                    service=None,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cost=cost,
                    request_id=request_id,
                )
            )

            return base64.b64decode(b64_data)

        except Exception as e:
            duration = time.time() - start_time
            record_llm_error(model=model, error_type=type(e).__name__)
            record_llm_request(model=model, status="error", duration=duration)
            raise

    async def close(self) -> None:
        """Закрывает httpx.AsyncClient."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_client: Optional[OpenRouterClient] = None


def get_openrouter_client() -> OpenRouterClient:
    """
    Возвращает singleton экземпляр OpenRouterClient.

    Lazy init: клиент создаётся при первом вызове из settings.OPENROUTER_API_KEY.
    """
    global _client
    if _client is None:
        from app.core.config import settings

        _client = OpenRouterClient(api_key=settings.OPENROUTER_API_KEY)
    return _client
