---
phase: 35-production-semantics
plan: 02
subsystem: tasks
tags: [celery, asyncio, websocket, timeout, status-semantics]

requires:
  - phase: 35-production-semantics
    provides: "CONTEXT.md с решениями D-01..D-16, RESEARCH.md с паттернами реализации"
provides:
  - "_finalize_book_status() helper — корректные статусы книг на основе failed chapters"
  - "pubsub **kwargs — расширяемый WebSocket message format"
  - "VPS-side timeout (asyncio.wait_for) — защита от зависания Modal"
  - "Per-book time budget check — предотвращение превышения Celery hard limit"
affects: [35-production-semantics, frontend-websocket-handler]

tech-stack:
  added: []
  patterns:
    - "asyncio.wait_for wrapper для Modal remote calls"
    - "check_time_budget() перед каждой chapter extraction"
    - "_finalize_book_status() extracted helper для тестируемой status logic"

key-files:
  created:
    - "backend/tests/tasks/test_book_status_semantics.py"
    - "backend/tests/tasks/test_modal_timeout.py"
    - "backend/tests/tasks/test_time_budget.py"
  modified:
    - "backend/app/tasks/book_tasks.py"
    - "backend/app/core/pubsub.py"

key-decisions:
  - "Extract _finalize_book_status() — вынести status logic из _process_book_async для изолированного тестирования"
  - "check_time_budget() как standalone function — тестируемо без mock всего pipeline"
  - "VPS_TIMEOUT=960 как локальная константа — не импортируется из modal/config.py (разные сервисы)"
  - "pubsub **kwargs вместо hardcoded params — обратная совместимость + расширяемость"

patterns-established:
  - "_finalize_book_status pattern: query -> set status -> WebSocket -> push notification (D-01..D-04)"
  - "Time budget check: time.monotonic() closure + CELERY_HARD_LIMIT - elapsed - SAFETY_MARGIN"

requirements-completed: [STAB-01, STAB-05, STAB-06]

duration: 12min
completed: 2026-03-28
---

# Phase 35 Plan 02: Семантика статусов книги Summary

**Корректные статусы книг (descriptions_extracted=False при failures), VPS-side asyncio.wait_for timeout (960s), per-book time budget check перед каждой главой**

## Производительность

- **Длительность:** 12 мин
- **Начало:** 2026-03-27T21:56:21Z
- **Завершение:** 2026-03-28T22:08:00Z
- **Задачи:** 2/2
- **Файлы изменены:** 5

## Результаты

- Failed chapters check перемещён ПЕРЕД установкой descriptions_extracted (был баг: строка 918 ставила True безусловно)
- WebSocket публикует `completed_with_errors` с `chapters_failed` count и `failed_chapter_numbers` array
- Push notification отправляется только при полном успехе (0 failed chapters)
- Modal вызовы обёрнуты в `asyncio.wait_for(timeout=960)` — event loop не блокируется при зависании Modal
- Per-book time budget check пропускает главы при remaining < VPS_TIMEOUT
- 14 новых тестов покрывают все сценарии

## Коммиты задач

Каждая задача зафиксирована атомарно (TDD: RED -> GREEN):

1. **Task 1 RED: Тесты статусов** - `c79a18d` (test)
2. **Task 1 GREEN: Реорганизация порядка операций** - `4b901b3` (feat)
3. **Task 2 RED: Тесты timeout/budget** - `0f297a4` (test)
4. **Task 2 GREEN: VPS timeout + time budget** - `cfd7f0c` (feat)

## Созданные/изменённые файлы

- `backend/app/tasks/book_tasks.py` — _finalize_book_status(), check_time_budget(), VPS_TIMEOUT/CELERY_HARD_LIMIT/SAFETY_MARGIN constants, asyncio.wait_for wrapper
- `backend/app/core/pubsub.py` — **kwargs в publish_book_progress, data.update(kwargs)
- `backend/tests/tasks/test_book_status_semantics.py` — 7 тестов: extracted flag, error message, WebSocket status, push notification guard, pubsub kwargs
- `backend/tests/tasks/test_modal_timeout.py` — 3 теста: VPS_TIMEOUT constant, timeout pattern, spec match
- `backend/tests/tasks/test_time_budget.py` — 4 теста: budget exhausted, sufficient, boundary, safety margin

## Принятые решения

- `_finalize_book_status()` выделена как helper — тестирование без mock всего pipeline
- `check_time_budget()` как standalone function с closure на task_start_time
- VPS_TIMEOUT=960 — локальная константа (LLM_TIMEOUT=900 + 60s buffer), не импорт из modal
- pubsub **kwargs — обратная совместимость, любые новые поля передаются в WebSocket без изменения сигнатуры

## Отклонения от плана

Нет — план выполнен точно как написано.

## Обнаруженные проблемы

- Worktree не имеет Python venv — тесты запускались через venv основного репозитория. Не влияет на результат.
- test_reading_sessions_tasks.py имеет pre-existing socket.gaierror (Redis connection) — не связано с нашими изменениями.

## Конфигурация пользователя

Не требуется — все изменения в существующих файлах.

## Известные стабы

Нет — все data flows полностью подключены.

## Готовность к следующему плану

- Status semantics (STAB-01) полностью реализованы
- VPS-side timeout (STAB-05) защищает от зависания Modal
- Time budget check (STAB-06) предотвращает превышение Celery hard limit
- Frontend может обрабатывать `completed_with_errors` WebSocket status (в scope другого плана если нужно)

## Self-Check: PASSED

- 5/5 files found
- 4/4 commits found
- 14/14 tests pass

---
*Phase: 35-production-semantics*
*Completed: 2026-03-28*
