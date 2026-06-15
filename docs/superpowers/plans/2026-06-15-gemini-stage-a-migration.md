# Этап A — Direct-миграция на Gemini: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести оба AI-пайплайна fancai (извлечение сущностей/описаний + генерация иллюстраций) с OpenRouter на прямой Gemini API через `google-genai`, синхронно, на `gemini-3.5-flash` (картинки — `gemini-3.1-flash-image`), и удалить OpenRouter полностью.

**Architecture:** Тонкий провайдер-слой: `GeminiClient` повторяет существующие сигнатуры `OpenRouterClient` (`generate_text→str`, `generate_structured→dict`, `generate_image→bytes`), usage пишется внутрь `llm_usage_log`. Выбор провайдера — фабрика `get_ai_provider()` по флагу `AI_PROVIDER` (мгновенный rollback на время cutover). Сервисы переключаются с `get_openrouter_client()` на `get_ai_provider()` без изменения сигнатур вызовов.

**Tech Stack:** Python 3.12, FastAPI, `google-genai==2.8.0`, Pydantic v2, SQLAlchemy 2.0, Celery, tenacity, pytest + pytest-asyncio.

> **Отклонение от spec §2.1 (осознанно):** spec ссылался на rich-Protocol плана v3 (`AIStructuredResult`/`AIUsage`). Здесь мы НЕ вводим новые result-типы — `GeminiClient` повторяет существующие `str`/`dict`/`bytes` сигнатуры `OpenRouterClient` (drop-in, следует паттерну кодовой базы, YAGNI). usage логируется внутри клиента в `llm_usage_log`, как сейчас.

> **Модель на Этапе A:** все LLM-задачи (extraction, translation, dedup, synthesis) идут на `GEMINI_EXTRACTION_MODEL` (`gemini-3.5-flash`) — cost moot при ~0 трафика, качество в приоритете. `GEMINI_LITE_MODEL` определён, но зарезервирован для tiering'а Этапа B.

---

## File Structure

**Создать:**

- `backend/app/core/ai_provider.py` — `AIProvider` Protocol (сигнатуры str/dict/bytes).
- `backend/app/core/gemini_pricing.py` — таблица цен + `compute_cost()`.
- `backend/app/core/gemini_client.py` — `GeminiClient` + локальный `_log_usage_to_db` + singleton.
- `backend/app/core/ai_provider_factory.py` — `get_ai_provider()` по флагу.
- `backend/app/services/nano_banana_generator.py` — тонкая генерация картинки (prompt→bytes) через Gemini.

**Модифицировать:**

- `backend/app/core/config.py` — добавить `GEMINI_*` настройки (после строки 62).
- `backend/requirements.txt` — `google-genai==2.8.0` (строка 30), убрать `[socks]` (строка 33).
- `backend/app/services/gemini_extractor.py` — вызовы через `get_ai_provider()`, модель из настроек, без `_inline_defs`.
- `backend/app/services/entity_deduplication_service.py` — `get_ai_provider()` вместо `get_openrouter_client()`.
- `backend/app/services/entity_synthesis_service.py` — то же.
- `backend/app/services/imagen_generator.py` — backend генерации → `NanoBananaGenerator`; `PromptTranslator` через `get_ai_provider()`.

**Удалить (фаза A7):**

- `backend/app/core/openrouter_client.py` (весь, включая `_inline_defs`, FLUX `generate_image`).
- OpenRouter-ветка в `ai_provider_factory.py`, `OPENROUTER_*` из `config.py`.

---

## Phase A0: Подготовка инфраструктуры

### Task A0.1: Gemini-настройки в config

**Files:**

- Modify: `backend/app/core/config.py` (после строки 62, ниже `OPENROUTER_IMAGE_MODEL`)
- Test: `backend/tests/core/test_config_gemini.py`

- [ ] **Step 1: Написать падающий тест**

```python
# backend/tests/core/test_config_gemini.py
from app.core.config import settings

def test_gemini_settings_exist_with_defaults():
    assert settings.AI_PROVIDER in ("openrouter", "gemini")
    assert settings.GEMINI_EXTRACTION_MODEL == "gemini-3.5-flash"
    assert settings.GEMINI_IMAGE_MODEL == "gemini-3.1-flash-image"
    # ключ может быть пустым в тестовой среде, но атрибут обязан существовать
    assert hasattr(settings, "GEMINI_API_KEY")
    assert hasattr(settings, "GEMINI_LITE_MODEL")
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && uv run python -m pytest tests/core/test_config_gemini.py -v`
Expected: FAIL (`AttributeError: ... GEMINI_EXTRACTION_MODEL`)

- [ ] **Step 3: Добавить настройки** в `config.py` сразу после строки 62 (после `OPENROUTER_IMAGE_MODEL`-блока):

