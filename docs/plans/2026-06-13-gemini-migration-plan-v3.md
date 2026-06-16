# План миграции fancai на прямой Gemini API (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: используй `superpowers:subagent-driven-development` (рекомендуется) или `superpowers:executing-plans` для исполнения задач по одной. Шаги помечены чекбоксами (`- [ ]`). Этап A готов к исполнению; Этап B — план верхнего уровня, детализируется отдельным документом перед стартом.

> **Правки по аудиту 2026-06-14** (`docs/reports/2026-06-14-gemini-migration-plan-v3-audit.md`): фактология плана подтверждена первоисточниками Google. Внесены P1/P2-правки: латентность по тарифу (Batch=Free/фон, Sync=Pro), 242-ФЗ поднят до P1-блокера Этапа B, добавлен риск safety-фильтров Gemini для иллюстраций, жёсткий Google spend-cap, унификация cost-drift, мелкие фактические корректировки.

**Goal:** Перевести оба AI-пайплайна fancai (извлечение сущностей и генерация иллюстраций) с OpenRouter на прямой Google Gemini API через `google-genai`, затем построить поверх двухтарифную модель Free/Pro с кредитами на изображения.

**Architecture:** Вводим тонкий провайдер-слой (`AIProvider` Protocol) с двумя реализациями — `GeminiClient` (primary, `google-genai`) и существующий `OpenRouterClient` (временный fallback на период миграции). Сервисы извлечения/дедупликации/синтеза/перевода и генерации изображений переключаются на абстракцию и перестают читать хардкод модели. Монетизация (Этап B) добавляется отдельным слоем: кредитный кошелёк + квоты + YooKassa, не трогая AI-ядро.

**Tech Stack:** Python 3.12, FastAPI, `google-genai==2.8.0`, Celery, PostgreSQL 17, Redis 7.4, Alembic, pytest. Сервер — VPS Германия (EU), прокси не используется.

---

## 0. Контекст: почему это v3 и что отменяет v2

Этот план заменяет `docs/plans/2026-05-03-gemini-direct-migration-plan-v2-with-audits.md`. Веб-исследование 2026-06-13 (официальные источники Google, адверсариальная верификация) опровергло ключевые предпосылки v2:

| Предпосылка v2                                                   | Реальность на 13.06.2026 (verified)                                                                                                             | Следствие                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Gemini 2.5 Flash shutdown **17 июня 2026** (аврал, буфер 0 дней) | Это **дата релиза 2025**. Реальный shutdown 2.5 (Flash/Pro/Flash-Lite) = **16 октября 2026**, «не ранее», ≥6 мес уведомления — может сдвинуться | **Аврала нет.** Миграция поэтапная, без аварийного mini-scope |
| Целевые модели `gemini-3-flash`, `gemini-3.1-pro` (как GA)       | Таких GA-имён нет (только `-preview`). GA: `gemini-3.5-flash`, `gemini-3.1-flash-lite`                                                          | Обновлены model IDs                                           |
| Продуктовый Free можно строить на бесплатном уровне Gemini       | **Free tier Gemini обучается на данных** (текст книг → аннотаторы Google). Только **paid tier** исключает обучение                              | **Весь продакшн (вкл. Free-тариф) идёт через PAID API**       |
| Нужен прокси для России                                          | Сервер в Германии (EU); Gemini API доступен в EU напрямую, межд. карты принимаются                                                              | Прокси/SOCKS удаляется, инфраструктура упрощается             |
| SDK `google-genai==1.74.0`                                       | Актуальная **2.8.0** (3 июня 2026), Python 3.10+, prod-ready                                                                                    | Пин обновлён                                                  |

**Переиспользуем из v2 (валидно):** провайдер-абстракция, идея `GeminiClient`/`NanoBananaGenerator`, кредитная модель (`credit_wallets` + append-only `credit_ledger`), YooKassa-flow с идемпотентностью, golden eval set, спойлер-безопасность как CI-гейт, canary 10→50→100%.

**Решения пользователя (13.06.2026), зафиксированы:**

1. Сначала миграция (Этап A), потом монетизация (Этап B) — раздельно.
2. Pro = подписка ₽/мес + докупка кредитов на изображения.
3. «10 бесплатных изображений Entity Wiki» = **10 на каждую книгу**, для всех тарифов; сверх — за кредиты.
4. Стартовая модель извлечения — `gemini-3.5-flash` (максимум качества); A/B против `gemini-3.1-flash-lite` заложен в план.

---

## 1. Финальный набор возможностей Gemini API

Итоговое решение по каждой возможности (verified-данные июня 2026):

| Возможность                                                  | Берём?                          | Этап     | Зачем для fancai                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Structured output** (`response_schema` + Pydantic нативно) | ✅ Да                           | A1–A2    | Ядро извлечения сущностей. Удаляем костыль `_inline_defs()` (был нужен для OpenRouter; Direct поддерживает `$ref:"#"` рекурсию нативно)                                                                                                            |
| **Thinking** (`thinking_level` для 3.x)                      | ✅ Да                           | A2       | `gemini-3.5-flash` управляется `thinking_level` (дефолт `medium`); для извлечения — `low`/`medium` (баланс качество/цена/латентность)                                                                                                              |
| **Batch API** (−50%, SLO 24ч, потолок 48ч)                   | ✅ Да, для Free/фон             | A4       | Снижает себестоимость книги вдвое. **Не для интерактивного Pro** (латентность 24–48ч) — латентность по тарифу (§3.2). Поддерживает structured output + caching + image gen                                                                         |
| **Context caching** (explicit, системный промпт)             | ⚠️ implicit by default          | A4       | Системный промпт извлечения ~1–2K ток < порога 4096 для 3.5 Flash → explicit не окупается; полагаемся на implicit (вкл. по умолч.). Explicit — только если профилирование покажет выгоду                                                           |
| **Image generation** (Nano Banana)                           | ✅ Да                           | A3       | Замена FLUX.2. `gemini-2.5-flash-image` ($0.039/изобр.) для авто-10; `gemini-3-pro-image` — премиум                                                                                                                                                |
| **File Search** (managed RAG, GA)                            | ⏸️ Этап C (после A/B)           | —        | Проверка консистентности сущностей по всей книге. GA, citations. Откладываем — не блокирует миграцию (перепроверить статус перед C)                                                                                                                |
| **Files API / PDF**                                          | ⏸️ Этап C                       | —        | Whole-book обработка без чанкинга. Эксперимент, не в scope миграции                                                                                                                                                                                |
| **Embeddings**                                               | ❌ Нет                          | —        | Не нужны без File Search; текущая дедупликация работает на fuzzy + LLM                                                                                                                                                                             |
| **Imagen 4**                                                 | ❌ Нет                          | —        | DEPRECATED, shutdown 24 июня 2026. Не строить на нём                                                                                                                                                                                               |
| **Vertex AI** (backend-режим Gemini)                         | ✅ Да (`GEMINI_BACKEND=vertex`) | A0/A1/A3 | **Переопределено 2026-06-16:** задействует $300 GCP trial (Developer API кредиты НЕ принимает). Регион `global`, auth service-account ADC. ZDR — побочный бонус, не мотивация. План: `docs/superpowers/plans/2026-06-16-vertex-backend-submode.md` |

