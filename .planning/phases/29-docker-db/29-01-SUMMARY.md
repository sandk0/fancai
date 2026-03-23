---
phase: 29-docker-db
plan: 01
subsystem: infra
tags: [docker, pytorch, pgvector, celery, nlp, huggingface]

requires:
  - phase: none
    provides: "Первый план milestone v1.4 — нет зависимостей"
provides:
  - "backend/Dockerfile.celery — multi-stage Docker image для Celery worker с PyTorch CPU-only и NLP зависимостями"
  - "docker-compose.prod.yml — pgvector PostgreSQL image, выделенный NLP Celery worker, nlp_models volume"
affects: [30-ner-gliner, 31-description-classifier, 32-pgvector-embeddings]

tech-stack:
  added: [PyTorch CPU-only 2.11.0, GLiNER2 1.2.4, sentence-transformers 5.3.0, scikit-learn 1.8.0, pgvector 0.4.2, pgvector/pgvector:0.8.2-pg17]
  patterns: [separate Dockerfile per service role, CMD as single source of truth (no compose command override), persistent HuggingFace cache via named volume]

key-files:
  created: [backend/Dockerfile.celery]
  modified: [docker-compose.prod.yml]

key-decisions:
  - "Отдельный Dockerfile.celery вместо расширения Dockerfile.prod — API image остаётся ~600MB"
  - "CMD в Dockerfile как единственный источник истины — command в compose удалён для celery-worker"
  - "max-tasks-per-child=0 — NLP модели персистентны в памяти, worker не перезапускается"
  - "pgvector/pgvector:0.8.2-pg17 вместо postgres:17.9-alpine — нативная поддержка vector extension"

patterns-established:
  - "Separate Dockerfile per service role: Dockerfile.prod (API), Dockerfile.celery (NLP worker)"
  - "Named volume nlp_models для persistent HuggingFace model cache между перезапусками"
  - "HF_HOME=/models — стандартный путь для HuggingFace cache в контейнере"

requirements-completed: [INFRA-01, INFRA-02, INFRA-05]

duration: 5min
completed: 2026-03-24
---

# Phase 29 Plan 01: Docker и DB инфраструктура — Summary

**Multi-stage Dockerfile.celery с PyTorch CPU-only + GLiNER2/sentence-transformers, PostgreSQL на pgvector:pg17, Celery worker 4GB/4CPU с persistent nlp_models volume**

## Производительность

- **Длительность:** ~5 мин
- **Начало:** 2026-03-23T23:05:52Z
- **Завершение:** 2026-03-23T23:11:16Z
- **Задачи:** 2/2
- **Файлы изменены:** 2

## Результаты

- Создан `backend/Dockerfile.celery` — multi-stage build с PyTorch CPU-only (~250MB wheel), GLiNER2, sentence-transformers, scikit-learn, pgvector
- PostgreSQL переведён на `pgvector/pgvector:0.8.2-pg17` для нативной поддержки vector extension
- Celery worker выделен в отдельный image `fancai-celery:latest` с 4GB RAM / 4 CPU, concurrency=1, persistent NLP models
- Named volume `nlp_models` для HuggingFace model cache — модели загружаются один раз, переживают перезапуски

## Коммиты задач

Каждая задача закоммичена атомарно:

1. **Task 1: Создать backend/Dockerfile.celery с PyTorch CPU-only** — `cbc2039` (feat)
2. **Task 2: Обновить docker-compose.prod.yml — pgvector, Celery build, nlp_models volume** — `e05c317` (feat)

## Созданные/изменённые файлы

- `backend/Dockerfile.celery` — Multi-stage Dockerfile для Celery worker с PyTorch CPU-only, GLiNER2, sentence-transformers
- `docker-compose.prod.yml` — pgvector image для PostgreSQL, выделенный Celery NLP worker, nlp_models volume

## Принятые решения

- Отдельный Dockerfile.celery — API image остаётся лёгким (~600MB), NLP image ~2.5GB
- CMD в Dockerfile как единый источник истины — `command:` удалён из compose для celery-worker (ловушка 3 из RESEARCH.md)
- `max-tasks-per-child=0` — NLP модели загружаются в память один раз, worker живёт вечно
- `start-period=120s` для healthcheck — NLP модели грузятся 30-90с при холодном старте
- Без `max-memory-per-child` — NLP worker легитимно использует 2-3GB, ограничение убьёт его
- celery-beat оставлен на `fancai-backend:latest` — ему не нужен PyTorch

## Отклонения от плана

Нет — план выполнен точно по спецификации.

## Обнаруженные проблемы

Нет.

## Настройка пользователем

Нет — внешняя конфигурация не требуется.

## Готовность к следующей фазе

- Docker-инфраструктура готова для Phase 30 (GLiNER2 NER) — Celery worker с PyTorch и NLP зависимостями
- PostgreSQL готов для Phase 32 (pgvector embeddings) — pgvector extension доступен
- **Важно:** при первом деплое необходим pg_dump/restore (Alpine -> Debian несовместимость, см. 29-02-PLAN)

## Self-Check: PASSED

- backend/Dockerfile.celery: FOUND
- docker-compose.prod.yml: MODIFIED
- Commit cbc2039: FOUND
- Commit e05c317: FOUND

---
*Phase: 29-docker-db*
*Completed: 2026-03-24*