```python
    # AI сервисы - Gemini Direct (Stage A migration, 2026-06)
    GEMINI_API_KEY: str = ""  # Google Gemini Developer API key (paid tier)
    AI_PROVIDER: str = "openrouter"  # gemini | openrouter — рубильник миграции
    GEMINI_EXTRACTION_MODEL: str = "gemini-3.5-flash"
    GEMINI_LITE_MODEL: str = "gemini-3.1-flash-lite"  # зарезервировано для tiering Этапа B
    GEMINI_IMAGE_MODEL: str = "gemini-3.1-flash-image"  # Nano Banana 2; ID подтвердить smoke-тестом A3.1
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `cd backend && uv run python -m pytest tests/core/test_config_gemini.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/tests/core/test_config_gemini.py
git commit -m "feat(ai): add Gemini config and AI_PROVIDER flag"
```

### Task A0.2: Зависимости

**Files:** Modify: `backend/requirements.txt` (строка 30 — `google-genai`; строка 33 — `httpx[socks]`)

- [ ] **Step 1:** Строка 30 → `google-genai==2.8.0` (было `google-genai>=1.69.0`).
- [ ] **Step 2:** Строка 33 → `httpx==0.28.1` (убрать суффикс `[socks]`).
- [ ] **Step 3:** Установить и проверить версию.

Run: `cd backend && uv pip install -r requirements.txt && uv run python -c "import google.genai; print(google.genai.__version__)"`
Expected: `2.8.0`, установка без конфликтов.

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore(deps): pin google-genai 2.8.0, drop socks proxy"
```

---

## Phase A1: GeminiClient core

### Task A1.1: gemini_pricing — таблица цен + compute_cost

**Files:**

- Create: `backend/app/core/gemini_pricing.py`
- Test: `backend/tests/core/test_gemini_pricing.py`

- [ ] **Step 1: Написать падающий тест** (цены verified по ai.google.dev/gemini-api/docs/pricing, июнь 2026):

```python
# backend/tests/core/test_gemini_pricing.py
import pytest
from app.core.gemini_pricing import compute_cost, IMAGE_PRICING

def test_flash35_text_cost():
    # 1M input + 1M output на 3.5 Flash = $1.50 + $9.00
    assert round(compute_cost("gemini-3.5-flash", 1_000_000, 1_000_000), 2) == 10.50

def test_cached_input_discounted():
    # 1M input, из них 1M cached → $0.15 (cached rate), output 0
    assert round(compute_cost("gemini-3.5-flash", 1_000_000, 0, cached=1_000_000), 4) == 0.15

def test_lite_cheaper():
    assert round(compute_cost("gemini-3.1-flash-lite", 1_000_000, 0), 4) == 0.25

def test_unknown_model_returns_zero():
    assert compute_cost("unknown-model", 1000, 1000) == 0.0

def test_image_price_nb2_1k():
    assert IMAGE_PRICING["gemini-3.1-flash-image"]["1K"] == 0.067
```

- [ ] **Step 2: Запустить — FAIL** (`ModuleNotFoundError`).

Run: `cd backend && uv run python -m pytest tests/core/test_gemini_pricing.py -v`

- [ ] **Step 3: Реализовать**

```python
# backend/app/core/gemini_pricing.py
"""Таблица цен Gemini API + расчёт стоимости из usage_metadata.

Цены $/1M токенов (Standard tier), verified по ai.google.dev/gemini-api/docs/pricing (июнь 2026).
Изображения — $/картинку по разрешению.
"""

# $/1M токенов: in / out / cached_in
PRICING: dict[str, dict[str, float]] = {
    "gemini-3.5-flash": {"in": 1.50, "out": 9.00, "cached_in": 0.15},
    "gemini-3.1-flash-lite": {"in": 0.25, "out": 1.50, "cached_in": 0.025},
    "gemini-2.5-flash": {"in": 0.30, "out": 2.50, "cached_in": 0.03},
    "gemini-2.5-flash-lite": {"in": 0.10, "out": 0.40, "cached_in": 0.01},
}

# $/картинку по разрешению
IMAGE_PRICING: dict[str, dict[str, float]] = {
    "gemini-3.1-flash-image": {"0.5K": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151},
    "gemini-2.5-flash-image": {"1K": 0.039},
    "gemini-3-pro-image": {"1K": 0.134, "2K": 0.134, "4K": 0.24},
}


def compute_cost(
    model: str, in_tokens: int, out_tokens: int, cached: int = 0
) -> float:
    """Стоимость текстового вызова в USD. Неизвестная модель → 0.0 (без падения)."""
    p = PRICING.get(model)
    if p is None:
        return 0.0
    billable_in = max(in_tokens - cached, 0)
    return (
        billable_in * p["in"] + cached * p["cached_in"] + out_tokens * p["out"]
    ) / 1_000_000


def compute_image_cost(model: str, resolution: str = "1K") -> float:
    """Стоимость генерации картинки в USD. Неизвестная модель/разрешение → 0.0."""
    return IMAGE_PRICING.get(model, {}).get(resolution, 0.0)
```

- [ ] **Step 4: Запустить — PASS.**

Run: `cd backend && uv run python -m pytest tests/core/test_gemini_pricing.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/gemini_pricing.py backend/tests/core/test_gemini_pricing.py
git commit -m "feat(ai): gemini pricing table and cost calc"
```

### Task A1.2: AIProvider Protocol

**Files:**

- Create: `backend/app/core/ai_provider.py`
- Test: `backend/tests/core/test_ai_provider.py`

- [ ] **Step 1: Написать падающий тест** (Protocol — структурная типизация; проверяем, что OpenRouterClient ему соответствует):

