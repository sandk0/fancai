---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Reader Stability & Polish
status: executing
last_updated: "2026-03-11T01:47:12.387Z"
last_activity: 2026-03-11 — Plan 17-03 complete (ReaderFooter с прогресс-линией)
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 7
  completed_plans: 6
  percent: 71
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-03-10)

**Ключевая ценность:** AI-ридер с интерактивной Entity Wiki -- загрузка книги, чтение, AI-глоссарий без спойлеров, иллюстрации, заметки
**Текущий фокус:** Phase 18 -- Выделение текста и заметки

## Текущая позиция

Phase: 18 of 20 (Выделение текста и заметки)
Plan: 0 of 2 complete
Status: Phase 17 gap closure in progress
Last activity: 2026-03-11 — Plan 17-03 complete (ReaderFooter с прогресс-линией)

Progress: [███████░░░] 71%

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

Полная таблица решений: .planning/PROJECT.md
Архив решений v1.0: .planning/milestones/v1.0-ROADMAP.md
Архив решений v1.1: .planning/milestones/v1.1-ROADMAP.md

### Ожидающие задачи

(нет)

### Блокеры/Опасения

- Плавность анимаций: приемлема, но есть потенциал для дальнейшей полировки (отложено)
- iOS overlay удаление: confidence MEDIUM, требует ручного тестирования на iOS Safari
- iOS drag handles при text selection плохо документированы (epub.js issue #904)
- Тестирование проводилось на Pixel 9 (Android PWA / Web Mobile), iOS не проверено
- Оставшиеся регрессии v1.1: выделение текста, описания (Phases 18-19)

## Непрерывность сессий

Последняя сессия: 2026-03-11
Plan 17-03: ReaderFooter с прогресс-линией, процентом, счётчиком страниц. Прогресс удалён из шапки.
Коммиты Plan 17-03: c865083, 98b5fb6.
Следующий шаг: выполнение оставшихся gap closure планов Phase 17 (17-04) или Phase 18.
