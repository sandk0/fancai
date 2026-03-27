---
phase: 36-error-classification-observability
plan: 02
subsystem: ai-pipeline
tags: [error-classification, structured-logging, observability, modal, truncated-retry]

requires:
  - phase: 36-error-classification-observability
    provides: "Modal metrics transport: {result, metrics} формат из Plan 01"
  - phase: 35-production-semantics-stability
    provides: "_finalize_book_status, check_time_budget, VPS_TIMEOUT"
provides:
  - "classify_error() для 5 типов pipeline-ошибок (timeout, json_error, modal_error, cancelled, truncated)"
  - "chapter.error_type колонка + Alembic migration"
  - "Per-chapter structured log с 9 полями через logger.bind()"
  - "Truncated response retry с error_type='truncated' при двойном отказе"
  - "extract_modal_result() и extract_modal_metrics() для backward-compatible парсинга"
affects: [37-retry-strategies, 38-cold-start-optimization, dashboard, alerting]

tech-stack:
  added: []
  patterns:
    - "ErrorClassifier: type(exc).__name__ для Modal SDK exceptions (без import)"
    - "Structured logging: logger.bind() с 9 полями -> .info('chapter_processed')"
    - "Backward-compatible response parsing: extract_modal_result() проверяет 'result' key"
    - "Truncated retry: 1 retry при finish_reason=length, error_type=truncated при повторном отказе"

key-files:
  created:
    - backend/app/core/error_classifier.py
    - backend/tests/core/test_error_classifier.py
    - backend/tests/tasks/test_chapter_logging.py
    - backend/alembic/versions/2026_03_28_0001_add_error_type_to_chapters.py
  modified:
    - backend/app/models/chapter.py
    - backend/app/tasks/book_tasks.py
    - backend/app/services/modal_client.py

key-decisions:
  - "type(exc).__name__ вместо isinstance для Modal SDK exceptions -- Modal не установлен на VPS"
  - "error_type String(20) nullable -- PG17 metadata-only ADD COLUMN (instant, без table rewrite)"
  - "Fallback modal_error для неизвестных exceptions -- лучше классифицировать неточно чем потерять"
  - "Best-effort error_type save в BaseException блоке -- emergency_session для обхода broken session"
  - "extract_modal_result() проверяет 'result' key первым, fallback на весь dict -- backward compat"

patterns-established:
  - "ErrorClassifier constants как единый источник правды для error_type значений (Phase 36-38)"
  - "Structured chapter log: logger.bind(9 fields).info('chapter_processed') -- parseable JSON в production"
  - "Modal response extraction: всегда через extract_modal_result() для forward/backward compat"

requirements-completed: [STAB-04, OBS-01, OBS-02]

duration: 10min
completed: 2026-03-28
---

# Phase 36 Plan 02: ErrorClassifier + Structured Logging Summary

**classify_error() для 5 типов pipeline-ошибок, chapter.error_type колонка, structured logging с 9 полями, truncated retry**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-27T23:10:12Z
- **Completed:** 2026-03-27T23:21:11Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 7

## Accomplishments

- ErrorClassifier модуль с 5 типами ошибок: timeout, json_error, modal_error, cancelled, truncated
- Chapter.error_type колонка + Alembic migration (PG17 metadata-only, instant)
- classify_error() интегрирован в оба except блока chapter processing loop (Exception + BaseException)
- Per-chapter structured log: 9 полей (chapter_id, book_id, duration_ms, result_type, error_type, finish_reason, cold_start_ms, inference_ms, is_cold_start)
- Truncated response handling: 1 retry при finish_reason=length, error_type='truncated' при повторном отказе
- extract_modal_result() и extract_modal_metrics() для backward-compatible парсинга Modal response
- 27 новых тестов: 11 error_classifier + 8 chapter_logging + 8 modal_client (все существующие тесты проходят)

## Task Commits

1. **Task 1: ErrorClassifier модуль + тесты + Alembic migration + Chapter model** - `8e1e677` (feat)
2. **Task 2: Интеграция в book_tasks.py + structured logging + truncated retry + modal_client** - `7b62f96` (feat)

## Files Created/Modified

- `backend/app/core/error_classifier.py` -- classify_error() и ERROR_TYPE_* константы
- `backend/tests/core/test_error_classifier.py` -- 11 тестов маппинга ошибок
- `backend/app/models/chapter.py` -- error_type: Mapped[str | None] колонка
- `backend/alembic/versions/2026_03_28_0001_add_error_type_to_chapters.py` -- Alembic migration
- `backend/app/tasks/book_tasks.py` -- ErrorClassifier + _log_chapter_result + truncated retry
- `backend/app/services/modal_client.py` -- extract_modal_result/metrics + обновлённый modal_response_to_chapter_result
- `backend/tests/tasks/test_chapter_logging.py` -- 8 тестов structured logging и modal_client

## Decisions Made

- `type(exc).__name__` для Modal SDK exceptions вместо isinstance -- Modal SDK не установлен на VPS, import вызовет ImportError
- error_type как String(20) nullable без default -- PG17 metadata-only ADD COLUMN (мгновенное добавление, без перезаписи таблицы)
- Fallback `modal_error` для неизвестных exceptions -- лучше иметь неточную классификацию чем null
- Best-effort error_type save через emergency_session в BaseException -- основная session может быть broken
- extract_modal_result() проверяет `result` key первым, если None -- fallback на весь dict для backward compatibility

## Deviations from Plan

None -- план выполнен точно по спецификации.

## Issues Encountered

None.

## User Setup Required

None -- изменения не требуют конфигурации внешних сервисов. Alembic migration запускается при деплое.

## Next Phase Readiness

- Error classification готова для retry-стратегий Phase 37 (error_type определяет retryable vs non-retryable)
- Structured logging готов для alerting/dashboard Phase 38 (9 полей в JSON формате)
- Все контракты стабильны: 27 тестов фиксируют ожидаемое поведение
- Phase 36 полностью завершена (Plan 01 + Plan 02)

---
*Phase: 36-error-classification-observability*
*Completed: 2026-03-28*