```python
# backend/tests/core/test_ai_provider.py
from app.core.ai_provider import AIProvider
from app.core.openrouter_client import OpenRouterClient

def test_openrouter_client_satisfies_protocol():
    client = OpenRouterClient(api_key="x")
    assert isinstance(client, AIProvider)  # runtime_checkable Protocol
```

- [ ] **Step 2: Запустить — FAIL** (`ModuleNotFoundError`).

Run: `cd backend && uv run python -m pytest tests/core/test_ai_provider.py -v`

- [ ] **Step 3: Реализовать**

```python
# backend/app/core/ai_provider.py
"""Провайдер-абстракция AI-вызовов.

Protocol с сигнатурами, идентичными существующему OpenRouterClient,
чтобы GeminiClient был drop-in заменой. usage логируется внутри реализаций
(в llm_usage_log), не возвращается.
"""
from typing import Optional, Protocol, Type, runtime_checkable

from pydantic import BaseModel


@runtime_checkable
class AIProvider(Protocol):
    async def generate_text(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        model: Optional[str] = None,
    ) -> str: ...

    async def generate_structured(
        self,
        prompt: str,
        schema_class: Type[BaseModel],
        system_prompt: Optional[str] = None,
        temperature: float = 0.1,
        model: Optional[str] = None,
    ) -> dict: ...

    async def generate_image(
        self,
        prompt: str,
        model: Optional[str] = None,
        aspect_ratio: str = "4:3",
        image_size: str = "1K",
    ) -> bytes: ...
```

- [ ] **Step 4: Запустить — PASS.**

Run: `cd backend && uv run python -m pytest tests/core/test_ai_provider.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/ai_provider.py backend/tests/core/test_ai_provider.py
git commit -m "feat(ai): add AIProvider protocol matching client signatures"
```

### Task A1.3: GeminiClient — generate_text + generate_structured

**Files:**

- Create: `backend/app/core/gemini_client.py`
- Test: `backend/tests/core/test_gemini_client.py`

- [ ] **Step 1: Написать падающий тест** (мокаем `genai.Client`; проверяем парсинг structured, маппинг usage, расчёт cost):

```python
# backend/tests/core/test_gemini_client.py
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
```

- [ ] **Step 2: Запустить — FAIL** (`ModuleNotFoundError`).

Run: `cd backend && uv run python -m pytest tests/core/test_gemini_client.py -v`

- [ ] **Step 3: Реализовать**

```python
# backend/app/core/gemini_client.py
"""GeminiClient — прямой клиент Gemini API (google-genai), drop-in для OpenRouterClient.

Сигнатуры идентичны OpenRouterClient: generate_text→str, generate_structured→dict,
generate_image→bytes. usage пишется в llm_usage_log (как в openrouter_client).
"""
import asyncio
import json
import logging
from typing import Optional, Type

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.core.config import settings
from app.core.gemini_pricing import compute_cost, compute_image_cost

logger = logging.getLogger(__name__)


async def _log_usage_to_db(
    model: str,
    service: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    cost: float,
) -> None:
    """Fire-and-forget запись usage в llm_usage_log (не блокирует и не роняет поток)."""
    try:
        from app.core.database import AsyncSessionLocal
        from app.models.llm_usage_log import LlmUsageLog

        async with AsyncSessionLocal() as session:
            session.add(
                LlmUsageLog(
                    model=model,
                    service=service,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cost_dollars=cost,
                    request_id=None,
                )
            )
            await session.commit()
    except Exception as e:
        logger.warning(f"[Gemini] usage log failed: {e}")


class GeminiClient:
    """Прямой клиент Gemini через google-genai (async via client.aio)."""

    def __init__(self, api_key: str):
        self._client = genai.Client(api_key=api_key)

    def _log(self, model: str, resp_usage, cost: float) -> None:
        asyncio.create_task(
            _log_usage_to_db(
                model=model,
                service=None,
                prompt_tokens=getattr(resp_usage, "prompt_token_count", 0) or 0,
                completion_tokens=getattr(resp_usage, "candidates_token_count", 0) or 0,
                cost=cost,
            )
        )

    async def generate_text(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        model: Optional[str] = None,
    ) -> str:
        model = model or settings.GEMINI_EXTRACTION_MODEL
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=temperature,
        )
        resp = await self._client.aio.models.generate_content(
            model=model, contents=prompt, config=config
        )
        um = resp.usage_metadata
        cost = compute_cost(
            model,
            getattr(um, "prompt_token_count", 0) or 0,
            getattr(um, "candidates_token_count", 0) or 0,
            cached=getattr(um, "cached_content_token_count", 0) or 0,
        )
        self._log(model, um, cost)
        return resp.text or ""

    async def generate_structured(
        self,
        prompt: str,
        schema_class: Type[BaseModel],
        system_prompt: Optional[str] = None,
        temperature: float = 0.1,
        model: Optional[str] = None,
    ) -> dict:
        model = model or settings.GEMINI_EXTRACTION_MODEL
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema_class,  # Pydantic-класс напрямую; рекурсия $ref поддержана
            system_instruction=system_prompt,
            temperature=temperature,
            thinking_config=types.ThinkingConfig(thinking_level="medium"),
        )
        resp = await self._client.aio.models.generate_content(
            model=model, contents=prompt, config=config
        )
        um = resp.usage_metadata
        cost = compute_cost(
            model,
            getattr(um, "prompt_token_count", 0) or 0,
            getattr(um, "candidates_token_count", 0) or 0,
            cached=getattr(um, "cached_content_token_count", 0) or 0,
        )
        self._log(model, um, cost)
        return json.loads(resp.text)  # JSONDecodeError пробрасывается вверх (без fallback)

    async def generate_image(
        self,
        prompt: str,
        model: Optional[str] = None,
        aspect_ratio: str = "4:3",
        image_size: str = "1K",
    ) -> bytes:
        model = model or settings.GEMINI_IMAGE_MODEL
        config = types.GenerateContentConfig(response_modalities=["IMAGE"])
        resp = await self._client.aio.models.generate_content(
            model=model, contents=prompt, config=config
        )
        # Извлекаем первый inline-блок с картинкой
        for part in resp.candidates[0].content.parts:
            inline = getattr(part, "inline_data", None)
            if inline and inline.data:
                asyncio.create_task(
                    _log_usage_to_db(
                        model=model,
                        service="image",
                        prompt_tokens=0,
                        completion_tokens=0,
                        cost=compute_image_cost(model, image_size),
                    )
                )
                return inline.data
        raise RuntimeError(f"Gemini image model {model} вернул ответ без image-данных")

    async def close(self) -> None:
        """Совместимость с интерфейсом OpenRouterClient (no-op для google-genai)."""
        return None


_client: Optional[GeminiClient] = None


def get_gemini_client() -> GeminiClient:
    """Singleton GeminiClient из settings.GEMINI_API_KEY."""
    global _client
    if _client is None:
        _client = GeminiClient(api_key=settings.GEMINI_API_KEY)
    return _client
```

