---
id: S02
parent: M003
milestone: M003
provides:
  - Адаптивная шапка ReaderHeader с overflow menu (Radix DropdownMenu)
  - Адаптивный прогресс (320px процент, 375px+ полоса, sm+ страница/всего)
  - Таб Info в TocSidebar вместо отдельного модала BookInfo
  - Controlled activeTab/onTabChange API в TocSidebar
  - Snap points панелей [0.5, 0.95] вместо [0.5, 0.9] для полной высоты
  - Убран max-h-[90vh] из MobilePanel (snap point контролирует высоту)
  - Autofocus поиска отключен на мобильных (TocSidebar + SearchPanel)
  - SearchPanel адаптирован для 320px viewport
  - "ReaderFooter с прогресс-линией, процентом, счётчиком страниц"
  - "chapterPage/chapterTotalPages из useCFITracking"
  - "Шапка без прогресса — только кнопки навигации и title/author"
  - "iOS overlay не перехватывает тапы по шапке"
  - "Entity Wiki и Settings всегда видны в шапке"
  - "Overflow menu содержит только TOC и Search для < 375px"
  - "Bridge iframe touch/click events для dismiss панелей при тапе в epub content"
  - "Реактивный activeSnapPoint в MobilePanel (Vaul dismiss работает)"
  - "Backdrop для SearchPanel — outside-click закрытие"
  - "handlePanelDismiss callback в EpubReader для закрытия всех панелей"
requires: []
affects: []
key_files: []
key_decisions:
  - "Breakpoints: <375px 3 элемента, xs(375px)+ TOC, sm(640px)+ Entities/Search, md(768px)+ все кнопки"
  - "Overflow menu: Radix DropdownMenu с обратными responsive classes (xs:hidden, sm:hidden) для предотвращения дублирования"
  - "BookInfo стал внутренним компонентом BookInfoContent в TocSidebar, файл BookInfo.tsx сохранён (используется в re-export)"
  - "Autofocus поиска в TocSidebar только на десктопе (isMobile check)"
  - "Snap points [0.5, 0.95] -- пользователь выбрал 0.95 вместо 0.9 для максимальной высоты"
  - "max-h-[90vh] удален полностью (snap point 0.95 контролирует высоту)"
  - "defaultSnap 0.95 для TocSidebar -- оглавление открывается на полную высоту"
  - "Autofocus отключен на мобильных через isMobile check (TocSidebar + SearchPanel)"
  - "SearchPanel на 320px: statusText скрыт, gap/padding уменьшены"
  - "Footer показывается/скрывается синхронно с шапкой через isHeaderVisible"
  - "chapterPage/chapterTotalPages сохраняются в state useCFITracking из displayed.page/displayed.total"
  - "iOS overlay top: calc(env(safe-area-inset-top) + 64px) для исключения header area"
  - "clientY < 80px guard как fallback-защита в handleOverlayTouchEnd"
  - "Entity Wiki и Settings всегда видны (flex без hidden prefix)"
  - "Overflow menu содержит только TOC и Search (xs:hidden) для экранов < 375px"
  - "Panel dismiss при ЛЮБОМ тапе в iframe (не только edge/center) — единообразное поведение"
  - "Backdrop SearchPanel прозрачный (z-[19]) — не затемняет контент, но ловит клики"
  - "activeSnapPoint в MobilePanel через useState + setActiveSnapPoint — Vaul может dismiss свайпом"
patterns_established:
  - "Responsive overflow: кнопки шапки с hidden xs:flex / hidden sm:flex, пункты overflow с xs:hidden / sm:hidden"
  - "Controlled tab state: activeTab prop + onTabChange callback для внешнего управления табами"
  - "isMobile guard для autofocus: проверка !isMobile перед focus() предотвращает клавиатуру на мобильных"
  - "Responsive density: hidden xs:inline для скрытия необязательных элементов на маленьких экранах"
  - "ReaderFooter: fixed bottom-0 с mb-safe, backdrop-blur, spring-анимация"
  - "Footer prop в ReaderUI отделён от header prop"
  - "iOS overlay offset: исключать фиксированные UI-элементы из overlay area"
  - "onPanelDismiss bridge: iframe events → host React state через ref-based callback"
observability_surfaces: []
drill_down_paths: []
duration: 8min
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---
# S02: Shapka I Paneli

**# Phase 17 Plan 01: Адаптивная шапка и перенос Info Summary**

## What Happened

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

# Phase 17 Plan 02: Snap points панелей и SearchPanel Summary

**Snap points панелей обновлены до [0.5, 0.95], autofocus отключен на мобильных, SearchPanel адаптирован для 320px**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-10T22:48:00Z
- **Completed:** 2026-03-10T22:55:31Z
- **Tasks:** 3 (2 auto + 1 checkpoint human-verify)
- **Files modified:** 3