---

## 2. Целевая архитектура

### 2.1 Провайдер-абстракция

```python
# backend/app/core/ai_provider.py (новый)
from typing import Protocol, Optional, Any
from pydantic import BaseModel

class AIUsage(BaseModel):
    prompt_tokens: int
    candidates_tokens: int
    cached_tokens: int = 0
    thoughts_tokens: int = 0
    cost_usd: float
    model: str
    cache_mode: str = "none"     # none | implicit | explicit
    service_tier: str = "standard"  # standard | batch

class AITextResult(BaseModel):
    text: str
    usage: AIUsage

class AIStructuredResult(BaseModel):
    data: dict[str, Any]
    usage: AIUsage

class AIImageResult(BaseModel):
    image_data: bytes
    mime_type: str
    usage: AIUsage

class AIProvider(Protocol):
    async def generate_text(self, prompt: str, *, system_prompt: str | None = None,
                            model: str | None = None, temperature: float = 0.3,
                            service: str) -> AITextResult: ...
    async def generate_structured(self, prompt: str, *, schema: type[BaseModel],
                                  system_prompt: str | None = None, model: str | None = None,
                                  temperature: float = 0.1, service: str) -> AIStructuredResult: ...
    async def generate_image(self, prompt: str, *, model: str | None = None,
                             service: str) -> AIImageResult: ...
```

`GeminiClient` и `OpenRouterClient` обе реализуют `AIProvider`. Выбор провайдера — через `get_ai_provider()` фабрику, управляемую feature-flag `AI_PROVIDER` (`gemini` | `openrouter`), что даёт мгновенный rollback без деплоя.

### 2.2 Карта файлов

**Создать:**

- `core/ai_provider.py` — Protocol + dataclasses (выше)
- `core/gemini_client.py` — `GeminiClient(AIProvider)` на `google-genai`
- `core/gemini_pricing.py` — таблица цен + расчёт `cost_usd` из `usage_metadata`
- `services/nano_banana_generator.py` — генерация изображений через Gemini
- `core/ai_provider_factory.py` — `get_ai_provider()` по feature-flag

**Модифицировать:**

- `core/config.py:59` — добавить `GEMINI_API_KEY`, `AI_PROVIDER`, `GEMINI_*_MODEL`; убрать обязательность `OPENROUTER_API_KEY`
- `services/gemini_extractor.py:123` (`GeminiConfig`) — модели на Gemini IDs; удалить `_inline_defs` workaround (строка 118 в openrouter_client); вызвать через `AIProvider`
- `services/entity_deduplication_service.py`, `services/entity_synthesis_service.py` — через `AIProvider`
- `services/imagen_generator.py` — делегировать в `NanoBananaGenerator` (сохранить класс как фасад для совместимости)
- `tasks/image_tasks.py` — путь генерации через новый провайдер
- `requirements.txt:30` — `google-genai==2.8.0` (пин); строка 33 — убрать `[socks]` из httpx (прокси не нужен)

**Не трогать в Этапе A:** модели данных, `routers/`, frontend (кроме smoke). Монетизация — Этап B.

### 2.3 Модели (итоговые ID)

| Назначение                      | Model ID                             | Цена (Standard, 1M) | Заметка                                          |
| ------------------------------- | ------------------------------------ | ------------------- | ------------------------------------------------ |
| Извлечение (primary)            | `gemini-3.5-flash`                   | $1.50 / $9.00       | Выбор пользователя; A/B vs lite                  |
| Извлечение (A/B-кандидат)       | `gemini-3.1-flash-lite`              | $0.25 / $1.50       | −83% себестоимости, если recall/precision держит |
| Перевод RU→EN, dedup, reduce    | `gemini-3.1-flash-lite`              | $0.25 / $1.50       | Дешёвые вспомогательные задачи                   |
| Изображения (авто-10)           | `gemini-2.5-flash-image`             | $0.039/изобр.       | Nano Banana                                      |
| Изображения (премиум)           | `gemini-3-pro-image`                 | дороже              | Опция Pro, Этап B                                |
| Hard-fallback (период миграции) | OpenRouter `google/gemini-2.5-flash` | —                   | Через feature-flag, удаляется в A7               |

> По докам Google GA-ID image-моделей **стабильны без суффикса** (`gemini-2.5-flash-image`, `gemini-3-pro-image` — Stable). Задача A3.1 — быстрый smoke-подтверждение, не блокирующий риск.

### 2.4 Регион и приватность