- [ ] **Step 4: Запустить — PASS.**

Run: `cd backend && uv run python -m pytest tests/core/test_gemini_client.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/gemini_client.py backend/tests/core/test_gemini_client.py
git commit -m "feat(ai): implement GeminiClient (text/structured/image) via google-genai"
```

> **Примечание по ретраям:** на этом шаге GeminiClient без circuit breaker и без явного tenacity-обёртывания — вызовы экстрактора уже обёрнуты `@retry_llm_extraction` (`core/retry.py`) на уровне call-site. Если на A2.3 проявятся `429`/`ServerError` — добавить tenacity внутрь GeminiClient отдельной задачей. **Circuit breaker не нужен** (у Gemini нет нестабильности OpenRouter; жёсткий cap Google — не транзиентная ошибка, решается в B6).

### Task A1.4: Фабрика провайдера

**Files:**

- Create: `backend/app/core/ai_provider_factory.py`
- Test: `backend/tests/core/test_ai_provider_factory.py`

- [ ] **Step 1: Написать падающий тест**

```python
# backend/tests/core/test_ai_provider_factory.py
import app.core.ai_provider_factory as f
from app.core.gemini_client import GeminiClient
from app.core.openrouter_client import OpenRouterClient


def test_factory_returns_gemini_when_flag_gemini(monkeypatch):
    monkeypatch.setattr(f.settings, "AI_PROVIDER", "gemini")
    f._reset()  # сбросить singleton
    assert isinstance(f.get_ai_provider(), GeminiClient)


def test_factory_returns_openrouter_when_flag_openrouter(monkeypatch):
    monkeypatch.setattr(f.settings, "AI_PROVIDER", "openrouter")
    f._reset()
    assert isinstance(f.get_ai_provider(), OpenRouterClient)
```

- [ ] **Step 2: Запустить — FAIL.**

Run: `cd backend && uv run python -m pytest tests/core/test_ai_provider_factory.py -v`

- [ ] **Step 3: Реализовать**

```python
# backend/app/core/ai_provider_factory.py
"""Фабрика AI-провайдера по feature-flag AI_PROVIDER (мгновенный rollback на cutover)."""
from typing import Optional

from app.core.ai_provider import AIProvider
from app.core.config import settings

_provider: Optional[AIProvider] = None


def get_ai_provider() -> AIProvider:
    global _provider
    if _provider is None:
        if settings.AI_PROVIDER == "gemini":
            from app.core.gemini_client import get_gemini_client

            _provider = get_gemini_client()
        else:
            from app.core.openrouter_client import get_openrouter_client

            _provider = get_openrouter_client()
    return _provider


def _reset() -> None:
    """Сброс singleton (для тестов и переключения флага)."""
    global _provider
    _provider = None
```

- [ ] **Step 4: Запустить — PASS.**

Run: `cd backend && uv run python -m pytest tests/core/test_ai_provider_factory.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/ai_provider_factory.py backend/tests/core/test_ai_provider_factory.py
git commit -m "feat(ai): provider factory with AI_PROVIDER feature flag"
```

---

## Phase A2: Миграция LLM-извлечения

### Task A2.1: Extractor через провайдер, без `_inline_defs`

**Files:**

- Modify: `backend/app/services/gemini_extractor.py` (`GeminiConfig` строка 123; вызовы `_call_gemini_with_retry` :628, `_call_gemini_tsa` :667; найти инициализацию `self._client`)
- Test: `backend/tests/services/test_extractor_provider.py`

