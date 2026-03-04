---
phase: 07-ux
plan: 01
subsystem: ui
tags: [i18n, error-handling, react, typescript]

requires:
  - phase: 04.1-integration-rebrand
    provides: i18n-инфраструктура (ru/en translation.json)
provides:
  - Централизованная утилита маппинга ошибок (mapApiError)
  - i18n ключи errors.* и errorBoundary.* для ru/en
  - Переведённый ErrorBoundary (русские тексты)
  - isRetryable флаг для контроля отображения кнопки retry
affects: [07-ux]

tech-stack:
  added: []
  patterns: [centralized-error-mapping, isRetryable-pattern]

key-files:
  created:
    - frontend/src/utils/errorMessages.ts
    - frontend/src/utils/__tests__/errorMessages.test.ts
  modified:
    - frontend/src/locales/ru/translation.json
    - frontend/src/locales/en/translation.json
    - frontend/src/components/ErrorBoundary.tsx
    - frontend/src/components/Reader/EpubReader.tsx
    - frontend/src/components/Reader/Core/ReaderOverlays.tsx

key-decisions:
  - "mapApiError поддерживает 3 типа входных данных: Axios-ошибки, Error-объекты, строки (обратная совместимость с getReadableError)"
  - "CircuitBreaker ошибки (503 + 'circuit' в detail) помечаются isRetryable=false -- кнопка retry не показывается"
  - "ErrorBoundary использует i18n.t() напрямую (class component, нет хуков) -- импорт i18n вместо useTranslation"
  - "UX-04 (loading при смене глав) -- решение пользователя: НЕ реализуется, никаких skeleton/shimmer"

patterns-established:
  - "Centralized error mapping: все API-ошибки через mapApiError() вместо ad-hoc маппинга"
  - "isRetryable pattern: ErrorMapping.isRetryable контролирует видимость кнопки retry"

requirements-completed: [UX-02, UX-04]

duration: 6min
completed: 2026-03-05
---

# Phase 7 Plan 1: Централизация ошибок Summary

**Централизованная утилита mapApiError с i18n-ключами для русских сообщений об ошибках, переведённый ErrorBoundary и isRetryable-контроль кнопки retry в ReaderOverlays**

## Performance

- **Duration:** 6 мин
- **Started:** 2026-03-04T23:47:22Z
- **Completed:** 2026-03-04T23:53:08Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Создана утилита mapApiError, обрабатывающая Axios-ошибки, Error-объекты и строки с маппингом на русские i18n-сообщения
- Добавлены 12 ключей errors.* и 10 ключей errorBoundary.* в ru/en переводы
- ErrorBoundary переведён с английских хардкодов на i18n.t() вызовы
- EpubReader: удалён ad-hoc getReadableError, заменён на mapApiError
- ReaderOverlays: inline-разметка заменена на переиспользуемый ErrorMessage компонент с isRetryable-контролем
- 22 теста покрывают все сценарии маппинга ошибок

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Тесты mapApiError** - `dff658a` (test)
2. **Task 1 (GREEN): Утилита + i18n + ErrorBoundary** - `256f65e` (feat)
3. **Task 2: Интеграция в EpubReader и ReaderOverlays** - `bf4789a` (feat)

_TDD task 1 имеет отдельные коммиты для RED и GREEN фаз_

## Files Created/Modified
- `frontend/src/utils/errorMessages.ts` - Централизованная утилита маппинга ошибок (mapApiError, ErrorMapping)
- `frontend/src/utils/__tests__/errorMessages.test.ts` - 22 теста для всех типов ошибок
- `frontend/src/locales/ru/translation.json` - Добавлены errors.* и errorBoundary.* ключи
- `frontend/src/locales/en/translation.json` - Добавлены errors.* и errorBoundary.* ключи (английские)
- `frontend/src/components/ErrorBoundary.tsx` - Заменены английские хардкоды на i18n.t()
- `frontend/src/components/Reader/EpubReader.tsx` - Удалён getReadableError, используется mapApiError
- `frontend/src/components/Reader/Core/ReaderOverlays.tsx` - Используется ErrorMessage компонент, добавлен isRetryable

## Decisions Made
- mapApiError поддерживает 3 типа входных данных для обратной совместимости
- CircuitBreaker (503 + "circuit" в detail) -> isRetryable=false, кнопка retry скрыта
- ErrorBoundary: i18n импортируется напрямую (class component не поддерживает хуки)
- UX-04: loading при смене глав НЕ реализуется -- осознанное решение пользователя, задокументировано

## Deviations from Plan

None - план выполнен точно как написан.

## Issues Encountered

None

## User Setup Required

None - не требуется конфигурация внешних сервисов.

## Next Phase Readiness
- Утилита mapApiError доступна для использования во всём приложении
- Готово к плану 07-02 (следующий план UX-улучшений)

## Self-Check: PASSED

All 7 files verified present. All 3 commit hashes verified in git log.

---
*Phase: 07-ux*
*Completed: 2026-03-05*