- Сервер в Германии → Gemini Developer API доступен напрямую, без прокси/SOCKS.
- **Весь трафик — на paid tier** (Cloud Billing привязан): данные пользователей не идут в обучение Google (политика с 23.03.2026).
- Оговорка: paid ≠ zero-retention (логи ~55 дней для abuse-monitoring). Для контрактного ZDR — заявка на **ZDR в Developer API** (доступен по approval) или Vertex AI.
- **Backend выбран: Vertex AI** (`GEMINI_BACKEND=vertex`), регион `global`, auth service-account ADC (`GOOGLE_APPLICATION_CREDENTIALS`). Мотивация — $300 GCP trial (Developer API кредиты не принимает), НЕ приватность (контент книг — не ПДн). $300 = 90 дней → заложить cutover на paid до истечения. План: `docs/superpowers/plans/2026-06-16-vertex-backend-submode.md`.
- ⚠️ **Разграничить два РАЗНЫХ вопроса** (план v2 их смешивал):
  1. _Данные в обучение Google_ — закрыто paid tier'ом (см. выше). Текст книг — опубликованная художка, **не ПДн**; отправка в Gemini здесь не нарушение.
  2. _Локализация ПДн по 242-ФЗ_ — **НЕ закрыто** сервером в EU. БД аккаунтов/платежей (email, платёжные данные граждан РФ) сейчас в Германии. 242-ФЗ требует первичного хранения ПДн росиян в РФ. Это **P1-риск Этапа B** (монетизация = сервис явно ориентирован на РФ), не Этапа A. См. риски и преамбулу Этапа B.

---

## 3. Экономика и тарифная модель

### 3.1 Расчёт себестоимости книги (35 глав, курс 90 ₽/$ с буфером)

| Статья                                | 3.5 Flash (Standard) | 3.5 Flash (Batch −50%) | 3.1 Flash-Lite (Batch) |
| ------------------------------------- | -------------------- | ---------------------- | ---------------------- |
| Извлечение (вход ~335K + выход ~140K) | $1.76                | $0.88                  | $0.15                  |
| Dedup + synthesis                     | $0.60                | $0.30                  | $0.06                  |
| Перевод промптов (lite)               | $0.02                | $0.02                  | $0.02                  |
| 10 изображений (Nano Banana $0.039)   | $0.39                | $0.20                  | $0.20                  |
| **Итого / книга**                     | **$2.77 (~249 ₽)**   | **$1.40 (~126 ₽)**     | **$0.43 (~39 ₽)**      |

> Входные токены (~335K) — оценка; зависит от размера книги (+15% overlap +повтор системного промпта). Закрепить фактическим замером в A2.3/A4.2.

**Выводы для экономики:**

1. На 3.5 Flash **Batch обязателен** — иначе книга ~250 ₽ себестоимости.
2. A/B-переход извлечения на `3.1-flash-lite` (если качество держит) даёт книгу ~39 ₽ — **в 6× дешевле**. Это главный экономический рычаг.
3. **Рычаг тарифа:** Free может извлекать на `3.1-flash-lite` (дёшево, Batch), Pro — на `3.5-flash` (качество, Sync). Решение по результатам A/B (Задача A5).

### 3.2 Тарифы (черновик, финализируется в Этапе B по факт. себестоимости)

|                         | **Free**                        | **Pro**                                                                    |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| Цена                    | 0 ₽                             | подписка ₽/мес (ориентир 299–499 ₽, market research РФ) + докупка кредитов |
| Книг/мес                | 1–2 (низко, дотация)            | повышенный лимит                                                           |
| Изображений Entity Wiki | **10 бесплатных на книгу**      | **10 бесплатных на книгу** + ежемесячный пакет кредитов                    |
| Сверх 10 на книгу       | за кредиты                      | за кредиты                                                                 |
| Модель извлечения       | `3.1-flash-lite` (по A/B)       | `3.5-flash` (качество)                                                     |
| Путь обработки          | **Batch** (готово ≤24ч, дёшево) | **Sync** (готово за минуты)                                                |

> **Латентность по тарифу** разрешает противоречие «Batch обязателен» ↔ «p95 ≤1.3× baseline»: дешёвый медленный путь оправдан бесплатностью Free; Pro платит за скорость.

### 3.3 Кредитная механика (Этап B)

- 1 кредит ≈ 1 генерация изображения сверх бесплатных 10/книга (конверсия уточняется: при себест. $0.04 ≈ 3.6 ₽ и наценке 3–5× → цена кредита **~11–18 ₽**).
- Кошелёк `credit_wallets` (balance) + append-only `credit_ledger` (каждое списание/пополнение с `idempotency_key`).
- Списание: `SELECT FOR UPDATE` на кошельке + идемпотентность (защита от двойного списания при ретраях Celery).
- Пополнение: только через подтверждённый webhook YooKassa.

---

# ЭТАП A — Миграция AI на прямой Gemini API

**Результат этапа:** оба пайплайна работают на `google-genai`, OpenRouter удалён, себестоимость и качество измерены, Free-лимиты Gemini сняты с реального проекта. Никаких изменений монетизации.

## Phase A0: Подготовка инфраструктуры

### Task A0.1: Биллинг, ключ, регион

> **⚠️ Backend = Vertex (выбрано 2026-06-16).** Инфра (service-account, enable Vertex API, регион `global`) и config-поля `GEMINI_BACKEND/GCP_PROJECT/GCP_LOCATION` — по плану `docs/superpowers/plans/2026-06-16-vertex-backend-submode.md` (Task 1-2, реализованы). Шаги ниже (AI Studio key, smoke из Германии) актуальны только как fallback на Developer API.

**Files:** `backend/app/core/config.py`, `.env.example`

- [ ] **Step 1:** В Google AI Studio создать проект, привязать Cloud Billing (paid tier — обязательно для исключения данных из обучения), внести минимум $10. Зафиксировать, что проект billable.
- [ ] **Step 2:** Создать `GEMINI_API_KEY`, положить в секреты прод-сервера (не в репозиторий).
- [ ] **Step 3:** Добавить в `config.py` **после строки 62** (строка 59 уже занята `OPENROUTER_API_KEY`, ниже `OPENROUTER_IMAGE_MODEL` на 60–62):