- [ ] **Step 1: Найти, где устанавливается `self._client`** в `gemini_extractor.py`:

Run: `cd backend && grep -n "_client" app/services/gemini_extractor.py | head`
Expected: строка вида `self._client = get_openrouter_client()` (запомнить номер для Step 3).

- [ ] **Step 2: Написать падающий тест** — extractor извлекает через провайдер (мок), schema передаётся как класс:

```python
# backend/tests/services/test_extractor_provider.py
import pytest
from unittest.mock import AsyncMock, patch
from app.services.gemini_extractor import GeminiDescriptionExtractor, GeminiConfig

@pytest.mark.asyncio
async def test_extractor_calls_provider_generate_structured():
    extractor = GeminiDescriptionExtractor(GeminiConfig())
    fake = AsyncMock(return_value={"descriptions": [], "entities": [], "relationships": []})
    with patch("app.services.gemini_extractor.get_ai_provider") as gp:
        gp.return_value.generate_structured = fake
        result = await extractor._call_gemini_with_retry("эталонный русский чанк")
    assert fake.await_count == 1
    # schema передаётся как Pydantic-класс (не dict), без _inline_defs
    _, kwargs = fake.call_args
    assert kwargs["schema_class"].__name__ == "GeminiResponseSchema"
```

> Если имя класса экстрактора отличается — поправить импорт по факту (`grep -n "class .*Extractor" app/services/gemini_extractor.py`).

- [ ] **Step 3: Запустить — FAIL.**

Run: `cd backend && uv run python -m pytest tests/services/test_extractor_provider.py -v`

- [ ] **Step 4: Заменить клиент на провайдер.** В `gemini_extractor.py`:
  - Заменить импорт `from app.core.openrouter_client import get_openrouter_client` → `from app.core.ai_provider_factory import get_ai_provider`.
  - В месте инициализации (Step 1): `self._client = get_ai_provider()`.
  - В `_call_gemini_with_retry` (:628) и `_call_gemini_tsa` (:667) вызовы `generate_structured` уже передают `schema_class=` — оставить как есть (Pydantic-класс передаётся напрямую; Gemini Direct разворачивает `$ref` нативно, `_inline_defs` не нужен).
  - В `GeminiConfig` (:130-134) обновить значения моделей (на Этапе A все на 3.5):
    ```python
    model_extraction: str = "gemini-3.5-flash"
    model_translation: str = "gemini-3.5-flash"
    model_reduce: str = "gemini-3.5-flash"
    ```

- [ ] **Step 5: Запустить — PASS + весь extractor-набор.**

Run: `cd backend && uv run python -m pytest tests/services/test_extractor_provider.py -v && uv run python -m pytest tests/ -k extractor -v`
Expected: PASS (кроме известных pre-existing).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/gemini_extractor.py backend/tests/services/test_extractor_provider.py
git commit -m "refactor(extractor): route via AIProvider, drop _inline_defs (native \$ref)"
```

### Task A2.2: dedup + synthesis через провайдер

**Files:**

- Modify: `backend/app/services/entity_deduplication_service.py` (импорт :26)
- Modify: `backend/app/services/entity_synthesis_service.py` (импорт + вызов :149)

- [ ] **Step 1: Написать падающий тест** — synthesis вызывает провайдер:

```python
# backend/tests/services/test_entities_provider.py
import pytest
from unittest.mock import AsyncMock, patch
from app.services.entity_synthesis_service import EntitySynthesisService

@pytest.mark.asyncio
async def test_synthesis_uses_ai_provider():
    svc = EntitySynthesisService()
    with patch("app.services.entity_synthesis_service.get_ai_provider") as gp:
        gp.return_value.generate_text = AsyncMock(return_value='{"entities": []}')
        out = await svc._call_gemini("prompt")
    assert out == {"entities": []}
```

> Имя класса сверить: `grep -n "class .*Service" app/services/entity_synthesis_service.py`.

- [ ] **Step 2: Запустить — FAIL.**

Run: `cd backend && uv run python -m pytest tests/services/test_entities_provider.py -v`

- [ ] **Step 3: Заменить импорты и вызовы** в обоих файлах:
  - `entity_synthesis_service.py`: импорт `get_openrouter_client` → `from app.core.ai_provider_factory import get_ai_provider`; в `_call_gemini` (:149) `client = get_openrouter_client()` → `client = get_ai_provider()`. Сигнатура `generate_text(...)` не меняется.
  - `entity_deduplication_service.py`: импорт (:26) → `from app.core.ai_provider_factory import get_ai_provider`; найти `get_openrouter_client()` (`grep -n get_openrouter_client app/services/entity_deduplication_service.py`) и заменить на `get_ai_provider()`. Сигнатура `generate_structured(...)` не меняется.

- [ ] **Step 4: Запустить — PASS + dedup/synthesis наборы.**

Run: `cd backend && uv run python -m pytest tests/services/test_entities_provider.py tests/ -k "dedup or synthesis" -v`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/entity_deduplication_service.py backend/app/services/entity_synthesis_service.py backend/tests/services/test_entities_provider.py
git commit -m "refactor(entities): route dedup/synthesis via AIProvider"
```

