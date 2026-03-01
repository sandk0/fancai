---
phase: 02-dead-code-cleanup
plan: 02
subsystem: api
tags: [python, fastapi, pydantic, typescript, react, schemas, refactoring]

requires:
  - phase: 02-01
    provides: "Удалены осиротевшие NLP-файлы, celery_config.py, test_*.py файлы (CLEAN-01, CLEAN-02, CLEAN-03)"

provides:
  - "DescriptionsAnalysis (бывший NLPAnalysisResult) — переименован, JSON-поле nlp_analysis сохранено"
  - "admin.py без NLP-классов: MultiNLPSettingsUpdateResponse, NLPProcessorStatusResponse, NLPProcessorTestResponse, NLPProcessorInfoResponse удалены"
  - "sync.py с явными 501-сообщениями для bookmark/highlight/reading-session"
  - "AdminMultiNLPSettings.tsx удалён, AdminDashboardEnhanced.tsx и AdminTabNavigation.tsx очищены"
  - "Все NLP-импорты и ссылки (NLPProcessorUnavailableException, NLPProcessorStatus, NLPStatusResponse) удалены"

affects:
  - "03-openrouter-migration"
  - "05-ai-stability"
  - "frontend-admin"

tech-stack:
  added: []
  patterns:
    - "Backward compatibility: JSON-поле nlp_analysis сохранено при переименовании Python-класса"
    - "Batch sync 501: ошибки накапливаются в errors[] без прерывания всего запроса"

key-files:
  created: []
  modified:
    - "backend/app/schemas/responses/descriptions.py — NLPAnalysisResult → DescriptionsAnalysis"
    - "backend/app/schemas/responses/admin.py — удалены 4 NLP-класса и nlp_mode из ParsingSettingsResponse"
    - "backend/app/schemas/responses/__init__.py — обновлены импорты и __all__"
    - "backend/app/services/description_extraction_service.py — обновлён импорт"
    - "backend/app/routers/books/processing.py — удалён мёртвый импорт nlp_processor (файл удалён в Dec 2025)"
    - "backend/app/routers/sync.py — TODO заменены на явные 501-сообщения"
    - "backend/app/core/exceptions.py — удалён NLPProcessorUnavailableException"
    - "backend/app/services/feature_flag_manager.py — очищены docstring NLP-примеры"
    - "backend/app/services/book/book_parsing_service.py — удалён NLP REMOVAL комментарий"
    - "frontend/src/components/Admin/AdminMultiNLPSettings.tsx — УДАЛЁН"
    - "frontend/src/components/Admin/AdminTabNavigation.tsx — удалена nlp вкладка"
    - "frontend/src/components/Admin/index.ts — удалён экспорт AdminMultiNLPSettings"
    - "frontend/src/pages/AdminDashboardEnhanced.tsx — удалены все NLP-ссылки и useQuery multiNlp"
    - "backend/tests/schemas/test_response_schemas_phase12.py — обновлён импорт DescriptionsAnalysis"

key-decisions:
  - "JSON-поле nlp_analysis сохранено в ChapterDescriptionsResponse и ChapterAnalysisResponse — фронтенд читает его в 8+ местах, менять нельзя без синхронной миграции фронтенда"
  - "sync.py: 501-ошибки помещаются в errors[], а не HTTPException — сохраняет batch-семантику (весь запрос не падает)"
  - "Мёртвый fallback на nlp_processor в processing.py заменён на re-raise — файл удалён в Dec 2025, импорт вызывал ModuleNotFoundError при срабатывании"

patterns-established:
  - "Backward compat renaming: переименовывать Python-классы можно без изменения JSON-имён полей"

requirements-completed: [CLEAN-04, CLEAN-05]

duration: 28min
completed: 2026-03-01
---

# Фаза 2, План 2: Рефакторинг NLP-схем и очистка роутеров — Итоги

**NLPAnalysisResult переименован в DescriptionsAnalysis, 4 NLP-класса удалены из admin.py, sync.py получил явные 501-сообщения, AdminMultiNLPSettings удалён из фронтенда — кодовая база полностью очищена от NLP-артефактов**

## Performance

- **Duration:** 28 мин
- **Started:** 2026-03-01T16:39:00Z
- **Completed:** 2026-03-01T17:07:05Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- Переименован `NLPAnalysisResult` → `DescriptionsAnalysis` в 5 файлах; JSON-поле `nlp_analysis` сохранено для совместимости с фронтендом
- Удалены 4 NLP-класса из `admin.py` и обновлён `ParsingSettingsResponse` (убраны `nlp_mode`, `enabled_processors`)
- Удалены `NLPProcessorStatus`, `NLPStatusResponse`, `NLPProcessorUnavailableException` из `__init__.py` и `exceptions.py`
- В `sync.py` 3 TODO-заглушки заменены явными "501: ... not implemented" сообщениями (CLEAN-04)
- Удалён `AdminMultiNLPSettings.tsx`; `AdminDashboardEnhanced.tsx` и `AdminTabNavigation.tsx` полностью очищены от nlp-таба и NLP-хуков
- Фронтенд собирается без ошибок; все тесты схем проходят

## Task Commits

Каждая задача зафиксирована атомарно:

