---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Reader Stability & Polish
status: executing
last_updated: "2026-03-11T16:31:06Z"
last_activity: 2026-03-11 — Plan 18-01 complete (CSS selection unblock, gesture passthrough)
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 7
  completed_plans: 7
  percent: 40
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-03-10)

**Ключевая ценность:** AI-ридер с интерактивной Entity Wiki -- загрузка книги, чтение, AI-глоссарий без спойлеров, иллюстрации, заметки
**Текущий фокус:** Phase 18 -- Выделение текста и заметки

## Текущая позиция

Phase: 18 of 20 (Выделение текста и заметки)
Plan: 1 of 2 complete
Status: Plan 18-01 complete, executing Phase 18
Last activity: 2026-03-11 — Plan 18-01 complete (CSS selection unblock, gesture passthrough)

Progress: [████░░░░░░] 40%

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

Последняя сессия: 2026-03-11
Plan 18-01 complete: разблокировка мобильного выделения текста.
Убран CSS user-select:none для мобильных, добавлен selection-blocked class, contextmenu suppression, selection passthrough в gesture controller.
Коммиты: c11f583 (test), 5a6126d (feat), c4213e6 (feat).
Следующий: Plan 18-02 (HighlightTooltip).
