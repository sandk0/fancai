---
phase: 07-ux
plan: 02
subsystem: ui
tags: [error-handling, retry, react, typescript, i18n]

requires:
  - phase: 07-ux
    provides: mapApiError утилита и i18n ключи errors.* (Plan 01)
provides:
  - ParsingOverlay с обработкой ошибок парсинга и кнопкой повтора
  - ExtractionIndicator с error state, retry кнопкой и лимитом попыток
  - ExtractionIndicator подключён в EpubReader (ранее только экспортировался)
  - useChapterData и useChapterManagement проксируют error и refetch
affects: []

tech-stack:
  added: []
  patterns: [error-state-with-retry-limit, useChapterData-error-propagation]

key-files:
  created: []
  modified:
    - frontend/src/components/UI/ParsingOverlay.tsx
    - frontend/src/components/Reader/ExtractionIndicator.tsx
    - frontend/src/components/Reader/EpubReader.tsx
    - frontend/src/hooks/epub/useChapterData.ts
    - frontend/src/hooks/epub/useChapterManagement.ts
    - frontend/src/locales/ru/translation.json
    - frontend/src/locales/en/translation.json

key-decisions:
  - "WebSocket onError разделён: parsing errors (type=error в WS-сообщении) показываются в UI, timeout/connection errors переключают на polling"
  - "Retry парсинга через booksAPI.processBook (POST /api/books/{id}/process) -- reprocess-descriptions не подходит для полного retry"
  - "useChapterData проксирует error и refetch наверх через useChapterManagement в EpubReader"
  - "ExtractionIndicator: CircuitBreakerError (isRetryable=false) -- кнопка retry не показывается"
  - "Retry count сбрасывается при смене главы через useEffect на currentChapter"

patterns-established:
  - "Error propagation: useChapterData -> useChapterManagement -> EpubReader -> ExtractionIndicator"
  - "Retry limit pattern: retryCount + maxRetries = UI контролирует видимость кнопки retry"

requirements-completed: [UX-03, UX-05]

duration: 5min
completed: 2026-03-05
---

# Phase 7 Plan 2: Обработка ошибок парсинга и извлечения Summary

**ParsingOverlay и ExtractionIndicator с error state, информативными русскими сообщениями и retry-кнопками (до 3 попыток), ExtractionIndicator подключён в EpubReader**

## Performance

- **Duration:** 5 мин
- **Started:** 2026-03-04T23:56:26Z
- **Completed:** 2026-03-05T00:02:10Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- ParsingOverlay обрабатывает status=error/failed от polling и WebSocket -- прогресс-бар больше не застревает
- ExtractionIndicator расширен error state с AlertCircle, retry кнопкой и лимитом 3 попыток
- ExtractionIndicator подключён в EpubReader через useChapterManagement (ранее только экспортировался)
- useChapterData и useChapterManagement проксируют error и refetch для полной цепочки обработки ошибок
- CircuitBreakerError (isRetryable=false) не показывает retry кнопку ни в одном компоненте
- Добавлены 6 i18n ключей для ошибок парсинга и извлечения (ru/en)

## Task Commits

Each task was committed atomically:

1. **Task 1: ParsingOverlay -- обработка ошибок парсинга + retry** - `55a5be7` (feat)
2. **Task 2: ExtractionIndicator -- error state + retry + подключение в EpubReader** - `5209fdc` (feat)

## Files Created/Modified
- `frontend/src/components/UI/ParsingOverlay.tsx` - Обработка status=error/failed, error UI с AlertCircle, retry через processBook
- `frontend/src/components/Reader/ExtractionIndicator.tsx` - Error state, retry кнопка с лимитом, retries_exhausted сообщение
- `frontend/src/components/Reader/EpubReader.tsx` - Подключение ExtractionIndicator, retry state, сброс при смене главы
- `frontend/src/hooks/epub/useChapterData.ts` - Добавлены error state и refetch callback
- `frontend/src/hooks/epub/useChapterManagement.ts` - Проксирование descriptionError и refetchDescriptions
- `frontend/src/locales/ru/translation.json` - Ключи errors.parsing_*, reader.extraction.error/retry_hint/retries_exhausted
- `frontend/src/locales/en/translation.json` - Английские аналоги тех же ключей

## Decisions Made
- WebSocket onError разделён: parsing errors показываются в UI, timeout переключает на polling
- Retry парсинга через processBook (не reprocess-descriptions) -- полный restart обработки
- Error propagation через цепочку хуков: useChapterData -> useChapterManagement -> EpubReader
- CircuitBreakerError скрывает retry кнопку через mapApiError().isRetryable === false

## Deviations from Plan

None -- план выполнен точно как написан.

## Issues Encountered

None

## User Setup Required

None -- не требуется конфигурация внешних сервисов.

## Next Phase Readiness
- Фаза 7 (UX-улучшения) полностью завершена (2/2 плана)
- Все UX-требования покрыты: централизация ошибок, i18n, ошибки парсинга, ошибки извлечения
- Готово к следующей фазе

## Self-Check: PASSED

All 7 files verified present. All 2 commit hashes verified in git log.

---
*Phase: 07-ux*
*Completed: 2026-03-05*