```python
    GEMINI_API_KEY: str = ""               # Google Gemini Developer API key (paid tier)
    AI_PROVIDER: str = "openrouter"        # gemini | openrouter — рубильник миграции
    GEMINI_EXTRACTION_MODEL: str = "gemini-3.5-flash"
    GEMINI_LITE_MODEL: str = "gemini-3.1-flash-lite"
    GEMINI_IMAGE_MODEL: str = "gemini-2.5-flash-image"
    GEMINI_IMAGE_PREMIUM_MODEL: str = "gemini-3-pro-image"
```

- [ ] **Step 4:** Smoke-тест из Германии (прод-сервер) — подтвердить доступность без прокси:

Run: `cd backend && uv run python -c "from google import genai; c=genai.Client(api_key='$GEMINI_API_KEY'); print(c.models.generate_content(model='gemini-3.5-flash', contents='ping').text)"`
Expected: непустой ответ, без сетевых/региональных ошибок.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/.env.example
git commit -m "chore(ai): add Gemini config and provider flag"
```

### Task A0.2: Зависимости

**Files:** `backend/requirements.txt`

- [ ] **Step 1:** Строка 30 → `google-genai==2.8.0` (сейчас `>=1.69.0`, мёртвый код). Строка 33 → `httpx==0.28.1` (убрать `[socks]` — прокси не нужен).
- [ ] **Step 2:** Run: `cd backend && uv pip install -r requirements.txt` → Expected: установка без конфликтов.
- [ ] **Step 3:** Run: `cd backend && uv run python -c "import google.genai; print(google.genai.__version__)"` → Expected: `2.8.0`.
- [ ] **Step 4: Commit** — `git commit -am "chore(deps): pin google-genai 2.8.0, drop socks proxy"`

## Phase A1: GeminiClient core

### Task A1.1: Provider Protocol

**Files:** Create `backend/app/core/ai_provider.py`; Test `backend/tests/core/test_ai_provider.py`

- [ ] **Step 1: Write failing test** — проверить, что dataclasses сериализуются и `cost_usd` обязателен.

```python
# tests/core/test_ai_provider.py
from app.core.ai_provider import AIUsage, AITextResult

def test_ai_usage_requires_cost():
    u = AIUsage(prompt_tokens=10, candidates_tokens=5, cost_usd=0.001, model="gemini-3.5-flash")
    assert u.cache_mode == "none"
    assert u.service_tier == "standard"
```

- [ ] **Step 2:** Run: `pytest tests/core/test_ai_provider.py -v` → Expected: FAIL (модуль не существует).
- [ ] **Step 3:** Создать `core/ai_provider.py` с кодом из §2.1.
- [ ] **Step 4:** Run: `pytest tests/core/test_ai_provider.py -v` → Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(ai): add AIProvider protocol and result types"`

### Task A1.2: gemini_pricing

**Files:** Create `backend/app/core/gemini_pricing.py`; Test `backend/tests/core/test_gemini_pricing.py`

- [ ] **Step 1: Write failing test** (цены verified 13.06.2026, за 1M токенов):

```python
# tests/core/test_gemini_pricing.py
from app.core.gemini_pricing import compute_cost

def test_flash35_standard_cost():
    # 1M вход + 1M выход на 3.5 Flash = $1.50 + $9.00
    assert round(compute_cost("gemini-3.5-flash", 1_000_000, 1_000_000, cached=0, tier="standard"), 2) == 10.50

def test_batch_halves_cost():
    std = compute_cost("gemini-3.5-flash", 1_000_000, 1_000_000, tier="standard")
    batch = compute_cost("gemini-3.5-flash", 1_000_000, 1_000_000, tier="batch")
    assert round(batch, 4) == round(std / 2, 4)

def test_flash_lite_cheaper():
    assert compute_cost("gemini-3.1-flash-lite", 1_000_000, 0) == 0.25
```

- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Реализовать с таблицей:

```python
# core/gemini_pricing.py — $/1M токенов (Standard, verified 2026-06-09)
PRICING = {
    "gemini-3.5-flash":      {"in": 1.50, "out": 9.00, "cached_in": 0.15},
    "gemini-3.1-flash-lite": {"in": 0.25, "out": 1.50, "cached_in": 0.025},
    "gemini-2.5-flash":      {"in": 0.30, "out": 2.50, "cached_in": 0.03},
    "gemini-2.5-flash-lite": {"in": 0.10, "out": 0.40, "cached_in": 0.01},
    "gemini-2.5-pro":        {"in": 1.25, "out": 10.00, "cached_in": 0.125},
}
IMAGE_PRICING = {"gemini-2.5-flash-image": 0.039}  # $/изображение

def compute_cost(model, in_tokens, out_tokens, cached=0, tier="standard"):
    p = PRICING[model]
    cost = ((in_tokens - cached) * p["in"] + cached * p["cached_in"] + out_tokens * p["out"]) / 1_000_000
    return cost * 0.5 if tier == "batch" else cost
```

- [ ] **Step 4:** Run → Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(ai): add gemini pricing table and cost calc"`

### Task A1.3: GeminiClient — generate_text + generate_structured

**Files:** Create `backend/app/core/gemini_client.py`; Test `backend/tests/core/test_gemini_client.py`

- [ ] **Step 1: Write failing test** (мокаем `google.genai.Client`, проверяем маппинг usage и парсинг structured):

```python
# tests/core/test_gemini_client.py
import pytest
from unittest.mock import MagicMock, patch
from pydantic import BaseModel
from app.core.gemini_client import GeminiClient

class _Schema(BaseModel):
    name: str

@pytest.mark.asyncio
async def test_generate_structured_maps_usage():
    fake = MagicMock()
    fake.text = '{"name": "Геральт"}'
    fake.usage_metadata.prompt_token_count = 1000
    fake.usage_metadata.candidates_token_count = 50
    fake.usage_metadata.cached_content_token_count = 0
    with patch("app.core.gemini_client.genai.Client") as C:
        C.return_value.aio.models.generate_content = MagicMock(return_value=_async(fake))
        client = GeminiClient(api_key="x")
        res = await client.generate_structured("prompt", schema=_Schema, service="extraction")
    assert res.data["name"] == "Геральт"
    assert res.usage.prompt_tokens == 1000
    assert res.usage.cost_usd > 0
```

(`_async` — хелпер, оборачивающий значение в awaitable; добавить в тест.)

- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Реализовать `GeminiClient`. Ключевые моменты:
  - `genai.Client(api_key=...)`, async через `client.aio.models.generate_content`.
  - structured: `config=GenerateContentConfig(response_mime_type="application/json", response_schema=schema, thinking_config=ThinkingConfig(thinking_level="low"))` — **Pydantic-класс передаётся напрямую**, без `_inline_defs` (Direct поддерживает рекурсивный `$ref:"#"`; оговорка — очень глубокие схемы могут отклоняться, держать golden-тест валидности A5).
  - usage: из `response.usage_metadata` (`prompt_token_count`, `candidates_token_count`, `cached_content_token_count`, `thoughts_token_count`), cost через `compute_cost`.
  - Ретраи: `tenacity` (как в `core/retry.py`) на `ServerError`/`429`. **Circuit breaker не обязателен** — у Gemini нет проблемы нестабильности OpenRouter; начать без него, добавить при необходимости. Учесть: при жёстком месячном cap'е Google (Tier 1 = $250) 429-стоп не транзиентный — ретраи не помогут, нужна spend-cap-логика (A6/B6).
  - Логирование usage в `llm_usage_log` (как `_log_usage_to_db` в openrouter_client).
- [ ] **Step 4:** Run → Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(ai): implement GeminiClient text+structured via google-genai"`

### Task A1.4: Фабрика провайдера

**Files:** Create `backend/app/core/ai_provider_factory.py`; Test `backend/tests/core/test_ai_provider_factory.py`

- [ ] **Step 1: Write failing test:** `get_ai_provider()` возвращает `GeminiClient` при `AI_PROVIDER="gemini"`, `OpenRouterClient` при `"openrouter"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Реализовать фабрику (singleton по флагу из `settings.AI_PROVIDER`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(ai): add provider factory with feature flag"`

## Phase A2: Миграция LLM-извлечения

### Task A2.1: Удалить `_inline_defs`, перевести extractor на провайдер

**Files:** Modify `services/gemini_extractor.py:123` (GeminiConfig), `:628`/`:667` (вызовы); удалить `_inline_defs` использование

- [ ] **Step 1: Write failing test** — извлечение из эталонного русского чанка возвращает валидный по схеме результат через Gemini-провайдер (мок Gemini).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** В `GeminiConfig` заменить `model_extraction` → `settings.GEMINI_EXTRACTION_MODEL`, `model_translation`/`model_reduce` → `settings.GEMINI_LITE_MODEL`. Вызовы `self._client.generate_structured(...)` направить через `get_ai_provider()`. Передавать `schema=` как Pydantic-класс напрямую (убрать `_inline_defs`-преобразование).
- [ ] **Step 4:** Run → PASS. Также запустить полный набор: `cd backend && uv run python -m pytest tests/ -k extractor -v`.
- [ ] **Step 5: Commit** — `git commit -am "refactor(extractor): use AIProvider, drop OpenRouter _inline_defs workaround"`

### Task A2.2: dedup + synthesis + translation через провайдер

**Files:** Modify `services/entity_deduplication_service.py`, `services/entity_synthesis_service.py`

- [ ] **Step 1–4:** Аналогично A2.1 — заменить прямые вызовы OpenRouter на `get_ai_provider().generate_structured/generate_text`, прогнать тесты dedup/synthesis.
- [ ] **Step 5: Commit** — `git commit -am "refactor(entities): route dedup/synthesis/translation via AIProvider"`

### Task A2.3: Интеграционный прогон одной книги на Gemini

- [ ] **Step 1:** На staging выставить `AI_PROVIDER=gemini`. Обработать 1 тестовую русскую книгу (например «Мастер и Маргарита», фрагмент).
- [ ] **Step 2:** Проверить: 100% валидность schema, сущности извлечены, `llm_usage_log` пишет `cost_usd` и модель `gemini-3.5-flash`.
- [ ] **Step 3:** Зафиксировать факт. себестоимость прогона (сверить с §3.1).
- [ ] **Step 4: Commit** (если были фиксы) — `git commit -am "test(ai): gemini extraction integration on RU book"`

## Phase A3: Миграция генерации изображений

### Task A3.1: Подтвердить callable image-ID + NanoBananaGenerator

**Files:** Create `services/nano_banana_generator.py`; Test `tests/services/test_nano_banana.py`

- [ ] **Step 1:** В AI Studio подтвердить точный callable-ID (`gemini-2.5-flash-image` — по докам Stable без `-preview`). Зафиксировать в `config.py`.
- [ ] **Step 2: Write failing test** — генерация по англоязычному промпту возвращает `image_data: bytes` + usage (мок).
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Реализовать `NanoBananaGenerator.generate_image()`: вызов `client.aio.models.generate_content(model=GEMINI_IMAGE_MODEL, contents=prompt, config=GenerateContentConfig(response_modalities=["IMAGE"]))`, извлечь `inline_data.data` (bytes), посчитать cost ($0.039/изобр.). Сохранить SFW-перевод RU→EN (переиспользовать существующий `PromptTranslator`, но через `AIProvider`).
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** — `git commit -am "feat(images): add NanoBananaGenerator via Gemini"`

### Task A3.2: Переключить image_tasks + сохранить старые FLUX

**Files:** Modify `tasks/image_tasks.py` (путь идёт через индирекцию `modal_client.get_image_generator`, `image_tasks.py:15` — учесть слой), `services/imagen_generator.py` (фасад)

- [ ] **Step 1:** Путь генерации направить в `NanoBananaGenerator` при `AI_PROVIDER=gemini`. Существующие FLUX-изображения в БД **не трогать** (поле `service_used` остаётся, новые пишутся с `model_id=gemini-2.5-flash-image`).
- [ ] **Step 2:** Тест: батч-генерация 5 изображений главы не падает, пишет `GeneratedImage` + `Description.image_generated=True`.
- [ ] **Step 3:** Визуальная проверка ≥20 изображений (5 типов сущностей). Цель — pass rate ≥85% vs FLUX baseline.
- [ ] **Step 3a (риск safety-фильтров):** Прогнать **разножанровую** выборку, включая «тёмные» сцены (насилие, оружие, хоррор, откровенное) — Gemini-image консервативнее FLUX по контент-модерации. Измерить **refusal-rate** отдельно. Если Gemini отклоняет промпт — **fallback на FLUX** (фасад `imagen_generator` оставить рабочим как запасной путь, **не удалять FLUX в A7**).
- [ ] **Step 4: Commit** — `git commit -am "feat(images): route generation through Gemini Nano Banana"`

