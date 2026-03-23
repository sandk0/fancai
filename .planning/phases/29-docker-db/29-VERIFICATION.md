---
phase: 29-docker-db
verified: 2026-03-24T12:00:00Z
status: human_needed
score: 5/5 критериев верифицировано
gaps: []
human_verification:
  - test: "Деплой с pg_dump/restore на production"
    expected: "PostgreSQL переезжает с postgres:17.9-alpine на pgvector/pgvector:0.8.2-pg17 без потери данных, ORDER BY на русском тексте корректен"
    why_human: "Требует production DB с реальными данными. Alpine→Debian несовместимость при простом image swap — только pg_dump/restore. Нельзя автоматически проверить."
  - test: "Старт celery-worker с реальным PyTorch CPU"
    expected: "Worker стартует без OOM за ~120 сек, PyTorch импортируется, HuggingFace cache пишется в /models"
    why_human: "Нельзя протестировать без docker build + реального запуска с 4GB RAM limit"
---

# Фаза 29: Docker и DB инфраструктура — Отчёт верификации

**Цель фазы:** Инфраструктура готова для NLP-моделей — pgvector работает с мигрированными данными, Celery worker настроен на 4GB RAM, schema поддерживает hybrid pipeline, feature flags контролируют rollout
**Верифицировано:** 2026-03-24T12:00:00Z
**Статус:** HUMAN_NEEDED
**Повторная верификация:** Нет — первичная верификация

---

## Результат достижения цели

### Наблюдаемые истины

| # | Истина | Статус | Доказательство |
|---|--------|--------|----------------|
| 1 | PostgreSQL запущен на pgvector/pgvector:pg17 | ✓ ВЕРИФИЦИРОВАНО | `docker-compose.prod.yml:244` — `image: pgvector/pgvector:0.8.2-pg17`, POSTGRES_INITDB_ARGS и PGDATA сохранены |
| 2 | Celery worker стартует с concurrency=1 и memory limit 4GB | ✓ ВЕРИФИЦИРОВАНО | `Dockerfile.celery:97` CMD содержит `--concurrency=1 --max-tasks-per-child=0`; compose: `memory: 4G`, `start_period: 120s`, без `max-memory-per-child` |
| 3 | Колонки extraction_source И pipeline_version существуют в entities/descriptions; chapter_embeddings с vector(384) | ✓ ВЕРИФИЦИРОВАНО | `extraction_source` — entity.py:91, description.py:93 (String(20), server_default='llm'). `pipeline_version` — entity.py:97, description.py:99. `chapter_embeddings` с `Vector(384)` — есть. Миграция обновлена. |
| 4 | 4 feature flags зарегистрированы и по умолчанию выключены | ✓ ВЕРИФИЦИРОВАНО | `feature_flag.py:142-168` — USE_GLINER_NER, USE_DESCRIPTION_CLASSIFIER, USE_HYBRID_PIPELINE, USE_PGVECTOR_EMBEDDINGS, все `enabled=False` |
| 5 | docker compose build собирает отдельный Celery image с PyTorch CPU-only | ✓ ВЕРИФИЦИРОВАНО | `Dockerfile.celery` существует, 98 строк, multi-stage, `torch==2.11.0+cpu`, `--index-url https://download.pytorch.org/whl/cpu`, `fancai-celery:latest` в compose |

**Счёт: 5/5 критериев верифицировано**

---

## Обязательные артефакты

### Plan 01 (INFRA-01, INFRA-02, INFRA-05)

| Артефакт | Ожидание | Статус | Детали |
|----------|----------|--------|--------|
| `backend/Dockerfile.celery` | Multi-stage Dockerfile с PyTorch CPU-only, ≥40 строк | ✓ ВЕРИФИЦИРОВАНО | 98 строк, FROM python:3.12-slim as builder + as production, torch==2.11.0+cpu, HF_HOME=/models, concurrency=1, max-tasks-per-child=0, start-period=120s, ENTRYPOINT |
| `docker-compose.prod.yml` | pgvector image, Celery build, nlp_models volume | ✓ ВЕРИФИЦИРОВАНО | pgvector/pgvector:0.8.2-pg17, Dockerfile.celery, nlp_models:/models, memory: 4G, cpus: '4.0', start_period: 120s |

### Plan 02 (INFRA-03, INFRA-04)

| Артефакт | Ожидание | Статус | Детали |
|----------|----------|--------|--------|
| `backend/app/models/chapter_embedding.py` | class ChapterEmbedding с Vector(384), ≥40 строк | ✓ ВЕРИФИЦИРОВАНО | 72 строки, `Vector(384)`, HNSW индекс, ForeignKey("chapters.id", ondelete="CASCADE"), UniqueConstraint, `lazy="raise"` |
| `backend/app/models/entity.py` | pipeline_version колонка | ✓ ВЕРИФИЦИРОВАНО | `pipeline_version: Mapped[str \| None] = mapped_column(String(50), nullable=True, index=True)` — строка 91 |
| `backend/app/models/description.py` | pipeline_version колонка | ✓ ВЕРИФИЦИРОВАНО | `pipeline_version: Mapped[str \| None] = mapped_column(String(50), nullable=True, index=True)` — строка 93 |
| `backend/app/models/feature_flag.py` | USE_GLINER_NER в DEFAULT_FEATURE_FLAGS | ✓ ВЕРИФИЦИРОВАНО | Все 4 NLP флага присутствуют, `len(DEFAULT_FEATURE_FLAGS) == 10` (6 старых + 4 новых) |
| `backend/tests/services/test_chapter_embedding_model.py` | class TestChapterEmbeddingModel | ✓ ВЕРИФИЦИРОВАНО | 107 строк, TestChapterEmbeddingModel + TestPipelineVersionColumn |

