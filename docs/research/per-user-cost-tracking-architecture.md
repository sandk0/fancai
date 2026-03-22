# Архитектура per-user трекинга AI-расходов для fancai

> **Канонические параметры**: См. [SHARED_ASSUMPTIONS.md](SHARED_ASSUMPTIONS.md)

> Исследовательский документ. Дата: 2026-03-14
> Статус: ПРОЕКТИРОВАНИЕ (не реализовано)

---

## Содержание

1. [Текущее состояние](#1-текущее-состояние)
2. [Архитектура real-time трекинга](#2-архитектура-real-time-трекинга)
3. [Схема базы данных](#3-схема-базы-данных)
4. [FastAPI middleware](#4-fastapi-middleware)
5. [Атрибуция расходов](#5-атрибуция-расходов)
6. [Dashboard API](#6-dashboard-api)
7. [Интеграция с OpenRouter](#7-интеграция-с-openrouter)
8. [Точки интеграции в коде](#8-точки-интеграции-в-коде)

---

## 1. Текущее состояние

### 1.1. Что уже есть

**Таблица `llm_usage_log`** (`backend/app/models/llm_usage_log.py`):

```
id             BIGINT PK AUTO
created_at     TIMESTAMP WITH TZ (indexed)
model          VARCHAR(128) (indexed) — "google/gemini-3-flash-preview"
service        VARCHAR(64) nullable — "entity_synthesis", "gemini_extractor"
prompt_tokens  INTEGER
completion_tokens INTEGER
cost_dollars   NUMERIC(12,8)
request_id     VARCHAR(64) nullable — OpenRouter request ID
```

**Что НЕ хватает**: поля `user_id` нет. Все записи — анонимные, невозможно атрибутировать
расходы конкретному пользователю.

### 1.2. Как записываются расходы сейчас

В `backend/app/core/openrouter_client.py` — функция `_log_usage_to_db()` (строка 144):

```python
async def _log_usage_to_db(
    model: str,
    service: Optional[str],        # всегда None — вызов service= не заполнен
    prompt_tokens: int,
    completion_tokens: int,
    cost: float,
    request_id: Optional[str],
) -> None:
```

Вызывается через `asyncio.create_task()` (fire-and-forget) в трёх методах:

- `generate_text()` — строка 338
- `generate_structured()` — строка 471
- `generate_image()` — строка 595

**Проблемы текущей реализации:**

1. `service=None` всегда — не заполняется вызывающим кодом
2. `user_id` отсутствует — нет контекста пользователя на уровне клиента
3. Fire-and-forget — нет гарантии записи (если сессия БД упадёт — потеря данных)
4. Нет pre-request проверки бюджета — расходы фиксируются только после вызова

### 1.3. Система квот изображений (reference architecture)

В `backend/app/routers/images.py` (строка 69-153) уже реализована зрелая система квот
для image generation:

```python
GENERATION_LIMITS = {
    SubscriptionPlan.FREE: settings.FREE_GENERATIONS_LIMIT,      # 50
    SubscriptionPlan.PREMIUM: settings.PREMIUM_GENERATIONS_LIMIT, # 500
    SubscriptionPlan.ULTIMATE: 999999,
}
```

Паттерн: `check_image_quota()` dependency → проверка `Subscription.images_generated_month`
→ HTTP 402 при превышении → `X-RateLimit-*` headers.

Этот паттерн можно обобщить на все AI-расходы, заменив "images per month"
на "credits/dollars per period".

### 1.4. Сервисы, потребляющие AI

| Сервис                      | Файл                                       | Метод OpenRouter                      | Контекст user_id                               |
| --------------------------- | ------------------------------------------ | ------------------------------------- | ---------------------------------------------- |
| GeminiDirectExtractor       | `services/gemini_extractor.py`             | `generate_structured()`               | Нет — вызов из Celery task `process_book_task` |
| ConsistencyManager          | `services/consistency_manager.py`          | `generate_text()`, `generate_image()` | Нет — вызов из Celery task                     |
| EntityDeduplicationService  | `services/entity_deduplication_service.py` | `generate_structured()`               | Нет — вызов из Celery task                     |
| EntitySynthesisService      | `services/entity_synthesis_service.py`     | `generate_text()`                     | Нет — вызов из Celery task                     |
| ImagenService (translation) | `services/imagen_generator.py`             | `generate_text()`                     | Нет — вызов из Celery task                     |
| ImagenService (image gen)   | `services/imagen_generator.py`             | `generate_image()`                    | Нет — вызов из Celery task                     |
| ImageGeneratorService       | `services/image_generator.py`              | через ImagenService                   | Есть `user_id` в параметре                     |

**Ключевой вывод**: все AI-вызовы проходят через `OpenRouterClient` singleton,
но user_id доступен только на уровне роутера/Celery task, а не на уровне клиента.

---

## 2. Архитектура real-time трекинга

### 2.1. Двухуровневая архитектура: Redis (hot) + PostgreSQL (cold)

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   FastAPI     │────▶│   Redis DB 0     │────▶│   PostgreSQL     │
│   Request     │     │   (hot counters) │     │   (cold storage) │
│               │     │                  │     │                  │
│ pre-request:  │     │ user:{uid}:cost: │     │ user_ai_usage    │
│  check budget │     │   daily          │     │ (per-request)    │
│               │     │   weekly         │     │                  │
│ post-request: │     │   monthly        │     │ user_ai_budget   │
│  record cost  │     │                  │     │ (limits/credits) │
└──────────────┘     └──────────────────┘     └──────────────────┘
                            │                         ▲
                            │   Celery Beat            │
                            │   (hourly flush)         │
                            └──────────────────────────┘
```

### 2.2. Redis-based real-time счётчики

**Ключи в Redis DB 0** (используется для кэша, допустимо):

```
# Per-user daily counter (expires at midnight UTC)
user:{user_id}:ai_cost:daily:{YYYY-MM-DD}     → NUMERIC (dollars)

# Per-user monthly counter (expires 1st of next month)
user:{user_id}:ai_cost:monthly:{YYYY-MM}      → NUMERIC (dollars)

# Per-user operation counter (for rate limiting)
user:{user_id}:ai_ops:daily:{YYYY-MM-DD}      → INTEGER (count)

# Budget cache (loaded from PostgreSQL)
user:{user_id}:ai_budget                       → JSON {monthly_limit, remaining, plan}
```

**TTL-стратегия**:

- `daily` ключи: TTL = секунд до конца текущего дня UTC + 3600 (запас)
- `monthly` ключи: TTL = секунд до конца текущего месяца + 86400 (запас)
- `ai_budget`: TTL = 300 секунд (5 мин), обновляется при каждой проверке

### 2.3. Атомарные обновления счётчиков

Критически важно: при concurrent requests от одного пользователя (например, batch
генерация изображений) необходимо атомарное обновление счётчиков.

```python
# backend/app/core/cost_tracker.py — НОВЫЙ ФАЙЛ

import time
from decimal import Decimal
from typing import Optional
from uuid import UUID
from datetime import datetime, timezone

from redis.asyncio import Redis
from loguru import logger


class CostTracker:
    """
    Real-time per-user AI cost tracker.

    Использует Redis INCRBYFLOAT для атомарных обновлений счётчиков.
    Все операции идемпотентны при replay (cost привязан к request_id).

    Redis DB 0 (shared with cache_manager).
    """

    def __init__(self, redis: Redis):
        self._redis = redis

    def _daily_key(self, user_id: UUID) -> str:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return f"user:{user_id}:ai_cost:daily:{today}"

    def _monthly_key(self, user_id: UUID) -> str:
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        return f"user:{user_id}:ai_cost:monthly:{month}"

    def _ops_key(self, user_id: UUID) -> str:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return f"user:{user_id}:ai_ops:daily:{today}"

    def _budget_key(self, user_id: UUID) -> str:
        return f"user:{user_id}:ai_budget"

    def _dedup_key(self, request_id: str) -> str:
        return f"ai_cost:dedup:{request_id}"

    async def record_cost(
        self,
        user_id: UUID,
        cost_dollars: float,
        request_id: Optional[str] = None,
    ) -> bool:
        """
        Атомарно записывает стоимость AI-вызова в Redis.

        Использует INCRBYFLOAT — атомарная операция, безопасна при конкурентных запросах.
        Дедупликация по request_id предотвращает двойную запись при retry.

        Args:
            user_id: UUID пользователя
            cost_dollars: Стоимость в USD
            request_id: OpenRouter request_id для дедупликации

        Returns:
            True если записано, False если дубликат
        """
        if cost_dollars <= 0:
            return True

        # Дедупликация по request_id (idempotency)
        if request_id:
            dedup_key = self._dedup_key(request_id)
            # SET NX — только если ключ НЕ существует
            was_set = await self._redis.set(dedup_key, "1", nx=True, ex=86400)
            if not was_set:
                logger.debug(f"Duplicate cost record skipped: {request_id}")
                return False

        # Атомарные инкременты (pipeline для батчинга)
        pipe = self._redis.pipeline(transaction=True)

        daily_key = self._daily_key(user_id)
        monthly_key = self._monthly_key(user_id)
        ops_key = self._ops_key(user_id)

        pipe.incrbyfloat(daily_key, cost_dollars)
        pipe.incrbyfloat(monthly_key, cost_dollars)
        pipe.incr(ops_key)

        # TTL: до конца дня/месяца + запас
        now = datetime.now(timezone.utc)

        # Daily TTL: до конца текущего дня + 1 час запас
        end_of_day = now.replace(hour=23, minute=59, second=59)
        daily_ttl = int((end_of_day - now).total_seconds()) + 3600
        pipe.expire(daily_key, daily_ttl)
        pipe.expire(ops_key, daily_ttl)

        # Monthly TTL: до конца текущего месяца + 1 день запас
        import calendar
        _, last_day = calendar.monthrange(now.year, now.month)
        end_of_month = now.replace(day=last_day, hour=23, minute=59, second=59)
        monthly_ttl = int((end_of_month - now).total_seconds()) + 86400
        pipe.expire(monthly_key, monthly_ttl)

        await pipe.execute()

        logger.debug(
            f"Cost recorded: user={user_id}, cost=${cost_dollars:.6f}, "
            f"request_id={request_id}"
        )
        return True

    async def check_budget(
        self,
        user_id: UUID,
        estimated_cost: float,
    ) -> tuple[bool, dict]:
        """
        Pre-request проверка бюджета пользователя.

        Args:
            user_id: UUID пользователя
            estimated_cost: Ожидаемая стоимость операции в USD

        Returns:
            (can_proceed, budget_info)
            can_proceed: True если бюджет позволяет
            budget_info: {monthly_limit, monthly_used, remaining, plan}
        """
        # Читаем бюджет из Redis cache (или загружаем из PostgreSQL)
        budget_key = self._budget_key(user_id)
        budget_json = await self._redis.get(budget_key)

        if budget_json:
            import json
            budget = json.loads(budget_json)
        else:
            # Загружаем из PostgreSQL и кэшируем
            budget = await self._load_budget_from_db(user_id)
            if budget:
                import json
                await self._redis.set(
                    budget_key,
                    json.dumps(budget, default=str),
                    ex=300,  # 5 min cache
                )

        if not budget:
            # Нет бюджета — разрешаем (free tier с дефолтным лимитом)
            return True, {"monthly_limit": 0.50, "monthly_used": 0, "remaining": 0.50}

        # Текущее использование за месяц из Redis
        monthly_key = self._monthly_key(user_id)
        monthly_used_str = await self._redis.get(monthly_key)
        monthly_used = float(monthly_used_str) if monthly_used_str else 0.0

        monthly_limit = float(budget.get("monthly_limit", 0.50))
        remaining = monthly_limit - monthly_used

        can_proceed = remaining >= estimated_cost

        budget_info = {
            "monthly_limit": monthly_limit,
            "monthly_used": round(monthly_used, 6),
            "remaining": round(max(0, remaining), 6),
            "plan": budget.get("plan", "free"),
            "estimated_cost": estimated_cost,
        }

        return can_proceed, budget_info

    async def get_usage_summary(self, user_id: UUID) -> dict:
        """
        Текущий snapshot использования для dashboard.

        Returns:
            {
                daily_cost, monthly_cost, daily_ops,
                monthly_limit, remaining, plan
            }
        """
        pipe = self._redis.pipeline(transaction=False)

        pipe.get(self._daily_key(user_id))
        pipe.get(self._monthly_key(user_id))
        pipe.get(self._ops_key(user_id))
        pipe.get(self._budget_key(user_id))

        results = await pipe.execute()

        daily_cost = float(results[0]) if results[0] else 0.0
        monthly_cost = float(results[1]) if results[1] else 0.0
        daily_ops = int(results[2]) if results[2] else 0

        import json
        budget = json.loads(results[3]) if results[3] else {}
        monthly_limit = float(budget.get("monthly_limit", 0.50))

        return {
            "daily_cost": round(daily_cost, 6),
            "monthly_cost": round(monthly_cost, 6),
            "daily_operations": daily_ops,
            "monthly_limit": monthly_limit,
            "remaining": round(max(0, monthly_limit - monthly_cost), 6),
            "plan": budget.get("plan", "free"),
        }

    async def _load_budget_from_db(self, user_id: UUID) -> Optional[dict]:
        """Загружает бюджет пользователя из PostgreSQL."""
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.user import Subscription, SubscriptionPlan
            from sqlalchemy import select

            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(Subscription).where(Subscription.user_id == user_id)
                )
                sub = result.scalar_one_or_none()

                if not sub:
                    return {
                        "monthly_limit": 0.50,
                        "plan": "free",
                    }

                # Лимиты расходов по планам (в USD)
                COST_LIMITS = {
                    SubscriptionPlan.FREE: 0.50,      # ~$0.50/мес — хватит на ~100 глав
                    SubscriptionPlan.PREMIUM: 5.00,    # ~$5/мес
                    SubscriptionPlan.ULTIMATE: 50.00,   # ~$50/мес
                }

                return {
                    "monthly_limit": COST_LIMITS.get(sub.plan, 0.50),
                    "plan": sub.plan.value,
                }

        except Exception as e:
            logger.warning(f"Failed to load budget from DB: {e}")
            return None
```

### 2.4. Периодическая синхронизация Redis → PostgreSQL

Redis — volatile storage. Для надёжности и аналитики необходима периодическая
синхронизация в PostgreSQL.

```python
# backend/app/tasks/cost_tracking_tasks.py — НОВЫЙ ФАЙЛ

@celery_app.task(name="flush_ai_costs_to_db")
def flush_ai_costs_to_db():
    """
    Celery Beat задача: синхронизирует Redis AI-счётчики в PostgreSQL.
    Запуск: каждый час.

    Стратегия: сканируем Redis ключи user:*:ai_cost:daily:*,
    записываем агрегаты в user_ai_usage_daily.
    """
    run_async(_flush_costs_async())


async def _flush_costs_async():
    import redis.asyncio as aioredis
    from app.core.config import settings
    from app.core.database import AsyncSessionLocal

    redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

    async with AsyncSessionLocal() as db:
        # Сканируем все daily cost ключи
        async for key in redis_client.scan_iter(match="user:*:ai_cost:daily:*"):
            # Parse: user:{uuid}:ai_cost:daily:{date}
            parts = key.split(":")
            if len(parts) != 5:
                continue

            user_id = parts[1]
            date_str = parts[4]
            cost = float(await redis_client.get(key) or 0)

            if cost > 0:
                # UPSERT в user_ai_usage_daily
                await db.execute(
                    text("""
                        INSERT INTO user_ai_usage_daily (user_id, date, total_cost, synced_at)
                        VALUES (:user_id, :date, :cost, NOW())
                        ON CONFLICT (user_id, date)
                        DO UPDATE SET total_cost = :cost, synced_at = NOW()
                    """),
                    {"user_id": user_id, "date": date_str, "cost": cost},
                )

        await db.commit()

    await redis_client.close()
```

---

## 3. Схема базы данных

### 3.1. Модификация существующей таблицы `llm_usage_log`

Добавляем `user_id` и `service` для per-user атрибуции:

```sql
-- Миграция: add_user_id_to_llm_usage_log

ALTER TABLE llm_usage_log
    ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN operation_type VARCHAR(32);
    -- operation_type: 'entity_extraction', 'entity_synthesis',
    -- 'entity_dedup', 'image_translation', 'image_generation',
    -- 'consistency_check', 'master_reference'

CREATE INDEX ix_llm_usage_log_user_id ON llm_usage_log(user_id);
CREATE INDEX ix_llm_usage_log_user_monthly ON llm_usage_log(user_id, created_at)
    WHERE user_id IS NOT NULL;
```

### 3.2. Новая таблица: `user_ai_budget`

```sql
-- Миграция: create_user_ai_budget

CREATE TABLE user_ai_budget (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Лимиты (в USD)
    monthly_limit_dollars   NUMERIC(10, 4) NOT NULL DEFAULT 0.50,
    -- 0.50 = free tier (~100 chapter extractions + ~20 images)

    -- Кредиты (покупки / промо)
    credits_dollars         NUMERIC(10, 4) NOT NULL DEFAULT 0.00,
    credits_expire_at       TIMESTAMP WITH TIME ZONE,

    -- Метаданные
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_ai_budget_user UNIQUE (user_id)
);

CREATE INDEX ix_user_ai_budget_user_id ON user_ai_budget(user_id);

COMMENT ON COLUMN user_ai_budget.monthly_limit_dollars IS
    'Monthly AI spending limit in USD. Determined by subscription plan.';
COMMENT ON COLUMN user_ai_budget.credits_dollars IS
    'Bonus credits (from purchases or promotions). Used before monthly limit.';
```

### 3.3. Новая таблица: `user_ai_usage_daily`

```sql
-- Миграция: create_user_ai_usage_daily

CREATE TABLE user_ai_usage_daily (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date            DATE NOT NULL,

    -- Агрегаты
    total_cost          NUMERIC(10, 6) NOT NULL DEFAULT 0,
    total_operations    INTEGER NOT NULL DEFAULT 0,
    prompt_tokens       INTEGER NOT NULL DEFAULT 0,
    completion_tokens   INTEGER NOT NULL DEFAULT 0,

    -- Breakdown по типу операции
    cost_extraction     NUMERIC(10, 6) NOT NULL DEFAULT 0,  -- entity extraction
    cost_synthesis      NUMERIC(10, 6) NOT NULL DEFAULT 0,  -- entity synthesis + dedup
    cost_images         NUMERIC(10, 6) NOT NULL DEFAULT 0,  -- image gen + translation
    cost_other          NUMERIC(10, 6) NOT NULL DEFAULT 0,  -- consistency, etc.

    -- Синхронизация из Redis
    synced_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_ai_usage_daily UNIQUE (user_id, date)
);

CREATE INDEX ix_user_ai_usage_daily_user_date
    ON user_ai_usage_daily(user_id, date DESC);

COMMENT ON TABLE user_ai_usage_daily IS
    'Per-user daily AI cost aggregates. Synced from Redis counters hourly.';
```

### 3.4. Полная SQLAlchemy модель

```python
# backend/app/models/user_ai_budget.py — НОВЫЙ ФАЙЛ

from datetime import datetime
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import Numeric, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserAiBudget(Base):
    """
    Per-user AI budget (monthly limits + bonus credits).

    Привязка: Subscription.plan → monthly_limit_dollars.
    Обновляется при смене подписки.
    """

    __tablename__ = "user_ai_budget"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    monthly_limit_dollars: Mapped[object] = mapped_column(
        Numeric(10, 4), default=0.50, nullable=False,
        comment="Monthly AI spending limit in USD",
    )

    credits_dollars: Mapped[object] = mapped_column(
        Numeric(10, 4), default=0.00, nullable=False,
        comment="Bonus credits (purchases / promo). Used before monthly limit.",
    )
    credits_expire_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        server_default=func.now(), onupdate=func.now(),
    )
```

```python
# backend/app/models/user_ai_usage_daily.py — НОВЫЙ ФАЙЛ

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Integer, Numeric, Date, ForeignKey, DateTime, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserAiUsageDaily(Base):
    """
    Per-user daily AI cost aggregates.

    Синхронизируется из Redis счётчиков каждый час через Celery Beat.
    Используется для dashboard графиков и исторической аналитики.
    """

    __tablename__ = "user_ai_usage_daily"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)

    total_cost: Mapped[object] = mapped_column(Numeric(10, 6), default=0, nullable=False)
    total_operations: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    cost_extraction: Mapped[object] = mapped_column(Numeric(10, 6), default=0, nullable=False)
    cost_synthesis: Mapped[object] = mapped_column(Numeric(10, 6), default=0, nullable=False)
    cost_images: Mapped[object] = mapped_column(Numeric(10, 6), default=0, nullable=False)
    cost_other: Mapped[object] = mapped_column(Numeric(10, 6), default=0, nullable=False)

    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_user_ai_usage_daily"),
    )
```

### 3.5. Расчёт лимитов по планам

Основано на реальных ценах OpenRouter (март 2026):

| Операция                    | Модель         | Ценообразование         | Типичный cost |
| --------------------------- | -------------- | ----------------------- | ------------- |
| Entity extraction (1 глава) | Gemini 3 Flash | ~2K input + 1K output   | ~$0.0003      |
| Entity synthesis (книга)    | Gemini 3 Flash | ~10K input + 3K output  | ~$0.0015      |
| Entity deduplication        | Gemini 3 Flash | ~5K input + 2K output   | ~$0.0008      |
| Image translation RU→EN     | Gemini 3 Flash | ~500 input + 200 output | ~$0.0001      |
| Image generation            | FLUX.2 Klein   | per-image               | ~$0.014       |
| Consistency check           | Gemini 3 Flash | ~3K input + 1K output   | ~$0.0004      |

**Типичная книга (30 глав):**

- Extraction: 30 × $0.0003 = $0.009
- Synthesis: $0.0015
- Dedup: $0.0008
- Consistency: $0.0004
- **Итого LLM: ~$0.012** за книгу

**Типичная сессия генерации изображений (10 картинок):**

- Translation: 10 × $0.0001 = $0.001
- Generation: 10 × $0.014 = $0.14
- **Итого Images: ~$0.141**

**Предлагаемые лимиты:**

| План     | Месячный лимит USD | ~Книг | ~Картинок | Цена     |
| -------- | ------------------ | ----- | --------- | -------- |
| FREE     | $0.50              | ~40   | ~30       | $0       |
| PREMIUM  | $5.00              | ~400  | ~300      | $299/мес |
| ULTIMATE | $50.00             | ~4000 | ~3000     | $999/мес |

---

## 4. FastAPI middleware

### 4.1. Архитектурное решение: Dependency, не Middleware

Вместо глобального ASGI middleware, который перехватывает ВСЕ запросы, используем
FastAPI Dependency injection — точечно для роутов с AI-операциями.

**Причины:**

1. Не все роуты потребляют AI (CRUD, reading sessions, sync — бесплатные)
2. Стоимость операции известна ДО вызова (можно оценить по типу)
3. Существующий паттерн `check_image_quota()` уже использует Dependency
4. Легче тестировать (mock dependency vs mock middleware)

### 4.2. Budget check dependency

```python
# backend/app/core/budget.py — НОВЫЙ ФАЙЛ

from enum import Enum
from typing import Tuple
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_active_user
from app.core.database import get_database_session
from app.models.user import User


class AiOperationType(str, Enum):
    """Типы AI-операций с estimated cost."""

    ENTITY_EXTRACTION = "entity_extraction"        # ~$0.0003/chapter
    ENTITY_SYNTHESIS = "entity_synthesis"           # ~$0.0015/book
    ENTITY_DEDUP = "entity_dedup"                   # ~$0.0008/book
    IMAGE_GENERATION = "image_generation"           # ~$0.015/image (translation + gen)
    CONSISTENCY_CHECK = "consistency_check"         # ~$0.0004/book
    BOOK_PROCESSING = "book_processing"             # ~$0.012/book (all LLM combined)


# Estimated cost per operation (conservative upper bounds)
ESTIMATED_COSTS: dict[AiOperationType, float] = {
    AiOperationType.ENTITY_EXTRACTION: 0.001,      # per chapter
    AiOperationType.ENTITY_SYNTHESIS: 0.005,        # per book
    AiOperationType.ENTITY_DEDUP: 0.003,            # per book
    AiOperationType.IMAGE_GENERATION: 0.020,        # per image
    AiOperationType.CONSISTENCY_CHECK: 0.001,       # per book
    AiOperationType.BOOK_PROCESSING: 0.050,         # per book (all combined)
}


async def check_ai_budget(
    operation: AiOperationType,
    count: int = 1,
    current_user: User = Depends(get_current_active_user),
) -> Tuple[User, float]:
    """
    FastAPI Dependency: pre-request budget check.

    Проверяет, может ли пользователь оплатить AI-операцию
    из месячного бюджета или бонусных кредитов.

    Usage:
        @router.post("/process")
        async def process(
            budget_check: Tuple[User, float] = Depends(
                lambda: check_ai_budget(AiOperationType.BOOK_PROCESSING)
            ),
        ):
            user, estimated_cost = budget_check
            ...

    Args:
        operation: Тип AI-операции
        count: Количество единиц (глав, изображений)
        current_user: Текущий пользователь (из auth)

    Returns:
        (user, estimated_cost)

    Raises:
        HTTPException 402: Бюджет исчерпан
    """
    from app.core.cost_tracker import get_cost_tracker

    estimated_cost = ESTIMATED_COSTS.get(operation, 0.01) * count
    tracker = get_cost_tracker()

    can_proceed, budget_info = await tracker.check_budget(
        user_id=current_user.id,
        estimated_cost=estimated_cost,
    )

    if not can_proceed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "ai_budget_exceeded",
                "message": (
                    f"Месячный лимит AI-расходов исчерпан. "
                    f"Использовано: ${budget_info['monthly_used']:.4f} "
                    f"из ${budget_info['monthly_limit']:.4f}."
                ),
                "budget": budget_info,
                "upgrade_url": "/settings/subscription",
            },
        )

    return current_user, estimated_cost
```

### 4.3. Post-request cost recording

Запись реальной стоимости происходит в `_log_usage_to_db()` — модифицированной версии
существующей функции:

```python
# Модификация backend/app/core/openrouter_client.py

async def _log_usage_to_db(
    model: str,
    service: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    cost: float,
    request_id: Optional[str],
    user_id: Optional[str] = None,          # НОВЫЙ параметр
    operation_type: Optional[str] = None,    # НОВЫЙ параметр
) -> None:
    """Записывает использование + обновляет Redis-счётчик пользователя."""
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
                user_id=user_id,               # НОВОЕ
                operation_type=operation_type,  # НОВОЕ
            )
            session.add(log_entry)
            await session.commit()

        # Обновляем Redis-счётчик пользователя
        if user_id and cost > 0:
            from app.core.cost_tracker import get_cost_tracker
            tracker = get_cost_tracker()
            await tracker.record_cost(
                user_id=UUID(user_id),
                cost_dollars=cost,
                request_id=request_id,
            )

    except Exception as e:
        logger.warning(f"[OpenRouter] Не удалось записать usage в DB: {e}")
```

### 4.4. Graceful handling при превышении бюджета mid-operation

Ситуация: пользователь запустил обработку книги (30 глав), бюджет закончился на 15-й главе.

**Стратегия: "Finish batch, block next"**

```python
# В book_tasks.py — process_chapter_safe():

async def process_chapter_safe(idx: int, chapter_id: UUID):
    # Перед каждой главой проверяем бюджет
    if user_id:
        tracker = get_cost_tracker()
        can_proceed, _ = await tracker.check_budget(
            user_id=user_id,
            estimated_cost=0.001,  # стоимость 1 главы
        )
        if not can_proceed:
            logger.warning(
                f"AI budget exceeded for user {user_id} at chapter {idx}. "
                f"Stopping processing gracefully."
            )
            # Помечаем оставшиеся главы как "budget_exceeded"
            local_chapter.parsing_error = "AI budget exceeded"
            await session.commit()
            return  # Не кидаем exception — позволяем уже обработанным сохраниться
    ...
```

**Для image generation**: квота проверяется ДО запуска — если бюджет < estimated cost,
возвращаем 402 сразу. Нет риска mid-operation failure.

### 4.5. Cost estimation API

```python
# backend/app/routers/budget.py — НОВЫЙ ФАЙЛ

@router.get("/ai/estimate")
async def estimate_ai_cost(
    operation: AiOperationType = Query(...),
    count: int = Query(default=1, ge=1, le=1000),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """
    Оценка стоимости AI-операции ДО её запуска.

    Возвращает estimated cost и оставшийся бюджет.
    """
    estimated = ESTIMATED_COSTS.get(operation, 0.01) * count
    tracker = get_cost_tracker()
    _, budget_info = await tracker.check_budget(current_user.id, estimated)

    return {
        "operation": operation.value,
        "count": count,
        "estimated_cost": round(estimated, 6),
        "can_afford": budget_info["remaining"] >= estimated,
        "budget": budget_info,
    }
```

---

## 5. Атрибуция расходов

### 5.1. Фоновые Celery tasks

**Проблема**: `process_book_task` запускается как Celery task, user_id передаётся
только в `generate_image_task` (как `user_id_str`), но НЕ передаётся
в `process_book_task` и дочерние сервисы.

**Решение: Propagate user_id через Context Variable**

```python
# backend/app/core/ai_context.py — НОВЫЙ ФАЙЛ

import contextvars
from typing import Optional
from uuid import UUID

# Context variable для текущего user_id в AI-вызове.
# Устанавливается на уровне роутера / Celery task.
# Читается в openrouter_client._log_usage_to_db().
_current_ai_user_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_ai_user_id", default=None
)
_current_ai_operation: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_ai_operation", default=None
)