1. **Task 1: Переименовать NLPAnalysisResult и очистить схемы** — `0232e5d` (refactor)
2. **Task 2: Исправить sync.py TODO-заглушки и финальная верификация** — `83200f8` (fix)

**Метаданные плана:** (создаётся после SUMMARY)

## Files Created/Modified

- `backend/app/schemas/responses/descriptions.py` — NLPAnalysisResult → DescriptionsAnalysis, обновлён __all__
- `backend/app/schemas/responses/admin.py` — удалены 4 NLP-класса и nlp_mode из ParsingSettingsResponse
- `backend/app/schemas/responses/__init__.py` — обновлены импорты, удалены NLPProcessorStatus, NLPStatusResponse
- `backend/app/services/description_extraction_service.py` — обновлён импорт и создание объекта DescriptionsAnalysis
- `backend/app/routers/books/processing.py` — удалён мёртвый import nlp_processor; fallback → re-raise
- `backend/app/routers/sync.py` — 3 TODO заменены на явные 501-сообщения
- `backend/app/core/exceptions.py` — удалён NLPProcessorUnavailableException
- `backend/app/services/feature_flag_manager.py` — обновлён docstring-пример
- `backend/app/services/book/book_parsing_service.py` — удалён NLP REMOVAL комментарий из docstring
- `frontend/src/components/Admin/AdminMultiNLPSettings.tsx` — УДАЛЁН
- `frontend/src/components/Admin/AdminTabNavigation.tsx` — удалена nlp вкладка из AdminTab union и tabs[]
- `frontend/src/components/Admin/index.ts` — удалён экспорт AdminMultiNLPSettings
- `frontend/src/pages/AdminDashboardEnhanced.tsx` — полностью переписан без NLP-хуков и NLP-блоков
- `backend/tests/schemas/test_response_schemas_phase12.py` — обновлён импорт DescriptionsAnalysis

## Decisions Made

- JSON-поле `nlp_analysis` сохранено в `ChapterDescriptionsResponse` и `ChapterAnalysisResponse` — фронтенд читает его в 8+ местах (useDescriptions.ts, useChapterData.ts, useChapterPrefetch.ts и др.). Менять без синхронной миграции фронтенда нельзя.
- `sync.py`: 501-ошибки помещены в `errors[]`, а не через `HTTPException` — сохраняет batch-семантику: при неудаче одной операции весь sync-запрос не падает.
- Мёртвый fallback на `nlp_processor` в `processing.py` заменён на `raise` — файл был удалён в Dec 2025, код вызывал `ModuleNotFoundError` при срабатывании. Это отклонение от плана (план говорил "удалить комментарий"), но фактически там было живое мёртвое code (Rule 1 Bug).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Удалён мёртвый импорт nlp_processor из processing.py (fallback-код)**
- **Found during:** Task 1 (очистка NLP-ссылок в роутерах)
- **Issue:** Строка `from ...services.nlp_processor import process_book_descriptions` в fallback-блоке ссылалась на удалённый файл. При срабатывании блока возникал `ModuleNotFoundError`. Файл `nlp_processor.py` удалён в Dec 2025 в рамках NLP-удаления.
- **Fix:** Заменён fallback-блок на `raise` — ошибка Celery propagates корректно
- **Files modified:** `backend/app/routers/books/processing.py`
- **Verification:** Нет импорта несуществующего модуля; backend-тесты проходят
- **Committed in:** `0232e5d` (Task 1 commit)

**2. [Rule 1 - Bug] Обновлён NLPAnalysisResult → DescriptionsAnalysis в тестах schemas**
- **Found during:** Task 2 (финальная верификация — pytest)
- **Issue:** `tests/schemas/test_response_schemas_phase12.py` импортировал `NLPAnalysisResult` — теперь не существует
- **Fix:** Заменён импорт и все 7 упоминаний на `DescriptionsAnalysis`
- **Files modified:** `backend/tests/schemas/test_response_schemas_phase12.py`
- **Verification:** Тесты schemas проходят (21 passed)
- **Committed in:** `83200f8` (Task 2 commit)

---

**Всего отклонений:** 2 автоисправления (Rule 1 — баги)
**Влияние на план:** Оба исправления были необходимы для корректности. Расширения скопа нет.

## Issues Encountered

- `NLPProcessorStatus` и `NLPStatusResponse` найдены в `schemas/responses/__init__.py` — не упомянуты в плане явно, но являются частью CLEAN-05 (NLP-схемы). Удалены как часть Task 1.
- `AdminTabNavigation.tsx` содержал `nlp` в union type `AdminTab` — удалён вместе с файлом `AdminMultiNLPSettings.tsx` для полной очистки.

## User Setup Required

None — нет необходимости в конфигурации внешних сервисов.

## Next Phase Readiness

- Фаза 2 полностью завершена: CLEAN-01..05 закрыты
- Кодовая база не содержит NLP-артефактов (кроме допустимого JSON-поля `nlp_analysis` и `FeatureFlagCategory.NLP` enum в DB)
- Фаза 3 (OpenRouter migration + Caddy) готова к старту

---
*Phase: 02-dead-code-cleanup*
*Completed: 2026-03-01*
