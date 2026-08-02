"""
OpenRouter API клиент для fancai.

Единый клиент для всех AI-вызовов:
- generate_text()      — JSON mode через response_format (для entity_synthesis, consistency_manager)
- generate_structured() — JSON Schema mode с inlined schema (для gemini_extractor, entity_dedup)
- generate_image()     — /chat/completions с modalities=["image"] (для imagen_generator)

Реализует client-side fallback chain: Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite.
Fallback срабатывает ТОЛЬКО на httpx.HTTPStatusError и httpx.TimeoutException.
json.JSONDecodeError и ValidationError пробрасываются вверх без fallback.

Circuit breaker: размыкается после 5 последовательных сетевых сбоев,
автоматически восстанавливается через 60 секунд (half-open probe).
Защищает все HTTP-вызовы через _post_with_breaker().

Источники:
- OpenRouter API: https://openrouter.ai/docs
- Image generation: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- Structured outputs: https://openrouter.ai/docs/guides/features/structured-outputs
- $defs/$ref issue: https://github.com/pydantic/pydantic-ai/issues/3617
"""

import base64
import json
import logging
import time
from typing import Any, Optional, Type

import httpx
from circuitbreaker import CircuitBreaker, CircuitBreakerError
from pydantic import BaseModel

from app.monitoring.metrics import (
    record_llm_error,
    record_llm_request,
    record_llm_tokens,
    llm_cost_dollars_total,
    llm_fallback_total,
    circuit_breaker_state,
    circuit_breaker_failure_count,
)
from app.core.retry import RateLimitError
from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Константы
# ---------------------------------------------------------------------------

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Fallback chain для LLM (в порядке приоритета).
# Триггер переключения: httpx.HTTPStatusError (5xx) и httpx.TimeoutException.
# json.JSONDecodeError и ValidationError НЕ вызывают fallback (ошибка парсинга ответа).
FALLBACK_MODELS = [
    "google/gemini-3.6-flash",  # primary — $1.50/$7.50, reasoning, JSON Schema
    "google/gemini-3.5-flash-lite",  # fallback — $0.30/$2.50
]

# Image модель пути отката.
# ВАЖНО: используется /chat/completions с modalities=["image"], НЕ /images/generations.
# Ответ: choices[0].message.images[0].image_url.url (base64 data URL).
# FLUX.2 в каталоге OpenRouter отсутствует целиком — прежний ID указывал в никуда.
DEFAULT_IMAGE_MODEL = settings.OPENROUTER_IMAGE_MODEL

# ---------------------------------------------------------------------------
# Circuit Breaker
# ---------------------------------------------------------------------------

# Типы исключений, которые увеличивают failure count в circuit breaker.
# Только сетевые ошибки — JSONDecodeError, ValidationError и т.п. НЕ вызывают
# переход в open state (это ошибки парсинга ответа, а не проблемы с API).
CIRCUIT_BREAKER_EXCEPTIONS = (
    httpx.HTTPStatusError,
    httpx.TimeoutException,
    ConnectionError,
    OSError,
)

# Единый circuit breaker для всех OpenRouter HTTP-вызовов.
# failure_threshold=5: после 5 последовательных сетевых сбоев — open state.
# recovery_timeout=60: через 60 секунд — half-open, пропускает пробный запрос.
openrouter_breaker = CircuitBreaker(
    failure_threshold=5,
    recovery_timeout=60,
    expected_exception=CIRCUIT_BREAKER_EXCEPTIONS,
    name="openrouter_api",
)

# Отдельный circuit breaker для image generation.
# LLM failures (entity extraction, translation) НЕ должны блокировать image generation.
openrouter_image_breaker = CircuitBreaker(
    failure_threshold=5,
    recovery_timeout=60,
    expected_exception=CIRCUIT_BREAKER_EXCEPTIONS,
    name="openrouter_image",
)