def set_ai_context(user_id: Optional[UUID], operation: Optional[str] = None) -> None:
    """Устанавливает user_id и тип операции для текущего AI-вызова."""
    _current_ai_user_id.set(str(user_id) if user_id else None)
    _current_ai_operation.set(operation)


def get_ai_user_id() -> Optional[str]:
    """Возвращает user_id из текущего контекста."""
    return _current_ai_user_id.get()


def get_ai_operation() -> Optional[str]:
    """Возвращает тип операции из текущего контекста."""
    return _current_ai_operation.get()
```

**Использование в Celery tasks:**

```python
# backend/app/tasks/book_tasks.py — модификация process_book_task

async def _process_book_async(book_id: UUID) -> Dict[str, Any]:
    async with AsyncSessionLocal() as db:
        book = ...  # загрузка книги

        # Устанавливаем контекст пользователя для всех AI-вызовов
        from app.core.ai_context import set_ai_context
        set_ai_context(user_id=book.user_id, operation="entity_extraction")

        # Все последующие вызовы OpenRouterClient автоматически
        # атрибутируют расходы этому пользователю
        ...
```

**Использование в OpenRouterClient:**

```python
# backend/app/core/openrouter_client.py — модификация _log_usage_to_db

async def _log_usage_to_db(
    model: str,
    service: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    cost: float,
    request_id: Optional[str],
) -> None:
    # Автоматически подхватываем контекст
    from app.core.ai_context import get_ai_user_id, get_ai_operation

    user_id = get_ai_user_id()
    operation_type = get_ai_operation()

    # ... далее запись с user_id и operation_type