## Accomplishments

- Панели открываются на 95% экрана вместо 90% -- контент не обрезается снизу
- Убран max-h-[90vh] из Drawer.Content -- snap point контролирует высоту
- Клавиатура не появляется при открытии оглавления/поиска на мобильных
- SearchPanel помещается на 320px: statusText скрыт, padding уменьшены
- Человек подтвердил работу на устройстве

## Task Commits

1. **Task 1: Snap points панелей и autofocus fix** - `129075b` (fix)
2. **Task 2: SearchPanel адаптация на 320px** - `ff7ca73` (fix)
3. **Task 3: Проверка шапки и панелей на устройстве** - checkpoint:human-verify (approved)

## Files Created/Modified

- `frontend/src/components/UI/MobilePanel.tsx` - Snap points [0.5, 0.95], убран max-h-[90vh]
- `frontend/src/components/Reader/TocSidebar.tsx` - snapPoints [0.5, 0.95], defaultSnap 0.95, autofocus только на десктопе
- `frontend/src/components/Reader/SearchPanel.tsx` - Адаптивный layout для 320px, autofocus только на десктопе

## Decisions Made

- Snap points [0.5, 0.95] -- пользователь выбрал 0.95 для максимальной видимости контента
- max-h-[90vh] удален полностью -- snap point сам контролирует высоту панели
- defaultSnap={0.95} для оглавления -- открывается на полную высоту по умолчанию
- Autofocus через isMobile guard в обоих компонентах (TocSidebar + SearchPanel) для консистентности
- StatusText скрыт ниже 375px (hidden xs:inline) -- input получает пространство на 320px

## Deviations from Plan

None -- план выполнен точно как написан.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 17 полностью завершена (Plans 01 + 02)
- Шапка адаптивна на 320px-768px+, панели открываются на полную высоту
- Клавиатура не появляется при открытии панелей на мобильных
- Готовность к Phase 18 (выделение текста и заметки)

---

_Phase: 17-shapka-i-paneli_
_Completed: 2026-03-11_

## Self-Check: PASSED

# Phase 17 Plan 03: ReaderFooter Summary

**Прогресс-линия перенесена из шапки в нижнюю панель ReaderFooter с процентом, счётчиком страниц и страницами до конца главы**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-11T01:34:03Z
- **Completed:** 2026-03-11T01:44:18Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Создан ReaderFooter.tsx с прогресс-линией (~95% ширины), процентом справа, счётчиком страниц и "стр. до конца главы"
- useCFITracking расширен: экспортирует chapterPage и chapterTotalPages из epub.js displayed data
- Прогресс полностью удалён из ReaderHeader — шапка содержит только кнопки навигации и title/author (md+)
- Footer синхронизируется с показом/скрытием шапки через isHeaderVisible

## Task Commits

Каждая задача закоммичена атомарно:

1. **Task 1: Расширить useCFITracking и создать ReaderFooter** - `c865083` (feat)
2. **Task 2: Удалить прогресс из ReaderHeader, подключить ReaderFooter** - `98b5fb6` (refactor)

## Files Created/Modified
- `frontend/src/components/Reader/ReaderFooter.tsx` - Новый компонент нижней панели с прогрессом
- `frontend/src/hooks/epub/useCFITracking.ts` - Добавлены chapterPage/chapterTotalPages state и export
- `frontend/src/components/Reader/ReaderHeader.tsx` - Удалены progress, currentPage, totalPages из props и рендера
- `frontend/src/components/Reader/Core/ReaderUI.tsx` - Добавлен footer prop и рендер ReaderFooter
- `frontend/src/components/Reader/EpubReader.tsx` - Деструктуризация chapterPage/chapterTotalPages, footer prop
- `frontend/src/components/Reader/BookReader.tsx` - Удалены старые progress props из ReaderHeader
- `frontend/src/locales/ru/translation.json` - i18n ключи reader.footer.*
- `frontend/src/locales/en/translation.json` - i18n ключи reader.footer.*

## Decisions Made
- Footer показывается/скрывается синхронно с шапкой через isHeaderVisible
- chapterPage/chapterTotalPages сохраняются в state useCFITracking из displayed.page/displayed.total
- Spring-конфиг футера идентичен шапке (stiffness: 400, damping: 35, mass: 1) для согласованности

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Обновлён BookReader.tsx для соответствия новому интерфейсу ReaderHeader**
- **Found during:** Task 2 (удаление прогресса из ReaderHeader)
- **Issue:** BookReader.tsx использовал старые progress/currentPage/totalPages props ReaderHeader, TypeScript build падал
- **Fix:** Удалены progress, currentPage, totalPages из вызова ReaderHeader в BookReader.tsx
- **Files modified:** frontend/src/components/Reader/BookReader.tsx
- **Verification:** npm run build проходит без ошибок
- **Committed in:** 98b5fb6 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Необходимое исправление для совместимости. Без расширения скоупа.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ReaderFooter готов к визуальному тестированию
- Шапка освобождена для будущих изменений (план 04: панели закрытия)