def _update_cb_metrics() -> None:
    """Update Prometheus gauges for circuit breaker state."""
    for name, breaker in [
        ("openrouter_api", openrouter_breaker),
        ("openrouter_image", openrouter_image_breaker),
    ]:
        state = breaker.state
        state_value = {"closed": 0, "half_open": 1, "open": 2}.get(state, -1)
        circuit_breaker_state.labels(name=name).set(state_value)
        circuit_breaker_failure_count.labels(name=name).set(breaker.failure_count)


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

    Вызывается через await, а не через asyncio.create_task(): Celery-таски идут
    через run_async -> asyncio.run, который на выходе отменяет незавершённые
    задачи, и fire-and-forget терял записи. Ошибки проглатываются, поэтому
    ожидание записи не может уронить основной вызов.
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
    LLM HTTP-вызовы защищены openrouter_breaker, image generation — openrouter_image_breaker.
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

    async def _post_with_breaker(self, endpoint: str, body: dict) -> httpx.Response:
        """
        HTTP POST через circuit breaker.

        Все HTTP-вызовы OpenRouter проходят через этот метод.
        Circuit breaker отслеживает только сетевые ошибки (CIRCUIT_BREAKER_EXCEPTIONS).
        JSONDecodeError, ValidationError и прочие ошибки парсинга не увеличивают failure count.

        Args:
            endpoint: URL path (например, "/chat/completions")
            body: JSON body для POST запроса

        Returns:
            httpx.Response

        Raises:
            CircuitBreakerError: Если circuit breaker в open state
            httpx.HTTPStatusError: При HTTP ошибках (5xx и т.п.)
            httpx.TimeoutException: При таймауте
            ConnectionError: При ошибке подключения
            OSError: При сетевых ошибках
        """

        # Check CB state BEFORE making the HTTP call (same logic as decorator pattern).
        # call_async only counts failures but doesn't block when open.
        if openrouter_breaker.opened:
            logger.error(
                "[OpenRouter] Circuit breaker OPEN -- "
                "запросы заблокированы на 60 сек"
            )
            _update_cb_metrics()
            raise CircuitBreakerError(openrouter_breaker)

        async def _do_post() -> httpx.Response:
            resp = await self._get_client().post(endpoint, json=body)
            resp.raise_for_status()
            return resp

        try:
            result = await openrouter_breaker.call_async(_do_post)
            # Successful call — update metrics (CB is closed or just recovered)
            _update_cb_metrics()
            return result
        except CIRCUIT_BREAKER_EXCEPTIONS:
            # Network error counted by CB — update metrics
            _update_cb_metrics()
            raise

    async def _post_with_image_breaker(
        self, endpoint: str, body: dict
    ) -> httpx.Response:
        """HTTP POST через image-specific circuit breaker."""
        if openrouter_image_breaker.opened:
            logger.error(
                "[OpenRouter] Image circuit breaker OPEN -- "
                "image запросы заблокированы на 60 сек"
            )
            _update_cb_metrics()
            raise CircuitBreakerError(openrouter_image_breaker)

        async def _do_post() -> httpx.Response:
            resp = await self._get_client().post(endpoint, json=body)
            resp.raise_for_status()
            return resp

        try:
            result = await openrouter_image_breaker.call_async(_do_post)
            _update_cb_metrics()
            return result
        except CIRCUIT_BREAKER_EXCEPTIONS:
            _update_cb_metrics()
            raise

    async def generate_text(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
    ) -> str:
        """
        Простая генерация текста с JSON mode.

        Заменяет response_mime_type="application/json" в google-genai SDK.
        Для: entity_synthesis_service, consistency_manager.

        Fallback: httpx.HTTPStatusError и httpx.TimeoutException -> следующая модель.
        json.JSONDecodeError -> пробрасывается вверх (не fallback).

        Args:
            prompt: Текст запроса
            system_prompt: Системный промпт (опционально)
            temperature: Температура генерации (0.0 - 1.0). None — не передавать:
                в Gemini 3.x параметр deprecated, а FALLBACK_MODELS — модели Gemini
            model: Конкретная модель (если None -- используется FALLBACK_MODELS)

        Returns:
            Строка с ответом модели (обычно JSON).

        Raises:
            CircuitBreakerError: Если circuit breaker в open state
        """
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        models = [model] if model else FALLBACK_MODELS

        for i, current_model in enumerate(models):
            is_last = i == len(models) - 1
            start_time = time.time()
            try:
                body: dict[str, Any] = {
                    "model": current_model,
                    "messages": messages,
                    "response_format": {"type": "json_object"},
                }
                if temperature is not None:
                    body["temperature"] = temperature

                resp = await self._post_with_breaker("/chat/completions", body)
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

                # Запись ждём: Celery-таски идут через run_async -> asyncio.run,
                # который отменяет незавершённые задачи на выходе, и
                # fire-and-forget терял usage. Ошибки внутри проглатываются.
                await _log_usage_to_db(
                    model=current_model,
                    service=None,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cost=cost,
                    request_id=request_id,
                )

                if i > 0:
                    logger.warning(
                        f"[OpenRouter] Fallback успешен: модель {current_model} "
                        f"(попытка {i + 1})"
                    )

                return content

            except CircuitBreakerError:
                # CB open — нет смысла пробовать другие модели (весь OpenRouter недоступен)
                raise

            except (httpx.HTTPStatusError, httpx.TimeoutException) as e:
                # HTTP ошибки (5xx, timeout) — переключаемся на следующую модель
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
                    f"[OpenRouter] Модель {current_model} недоступна: {type(e).__name__}: {e}. "
                    f"{'Завершено — все модели исчерпаны.' if is_last else f'Fallback → {next_model}'}"
                )
                if is_last:
                    raise

        # Сюда попадаем только при пустом списке моделей: цикл не выполнился
        # ни разу, и без явного raise функция вернула бы None вместо str.
        raise RuntimeError("OpenRouter: список моделей для generate_text пуст")

    async def generate_structured(
        self,
        prompt: str,
        schema_class: Type[BaseModel],
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
    ) -> dict:
        """
        Генерация со структурированным выводом (JSON Schema).

        Для: gemini_extractor, entity_deduplication_service.
        Использует JSON Schema inlining (без $defs/$ref) -- обязательно для Google моделей.

        Fallback: httpx.HTTPStatusError и httpx.TimeoutException -> следующая модель.
        json.JSONDecodeError и ValidationError -> пробрасываются вверх без fallback.

        Args:
            prompt: Текст запроса
            schema_class: Pydantic модель (класс) для структуры ответа
            system_prompt: Системный промпт (опционально)
            temperature: Температура генерации; None — не передавать (Gemini 3.x)
            model: Конкретная модель (если None -- используется FALLBACK_MODELS)

        Returns:
            dict, соответствующий JSON Schema модели.

        Raises:
            json.JSONDecodeError: Если ответ модели -- невалидный JSON (fallback НЕ вызывается)
            CircuitBreakerError: Если circuit breaker в open state
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
                body: dict[str, Any] = {
                    "model": current_model,
                    "messages": messages,
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": schema_class.__name__,
                            "strict": True,
                            "schema": inlined_schema,
                        },
                    },
                }
                if temperature is not None:
                    body["temperature"] = temperature

                resp = await self._post_with_breaker("/chat/completions", body)
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

                await _log_usage_to_db(
                    model=current_model,
                    service=None,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cost=cost,
                    request_id=request_id,
                )

                if i > 0:
                    logger.warning(
                        f"[OpenRouter] Fallback успешен (structured): модель {current_model}"
                    )

                return result

            except CircuitBreakerError:
                # CB open — нет смысла пробовать другие модели
                raise

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

        # Пустой список моделей: цикл не выполнился ни разу.
        raise RuntimeError("OpenRouter: список моделей для generate_structured пуст")

    async def generate_image(
        self,
        prompt: str,
        model: Optional[str] = None,
        aspect_ratio: str = "4:3",  # landscape — хорошо для иллюстраций книг
        image_size: str = "1K",  # "1K" | "2K" | "4K" | "0.5K"
    ) -> bytes:
        """
        Генерация изображений через OpenRouter FLUX.2.

        Используется из imagen_generator.py для FLUX.2 Klein.

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
            bytes -- изображение в PNG/JPEG формате.

        Raises:
            CircuitBreakerError: Если circuit breaker в open state
        """
        model = model or DEFAULT_IMAGE_MODEL
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
            resp = await self._post_with_image_breaker("/chat/completions", body)
            data = resp.json()

            # Валидация: OpenRouter может вернуть JSON без choices (transient error)
            if "choices" not in data or not data["choices"]:
                error_info = data.get("error", {})
                error_msg = (
                    error_info.get("message", "Unknown error")
                    if isinstance(error_info, dict)
                    else str(error_info)
                )
                response_preview = str(data)[:500]
                logger.error(
                    "OpenRouter image: missing 'choices' in response",
                    extra={
                        "model": model,
                        "duration": f"{time.time() - start_time:.2f}s",
                        "response_preview": response_preview,
                        "prompt_preview": prompt[:200],
                        "error": error_msg,
                    },
                )
                raise RuntimeError(
                    f"OpenRouter {model}: no choices in response. Error: {error_msg}"
                )

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

            await _log_usage_to_db(
                model=model,
                service=None,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost=cost,
                request_id=request_id,
            )

            return base64.b64decode(b64_data)

        except CircuitBreakerError:
            # Already logged in _post_with_breaker
            raise

        except httpx.HTTPStatusError as e:
            duration = time.time() - start_time
            sc = e.response.status_code

            if sc == 400:
                # Non-retryable: OpenRouter отклонил промпт (модерация)
                try:
                    err_body = e.response.json()
                    detail = err_body.get("error", {}).get("message", str(e))
                except Exception:
                    detail = e.response.text[:500]
                logger.error(
                    "OpenRouter image: 400 Bad Request (non-retryable)",
                    extra={
                        "model": model,
                        "duration": f"{duration:.2f}s",
                        "error_detail": detail,
                        "prompt_preview": prompt[:200],
                    },
                )
                record_llm_error(model=model, error_type="BadRequest")
                record_llm_request(model=model, status="error", duration=duration)
                # ValueError НЕ входит в IMAGE_GENERATION_EXCEPTIONS — tenacity НЕ retry-ит
                raise ValueError(f"OpenRouter rejected prompt (400): {detail}")

            elif sc == 429:
                logger.warning(f"OpenRouter rate limit (429) for image model {model}")
                record_llm_error(model=model, error_type="RateLimit")
                record_llm_request(model=model, status="error", duration=duration)
                # RateLimitError входит в IMAGE_GENERATION_EXCEPTIONS — tenacity retry-ит
                raise RateLimitError(f"Rate limit for {model}")

            else:
                # 5xx и прочее — пробрасываем как есть
                record_llm_error(model=model, error_type=f"HTTP_{sc}")
                record_llm_request(model=model, status="error", duration=duration)
                raise

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
        _client = OpenRouterClient(api_key=settings.OPENROUTER_API_KEY)
    return _client