```

**Важно**: `contextvars` работают в asyncio — каждая Task имеет свою копию контекста.
Это означает, что `asyncio.create_task(_log_usage_to_db(...))` автоматически
наследует ContextVar из родительской coroutine. Для Celery tasks: установка
происходит в начале task-функции, все async вызовы внутри наследуют контекст.

### 5.1.1. Пропагация user_id в Celery задачах

В `book_tasks.py:process_book_task()` передаётся только `book_id_str`, а `user_id` отсутствует. Варианты решения:

**Вариант A (рекомендуемый)**: Извлекать `user_id` из `Book.user_id` внутри Celery worker:

```python
book = await db.get(Book, book_id)
user_id_context.set(book.user_id)  # ContextVar
```

**Вариант B**: Добавить `user_id` как аргумент задачи при enqueue:

```python
process_book_task.delay(str(book.id), str(current_user.id))
```

Вариант A предпочтительнее — не требует изменения сигнатур всех задач.

### 5.2. Shared cache hits

**Проблема**: если два пользователя запросили обработку одной и той же книги (невозможно
в fancai — книги привязаны к user), но возможно для LLM cache:
`gemini_extractor._get_cached_response()` возвращает кэшированный ответ без вызова LLM.

**Решение**: Кэшированные ответы — **бесплатные**. Стоимость = 0 для cache hit.
Это справедливо: пользователь платит только за реальные API-вызовы.

Текущий LLM кэш (`llm:{model}:{text_hash}` в Redis) уже записывает `record_llm_cache_hit()`
в Prometheus. Для cost tracking: просто не вызываем `record_cost()` при cache hit.

### 5.3. Неудачные запросы

**Политика**: неудачные запросы (HTTP 5xx, timeout, CircuitBreakerError) **не стоят**
пользователю денег.

В текущей реализации `_log_usage_to_db()` вызывается только при успешном ответе
(внутри `try` блока после получения `data["choices"]`). При ошибке — перехват
в `except` блоке, `_log_usage_to_db()` не вызывается. Это уже правильное поведение.

### 5.4. Retry costs

**Проблема**: Celery task retry (`max_retries=3` для image_tasks, `max_retries=3`
для book_tasks). Каждый retry — новый API-вызов с новой стоимостью.

**Политика**: первый retry — бесплатный, последующие — за счёт пользователя.

**Реализация**: дедупликация в `CostTracker.record_cost()` не подходит (разные request_id
для retry). Вместо этого:

```python
# В image_tasks.py:

