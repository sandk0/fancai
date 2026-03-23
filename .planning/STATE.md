---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Оптимизация обработки книг
status: planning
last_updated: "2026-03-23T23:05:03.106Z"
last_activity: 2026-03-23
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 2
  completed_plans: 0
  percent: 0
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-03-24)

**Ключевая ценность:** AI-ридер с интерактивной Entity Wiki — загрузка книги, чтение, AI-глоссарий без спойлеров, иллюстрации, заметки
**Текущий фокус:** Phase 29 — Docker и DB инфраструктура (pgvector migration, Celery limits, feature flags)

## Текущая позиция

Phase: 29 of 34 (Docker и DB инфраструктура) — 1 of 6 in milestone v1.4
Plan: —
Status: Ready to plan
Last activity: 2026-03-23

Progress: [░░░░░░░░░░] 0%

## Метрики производительности

**Общая статистика:**

| Milestone | Фазы | Планы | Время  | Среднее/план |
| --------- | ---- | ----- | ------ | ------------ |
| v1.0      | 9    | 23    | 9 дней | —            |
| v1.1      | 6    | 13    | 92 min | 7 min        |
| v1.2      | 8    | 21    | 4 дня  | —            |
| v1.3      | 10   | 14    | 9 дней | —            |
| v1.4      | 6    | —     | —      | —            |

## Накопленный контекст

### Решения

Полная таблица решений: .planning/PROJECT.md

- v1.4: pg_dump/restore для миграции PG (не image swap — Alpine/Debian несовместимы)
- v1.4: Celery concurrency=1, max-tasks-per-child=0 (lazy singleton для NLP моделей)
- v1.4: Отдельный Dockerfile.celery с PyTorch CPU-only (250MB vs 2.5GB CUDA)
- v1.4: GLiNER2 F1=0.564 на Literature — сопоставим с GPT-4o (0.561)
- v1.4: Leave-one-book-out CV обязателен для classifier (random split дает data leakage)
- v1.4: DeepSeek V3.2 ($0.26/$0.38) как primary synthesis model

### Ожидающие задачи

Нет.

### Блокеры/Опасения

- NER: GLiNER2 latency на production EPYC 9645 — теоретическая оценка 100-200ms/chunk, нужен бенчмарк
- Classifier: TF-IDF F1 0.65-0.80 — диапазон оценочный, реальное значение через LOO CV
- DeepSeek V3.2: качество synthesis на русской fiction неизвестно — mitigation через Pydantic validation + tenacity + fallback

## Непрерывность сессий

Последняя сессия: 2026-03-24
Остановились на: Roadmap v1.4 создана, ready to plan Phase 29
Resume file: .planning/phases/29-docker-db/29-CONTEXT.md