### Task A2.3: Интеграционный прогон одной книги (часть eval-гейта)

- [ ] **Step 1:** На staging выставить `AI_PROVIDER=gemini` и `GEMINI_API_KEY=<paid key>`. Обработать 1 русскую книгу (фрагмент «Мастер и Маргарита»).
- [ ] **Step 2: Проверить корректность** (не сравнение с 2.5):
  - 100% валидность schema (нет `JSONDecodeError`/`ValidationError` в логах);
  - сущности/описания извлечены и осмысленны (eyeball);
  - `llm_usage_log` пишет строки с `model="gemini-3.5-flash"` и `cost_dollars > 0`.

Run (проверка лога): `cd backend && uv run python -c "import asyncio; from app.core.database import AsyncSessionLocal; from sqlalchemy import select, desc; from app.models.llm_usage_log import LlmUsageLog;
async def m():
    async with AsyncSessionLocal() as s:
        rows=(await s.execute(select(LlmUsageLog).order_by(desc(LlmUsageLog.id)).limit(5))).scalars().all()
        [print(r.model, r.cost_dollars) for r in rows]
asyncio.run(m())"`
Expected: модели `gemini-3.5-flash`, ненулевой cost.

- [ ] **Step 3:** Зафиксировать факт. себестоимость прогона в `docs/reports/` (вход для экономики Этапа B).
- [ ] **Step 4: Commit** (если были фиксы) — `git commit -am "test(ai): gemini extraction integration on RU book"`

---

## Phase A3: Миграция генерации изображений

### Task A3.1: NanoBananaGenerator + подтверждение callable-ID

**Files:**

- Create: `backend/app/services/nano_banana_generator.py`
- Test: `backend/tests/services/test_nano_banana.py`

- [ ] **Step 1: Подтвердить точный callable-ID** в AI Studio / smoke:

Run: `cd backend && uv run python -c "from google import genai; from app.core.config import settings; c=genai.Client(api_key=settings.GEMINI_API_KEY); r=c.models.generate_content(model='gemini-3.1-flash-image', contents='a red apple on a table'); print(type(r), bool(r.candidates))"`
Expected: ответ без ошибки `NOT_FOUND`/`model not found`. Если ID требует суффикс `-preview` — обновить `GEMINI_IMAGE_MODEL` в `config.py` и зафиксировать.

- [ ] **Step 2: Написать падающий тест** (мок генерации, проверяем извлечение bytes):

```python
# backend/tests/services/test_nano_banana.py
import pytest
from types import SimpleNamespace
from unittest.mock import patch
from app.services.nano_banana_generator import NanoBananaGenerator


async def _async_return(v):
    return v


def _img_response(data: bytes):
    part = SimpleNamespace(inline_data=SimpleNamespace(data=data))
    cand = SimpleNamespace(content=SimpleNamespace(parts=[part]))
    return SimpleNamespace(candidates=[cand], usage_metadata=SimpleNamespace())


@pytest.mark.asyncio
async def test_generate_returns_bytes():
    gen = NanoBananaGenerator()
    with patch.object(
        gen._client._client.aio.models,
        "generate_content",
        return_value=_async_return(_img_response(b"\x89PNG_fake")),
    ), patch("app.core.gemini_client.asyncio.create_task"):
        out = await gen.generate(prompt="a knight in armor, book illustration")
    assert out == b"\x89PNG_fake"
```

- [ ] **Step 3: Запустить — FAIL.**

Run: `cd backend && uv run python -m pytest tests/services/test_nano_banana.py -v`

- [ ] **Step 4: Реализовать** (тонкая обёртка над `GeminiClient.generate_image`):

```python
# backend/app/services/nano_banana_generator.py
"""NanoBananaGenerator — генерация иллюстраций через Gemini (gemini-3.1-flash-image).

Тонкий слой: готовый английский промпт → bytes. Prompt-инженерия (перевод RU→EN,
genre-стили, SFW) остаётся в ImagenPromptEngineer/ImagenService.
"""
import logging
from typing import Optional

from app.core.config import settings
from app.core.gemini_client import get_gemini_client

logger = logging.getLogger(__name__)


class NanoBananaGenerator:
    def __init__(self):
        self._client = get_gemini_client()

    async def generate(
        self,
        prompt: str,
        aspect_ratio: str = "4:3",
        image_size: str = "1K",
        model: Optional[str] = None,
    ) -> bytes:
        return await self._client.generate_image(
            prompt=prompt,
            model=model or settings.GEMINI_IMAGE_MODEL,
            aspect_ratio=aspect_ratio,
            image_size=image_size,
        )
```

- [ ] **Step 5: Запустить — PASS.**

Run: `cd backend && uv run python -m pytest tests/services/test_nano_banana.py -v`

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/nano_banana_generator.py backend/tests/services/test_nano_banana.py
git commit -m "feat(images): add NanoBananaGenerator (gemini-3.1-flash-image)"
```

### Task A3.2: Переключить ImagenService backend на NB2 + переводчик через провайдер

**Files:**

- Modify: `backend/app/services/imagen_generator.py` (`PromptTranslator.__init__` :80; `ImagenService._generate_with_retry` :376-391)

- [ ] **Step 1: Написать падающий тест** — ImagenService генерит через NanoBananaGenerator:

```python
# backend/tests/services/test_imagen_uses_nb2.py
import pytest
from unittest.mock import AsyncMock, patch
from app.services.imagen_generator import ImagenService