@celery_app.task(bind=True, max_retries=3)
def generate_image_task(self, ...):
    attempt = self.request.retries + 1

    result = run_async(_generate_image_async(
        ...,
        charge_user=(attempt <= 1),  # Бесплатный первый retry
    ))
```

Передаём флаг `charge_user` в async-функцию, которая передаёт его
в контекст AI-вызова. Если `charge_user=False`, стоимость записывается
с `user_id=None` (системные расходы).

### 5.5. Fallback model costs

**Проблема**: fallback chain Gemini Flash → Claude Haiku → Gemini Lite.
Claude Haiku значительно дороже (~10x). Пользователь не выбирал дорогую модель.

**Политика**: пользователь платит по цене самой дешёвой модели (primary model).
Разница — системные расходы.

**Реализация**:

```python
# В openrouter_client.py generate_text() / generate_structured():

# При fallback (i > 0):
if i > 0:
    # Записываем стоимость primary модели, а не fallback
    primary_cost_estimate = self._estimate_primary_cost(
        prompt_tokens, completion_tokens
    )
    user_cost = min(cost, primary_cost_estimate)
    system_cost = cost - user_cost

    # user_id → user_cost
    asyncio.create_task(
        _log_usage_to_db(model=current_model, cost=user_cost, ...)
    )
    # None → system_cost (системные расходы)
    asyncio.create_task(
        _log_usage_to_db(model=current_model, cost=system_cost, user_id=None, ...)
    )