## Phase A4: Batch API + context caching (себестоимость)

> **Латентность по тарифу (разрешение противоречия Batch↔p95):** Batch (SLO 24ч, потолок 48ч до `JOB_STATE_EXPIRED`) — путь **Free/фоновой** обработки, где ожидание оправдано бесплатностью. **Pro идёт sync** (минуты). Метрика «p95 ≤1.3× baseline» применяется к **sync-пути**; для batch — отдельная метрика time-to-ready (см. «Метрики успеха»).

### Task A4.1: Explicit caching системного промпта (опционально)

**Files:** Modify `core/gemini_client.py`, `services/gemini_extractor.py`

- [ ] **Step 1: Write failing test** — при включённом caching повторный вызов с тем же системным промптом передаёт `cached_content` и usage показывает `cached_tokens > 0`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Реализовать: создать `CachedContent` для системного промпта извлечения (`client.aio.caches.create(model=..., config=CreateCachedContentConfig(system_instruction=..., ttl="3600s"))`), переиспользовать `cache.name` в запросах. **Условие минимума:** для 3.5 Flash порог 4096 токенов — а системный промпт ~1–2K, поэтому explicit-кэш не окупается (storage $1/1M/час + сложность). **Рекомендация по аудиту: полагаться на implicit caching** (включён по умолчанию для 2.5+ моделей); explicit реализовать только если профилирование покажет выгоду. Пометить выбор в коде.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -am "perf(ai): explicit cache for extraction system prompt"`

### Task A4.2: Batch-режим извлечения (путь Free/фон)

**Files:** Modify `core/gemini_client.py` (`submit_batch`/`poll_batch`), `tasks/book_tasks.py`

> Batch применяется к **Free/фоновому** пути обработки книги, не к Pro-sync. Состояние `JOB_STATE_EXPIRED` наступает на **48ч** (24ч — целевой SLO, не потолок).

- [ ] **Step 1: Write failing test** — `submit_batch()` формирует JSONL/inline-запросы и возвращает job; `poll_batch()` обрабатывает состояния `JOB_STATE_*` (PENDING/RUNNING/SUCCEEDED/FAILED/CANCELLED/EXPIRED).
- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Реализовать через `client.aio.batches.create(model=..., src=inline_requests, config={"display_name": book_id})` (inline ≤20MB; крупные книги — JSONL через Files API ≤2GB). Polling `client.aio.batches.get(name=...)` с таймаутом **до 48ч** (под потолок `EXPIRED`); на `JOB_STATE_EXPIRED`/`JOB_STATE_FAILED`/таймаут — fallback на синхронный режим. Batch поддерживает structured output + caching + image gen (verified).
- [ ] **Step 4:** Run → PASS. Интеграция: одна книга через batch, сверить себестоимость (ожидаем ~−50% vs A2.3) **и зафиксировать фактический time-to-ready**.
- [ ] **Step 5: Commit** — `git commit -am "perf(ai): batch mode for chapter extraction (-50% cost)"`

## Phase A5: Golden eval + A/B моделей

### Task A5.1: Golden eval set

**Files:** Create `backend/tests/golden/` (датасет + раннер)

- [ ] **Step 1:** Собрать эталон: 25 глав × 5 жанров (вкл. русскую классику — транслитерация имён: «Гарри» не должен стать «Garry»), 10 кластеров дедупликации, 5 книг полный прогон.
- [ ] **Step 2:** Раннер метрик: entity recall, precision, JSON schema validity, translation качество (ручная шкала), spoiler-free (100%).
- [ ] **Step 3: Commit** — `git commit -am "test(golden): add eval set for extraction quality"`

### Task A5.2: A/B 3.5 Flash vs 3.1 Flash-Lite (+ опц. 3 Flash Preview)

- [ ] **Step 1:** Прогнать golden set на обеих моделях. Зафиксировать recall/precision/cost.
- [ ] **Step 1a (опционально):** Добавить 3-м кандидатом `gemini-3-flash-preview` ($0.50/$3.00 — втрое дешевле 3.5-flash, near-Pro reasoning). Учесть: это **preview** (нестабилен, не для прода до GA), но A/B покажет, стоит ли ждать его GA как «золотую середину» между lite и 3.5.
- [ ] **Step 2:** Критерий: если `3.1-flash-lite` даёт recall ≥0.85 и precision ≥0.92 (vs baseline), назначить её default для Free (−83% себестоимости); 3.5 Flash оставить для Pro. Иначе — 3.5 Flash везде.
- [ ] **Step 3:** Записать решение в `docs/reports/` и обновить `GEMINI_EXTRACTION_MODEL`-логику (модель по тарифу — задел для Этапа B).
- [ ] **Step 4: Commit** — `git commit -am "test(ai): model A/B results, set per-tier extraction model"`

## Phase A6: Тест лимитов Free tier Gemini (запрос пользователя)

### Task A6.1: Снять реальные лимиты с проекта

- [ ] **Step 1:** Открыть `aistudio.google.com/rate-limit` для прод-проекта (лимиты больше **не публикуются статически**, только per-project). Зафиксировать RPM/TPM/RPD по `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-flash-image` на текущем tier.
- [ ] **Step 2:** Нагрузочный микро-тест: измерить фактический throughput (книг/час, изображений/час) при текущих лимитах, поведение при 429 (backoff срабатывает).
- [ ] **Step 3:** Рассчитать, сколько Free-юзеров выдержит проект в пределах Tier-cap, и нужен ли переход на Tier 2 ($2000). **Это входные данные для лимитов Free-тарифа в Этапе B.**
- [ ] **Step 3a (⚠️ жёсткий cap Google):** С 1 апр 2026 при достижении месячного cap'а tier'а (**Tier 1 = $250**, Tier 2 = $2000) **все запросы пауза до след. цикла** — аварийный стоп всего сервиса в середине месяца. Заложить: алерт на **70/85%** Google-cap'а и **проактивный апгрейд Tier 1→2 до приближения к $250**. Связать с собственным spend-cap (B6).
- [ ] **Step 4:** Записать в `docs/reports/2026-XX-gemini-free-tier-limits.md`.

> Примечание: «Free tier Gemini» (бесплатный уровень Google) **не используем** в проде (данные → обучение). Этот тест — про лимиты нашего **paid** проекта, на которых строится продуктовый Free-тариф.

## Phase A7: Canary rollout + удаление OpenRouter

### Task A7.1: Постепенный rollout

- [ ] **Step 1:** `AI_PROVIDER=gemini` на 10% трафика (по user_id hash), soak 24ч. Метрики: качество ≥ baseline, cost drift ≤5%, latency p95 ≤1.3× baseline (sync-путь), spoiler-free 100%.
- [ ] **Step 2:** 50% → soak 24ч → 100% → soak 24ч. На регрессии — мгновенный откат флагом на `openrouter`.
- [ ] **Step 3: Commit** — `git commit -am "ops(ai): gemini at 100% traffic"`

### Task A7.2: Удаление OpenRouter

**Files:** Delete `core/openrouter_client.py`; Modify `config.py`, `requirements.txt`

- [ ] **Step 1:** Удалить `OpenRouterClient`, ветку фабрики, `OPENROUTER_*` из config, `_inline_defs`. Убрать `google-genai` из «мёртвого кода» — теперь он основной. **Исключение:** FLUX-путь (`imagen_generator`) оставить как fallback для image-промптов, отклонённых safety-фильтрами Gemini (A3.2).
- [ ] **Step 2:** Run: `cd backend && uv run python -m pytest -v` → Expected: всё зелёное (кроме известных pre-existing).
- [ ] **Step 3:** Обновить `docs/architecture/ai-pipeline.md` (источник истины: теперь Gemini Direct).
- [ ] **Step 4: Commit** — `git commit -am "refactor(ai): remove OpenRouter, Gemini is sole provider"`

---

# ЭТАП B — Тарифы Free/Pro + кредиты + платежи

> **Статус:** план верхнего уровня. **Перед стартом Этапа B создать детальный план** `docs/plans/YYYY-MM-DD-monetization-plan.md` с TDD-задачами — его ценообразование и лимиты зависят от факт. себестоимости (A2.3/A4.2) и лимитов Free (A6). Ниже — каркас, фазы и схемы БД.
>
> **⚠️ P1-блокер монетизации — 242-ФЗ (локализация ПДн):** монетизация для РФ-аудитории делает сервис явно «ориентированным на граждан РФ» → срабатывает обязанность **первичного хранения ПДн росиян на территории РФ** (152-ФЗ ч.5 ст.18 / 242-ФЗ). Сейчас БД аккаунтов/платежей в EU (сервер в Германии). Прецедент: **Miro оштрафован на 2 млн ₽ (фев 2026)** за БД в США. **До старта B:** юридическая проверка + решение по локализации первичной БД ПДн (РФ-инстанс / РФ-юрлицо / ИП). Это структурное решение, не Privacy Policy. Текст книг — не ПДн, проблема только в учётках/платежах.
>
> **Операционный prerequisite 54-ФЗ:** фискальный чек закрывается облачной кассой YooKassa+ОФД, но требует **ИП/самозанятого + договор с ОФД**. Заложить в чеклист до приёма платежей.

## Phase B1: Модели данных

**Создать модели + Alembic-миграции:**

- `models/credit_wallet.py` — `user_id` (unique FK), `balance` (Numeric), `total_purchased`, `total_consumed`.
- `models/credit_transaction.py` — append-only ledger: `user_id`, `delta`, `reason` (`signup_bonus`|`purchase`|`image_generation`|`refund`), `related_entity_id`, `balance_after`, `idempotency_key` (unique), `created_at`.
- `models/payment.py` — `user_id`, `amount_rub`, `credits`, `status` (`pending`|`succeeded`|`canceled`), `provider` (`yookassa`), `provider_payment_id` (unique), `idempotency_key`.
- Расширить `Subscription` (`models/user.py:148`): `tier_code` (free|pro), `started_at`, `ends_at`, `auto_renew`, `provider_subscription_id`. Перевести существующий enum `FREE/PREMIUM/ULTIMATE` → `free/pro` (миграция данных).
- Расширить `GeneratedImage`: `model_id`, `credits_consumed`, `is_free_quota` (для логики «10 на книгу»).

## Phase B2: Credit service + квоты «10 на книгу»

- `services/credit_service.py`: `consume(user_id, amount, reason, idempotency_key)` с `SELECT FOR UPDATE` на кошельке; `grant(...)`; `balance(...)`.
- `services/quota_guard.py`: перед генерацией изображения проверять — если у книги `<10` сгенерированных бесплатных → бесплатно (`is_free_quota=True`); иначе списать кредит. Заменить текущую логику `check_image_quota` (`routers/images.py:83`, месячный счётчик) на per-book + кредиты.
- Тесты: race condition (параллельные списания не уводят баланс в минус), идемпотентность (повторный Celery-ретрай не списывает дважды), граница «10-я vs 11-я картинка книги».

## Phase B3: YooKassa-интеграция

- `services/yookassa_service.py` на официальном SDK (`yookassa` — версию пина уточнить на PyPI перед стартом): создание платежа с `Idempotence-Key`, `save_payment_method` для рекуррента.
- `routers/payments.py`: `POST /payments/credits` (купить пакет), `POST /webhooks/yookassa` — верификация по IP-allowlist YooKassa + проверка подписи, idempotent обработка (`provider_payment_id` unique), начисление кредитов только на `payment.succeeded`.
- Celery Beat: рекуррентное списание Pro-подписки (YooKassa не хранит подписки — логика на нашей стороне через сохранённый `payment_method_id`), grace-period при неудаче.
- Безопасность: webhook — replay-window ≤5 мин, всё в `payment` ledger.

## Phase B4: Тарифная логика Free/Pro

- `services/tariff_service.py`: entitlements по тарифу (книг/мес, ежемесячные кредиты Pro, модель извлечения по тарифу из A5, **путь обработки: Free=Batch, Pro=Sync**).
- Free: `3.1-flash-lite` извлечение, Batch, 1–2 книги/мес, 10 картинок/книга. Pro: `3.5-flash`, Sync, повышенные лимиты, пакет кредитов/мес + докупка.
- Anti-abuse: email-верификация + IP rate-limit на регистрацию (Free на дотации).

## Phase B5: Frontend

- Страница тарифов, баланс кредитов, покупка пакетов (YooKassa embedded widget), индикатор «осталось N бесплатных для этой книги».
- TanStack Query хуки (без прямого `fetch`).

## Phase B6: Cost monitoring + spend cap

- Дашборд себестоимости (Grafana): cost/книга, cost/юзер, маржа.
- Spend-cap эскалация: 90% месячного бюджета → пауза Free, 95% → пауза Pro-генераций сверх включённых, 100% → read-only. Daily reconciliation `llm_usage_log` vs Google Cloud Billing (drift >5% — алерт).
- **Связка с жёстким Google-cap'ом:** собственный spend-cap должен срабатывать **раньше** месячного cap'а tier'а Google (Tier 1 = $250 / Tier 2 = $2000), иначе Google остановит API жёстко (стоп до след. цикла). Алерт на 70/85% Google-cap'а + автозаявка/апгрейд tier.

---

## Риски и митигации

| Риск                                            | Вер.  | Влияние | Митигация                                                                                                                                     |
| ----------------------------------------------- | ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.5 Flash дорог → Free нерентабелен             | Выс.  | Выс.    | Batch (A4) + A/B на lite (A5) + модель по тарифу + низкий лимит книг Free                                                                     |
| Регрессия качества извлечения на русском        | Сред. | Выс.    | Golden set с русской классикой (A5.1), порог recall/precision как гейт                                                                        |
| **Spoiler-free регрессия**                      | Низк. | Крит.   | CI-тест 100% (non-negotiable), блокирует деплой                                                                                               |
| Batch-латентность ломает UX (24–48ч)            | Сред. | Выс.    | Латентность по тарифу: Batch=Free/фон, Sync=Pro (§3.2); отдельная метрика time-to-ready                                                       |
| **Gemini image-фильтры режут fiction-сцены**    | Сред. | Сред.   | Gemini консервативнее FLUX; тест разножанровый + refusal-rate (A3.2); **FLUX-fallback** на отклонённые промпты                                |
| Image callable-ID `-preview` нестабилен         | Низк. | Низк.   | По докам GA-ID стабильны без суффикса (`gemini-2.5-flash-image`); A3.1 — быстрый smoke, фасад `imagen_generator` остаётся                     |
| Лимиты/жёсткий cap Free Gemini режут throughput | Сред. | Выс.    | Замер на проекте (A6); проактивный Tier 1→2; алерт 70/85% Google-cap; spend-cap раньше cap Google (B6)                                        |
| **242-ФЗ (локализация ПДн росиян)**             | Выс.  | Крит.   | **P1-блокер Этапа B:** первичная БД ПДн в РФ (сервер в Германии не годится); юрист до монетизации; прецедент Miro 2 млн₽. Текст книг — не ПДн |
| 54-ФЗ (фискальный чек)                          | Сред. | Выс.    | Облачная касса YooKassa+ОФД; prerequisite — ИП/самозанятый + договор с ОФД                                                                    |
| Курс рубля >115 ₽/$                             | Сред. | Выс.    | Буфер +30% в ценах, авто-ре-калибровка при триггере                                                                                           |
| Double-spend кредитов при ретраях               | Сред. | Выс.    | `idempotency_key` + `SELECT FOR UPDATE` (B2)                                                                                                  |
| Нужен контрактный ZDR                           | Низк. | Сред.   | ZDR доступен и в Developer API (по заявке) либо Vertex AI + DPA (вне scope)                                                                   |

## Метрики успеха Этапа A

| Метрика                              | Цель                                   |
| ------------------------------------ | -------------------------------------- |
| JSON schema validity                 | ≥0.99                                  |
| Entity recall / precision            | ≥0.85 / ≥0.92 (vs OpenRouter baseline) |
| Spoiler-free                         | 100% (CI-гейт)                         |
| Image visual pass rate               | ≥0.85                                  |
| Latency p95 (**sync-путь, Pro**)     | ≤1.3× baseline                         |
| Time-to-ready (**batch-путь, Free**) | ≤24ч (потолок 48ч)                     |
| Cost drift (план vs Cloud Billing)   | ≤5%                                    |
| Себестоимость книги                  | измерена и зафиксирована (план §3.1)   |

## Последовательность и зависимости

```
A0 → A1 → A2 → A3 → A4 → A5 → A6 → A7   (Этап A, исполнять по порядку)
                                   │
                                   ▼
        [детальный план Этапа B] → B1 → B2 → B3 → B4 → B5 → B6
```

A4 (batch/cache) можно начать параллельно с A3 (разные файлы). A5 требует A2+A3. Этап B стартует только после A7 (стабильный Gemini в проде) и использует числа из A2.3/A4.2/A6.

## Открытые вопросы (на будущее, не блокируют)

1. File Search для проверки консистентности сущностей (Этап C) — POC после стабилизации (перепроверить GA-статус перед стартом).
2. Точная конверсия кредит↔рубль и цена Pro — финализировать в детальном плане Этапа B по факт. себестоимости.
3. Премиум-изображения `gemini-3-pro-image` для Pro — отдельная фича после базовой монетизации.
4. Vertex AI + ZDR/DPA — только если появится требование контрактного zero-retention.
5. Локализация первичной БД ПДн под 242-ФЗ — решить ДО Этапа B (юридический трек).