@pytest.mark.asyncio
async def test_imagen_generate_with_retry_uses_nano_banana():
    svc = ImagenService()
    svc._available = True
    with patch("app.services.imagen_generator.NanoBananaGenerator") as NB:
        NB.return_value.generate = AsyncMock(return_value=b"PNGDATA")
        svc._nano = NB.return_value
        out = await svc._generate_with_retry("a castle, book illustration", "4:3")
    assert out == b"PNGDATA"
```

- [ ] **Step 2: Запустить — FAIL.**

Run: `cd backend && uv run python -m pytest tests/services/test_imagen_uses_nb2.py -v`

- [ ] **Step 3: Переключить backend** в `imagen_generator.py`:
  - Импорт: добавить `from app.services.nano_banana_generator import NanoBananaGenerator`; заменить `from app.core.openrouter_client import get_openrouter_client` → `from app.core.ai_provider_factory import get_ai_provider`.
  - `PromptTranslator.__init__` (:80): `self._client = get_openrouter_client()` → `self._client = get_ai_provider()` (сигнатура `generate_text` не меняется).
  - `ImagenService._initialize` (:362): `self._client = get_openrouter_client()` → добавить `self._nano = NanoBananaGenerator()`.
  - `ImagenService._generate_with_retry` (:376-391) заменить тело на:
    ```python
    @retry_image_generation
    async def _generate_with_retry(self, prompt: str, aspect_ratio: str) -> bytes:
        return await self._nano.generate(
            prompt=prompt, aspect_ratio=aspect_ratio, image_size="1K"
        )
    ```
  - `_model`/`get_status` (:351, :661): заменить `settings.OPENROUTER_IMAGE_MODEL` → `settings.GEMINI_IMAGE_MODEL`; `model_used` в результате (:543) → `settings.GEMINI_IMAGE_MODEL`.
  - Доступность сервиса (:357): условие `if not settings.OPENROUTER_API_KEY` → `if not settings.GEMINI_API_KEY`.

- [ ] **Step 4: Запустить — PASS + imagen-набор.**

Run: `cd backend && uv run python -m pytest tests/services/test_imagen_uses_nb2.py tests/ -k imagen -v`

- [ ] **Step 5: Визуальная проверка + refusal-rate** (часть eval-гейта): сгенерировать ≥20 картинок по 5 типам сущностей на разножанровой выборке (вкл. «тёмные» сцены: бой, хоррор). Зафиксировать pass-rate и **refusal-rate** Gemini. Если refusal-rate высокий — это вход для решения вернуть FLUX (через git-историю), вне scope Этапа A.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/imagen_generator.py backend/tests/services/test_imagen_uses_nb2.py
git commit -m "feat(images): route ImagenService backend to Nano Banana 2"
```

---

## Phase A5: Eval-гейт (correctness)

### Task A5.1: Spoiler-free CI-инвариант (non-negotiable)

**Files:**

- Test: `backend/tests/integration/test_spoiler_free_gemini.py`

- [ ] **Step 1: Написать тест**, который прогоняет извлечение на 2-главном фрагменте под `AI_PROVIDER=gemini` и проверяет, что `_apply_chapter_filter` не отдаёт сущности/описания будущих глав при чтении главы 1.

```python
# backend/tests/integration/test_spoiler_free_gemini.py
import pytest

@pytest.mark.integration
@pytest.mark.asyncio
async def test_no_future_chapter_leak_under_gemini(gemini_processed_two_chapter_book):
    book = gemini_processed_two_chapter_book  # фикстура: книга, обработанная на Gemini
    visible = await get_entities_visible_up_to_chapter(book.id, chapter=1)
    for e in visible:
        assert e.first_mention_chapter <= 1, f"Spoiler leak: {e.name} (ch {e.first_mention_chapter})"
```

> Переиспользовать существующий spoiler-free тест как шаблон: `grep -rl "first_mention_chapter" backend/tests/`. Фикстуру `gemini_processed_two_chapter_book` собрать на базе существующих book-фикстур + `AI_PROVIDER=gemini`.

- [ ] **Step 2: Запустить.**

Run: `cd backend && AI_PROVIDER=gemini uv run python -m pytest tests/integration/test_spoiler_free_gemini.py -v`
Expected: PASS (100%). Если FAIL — это блокер cutover, чинить `_apply_chapter_filter` под новые структуры ответа.

- [ ] **Step 3: Commit** — `git commit -am "test(eval): spoiler-free invariant under Gemini provider"`

### Task A5.2: Schema-validity + sanity сводка

- [ ] **Step 1:** Прогнать 3–5 реальных книг разных жанров (вкл. русскую классику — проверить транслитерацию имён: «Гарри» не должен стать «Garry»).
- [ ] **Step 2:** Свести метрики гейта в `docs/reports/2026-XX-gemini-stage-a-eval.md`: schema validity (% без ошибок парсинга), наблюдения по sanity (сущности/описания/картинки), refusal-rate картинок, факт. себестоимость.
- [ ] **Step 3:** Решение gate pass/fail. Pass-критерий: spoiler-free 100%, schema validity ≥0.99, sanity OK, картинки генерятся.
- [ ] **Step 4: Commit** — `git commit -am "docs(eval): Stage A correctness gate report"`