```

---

## 6. Dashboard API

### 6.1. Endpoint: текущий баланс и расходы

```python
# backend/app/routers/budget.py — НОВЫЙ ФАЙЛ

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
from datetime import date, timedelta

from app.core.auth import get_current_active_user
from app.core.database import get_database_session
from app.models.user import User

router = APIRouter(prefix="/ai", tags=["AI Budget"])


@router.get("/budget/summary")
async def get_budget_summary(
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """
    Текущий баланс и расходы пользователя.

    Данные из Redis (real-time) + PostgreSQL budget.
    Latency: <10ms (Redis only).
    """
    from app.core.cost_tracker import get_cost_tracker

    tracker = get_cost_tracker()
    summary = await tracker.get_usage_summary(current_user.id)

    # Оценка оставшихся операций
    remaining = summary["remaining"]
    estimated_ops = {
        "books_can_process": int(remaining / 0.012) if remaining > 0 else 0,
        "images_can_generate": int(remaining / 0.015) if remaining > 0 else 0,
        "chapters_can_extract": int(remaining / 0.0003) if remaining > 0 else 0,
    }

    return {
        **summary,
        "estimated_remaining_operations": estimated_ops,
    }


@router.get("/budget/history")
async def get_usage_history(
    days: int = Query(default=30, ge=1, le=90),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> dict:
    """
    Историческое использование по дням (для графиков).

    Данные из PostgreSQL (user_ai_usage_daily).
    """
    from app.models.user_ai_usage_daily import UserAiUsageDaily
    from sqlalchemy import select

    start_date = date.today() - timedelta(days=days)

    result = await db.execute(
        select(UserAiUsageDaily)
        .where(UserAiUsageDaily.user_id == current_user.id)
        .where(UserAiUsageDaily.date >= start_date)
        .order_by(UserAiUsageDaily.date)
    )
    rows = result.scalars().all()

    daily_data = [
        {
            "date": row.date.isoformat(),
            "total_cost": float(row.total_cost),
            "operations": row.total_operations,
            "breakdown": {
                "extraction": float(row.cost_extraction),
                "synthesis": float(row.cost_synthesis),
                "images": float(row.cost_images),
                "other": float(row.cost_other),
            },
        }
        for row in rows
    ]

    return {
        "user_id": str(current_user.id),
        "period_days": days,
        "daily": daily_data,
        "total_cost": sum(d["total_cost"] for d in daily_data),
        "total_operations": sum(d["operations"] for d in daily_data),
    }


@router.get("/budget/breakdown")
async def get_cost_breakdown(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> dict:
    """
    Breakdown расходов по типу операции за текущий месяц.

    Данные из llm_usage_log (точные, per-request).
    """
    from app.models.llm_usage_log import LlmUsageLog
    from sqlalchemy import select, func
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    result = await db.execute(
        select(
            LlmUsageLog.operation_type,
            LlmUsageLog.model,
            func.count().label("calls"),
            func.sum(LlmUsageLog.cost_dollars).label("total_cost"),
            func.sum(LlmUsageLog.prompt_tokens).label("total_prompt_tokens"),
            func.sum(LlmUsageLog.completion_tokens).label("total_completion_tokens"),
        )
        .where(LlmUsageLog.user_id == current_user.id)
        .where(LlmUsageLog.created_at >= month_start)
        .group_by(LlmUsageLog.operation_type, LlmUsageLog.model)
    )
    rows = result.all()

    breakdown = {}
    for row in rows:
        op_type = row.operation_type or "unknown"
        if op_type not in breakdown:
            breakdown[op_type] = {
                "total_cost": 0,
                "total_calls": 0,
                "models": {},
            }
        breakdown[op_type]["total_cost"] += float(row.total_cost or 0)
        breakdown[op_type]["total_calls"] += row.calls
        breakdown[op_type]["models"][row.model] = {
            "calls": row.calls,
            "cost": float(row.total_cost or 0),
            "prompt_tokens": row.total_prompt_tokens,
            "completion_tokens": row.total_completion_tokens,
        }

    return {
        "period": f"{month_start.strftime('%Y-%m')}",
        "breakdown": breakdown,
        "total_cost": sum(b["total_cost"] for b in breakdown.values()),
    }
```

### 6.2. Структура данных для frontend

```typescript
// frontend/src/types/budget.ts — НОВЫЙ ФАЙЛ

interface BudgetSummary {
  daily_cost: number;
  monthly_cost: number;
  daily_operations: number;
  monthly_limit: number;
  remaining: number;
  plan: "free" | "premium" | "ultimate";
  estimated_remaining_operations: {
    books_can_process: number;
    images_can_generate: number;
    chapters_can_extract: number;
  };
}

interface UsageHistoryDay {
  date: string; // ISO date
  total_cost: number;
  operations: number;
  breakdown: {
    extraction: number;
    synthesis: number;
    images: number;
    other: number;
  };
}

interface UsageHistory {
  user_id: string;
  period_days: number;
  daily: UsageHistoryDay[];
  total_cost: number;
  total_operations: number;
}

interface CostBreakdown {
  period: string; // "2026-03"
  breakdown: Record<
    string,
    {
      total_cost: number;
      total_calls: number;
      models: Record<
        string,
        {
          calls: number;
          cost: number;
          prompt_tokens: number;
          completion_tokens: number;
        }
      >;
    }
  >;
  total_cost: number;
}
```

---

## 7. Интеграция с OpenRouter cost data

### 7.1. Парсинг стоимости из ответа

OpenRouter возвращает `usage.cost` в response body:

```json
{
  "id": "gen-abc123",
  "choices": [...],
  "usage": {
    "prompt_tokens": 1500,
    "completion_tokens": 800,
    "cost": 0.000234
  }
}
```

Текущий код уже парсит это (строки 327-330 в `openrouter_client.py`):

```python
usage = data.get("usage", {})
prompt_tokens = usage.get("prompt_tokens", 0)
completion_tokens = usage.get("completion_tokens", 0)
cost = usage.get("cost", 0.0) or 0.0
```

### 7.2. Delayed cost reporting

**Проблема**: OpenRouter может вернуть `cost: null` или `cost: 0` в ответе,
а реальная стоимость появляется через API позже (bulk generation ID endpoint).

**Текущее поведение**: `cost = usage.get("cost", 0.0) or 0.0` — если null,
записывается 0.

**Решение: Fallback cost estimation**

```python
# backend/app/core/cost_estimator.py — НОВЫЙ ФАЙЛ

# Ценообразование OpenRouter (март 2026)
# Источник: https://openrouter.ai/models
MODEL_PRICING = {
    "google/gemini-3-flash-preview": {
        "input_per_1m": 0.10,     # $0.10 / 1M input tokens
        "output_per_1m": 0.40,    # $0.40 / 1M output tokens
    },
    "anthropic/claude-haiku-4.5": {
        "input_per_1m": 0.80,
        "output_per_1m": 4.00,
    },
    "google/gemini-2.5-flash-lite": {
        "input_per_1m": 0.075,
        "output_per_1m": 0.30,
    },
    "black-forest-labs/flux.2-klein-4b": {
        "per_image": 0.014,       # $0.014 per megapixel
    },
}


def estimate_cost(
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> float:
    """
    Fallback cost estimation когда OpenRouter не возвращает cost.

    Использует таблицу цен для расчёта по токенам.
    """
    pricing = MODEL_PRICING.get(model)
    if not pricing:
        return 0.0

    if "per_image" in pricing:
        return pricing["per_image"]

    input_cost = (prompt_tokens / 1_000_000) * pricing.get("input_per_1m", 0)
    output_cost = (completion_tokens / 1_000_000) * pricing.get("output_per_1m", 0)

    return input_cost + output_cost
```

**Интеграция в `openrouter_client.py`:**

```python
cost = usage.get("cost", 0.0) or 0.0

# Fallback: если OpenRouter не вернул cost, считаем по ценнику
if cost == 0 and (prompt_tokens > 0 or completion_tokens > 0):
    from app.core.cost_estimator import estimate_cost
    cost = estimate_cost(current_model, prompt_tokens, completion_tokens)
    logger.debug(f"Estimated cost (no cost in response): ${cost:.6f}")
```

### 7.3. Reconciliation: estimated vs actual

Для reconciliation (сверки) между нашими estimated costs и фактическими charges
в OpenRouter можно использовать OpenRouter Activity API:

```
GET https://openrouter.ai/api/v1/auth/key
```

Этот endpoint возвращает суммарные расходы за период. Можно запускать
reconciliation раз в сутки через Celery Beat:

```python
@celery_app.task(name="reconcile_openrouter_costs")
def reconcile_openrouter_costs():
    """
    Ежедневная сверка расходов с OpenRouter.
    Сравнивает SUM(cost_dollars) из llm_usage_log с данными OpenRouter API.
    Записывает расхождения в лог.
    """
    ...
```

---

## 8. Точки интеграции в коде

### 8.1. Файлы, требующие модификации

| Файл                                    | Изменение                                                                         | Приоритет |
| --------------------------------------- | --------------------------------------------------------------------------------- | --------- |
| `backend/app/core/openrouter_client.py` | Добавить `user_id`, `operation_type` в `_log_usage_to_db()`, читать из ContextVar | P0        |
| `backend/app/models/llm_usage_log.py`   | Добавить `user_id`, `operation_type` columns                                      | P0        |
| `backend/app/tasks/book_tasks.py`       | `set_ai_context(user_id=book.user_id)` в начале `_process_book_async()`           | P0        |
| `backend/app/tasks/image_tasks.py`      | `set_ai_context(user_id=user_id)` в начале `_generate_image_async()`              | P0        |
| `backend/app/routers/images.py`         | Заменить `check_image_quota` на `check_ai_budget` (или использовать оба)          | P1        |
| `backend/app/routers/books/crud.py`     | Добавить `check_ai_budget` dependency к `process_book_descriptions()`             | P1        |
| `backend/app/core/config.py`            | Добавить AI budget settings (лимиты по планам)                                    | P1        |
| `backend/app/models/__init__.py`        | Зарегистрировать новые модели                                                     | P1        |

### 8.2. Новые файлы

| Файл                                                   | Описание                                        |
| ------------------------------------------------------ | ----------------------------------------------- |
| `backend/app/core/cost_tracker.py`                     | Redis-based real-time cost tracker              |
| `backend/app/core/cost_estimator.py`                   | Fallback cost estimation по ценнику             |
| `backend/app/core/ai_context.py`                       | ContextVar для user_id propagation              |
| `backend/app/core/budget.py`                           | `check_ai_budget` FastAPI dependency            |
| `backend/app/models/user_ai_budget.py`                 | SQLAlchemy модель бюджета                       |
| `backend/app/models/user_ai_usage_daily.py`            | SQLAlchemy модель дневных агрегатов             |
| `backend/app/routers/budget.py`                        | API для dashboard (summary, history, breakdown) |
| `backend/app/tasks/cost_tracking_tasks.py`             | Celery tasks (flush, reconciliation)            |
| `backend/alembic/versions/XXX_add_ai_cost_tracking.py` | Alembic миграция                                |

### 8.3. Минимальная стратегия миграции (Phase 0)

Минимальное изменение, которое даёт per-user атрибуцию без остальной инфраструктуры:

**Шаг 1**: Добавить `user_id` в `llm_usage_log` + миграция (1 hour)

**Шаг 2**: Создать `ai_context.py` с ContextVar (30 min)

**Шаг 3**: Модифицировать `_log_usage_to_db()` — читать user_id из ContextVar (30 min)

**Шаг 4**: Установить контекст в `book_tasks.py` и `image_tasks.py` (30 min)

**Итого Phase 0**: ~2.5 часа. Результат: все AI-расходы атрибутированы пользователям
в существующей таблице. Без бюджетов, без Redis-счётчиков, без dashboard.

### 8.4. Полная стратегия миграции (Phases 0-3)

**Phase 0 — Attribution** (2.5h):

- user_id в llm_usage_log
- ContextVar propagation
- Миграция

**Phase 1 — Budget checks** (4h):

- Redis cost tracker
- check_ai_budget dependency
- Лимиты по планам
- Таблица user_ai_budget

**Phase 2 — Dashboard** (4h):

- API endpoints (summary, history, breakdown)
- Таблица user_ai_usage_daily
- Celery Beat flush task
- Frontend компоненты

**Phase 3 — Credits & Reconciliation** (3h):

- Система кредитов (покупки, промо)
- Reconciliation с OpenRouter
- Admin dashboard
- Prometheus метрики per-user

### 8.5. Детальный diff для Phase 0

```python
# --- backend/app/models/llm_usage_log.py ---
# Добавить после request_id:

+    user_id: Mapped[object | None] = mapped_column(
+        PG_UUID(as_uuid=True),
+        nullable=True,
+        index=True,
+        comment="User who triggered this API call",
+    )
+
+    operation_type: Mapped[str | None] = mapped_column(
+        String(32),
+        nullable=True,
+        comment="Operation type: entity_extraction, image_generation, etc.",
+    )
```

```python
# --- backend/app/core/openrouter_client.py ---
# Модификация _log_usage_to_db():

 async def _log_usage_to_db(
     model: str,
     service: Optional[str],
     prompt_tokens: int,
     completion_tokens: int,
     cost: float,
     request_id: Optional[str],
 ) -> None:
+    # Подхватываем контекст пользователя (если установлен)
+    from app.core.ai_context import get_ai_user_id, get_ai_operation
+    user_id = get_ai_user_id()
+    operation_type = get_ai_operation()
+
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
+                user_id=user_id,
+                operation_type=operation_type,
             )
```

```python
# --- backend/app/tasks/book_tasks.py ---
# В начале _process_book_async(), после загрузки book:

+        from app.core.ai_context import set_ai_context
+        set_ai_context(user_id=book.user_id, operation="book_processing")
```

```python
# --- backend/app/tasks/image_tasks.py ---
# В начале _generate_image_async():

+    from app.core.ai_context import set_ai_context
+    set_ai_context(user_id=user_id, operation="image_generation")
```

---

## Приложение A: Оценка нагрузки на Redis

**Assumptions:**

- 100 DAU (daily active users)
- В среднем 2 книги/день → 2 × 30 chapters × AI call = 60 AI calls/user/day
- В среднем 5 image generations/user/day

**Redis operations per day:**

- Cost record: (60 + 5) × 100 = 6,500 INCRBYFLOAT/day
- Budget check: (60 + 5) × 100 = 6,500 GET/day (+ periodic SET)
- Dashboard: ~10 × 100 = 1,000 pipeline GET/day
- **Total: ~14,000 operations/day ≈ 0.16 ops/sec**

Это ничтожная нагрузка для Redis. Текущий rate limiter генерирует
в 10x больше операций.

**Memory footprint:**

- Per-user keys: ~5 keys × 100 bytes = 500 bytes/user
- 1000 users: ~500 KB
- Dedup keys (request_id): ~100 bytes × 6500/day × 30 days ≈ 18.5 MB

---

## Приложение B: Сравнение подходов

| Подход                               | Плюсы                                            | Минусы                                                              |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| **Redis counters + PG log** (выбран) | Real-time, атомарный, минимальная нагрузка на PG | Volatile — теряется при Redis restart                               |
| **Only PostgreSQL**                  | Надёжный, ACID                                   | Latency ~5-20ms per budget check, блокировки при concurrent updates |
| **Only Redis**                       | Быстрый                                          | Нет истории, volatile, нет аналитики                                |
| **Event sourcing (Kafka)**           | Идеальная аудитория                              | Overkill для текущего масштаба, +1 infra зависимость                |

Выбранный подход (Redis hot + PG cold) оптимален для текущего масштаба fancai:

- Pre-request budget check: <1ms (Redis GET)
- Post-request cost record: <1ms (Redis INCRBYFLOAT)
- Historical analytics: PostgreSQL (hourly sync)
- Потеря при Redis restart: максимум 1 час данных (восстанавливается из llm_usage_log)

---

## Приложение C: Миграция существующих данных

После добавления `user_id` в `llm_usage_log` можно backfill существующие записи:

```sql
-- Backfill: привязываем llm_usage_log к пользователям через book processing timestamps
-- Это ПРИБЛИЗИТЕЛЬНАЯ привязка — точная невозможна без user_id в логе

-- Для image generation tasks (user_id был в Celery task):
-- Невозможно без отдельного лога — пропускаем.

-- Для book processing: привязываем по временным окнам
-- Книга X обрабатывалась с T1 по T2 → все LLM вызовы в [T1, T2] принадлежат владельцу книги X
-- Это эвристика и не 100% точная.

-- РЕКОМЕНДАЦИЯ: не делать backfill. Начать запись с момента миграции.
-- Старые данные оставить без user_id (системные расходы).
```

### Backfill стратегия

Существующие записи в `llm_usage_log` не содержат `user_id`. Backfill возможен через:

```sql
-- Backfill через book_id -> user_id (для entity extraction)
-- Невозможно для 100% записей (service=None), но покроет ~70%
UPDATE llm_usage_log SET user_id = b.user_id
FROM books b WHERE llm_usage_log.metadata->>'book_id' = b.id::text;
```

Для записей без привязки к книге — оставить `user_id = NULL`.

---

## Приложение D: Celery Beat расписание

Добавить в `backend/app/core/celery_app.py`:

```python
beat_schedule = {
    ...
    # AI cost tracking: flush Redis → PostgreSQL
    "flush-ai-costs-to-db": {
        "task": "flush_ai_costs_to_db",
        "schedule": 3600.0,  # Каждый час
        "options": {"queue": "light", "priority": 1},
    },
    # AI cost reconciliation with OpenRouter
    "reconcile-openrouter-costs": {
        "task": "reconcile_openrouter_costs",
        "schedule": 86400.0,  # Каждые 24 часа
        "options": {"queue": "light", "priority": 1},
    },
}
```

---

## Итого

### Ключевые архитектурные решения:

1. **Двухуровневый трекинг**: Redis (real-time counters) + PostgreSQL (cold storage + analytics)
2. **ContextVar propagation**: user_id передаётся через contextvars, не через параметры функций — минимальные изменения в existing codebase
3. **Dependency injection**: `check_ai_budget()` — FastAPI Dependency, как и существующий `check_image_quota()`
4. **Atomic Redis operations**: INCRBYFLOAT + pipeline — безопасно при concurrent requests
5. **Idempotent cost recording**: дедупликация по request_id предотвращает двойную запись
6. **Fallback cost estimation**: если OpenRouter не возвращает cost — считаем по ценнику
7. **Graceful degradation**: budget exceeded mid-operation → stop processing, save what's done
8. **Fair retry policy**: первый retry бесплатный, fallback model — по цене primary

### Минимальный MVP (Phase 0): 2.5 часа

### Полная реализация (Phases 0-3): ~14 часов
