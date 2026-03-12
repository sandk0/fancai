---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Reader Stability & Polish
status: completed
last_updated: "2026-03-12T12:37:00Z"
last_activity: "2026-03-12 — Plan 19.2-01 complete: selectstart suppression + iframe coordinate fix"
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 16
  completed_plans: 16
  percent: 100
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-03-10)

**Ключевая ценность:** AI-ридер с интерактивной Entity Wiki -- загрузка книги, чтение, AI-глоссарий без спойлеров, иллюстрации, заметки
**Текущий фокус:** Phase 19.2 complete -- Мобильные баги ридера: touch selection, iframe координаты, annotation timing

## Текущая позиция

Phase: 19.2 (Мобильные баги ридера: touch selection, iframe координаты, annotation timing)
Plan: 2 of 2 (all plans complete)
Status: Phase Complete — awaiting Human UAT Round 2
Last activity: 2026-03-12 — Plan 19.2-01 complete: selectstart suppression + iframe coordinate fix

Progress: [██████████] 100%

## Метрики производительности

**Общая статистика:**

| Milestone | Фазы | Планы | Время  | Среднее/план |
| --------- | ---- | ----- | ------ | ------------ |
| v1.0      | 9    | 23    | 9 дней | --           |
| v1.1      | 6    | 13    | 92 min | 7 min        |
| v1.2      | 5    | 10    | --     | --           |

## Накопленный контекст

### Решения

- [16-01] chapterTransitionThreshold: 0.08 (было 0.35→0.15→0.08, теперь ~30px на 375px viewport)
- [16-01] Тап-навигация: instant scroll ПЕРЕД spring slide-in (двухфазный паттерн)
- [16-01] onEdgeTap стал no-op -- навигация внутри gesture controller
- [16-02] Spring-конфиги ×2 ускорены: SPRING_FAST 800/57, SPRING_SWIPE 600/34, SPRING_TAP 1000/57 (d859d16)
- [16-02] Тень при свайпе: переведена на inline boxShadow (вместо Tailwind drop-shadow), shadow усиливается по мере движения
- [16-02] Edge zone расширена до 15% viewport (было ~12%) для entity clicks
- [16-02] Анимация toggle: настройка в reader store (animationsEnabled), по умолчанию включена
- [16-02] maxRubberBand увеличен до 100px (было 80px), rubber-band resistance 0.4
- [17-01] Breakpoints шапки: <375px 3 элемента, xs TOC, sm Entities/Search, md все кнопки
- [17-01] Overflow menu: Radix DropdownMenu с обратными CSS classes (xs:hidden, sm:hidden)
- [17-01] BookInfo перенесён в таб Info в TocSidebar (controlled activeTab/onTabChange)
- [17-01] Autofocus поиска TocSidebar только на десктопе (isMobile check)
- [17-02] Snap points [0.5, 0.95] вместо [0.5, 0.9] -- max-h-[90vh] удален
- [17-02] defaultSnap 0.95 для TocSidebar -- оглавление на полную высоту
- [17-02] Autofocus SearchPanel отключен на мобильных (isMobile guard)
- [17-02] SearchPanel 320px: statusText скрыт ниже 375px (hidden xs:inline)
- [17-05] Panel dismiss при ЛЮБОМ тапе в iframe (unified early return до zone detection)
- [17-05] Backdrop SearchPanel прозрачный z-[19] -- ловит клики без затемнения
- [17-05] MobilePanel activeSnapPoint через useState + setActiveSnapPoint (Vaul dismiss работает)
- [17-03] Footer показывается/скрывается синхронно с шапкой (isHeaderVisible)
- [17-03] chapterPage/chapterTotalPages из useCFITracking (displayed.page/displayed.total)
- [17-04] iOS overlay top: calc(env(safe-area-inset-top) + 64px) -- исключает header area
- [17-04] clientY < 80px guard в handleOverlayTouchEnd как fallback-защита
- [17-04] Entity Wiki и Settings: всегда видны (flex без hidden), Search от xs (375px)
- [17-04] Overflow menu: только TOC + Search (xs:hidden), trigger xs:hidden
- [hotfix] epub.js 0.3.93 queue.dequeue() не имеет try-catch — если task бросает исключение, очередь блокируется навсегда. Monkey-patch в patchRenditionQueue (useBookSearch.ts). Коммит 4c97bde.
- [hotfix] rangeToPointCfi УДАЛЁН — конвертация range→point CFI ломала кросс-секционную навигацию. Range CFI работает с patched queue.
- [18-01] CSS class toggle (body.selection-blocked) вместо JS guard для блокировки выделения при анимации
- [18-01] contextmenu suppression через maxTouchPoints/ontouchstart (не глобально)
- [18-01] -webkit-touch-callout: none НЕ применяется глобально (ломает long-press выделение на iOS)
- [18-02] Edit mode в SelectionMenu через editMode prop с pre-populated полями (не отдельный компонент)
- [18-02] HighlightTooltip позиционирование: выше/ниже точки тапа на основе 50% viewport
- [19-01] DescriptionDrawer: snap points [0.4, 0.8], h-[95dvh], useGenerateImage мутация внутри компонента
- [19-01] EntityBottomSheet: snap points [0.3, 0.6], entities.type_${type} i18n паттерн
- [19-01] isPanelOpen расширен: isDrawerOpen + !!popupEntity (закрытие при навигации)
- [19-01] popupPosition state удалён -- bottom sheet не нуждается в позиционировании
- [19-02] TYPE_COLORS bg opacity 0.2 -> 0.06, active 0.4 -> 0.15 (приглушённые описания)
- [19-02] onCenterTap returns boolean -- UI toggle только если interactive element не найден
- [19-02] handleCenterTap проверяет и .description-highlight и .entity-mention (ENT-02 fix)
- [19-02] descriptionHighlightingEnabled: boolean в store (version 6), toggle в настройках
- [19.1-01] Inline touchAction/userSelect/webkitUserSelect убраны из useEpubRendition, CSS из useContentHooks -- единственный источник
- [19.1-01] bg-[var(--color-bg-base)] для standalone drawer-ов (solid, theme-adaptive)
- [19.1-01] elementFromPoint вместо e.target для определения интерактивных элементов в edge zones
- [19.1-01] Click handler обновлён аналогично touch handler: entity + description обработка
- [19.1-02] bookmarksRef.current вместо closure в applyAnnotations -- всегда актуальные данные при debounced вызове
- [19.1-02] Дифференцированный debounce: 50ms для bookmark changes, 200ms для rendered event
- [19.1-02] Click handler переведён на bookmarksRef -- убрана зависимость bookmarks из useEffect deps
- [19.1-03] globals.css: touch-action: pan-x pan-y !important вместо manipulation !important (не перезаписывает useContentHooks CSS)
- [19.1-03] getIframeRect helper для screen→iframe-viewport конвертации в gesture controller (elementFromPoint + onCenterTap)
- [19.1-03] bookmarkDebounceRef (50ms) + renderedDebounceRef (200ms) — два независимых таймера вместо единого debouncedApply
- [19.2-02] hooks.content.register для аннотаций вместо rendered event — гарантирует применение ДО рендеринга страницы (epub.js lifecycle: hooks.content -> rendered)
- [19.2-02] renderedDebounceRef удалён — единственный debounce bookmarkDebounceRef (50ms) для bookmark changes
- [19.2-01] selectstart listener вместо CSS/meta-tag для подавления Chrome Touch to Search — единственный способ, работающий на уровне Touch to Search
- [19.2-01] Порог 300ms для разделения short tap и long-press — согласован с gesture controller LONG_PRESS_TIMEOUT (350ms)
- [19.2-01] getIframeRect helper удалён — iframe events уже в iframe-viewport coords, конвертация не нужна
- [19.2-01] globals.css: iframe body правила удалены — useContentHooks.ts единственный источник стилей для iframe body

