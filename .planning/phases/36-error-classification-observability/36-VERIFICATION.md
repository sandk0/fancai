---
status: passed
phase: 36-error-classification-observability
requirements: [STAB-04, OBS-01, OBS-02]
verified: 2026-03-28
score: 9/9
---

# Верификация Phase 36: Error Classification & Observability

## Результат: PASSED (9/9 must-haves)

## Требования

| ID | Описание | Статус |
|----|----------|--------|
| STAB-04 | finish_reason проверка ДО json.loads(), truncated retry | ✓ Verified |
| OBS-01 | Error classification — classify_error() с 5 типами | ✓ Verified |
| OBS-02 | Structured per-chapter logging с metrics transport | ✓ Verified |

## Plan 01: Modal Metrics Transport (Wave 1)

### Must-haves verified:

1. ✓ `extract_chapter()` возвращает dict с ключами `result` и `metrics`
2. ✓ При `finish_reason='length'` result=None и truncated_text содержит первые 500 символов
3. ✓ metrics содержит cold_start_ms, inference_ms, finish_reason, is_cold_start
4. ✓ `reduce_entities()` возвращает dict с `result` и `metrics` (консистентность)
5. ✓ cold_start_ms замеряет реальное время загрузки модели в @enter

**Артефакты:**
- `modal/llm_extractor.py` — metrics transport, finish_reason check
- `backend/tests/tasks/test_modal_metrics.py` — 6 тестов, все PASSED

## Plan 02: ErrorClassifier + Structured Logging (Wave 2)

### Must-haves verified:

6. ✓ ErrorClassifier маппит FunctionTimeoutError→timeout, JSONDecodeError→json_error, RemoteError→modal_error, InputCancellation→cancelled
7. ✓ error_type сохраняется в колонку chapter.error_type при ошибке обработки
8. ✓ При truncated response выполняется 1 retry, при повторном truncated — error_type='truncated'
9. ✓ Per-chapter structured log содержит 9 полей: chapter_id, book_id, duration_ms, result_type, error_type, finish_reason, cold_start_ms, inference_ms, is_cold_start

**Артефакты:**
- `backend/app/core/error_classifier.py` — classify_error() + 5 ERROR_TYPE_* констант
- `backend/app/models/chapter.py` — error_type колонка
- `backend/alembic/versions/2026_03_28_0001_add_error_type_to_chapters.py` — migration
- `backend/app/tasks/book_tasks.py` — интеграция ErrorClassifier + structured logging + truncated retry
- `backend/app/services/modal_client.py` — extract_modal_result/metrics + backward compat
- `backend/tests/core/test_error_classifier.py` — 11 тестов
- `backend/tests/tasks/test_chapter_logging.py` — 8 тестов

## Тесты

| Suite | Тестов | Статус |
|-------|--------|--------|
| test_modal_metrics.py | 6 | ✓ PASSED |
| test_error_classifier.py | 11 | ✓ PASSED |
| test_chapter_logging.py | 8 | ✓ PASSED |
| **Итого** | **25** | **✓ ALL PASSED** |

## Регрессия

45 тестов предыдущих фаз — все прошли. 6 ошибок в test_admin_reconciliation.py — pre-existing (требуют БД).

## Key Links

| From | To | Via | Статус |
|------|----|-----|--------|
| modal/llm_extractor.py | book_tasks.py | {result, metrics} формат | ✓ |
| error_classifier.py | book_tasks.py | classify_error() в except блоках | ✓ |
| book_tasks.py | chapter.py | error_type колонка | ✓ |
| modal_client.py | book_tasks.py | extract_modal_result backward compat | ✓ |
