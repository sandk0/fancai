---
phase: 29-docker-db
plan: 02
subsystem: database
tags: [pgvector, sqlalchemy, alembic, feature-flags, embeddings, hnsw]

requires:
  - phase: 29-docker-db/01
    provides: Docker-инфраструктура с pgvector/pgvector:pg17

provides:
  - Колонка pipeline_version в Entity и Description для A/B трекинга pipeline
  - Модель ChapterEmbedding с vector(384) и HNSW индексом для vector search
  - 4 NLP feature flags для поэтапного rollout гибридного pipeline
  - Alembic-миграция для всех schema-изменений
  - pgvector==0.4.2 в requirements.txt

affects: [30-gliner-ner, 31-description-classifier, 32-pgvector-embeddings, 33-synthesis-pipeline, 34-rollout]

tech-stack:
  added: [pgvector==0.4.2, numpy==2.4.3]
  patterns: [pipeline_version для version-tracking entities/descriptions, HNSW индекс для cosine similarity]

key-files:
  created:
    - backend/app/models/chapter_embedding.py
    - backend/tests/services/test_chapter_embedding_model.py
    - backend/alembic/versions/2026_03_24_0001_add_hybrid_pipeline_schema.py
  modified:
    - backend/app/models/entity.py
    - backend/app/models/description.py
    - backend/app/models/__init__.py
    - backend/app/models/feature_flag.py
    - backend/alembic/env.py
    - backend/requirements.txt
    - backend/tests/services/test_feature_flag_model.py

key-decisions:
  - "Ручная Alembic-миграция вместо autogenerate (нет локальной production DB)"
  - "pgvector в shared requirements.txt (не только Dockerfile.celery) для Alembic и API"
  - "Все 4 NLP флага disabled по умолчанию — включение через admin/API при rollout"

patterns-established:
  - "pipeline_version: null=legacy, 'hybrid_v1'=новый pipeline — для A/B сравнения"
  - "Feature flag category 'nlp' для всех pipeline-related флагов"
  - "HNSW индекс с m=16, ef_construction=64 для vector search"

requirements-completed: [INFRA-03, INFRA-04]

duration: 10min
completed: 2026-03-24
---

# Phase 29 Plan 02: Hybrid Pipeline Schema Summary

**pipeline_version в Entity/Description, ChapterEmbedding с vector(384)/HNSW, 4 NLP feature flags, Alembic-миграция**

## Производительность

- **Длительность:** 10 мин
- **Начало:** 2026-03-23T23:05:55Z
- **Завершение:** 2026-03-23T23:16:03Z
- **Задачи:** 3
- **Файлов изменено:** 10

## Достижения

- pipeline_version (String(50), nullable, indexed) добавлен в Entity и Description для version-трекинга
- ChapterEmbedding модель создана с vector(384), HNSW индексом, FK на chapters.id, unique constraint
- 4 NLP feature flags (USE_GLINER_NER, USE_DESCRIPTION_CLASSIFIER, USE_HYBRID_PIPELINE, USE_PGVECTOR_EMBEDDINGS) добавлены в DEFAULT_FEATURE_FLAGS
- Alembic-миграция с pgvector extension, columns, table, indexes и rollback support
- 36 тестов проходят (10 новых + 26 обновленных)

## Коммиты по задачам

1. **Task 1: Модели + imports + requirements** - `b7fad18` (feat)
2. **Task 2: Alembic-миграция** - `b4d61bd` (feat)
3. **Task 3: Тесты ChapterEmbedding + feature flags** - `dc9037b` (test)

## Созданные/измененные файлы

- `backend/app/models/chapter_embedding.py` - Новая модель ChapterEmbedding с vector(384) и HNSW индексом
- `backend/app/models/entity.py` - Добавлена колонка pipeline_version
- `backend/app/models/description.py` - Добавлена колонка pipeline_version
- `backend/app/models/__init__.py` - Import и __all__ для ChapterEmbedding
- `backend/app/models/feature_flag.py` - 4 NLP feature flags в DEFAULT_FEATURE_FLAGS
- `backend/alembic/env.py` - Import ChapterEmbedding для autogenerate
- `backend/requirements.txt` - pgvector==0.4.2
- `backend/alembic/versions/2026_03_24_0001_add_hybrid_pipeline_schema.py` - Миграция
- `backend/tests/services/test_chapter_embedding_model.py` - 10 тестов
- `backend/tests/services/test_feature_flag_model.py` - Обновлены count/names/categories + 4 новых теста

## Принятые решения

- Ручная Alembic-миграция вместо autogenerate — нет локальной production DB, миграция выполнится на production при deploy
- pgvector добавлен в shared requirements.txt — нужен и для Alembic autogenerate, и для API-модели Vector type
- Все 4 NLP флага disabled по умолчанию — безопасный rollout через feature flag manager

## Отклонения от плана

Нет — план выполнен точно по описанию.

## Встреченные проблемы

- pgvector не был установлен локально — установлен через `uv pip install pgvector==0.4.2` (numpy как зависимость)
- Settings validation блокировала import-проверку без .env — использован DEBUG=true для обхода production validation

## Настройка пользователем

Не требуется — schema-изменения и feature flags применяются автоматически при deploy.

## Готовность к следующей фазе

- Schema для hybrid pipeline готова: pipeline_version трекинг, vector embeddings, feature flags
- Миграция создана и готова к выполнению на production (alembic upgrade head)
- Phase 30 (GLiNER NER) может использовать USE_GLINER_NER flag и pipeline_version='hybrid_v1'
- Phase 32 (pgvector embeddings) может использовать ChapterEmbedding модель и USE_PGVECTOR_EMBEDDINGS flag

## Известные стабы

Нет — все модели полностью реализованы, данные не hardcoded.

---
*Phase: 29-docker-db*
*Completed: 2026-03-24*