### Roadmap Evolution

- Phase 19.1 inserted after Phase 19: UAT-фиксы: выделение, прозрачность, edge taps, задержка заметок (URGENT)
- Phase 19.2 inserted after Phase 19.1: Мобильные баги ридера: touch selection, iframe координаты, annotation timing (URGENT — исследование показало фундаментально неверный подход в 19.1)

Полная таблица решений: .planning/PROJECT.md
Архив решений v1.0: .planning/milestones/v1.0-ROADMAP.md
Архив решений v1.1: .planning/milestones/v1.1-ROADMAP.md

### Ожидающие задачи

- UAT Round 2 на Pixel 9: проверить фиксы #1 (TOC), #3 (Info), #5 (SearchPanel кнопки)

### Блокеры/Опасения

- Плавность анимаций: приемлема, но есть потенциал для дальнейшей полировки (отложено)
- iOS overlay удаление: confidence MEDIUM, требует ручного тестирования на iOS Safari
- iOS drag handles при text selection плохо документированы (epub.js issue #904)
- Тестирование проводилось на Pixel 9 (Android PWA / Web Mobile), iOS не проверено
- Оставшиеся регрессии v1.1: выделение текста, описания (Phases 18-19)

## Непрерывность сессий

Последняя сессия: 2026-03-12
Phase 19.2 COMPLETE (both plans):
- Plan 02 — BUG-4 (annotation timing): FIXED — hooks.content.register вместо rendered event
- Plan 01 — BUG-1 (touch selection): FIXED — selectstart listener с timing-based подавлением (300ms порог)
- Plan 01 — BUG-5 (iframe coords): FIXED — убрано двойное вычитание iframeRect, elementFromPoint использует clientX напрямую
- getIframeRect helper удален, globals.css очищен от дублирующих правил
Milestone v1.2 complete. Следующий шаг: Human UAT Round 2 на Pixel 9, затем Phase 18 (текстовые заметки).
