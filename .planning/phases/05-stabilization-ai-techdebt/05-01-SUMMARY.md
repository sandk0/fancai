---
phase: 05-stabilization-ai-techdebt
plan: 01
subsystem: ai
tags: [circuitbreaker, openrouter, prometheus, cleanup, resilience]

# Dependency graph
requires:
  - phase: 03-migration-services
    provides: openrouter_client.py с fallback chain
provides:
  - Circuit breaker для OpenRouter API (5 failures -> open, 60s recovery)
  - Prometheus-метрики состояния circuit breaker
  - Сервис полной очистки AI-данных книги перед переобработкой
  - Интеграция cleanup в reprocess endpoint
affects: [05-stabilization-ai-techdebt, deploy]

# Tech tracking
tech-stack:
  added: [circuitbreaker==2.1.3]
  patterns: [circuit-breaker-over-fallback-chain, call_async-with-opened-guard, cleanup-before-reprocess]

key-files:
  created:
    - backend/app/services/book_cleanup_service.py
    - backend/tests/core/test_circuit_breaker.py
    - backend/tests/services/test_book_cleanup.py
  modified:
    - backend/app/core/openrouter_client.py
    - backend/app/monitoring/metrics.py
    - backend/app/routers/books/crud.py
    - backend/requirements.txt

key-decisions:
  - "Circuit breaker через call_async() с предварительной проверкой opened (а не декоратор) -- позволяет использовать один CB для метода класса"
  - "CB оборачивает единый HTTP-вызов; retry и fallback chain работают над CB -- при open state ошибка сразу пробрасывается"
  - "cleanup_book_data() использует flush() а не commit() -- транзакция управляется вызывающим кодом в crud.py"
  - "Библиотека circuitbreaker использует monotonic clock -- тесты используют monotonic() для управления _opened"

patterns-established:
  - "Circuit breaker pattern: openrouter_breaker.opened проверяется перед call_async() для блокировки при open state"
  - "Book cleanup pattern: cleanup_book_data() для полного сброса AI-данных перед переобработкой"

requirements-completed: [AI-02, UX-06]

# Metrics
duration: 10min
completed: 2026-03-04
---

# Phase 5 Plan 01: Circuit breaker для OpenRouter API и очистка данных книги Summary

**Circuit breaker (circuitbreaker==2.1.3) защищает все 3 метода OpenRouter клиента с Prometheus-метриками + сервис полной очистки AI-данных книги при переобработке**

## Performance

- **Duration:** 10 мин
- **Started:** 2026-03-04T20:26:41Z
- **Completed:** 2026-03-04T20:36:39Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Circuit breaker интегрирован в openrouter_client.py: generate_text, generate_structured, generate_image защищены единым CB
- Prometheus Gauge circuit_breaker_state (0=closed, 1=half-open, 2=open) и circuit_breaker_failure_count обновляются при каждом переходе
- book_cleanup_service.py: полная очистка descriptions, entities (CASCADE), файлов аватарок/изображений, сброс флагов chapters и book
- Закомментированный TODO в reprocess endpoint заменён на вызов cleanup_book_data()
- 13 тестов пройдено: 7 circuit breaker + 6 book cleanup

## Task Commits

Each task was committed atomically (TDD: RED -> GREEN):

1. **Task 1: Circuit breaker для OpenRouter API + Prometheus-метрики**
   - `6858013` (test: failing tests for circuit breaker -- RED)
   - `21d8dcc` (feat: circuit breaker integration with Prometheus metrics -- GREEN)

2. **Task 2: Сервис очистки данных книги + интеграция в reprocess endpoint**
   - `51d01f8` (test: failing tests for book cleanup service -- RED)
   - `0b2fd53` (feat: book cleanup service and reprocess integration -- GREEN)

## Files Created/Modified
- `backend/app/core/openrouter_client.py` -- CB интеграция через _post_with_breaker(), экспорт CircuitBreakerError и openrouter_breaker
- `backend/app/monitoring/metrics.py` -- circuit_breaker_state и circuit_breaker_failure_count Gauge
- `backend/app/services/book_cleanup_service.py` -- cleanup_book_data() для полной очистки AI-данных книги
- `backend/app/routers/books/crud.py` -- вызов cleanup_book_data() в reprocess endpoint
- `backend/requirements.txt` -- circuitbreaker==2.1.3
- `backend/tests/core/test_circuit_breaker.py` -- 7 тестов CB
- `backend/tests/services/test_book_cleanup.py` -- 6 тестов cleanup

## Decisions Made
- Использование call_async() вместо декоратора @openrouter_breaker: декоратор не работает с методами класса (self не передаётся). Вместо этого проверяем opened перед call_async() -- аналогичное поведение
- Библиотека circuitbreaker 2.1.3 использует monotonic() для внутреннего таймера -- тесты half-open используют monotonic() для корректного управления _opened
- cleanup_book_data() не вызывает commit() -- транзакция управляется endpoint для атомарности с последующим обновлением book.is_processing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Исправлена интеграция call_async с CB**
- **Found during:** Task 1 (Circuit breaker integration)
- **Issue:** circuitbreaker.call_async() не проверяет opened state перед вызовом (в отличие от декоратора) -- CircuitBreakerError никогда не выбрасывалась
- **Fix:** Добавлена предварительная проверка openrouter_breaker.opened перед call_async() в _post_with_breaker()
- **Files modified:** backend/app/core/openrouter_client.py
- **Verification:** test_cb_opens_after_5_timeouts и test_generate_image_protected_by_cb проходят
- **Committed in:** 21d8dcc

**2. [Rule 3 - Blocking] Исправлен monotonic clock в тестах**
- **Found during:** Task 1 (Circuit breaker tests)
- **Issue:** Тесты half-open использовали time.time() для _opened, но библиотека использует monotonic() -- разница ~1.77 млрд секунд
- **Fix:** Заменён time.time() на monotonic() в тестах
- **Files modified:** backend/tests/core/test_circuit_breaker.py
- **Verification:** test_cb_half_open_after_recovery_timeout проходит
- **Committed in:** 21d8dcc

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Оба исправления необходимы для корректной работы circuit breaker. Без них CB никогда не блокировал бы запросы и half-open тесты не проходили. Scope не расширялся.

## Issues Encountered
None -- план выполнен без неожиданных проблем (кроме описанных выше девиаций).

## User Setup Required
None -- не требуется ручная настройка. circuitbreaker==2.1.3 будет установлен при следующем `pip install -r requirements.txt` или `docker compose build`.

## Next Phase Readiness
- Circuit breaker и book cleanup готовы к production deploy
- Plan 05-02 может быть начат (бэкап БД, очистка остаточного техдолга)
- При deploy: circuitbreaker==2.1.3 автоматически установится из requirements.txt

## Self-Check: PASSED

- All 7 created/modified files verified on disk
- All 4 commits (6858013, 21d8dcc, 51d01f8, 0b2fd53) verified in git log
- 13 tests pass (7 circuit breaker + 6 book cleanup)
- Import checks pass (CircuitBreakerError, openrouter_breaker, cleanup_book_data)

---
*Phase: 05-stabilization-ai-techdebt*
*Completed: 2026-03-04*