---

## Phase A7: Cutover + удаление OpenRouter

### Task A7.1: Flag-cutover на проде

- [ ] **Step 1:** После прохождения гейта (A5) выставить на проде `AI_PROVIDER=gemini`, `GEMINI_API_KEY=<paid>`. Деплой по `/deploy`.
- [ ] **Step 2:** Наблюдение на реальных прогонах (обработать 1–2 книги в проде). Метрики: ноль ошибок парсинга, spoiler-free, `llm_usage_log` пишет Gemini-модели. **Rollback:** при регрессии — вернуть `AI_PROVIDER=openrouter` (мгновенно, без передеплоя кода).
- [ ] **Step 3: Commit** — `git commit -am "ops(ai): gemini provider at 100% in prod"`

### Task A7.2: Удаление OpenRouter (LLM + FLUX)

**Files:**

- Delete: `backend/app/core/openrouter_client.py`
- Modify: `backend/app/core/ai_provider_factory.py`, `backend/app/core/config.py`, `backend/tests/core/test_ai_provider.py`, `backend/tests/core/test_ai_provider_factory.py`
- Modify: `docs/architecture/ai-pipeline.md`

- [ ] **Step 1:** Убедиться, что ничего, кроме фабрики и тестов, не импортирует OpenRouter:

Run: `cd backend && grep -rn "openrouter_client\|get_openrouter_client\|OpenRouterClient\|_inline_defs\|OPENROUTER_IMAGE_MODEL\|OPENROUTER_API_KEY" app/ tests/`
Expected: совпадения только в `ai_provider_factory.py`, `config.py`, `test_ai_provider*.py` (их правим ниже).

- [ ] **Step 2:** Удалить `git rm backend/app/core/openrouter_client.py`. В `ai_provider_factory.py` убрать ветку `else` — оставить только Gemini:

  ```python
  def get_ai_provider() -> AIProvider:
      global _provider
      if _provider is None:
          from app.core.gemini_client import get_gemini_client
          _provider = get_gemini_client()
      return _provider
  ```

  В `config.py` удалить `OPENROUTER_API_KEY`, `OPENROUTER_IMAGE_MODEL`, `AI_PROVIDER` (флаг больше не нужен — провайдер один). Обновить `test_ai_provider.py` (проверять `GeminiClient` вместо `OpenRouterClient`) и `test_ai_provider_factory.py` (только Gemini-ветка).

- [ ] **Step 3:** Полный прогон тестов.

Run: `cd backend && uv run python -m pytest -v`
Expected: всё зелёное (кроме известных pre-existing: ErrorBoundary/auth — frontend, не backend).

- [ ] **Step 4:** Обновить `docs/architecture/ai-pipeline.md` — источник истины теперь Gemini Direct (модели `gemini-3.5-flash` / `gemini-3.1-flash-image`, ключ `GEMINI_API_KEY`, провайдер `core/gemini_client.py`). Обновить `backend/CLAUDE.md` и `.claude/rules/ai-pipeline.md` (OpenRouter → Gemini).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ai): remove OpenRouter, Gemini is the sole provider"
```

---

## Self-Review (выполнено при написании плана)

**1. Покрытие spec:** модель 3.5-flash (A0.1/A2.1) ✓; sync-only (нет batch-задач) ✓; implicit caching (нет explicit-задач — автоматичен) ✓; NB2-картинки (A3) ✓; correctness-гейт без baseline (A5) ✓; flag-cutover без canary (A7.1) ✓; полное удаление OpenRouter/FLUX (A7.2) ✓; thinking_level=medium (A1.3 generate_structured) ✓. Batch/A6/model-A-B — намеренно отсутствуют (→ Этап B). ✓
**2. Плейсхолдеры:** нет TBD/«добавить обработку» — весь код приведён. Где имена классов/строк могут отличаться, дан `grep`-шаг для верификации (A2.1/A2.2/A3.2/A5.1). ✓
**3. Консистентность типов:** `generate_text→str`, `generate_structured(schema_class)→dict`, `generate_image→bytes`, `generate(prompt,...)→bytes` (NanoBananaGenerator) — единообразны во всех задачах; `get_ai_provider()`/`get_gemini_client()`/`compute_cost()`/`compute_image_cost()` совпадают между определением и использованием. ✓

## Известные допущения (проверить при исполнении)

- Точные имена классов `GeminiDescriptionExtractor` / `EntitySynthesisService` / `ImagenService` и строки инициализации `self._client` — подтвердить `grep`-шагами (заложены в задачи).
- `GeminiClient.generate_structured` использует `resp.text`; если google-genai 2.8.0 в каком-то кейсе кладёт JSON иначе — поправить извлечение (тест A1.3 поймает).
- Если на A2.3 появятся `429`/`ServerError` от Gemini — добавить tenacity внутрь `GeminiClient` отдельной мелкой задачей (call-site уже под `@retry_llm_extraction`).
