---
phase: 17-shapka-i-paneli
plan: 01
subsystem: ui
tags: [react, tailwind, radix, dropdown-menu, responsive, reader]

# Dependency graph
requires:
  - phase: 16-navigatsiya-i-zhesty
    provides: Стабильный ридер с gesture controller и auto-hide UI
provides:
  - Адаптивная шапка ReaderHeader с overflow menu (Radix DropdownMenu)
  - Адаптивный прогресс (320px процент, 375px+ полоса, sm+ страница/всего)
  - Таб Info в TocSidebar вместо отдельного модала BookInfo
  - Controlled activeTab/onTabChange API в TocSidebar
affects: [17-02-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [responsive overflow menu с Tailwind breakpoints + Radix DropdownMenu, controlled tab state в TocSidebar]

key-files:
  created: []
  modified:
    - frontend/src/components/Reader/ReaderHeader.tsx
    - frontend/src/components/Reader/TocSidebar.tsx
    - frontend/src/components/Reader/EpubReader.tsx
    - frontend/src/components/Reader/Core/ReaderUI.tsx
    - frontend/src/components/Reader/Core/ReaderModals.tsx
    - frontend/src/components/Reader/BookReader.tsx

key-decisions:
  - "Breakpoints: <375px 3 элемента, xs(375px)+ TOC, sm(640px)+ Entities/Search, md(768px)+ все кнопки"
  - "Overflow menu: Radix DropdownMenu с обратными responsive classes (xs:hidden, sm:hidden) для предотвращения дублирования"
  - "BookInfo стал внутренним компонентом BookInfoContent в TocSidebar, файл BookInfo.tsx сохранён (используется в re-export)"
  - "Autofocus поиска в TocSidebar только на десктопе (isMobile check)"

patterns-established:
  - "Responsive overflow: кнопки шапки с hidden xs:flex / hidden sm:flex, пункты overflow с xs:hidden / sm:hidden"
  - "Controlled tab state: activeTab prop + onTabChange callback для внешнего управления табами"

requirements-completed: [HDR-01, HDR-02]

# Metrics
duration: 7min
completed: 2026-03-11
---

# Phase 17 Plan 01: Адаптивная шапка и перенос Info Summary

**Адаптивный ReaderHeader с Radix overflow menu для 320px-768px+, перенос BookInfo из модала в таб Info в TocSidebar**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-10T22:35:27Z
- **Completed:** 2026-03-10T22:43:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Шапка помещается на 320px: 3 элемента (Назад, процент, overflow)
- Кнопки постепенно выходят из overflow: xs TOC, sm Entities/Search, md Settings
- Адаптивный прогресс: 320px только процент, xs+ полоса, sm+ страница/всего
- BookInfo удалён из ReaderModals, стал табом Info в TocSidebar
- Autofocus поиска в TocSidebar исправлен: только на десктопе

## Task Commits

1. **Task 1: Адаптивный ReaderHeader с overflow menu** - `5eeb410` (feat)
2. **Task 2: Перенос Инфо в TocSidebar и очистка prop chain** - `f8d5c2e` (feat)

## Files Created/Modified
- `frontend/src/components/Reader/ReaderHeader.tsx` - Полностью переписан: адаптивный layout с overflow menu
- `frontend/src/components/Reader/TocSidebar.tsx` - Добавлен таб Info, BookInfoContent, controlled tab API
- `frontend/src/components/Reader/EpubReader.tsx` - Удалён isBookInfoOpen, добавлен tocTab state
- `frontend/src/components/Reader/Core/ReaderUI.tsx` - Удалён onInfoOpen из props
- `frontend/src/components/Reader/Core/ReaderModals.tsx` - Удалён bookInfo, добавлены toc metadata/tab props
- `frontend/src/components/Reader/BookReader.tsx` - Удалён onInfoOpen prop

## Decisions Made
- Breakpoints появления кнопок: xs(375px) TOC, sm(640px) Entities/Search, md(768px) Settings -- баланс между плотностью и юзабилити
- Overflow menu использует обратные CSS classes (xs:hidden на пункте TOC) вместо JS-фильтрации -- zero re-render overhead
- BookInfoContent встроен в TocSidebar как внутренний компонент (не отдельный файл) -- минимум boilerplate для простого layout
- TocSidebar получил controlled mode (activeTab/onTabChange) для возможности открывать конкретный таб извне

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Исправлен BookReader.tsx (не упомянут в плане)**
- **Found during:** Task 1 (ReaderHeader)
- **Issue:** BookReader.tsx тоже передавал onInfoOpen в ReaderHeader, TypeScript build падал
- **Fix:** Удалён onInfoOpen prop из BookReader.tsx
- **Files modified:** frontend/src/components/Reader/BookReader.tsx
- **Verification:** npm run build проходит
- **Committed in:** 5eeb410 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Необходимое исправление для прохождения TypeScript build. Без расширения scope.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- План 17-02 может обновить snap points панелей и фикс автофокуса
- TocSidebar готов к snap point изменениям (snapPoints prop уже передаётся)
- Шапка адаптивна и не требует дальнейших изменений

---
*Phase: 17-shapka-i-paneli*
*Completed: 2026-03-11*

## Self-Check: PASSED
