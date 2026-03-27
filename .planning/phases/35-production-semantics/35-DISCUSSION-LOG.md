# Phase 35: Стабилизация production semantics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 35-production-semantics
**Areas discussed:** Семантика статусов, Reconciliation подход, Timeout архитектура, num_gpu_blocks profiling

---

## Семантика статусов

### Когда descriptions_extracted = True?

| Option | Description | Selected |
|--------|-------------|----------|
| Только 0 failed | descriptions_extracted=True только при 100% успешных глав | ✓ |
| Порог >80% | True если >80% глав успешны, пользователь получает частичный результат | |
| Два поля | Новое поле descriptions_status (none/partial/complete) + Alembic миграция | |

**User's choice:** Только 0 failed
**Notes:** Чёткая семантика, совпадает с рекомендацией аудита

### Push notification при partial success?

| Option | Description | Selected |
|--------|-------------|----------|
| Не отправлять | Push только при полном успехе | ✓ |
| Отправлять с предупреждением | Разные сообщения для success vs partial | |

**User's choice:** Не отправлять
**Notes:** Пользователь увидит статус при следующем визите

### WebSocket при partial failure?

| Option | Description | Selected |
|--------|-------------|----------|
| completed_with_errors | status: 'completed_with_errors' + chapters_failed + failed_chapter_numbers | ✓ |
| completed + error field | status: 'completed' с дополнительным has_errors: true | |
| failed | status: 'failed' при любых сбоях | |

**User's choice:** completed_with_errors
**Notes:** Frontend сможет показать информацию о сбоях

---

## Reconciliation подход

### Как найти и починить existing книги?

| Option | Description | Selected |
|--------|-------------|----------|
| Admin endpoint | POST /admin/reconcile-statuses — находит inconsistent, фиксит, возвращает отчёт | ✓ |
| Alembic data migration | UPDATE в миграции, одноразово при deploy | |
| CLI скрипт | python -m scripts.reconcile_book_statuses | |

**User's choice:** Admin endpoint
**Notes:** Можно перезапускать после каждого деплоя

### Что делать с найденными книгами?

| Option | Description | Selected |
|--------|-------------|----------|
| Пометить для переобработки | descriptions_extracted=False, error='Требуется переобработка' | ✓ |
| Авто-requeue | Сразу отправить в Celery на переобработку | |
| Только отчёт | Вернуть список, админ решает вручную | |

**User's choice:** Пометить для переобработки
**Notes:** Пользователь может запустить reprocess через UI

---

## Timeout архитектура

### Где разместить VPS-side timeout?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-chapter wrapper | asyncio.wait_for() вокруг каждого Modal вызова | ✓ |
| Per-book budget | Общий бюджет на всю книгу через Celery soft_time_limit | |
| Оба уровня | Per-chapter + per-book budget check | |

**User's choice:** Per-chapter wrapper
**Notes:** Гранулярно — зависшая глава не блокирует остальные

### Значение LLM_TIMEOUT?

| Option | Description | Selected |
|--------|-------------|----------|
| 900s (15 min) | Из аудита, VPS-side = 960s | ✓ |
| 600s (оставить) | Текущее значение | |
| Ты решаешь | Claude определит по профилированию | |

**User's choice:** 900s
**Notes:** Достаточно для длинных глав

### Per-book budget check?

| Option | Description | Selected |
|--------|-------------|----------|
| Да, budget check | Перед каждой главой проверять остаток до hard limit | ✓ |
| Нет | Достаточно per-chapter timeout | |

**User's choice:** Да, budget check
**Notes:** Предотвращает превышение Celery hard limit

---

## num_gpu_blocks profiling

### Подход к num_gpu_blocks_override?

| Option | Description | Selected |
|--------|-------------|----------|
| 512 + production мониторинг | Старт с 512, логировать memory usage, корректировать | ✓ |
| Без override, ждать fix | Не трогать, ждать vLLM 0.19.x | |
| A/B на staging | 256 vs 512 vs 1024 на staging с 3 книгами | |

**User's choice:** 512 + production мониторинг
**Notes:** Быстро в production, корректировка по данным

---

## Claude's Discretion

- Конкретная реализация per-book budget check
- Формат structured log для timeout/failure events
- Организация кода: helper vs inline
- Порядок задач в планах
- maxLength значения (утверждены из таблицы аудита)

## Deferred Ideas

Нет — обсуждение осталось в рамках Phase 35.
