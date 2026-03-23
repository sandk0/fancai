---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Оптимизация обработки книг
status: executing
last_updated: "2026-03-23T23:16:03Z"
last_activity: 2026-03-24
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 2
  completed_plans: 1
  percent: 50
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-03-24)

**Ключевая ценность:** AI-ридер с интерактивной Entity Wiki — загрузка книги, чтение, AI-глоссарий без спойлеров, иллюстрации, заметки
**Текущий фокус:** Phase 29 — Docker и DB инфраструктура (Plan 02 завершен: hybrid pipeline schema)

## Текущая позиция

Phase: 29 of 34 (Docker и DB инфраструктура) — 1 of 6 in milestone v1.4
Plan: 02 of 02 (Plan 02 завершен)
Status: Plan 02 завершен — hybrid pipeline schema, feature flags, тесты
Last activity: 2026-03-24 — Plan 02 завершен (10 мин)

Progress: [█████░░░░░] 50%

## Метрики производительности

**Общая статистика:**

| Milestone | Фазы | Планы | Время  | Среднее/план |
| --------- | ---- | ----- | ------ | ------------ |
| v1.0      | 9    | 23    | 9 дней | —            |
| v1.1      | 6    | 13    | 92 min | 7 min        |
| v1.2      | 8    | 21    | 4 дня  | —            |
| v1.3      | 10   | 14    | 9 дней | —            |
| v1.4      | 6    | —     | —      | —            |

| Phase | Plan | Длительность | Задач | Файлов |
| ----- | ---- | ------------ | ----- | ------ |
| 29    | 02   | 10 мин       | 3     | 10     |

## Накопленный контекст

### Решения

Полная таблица решений: .planning/PROJECT.md

- v1.4: pg_dump/restore для миграции PG (не image swap — Alpine/Debian несовместимы)
- v1.4: Celery concurrency=1, max-tasks-per-child=0 (lazy singleton для NLP моделей)
- v1.4: Отдельный Dockerfile.celery с PyTorch CPU-only (250MB vs 2.5GB CUDA)
- v1.4: GLiNER2 F1=0.564 на Literature — сопоставим с GPT-4o (0.561)
- v1.4: Leave-one-book-out CV обязателен для classifier (random split дает data leakage)
- v1.4: DeepSeek V3.2 ($0.26/$0.38) как primary synthesis model
- 29-02: Ручная Alembic-миграция вместо autogenerate (нет локальной production DB)
- 29-02: pgvector в shared requirements.txt для Alembic и API
- 29-02: Все 4 NLP флага disabled по умолчанию для безопасного rollout

### Ожидающие задачи

Нет.

### Блокеры/Опасения

- NER: GLiNER2 latency на production EPYC 9645 — теоретическая оценка 100-200ms/chunk, нужен бенчмарк
- Classifier: TF-IDF F1 0.65-0.80 — диапазон оценочный, реальное значение через LOO CV
- DeepSeek V3.2: качество synthesis на русской fiction неизвестно — mitigation через Pydantic validation + tenacity + fallback

## Непрерывность сессий

Последняя сессия: 2026-03-24
Остановились на: Phase 29 Plan 02 завершен (hybrid pipeline schema)
Resume file: .planning/phases/29-docker-db/29-02-SUMMARY.md