---
*Phase: 17-shapka-i-paneli*
*Completed: 2026-03-11*

# Phase 17 Plan 04: Фикс iOS overlay и реорганизация кнопок шапки

**Фикс перехвата тапов iOS overlay в области шапки и вынос Entity Wiki / Settings из overflow menu**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-11T01:48:34Z
- **Completed:** 2026-03-11T01:51:25Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- iOS overlay теперь начинается ниже шапки (top: calc(env(safe-area-inset-top) + 64px))
- Добавлен clientY < 80px guard в handleOverlayTouchEnd как fallback-защита
- Entity Wiki (Library icon) всегда видна в шапке на всех размерах экрана
- Settings всегда видна в шапке на всех размерах экрана
- Overflow menu содержит только TOC и Search для экранов < 375px

## Task Commits

Each task was committed atomically:

1. **Task 1: Фикс iOS overlay -- исключить область шапки** - `e67ee14` (fix)
2. **Task 2: Вынести Entity Wiki и Settings из overflow в шапку** - `d2a72c0` (feat)

## Files Created/Modified
- `frontend/src/hooks/epub/useGestureController.ts` - iOS overlay top offset + clientY guard в handleOverlayTouchEnd
- `frontend/src/components/Reader/ReaderHeader.tsx` - Entity Wiki и Settings всегда видны, overflow упрощен

## Decisions Made
- iOS overlay top: calc(env(safe-area-inset-top) + 64px) -- 64px = высота шапки (~56px header + 8px padding)
- clientY < 80px guard как дополнительная fallback-защита (safe-area + header height)
- Entity Wiki и Settings: `flex` без hidden prefix -- всегда видны как ключевые функции
- Search: `hidden xs:flex` -- виден от 375px
- Overflow trigger: `xs:hidden` -- скрыт от 375px (все основные кнопки уже видны)
- На 320px: [Back] [spacer] [Entities] [Settings] [Overflow] -- помещается (176px + spacer)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 17 gap closure завершена (все 5 планов выполнены)
- Готовность к Phase 18 (Выделение текста и заметки)
- iOS overlay fix требует ручного тестирования на iOS Safari для подтверждения

---
*Phase: 17-shapka-i-paneli*
*Completed: 2026-03-11*

# Phase 17 Plan 05: Закрытие панелей Summary

**Bridge iframe touch/click events для dismiss панелей, реактивный activeSnapPoint в MobilePanel, backdrop для SearchPanel**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-11T01:33:09Z
- **Completed:** 2026-03-11T01:41:11Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Iframe event bridge: тап/клик внутри epub iframe при открытой панели теперь вызывает onPanelDismiss
- MobilePanel: замороженный activeSnapPoint заменён на useState — Vaul dismiss свайпом работает
- SearchPanel: прозрачный backdrop (z-[19]) для outside-click dismiss
- EpubReader: handlePanelDismiss закрывает все панели (TOC, Settings, EntityDrawer, Search)

## Task Commits

Each task was committed atomically:

1. **Task 1: Bridge iframe touch events и фикс MobilePanel activeSnapPoint** - `8058b20` (feat)
2. **Task 2: Backdrop для SearchPanel и подключение onPanelDismiss в EpubReader** - `9f3656e` (feat)

## Files Created/Modified
- `frontend/src/hooks/epub/useGestureController.ts` - onPanelDismiss callback, вызывается при touch/click/iOS overlay tap с isPanelOpen
- `frontend/src/components/UI/MobilePanel.tsx` - useState для activeSnapPoint, setActiveSnapPoint в Drawer.Root
- `frontend/src/components/Reader/SearchPanel.tsx` - Transparent backdrop div для outside-click dismiss
- `frontend/src/components/Reader/EpubReader.tsx` - handlePanelDismiss callback, передача onPanelDismiss в gestureController

## Decisions Made
- Panel dismiss при ЛЮБОМ тапе в iframe когда панель открыта — unified early return до zone detection
- Backdrop SearchPanel прозрачный (без bg) — не мешает чтению, только ловит клики
- MobilePanel activeSnapPoint управляется через useState + useEffect синхронизация при isOpen

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- 2 pre-existing TypeScript ошибки в BookReader.tsx и ReaderUI.tsx (Property 'progress' not on ReaderHeaderProps) — не связаны с изменениями этого плана, записаны в deferred-items.md

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Все панели корректно закрываются при тапе вне них (iframe, backdrop)
- MobilePanel поддерживает swipe-to-dismiss через Vaul
- Готовность к Phase 18 (выделение текста и заметки)

---
*Phase: 17-shapka-i-paneli*
*Completed: 2026-03-11*