---

## Верификация ключевых связей

### Plan 01

| От | До | Через | Статус | Детали |
|----|-----|-------|--------|--------|
| `docker-compose.prod.yml` | `backend/Dockerfile.celery` | celery-worker build context | ✓ СВЯЗАНО | `dockerfile: Dockerfile.celery` на строке 149 |
| `docker-compose.prod.yml` | nlp_models volume | volume mount для HuggingFace cache | ✓ СВЯЗАНО | `nlp_models:/models` в celery-worker volumes; `nlp_models:` объявлен в volumes секции с `driver: local` |

### Plan 02

| От | До | Через | Статус | Детали |
|----|-----|-------|--------|--------|
| `backend/app/models/chapter_embedding.py` | `backend/app/models/__init__.py` | import и export в __all__ | ✓ СВЯЗАНО | `from .chapter_embedding import ChapterEmbedding` на строке 24; `"ChapterEmbedding"` в __all__ |
| `backend/app/models/chapter_embedding.py` | `backend/alembic/env.py` | import для Alembic autogenerate | ✓ СВЯЗАНО | `from app.models.chapter_embedding import ChapterEmbedding  # noqa: F401` на строке 30 |
| `backend/app/models/feature_flag.py` | `backend/tests/services/test_feature_flag_model.py` | тесты проверяют DEFAULT_FEATURE_FLAGS | ✓ СВЯЗАНО | `DEFAULT_FEATURE_FLAGS` импортируется и проверяется в тестах |

---

## Покрытие требований

| Требование | Исходный план | Описание | Статус | Доказательство |
|------------|--------------|----------|--------|----------------|
| INFRA-01 | 29-01 | PostgreSQL мигрирован на pgvector/pgvector:pg17 | ✓ УДОВЛЕТВОРЕНО | `image: pgvector/pgvector:0.8.2-pg17` в compose |
| INFRA-02 | 29-01 | Celery worker настроен на 4GB RAM, concurrency=1, max-tasks-per-child=0 | ✓ УДОВЛЕТВОРЕНО | memory: 4G, CMD с --concurrency=1 --max-tasks-per-child=0, без max-memory-per-child |
| INFRA-03 | 29-02 | pipeline_version добавлена в entities и descriptions | ✓ УДОВЛЕТВОРЕНО | Колонки присутствуют в обеих моделях и в Alembic-миграции. _Примечание: extraction_source из ROADMAP success criterion НЕ является частью этого требования_ |
| INFRA-04 | 29-02 | Feature flags USE_GLINER_NER, USE_DESCRIPTION_CLASSIFIER, USE_HYBRID_PIPELINE, USE_PGVECTOR_EMBEDDINGS зарегистрированы | ✓ УДОВЛЕТВОРЕНО | Все 4 флага в DEFAULT_FEATURE_FLAGS, enabled=False |
| INFRA-05 | 29-01 | Отдельный Dockerfile для Celery worker с PyTorch CPU-only | ✓ УДОВЛЕТВОРЕНО | backend/Dockerfile.celery с multi-stage build и torch==2.11.0+cpu |

**Замечание по INFRA-03 vs ROADMAP:** REQUIREMENTS.md (INFRA-03) требует только `pipeline_version`. ROADMAP Success Criterion #3 упоминает обе колонки: `extraction_source` И `pipeline_version`. Колонка `extraction_source` описана в `.planning/research/ARCHITECTURE.md` и исследовательском SUMMARY, но **не попала в PLAN**. Это расхождение между ROADMAP и PLAN. С точки зрения INFRA-03 — требование выполнено. С точки зрения ROADMAP success criterion — пробел.

---

## Обнаруженные анти-паттерны

| Файл | Строка | Паттерн | Серьёзность | Влияние |
|------|--------|---------|-------------|---------|
| — | — | Нет | — | — |

Стабов не обнаружено. Все реализации содержательны. `pipeline_version` инициализируется в `None` (корректно — это значение по умолчанию для legacy data, а не stub). `DEFAULT_FEATURE_FLAGS` содержит полные данные, а не заглушки.

---

## Требует проверки человеком

### 1. Миграция PostgreSQL через pg_dump/restore на production

**Тест:** Выполнить pg_dump на текущем postgres:17.9-alpine, сменить image на pgvector/pgvector:0.8.2-pg17, восстановить данные через pg_restore
**Ожидается:** Все существующие таблицы, данные и индексы доступны; ORDER BY на русском тексте корректен (locale=C)
**Почему требует человека:** Alpine→Debian несовместимость при простом image swap. Без реального production dump нельзя автоматически проверить сохранность данных

### 2. Старт celery-worker с реальным PyTorch CPU-only image

**Тест:** `docker compose -f docker-compose.prod.yml build celery-worker && docker compose -f docker-compose.prod.yml up celery-worker`
**Ожидается:** Worker стартует за ≤120 секунд, healthcheck проходит (`celery inspect ping` возвращает pong), потребление памяти ≤4GB при холодном старте с загрузкой PyTorch
**Почему требует человека:** Нельзя протестировать без docker build (требует скачать ~250MB PyTorch wheel) и реального запуска с 4GB memory limit

---

## Сводка по пробелам

Все пробелы закрыты. `extraction_source` добавлена после верификации (commit `feat(29): add extraction_source column`). Все 5/5 success criteria выполнены.

---

*Верифицировано: 2026-03-24T12:00:00Z*
*Верификатор: Claude (gsd-verifier)*
