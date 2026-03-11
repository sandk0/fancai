# Phase 17: Шапка и панели - Research

**Researched:** 2026-03-11
**Domain:** Адаптивный UI ридера (responsive header, overflow menu, bottom sheet panels)
**Confidence:** HIGH

## Summary

Фаза 17 -- чисто фронтенд-задача по адаптации существующих компонентов ридера для экранов от 320px (iPhone SE) до планшетов. Никаких новых функций, только полировка layout: адаптивная шапка с overflow menu, исправление snap points панелей, фикс автофокуса клавиатуры.

Все необходимые библиотеки уже установлены и используются в проекте: Radix DropdownMenu для overflow menu, Vaul для bottom sheets, Tailwind CSS v4 для responsive breakpoints. Кастомный breakpoint `xs: 375px` уже определён в globals.css. Задача сводится к рефакторингу существующих компонентов без добавления зависимостей.

**Основная рекомендация:** Разделить работу на два плана: (1) адаптивная шапка с overflow menu + прогресс + перенос «Инфо» в TocSidebar; (2) snap points панелей + фикс автофокуса клавиатуры + SearchPanel на 320px.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- На 320px видны только 3 элемента: кнопка Назад (иконка без текста), процент прогресса по центру, кнопка overflow (MoreVertical)
- Все остальные кнопки (Оглавление, Поиск, Сущности, Настройки) уходят в overflow menu
- На десктопе (md/768px+) -- все кнопки видны, название книги и автор по центру (без изменений)
- Кнопка «Инфо» удаляется из шапки -- становится табом в оглавлении (TocSidebar: Оглавление / Заметки / Инфо)
- Overflow menu: popover/dropdown сверху (Radix DropdownMenu), иконка MoreVertical, формат: иконка слева + название справа
- Закрытие overflow: по клику на пункт + клик вне (стандартное поведение Radix)
- Анимация overflow: стандарт Radix (fade+scale), без badge на кнопке MoreVertical
- 320px прогресс: только «42%» по центру, без полосы, без страницы/всего
- 375px+ прогресс: процент + полоса прогресса
- sm (640px)+ прогресс: процент + полоса + страница/всего
- Все панели: snap points [0.5, 0.95] (было [0.5, 0.9])
- Оглавление: открывается на 0.95 по умолчанию
- Настройки: Vaul bottom sheet, snap points [0.5, 0.95]
- Убрать max-h-[90vh] из MobilePanel -- snap 0.95 сам ограничивает высоту
- Автофокус поля поиска только на десктопе (useIsMobile check)

### Claude's Discretion
- Конкретные breakpoints для появления кнопок из overflow (375px, 414px и т.д.)
- Порядок пунктов в overflow menu
- Нужно ли анимировать появление/скрытие кнопок при resize
- Поле поиска в SearchPanel на 320px -- убедиться что помещается

### Deferred Ideas (OUT OF SCOPE)
Нет -- обсуждение осталось в рамках фазы.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HDR-01 | Шапка ридера помещается на экран от 320px (iPhone SE) -- overflow menu для второстепенных кнопок | Radix DropdownMenu уже установлен и используется; Tailwind breakpoints xs/sm/md покрывают все размеры; ReaderHeader.tsx требует рефакторинга layout |
| HDR-02 | Поле поиска и кнопка закрытия полностью видны на любом экране, крестик не обрезается | SearchPanel.tsx: statusText min-w-[80px] нужно сделать адаптивным; flex layout уже корректный, но нужна проверка на 320px |
| PNL-01 | Панели настроек, оглавления и заметок отображают всё содержимое (Vaul snap points, полная высота) | MobilePanel.tsx: заменить max-h-[90vh] на max-h-[97%] (рекомендация Vaul docs), snap [0.5, 0.9] -> [0.5, 0.95], defaultSnap 0.95 для TocSidebar |
| PNL-02 | Клавиатура не открывается автоматически при открытии оглавления | TocSidebar.tsx строка 123-126: setTimeout(() => inputRef.current?.focus(), 100) -- нужно обернуть в if (!isMobile) |
</phase_requirements>

## Standard Stack

### Core (уже установлено)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @radix-ui/react-dropdown-menu | ^2.1.16 | Overflow menu шапки | Уже используется в dropdown-menu.tsx и ReaderControls |
| vaul | ^1.1.2 | Bottom sheet панели | Уже используется в MobilePanel.tsx |
| tailwindcss | ^4.1.18 | Responsive layout | CSS-first config, кастомный xs breakpoint уже определён |
| lucide-react | ^0.563.0 | Иконки (MoreVertical, List, Search, Library, Settings) | Уже используются во всех компонентах ридера |
| motion | ^12.31.0 | Анимация шапки (spring show/hide) | Уже используется в ReaderHeader |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-virtual | ^3.13.18 | Виртуализация оглавления | Уже используется в TocSidebar (> 20 глав) |

### Alternatives Considered
Нет -- все нужные библиотеки уже в проекте. Новых зависимостей не требуется.

## Architecture Patterns

### Текущая структура файлов (затрагиваемые)
```
frontend/src/
├── components/
│   ├── Reader/
│   │   ├── ReaderHeader.tsx         # 144 строки -- ОСНОВНОЙ РЕФАКТОРИНГ
│   │   ├── TocSidebar.tsx           # 347 строк -- добавить таб Info, фикс autofocus
│   │   ├── SearchPanel.tsx          # 185 строк -- адаптация layout на 320px
│   │   ├── BookInfo.tsx             # 111 строк -- извлечь контент для таба в TocSidebar
│   │   ├── EpubReader.tsx           # 753 строки -- обновить onInfoOpen -> openToc с табом
│   │   └── Core/
│   │       ├── ReaderUI.tsx         # 127 строк -- обновить props (удалить onInfoOpen)
│   │       └── ReaderModals.tsx     # 169 строк -- убрать BookInfo modal
│   └── UI/
│       ├── MobilePanel.tsx          # 70 строк -- snap points + убрать max-h
│       └── dropdown-menu.tsx        # 199 строк -- БЕЗ ИЗМЕНЕНИЙ
├── hooks/shared/
│   └── useIsMobile.ts              # 37 строк -- БЕЗ ИЗМЕНЕНИЙ
└── styles/
    └── globals.css                  # xs: 375px breakpoint уже определён
```

### Pattern 1: Responsive Overflow с Tailwind breakpoints
**Что:** Кнопки шапки скрываются/показываются через Tailwind responsive classes, скрытые кнопки дублируются в Radix DropdownMenu.
**Когда:** При переходе с мобильного на десктоп layout.
**Рекомендуемые breakpoints:**
- **< 375px (320px, iPhone SE):** Назад + процент по центру + overflow (MoreVertical) -- 3 элемента
- **375px+ (xs):** Назад + Оглавление + процент + overflow -- 4 элемента (Оглавление выходит из overflow)
- **640px+ (sm):** Назад + Оглавление + процент с полосой и страницей + Сущности + overflow -- overflow остаётся для Поиска и Настроек
- **768px+ (md):** Все кнопки видны, название книги по центру, overflow скрыт

**Пример:**
```tsx
// Кнопка оглавления -- видна от xs (375px)
<button
  onClick={onTocToggle}
  className="hidden xs:flex items-center justify-center w-11 h-11 ..."
>
  <List className="w-5 h-5" />
</button>

// Overflow menu -- скрыт от md (768px)
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <button className="md:hidden flex items-center justify-center w-11 h-11 ...">
      <MoreVertical className="w-5 h-5" />
    </button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    {/* Пункты, которые скрыты на текущем breakpoint */}
    <DropdownMenuItem onClick={onTocToggle} className="xs:hidden">
      <List className="w-5 h-5" />
      <span>Оглавление</span>
    </DropdownMenuItem>
    {/* ... остальные пункты */}
  </DropdownMenuContent>
</DropdownMenu>
```

### Pattern 2: Адаптивный прогресс
**Что:** Прогресс показывает разный уровень детализации в зависимости от ширины экрана.
**Когда:** В шапке ридера.
**Пример:**
```tsx
<div className="flex flex-col items-center gap-1 flex-1 min-w-0">
  <div className="flex items-center gap-1.5">
    {/* Страница/всего -- только от sm */}
    {currentPage && totalPages && (
      <span className="hidden sm:inline font-medium text-xs text-muted-foreground">
        {currentPage}/{totalPages}
      </span>
    )}
    <span className="font-bold text-sm tabular-nums text-foreground">
      {progress < 10 ? progress.toFixed(1) : Math.round(progress)}%
    </span>
  </div>
  {/* Полоса прогресса -- только от xs (375px) */}
  <div className="hidden xs:block w-full h-1.5 rounded-full bg-muted">
    <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
  </div>
</div>
```

### Pattern 3: Перенос «Инфо» в TocSidebar как таб
**Что:** BookInfo перестаёт быть модалом, становится третьим табом в TocSidebar.
**Подход:**
1. Извлечь контент BookInfo.tsx в отдельный компонент `BookInfoContent.tsx` (без модальной обёртки)
2. Добавить таб `'info'` в TocSidebar (`SidebarTab = 'toc' | 'notes' | 'info'`)
3. В EpubReader.tsx: `onInfoOpen` -> `setIsTocOpen(true)` + `setTocActiveTab('info')`
4. Удалить модал BookInfo из ReaderModals.tsx
5. Удалить `onInfoOpen` из ReaderHeader props (кнопка Info удаляется из шапки)
6. Удалить `isBookInfoOpen` state из EpubReader.tsx

### Anti-Patterns to Avoid
- **window.innerWidth вместо matchMedia/Tailwind:** Не использовать JS для определения breakpoints -- всё через Tailwind responsive classes, кроме useIsMobile (который уже использует matchMedia)
- **Дублирование логики breakpoints:** Один источник правды -- Tailwind classes для показа/скрытия кнопок, overflow menu показывает ВСЕ пункты, а CSS скрывает те, что уже видны как кнопки
- **autoFocus на input без проверки устройства:** На мобильных это вызывает клавиатуру при открытии панели -- всегда проверять `useIsMobile()`
- **max-h на Drawer.Content при snap points:** Snap points уже контролируют высоту, `max-h-[90vh]` создаёт конфликт, ограничивая контент ниже ожидаемой высоты snap point

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dropdown/popover menu | Кастомный dropdown с useState + portal | Radix DropdownMenu (уже есть) | Accessibility, keyboard nav, click-outside, portal, focus management |
| Bottom sheet с snap points | Кастомный draggable sheet | Vaul Drawer (уже есть) | Gesture handling, physics, scroll lock, snap transitions |
| Responsive visibility | JS resize observer + state | Tailwind responsive classes | CSS media queries быстрее, не вызывают re-render |
| Focus management при открытии/закрытии | Manual focus/blur | useFocusTrap (уже есть) + Radix built-in | Edge cases: circular focus, initial focus, return focus |

**Ключевой инсайт:** Все нужные примитивы уже в проекте. Задача -- правильно скомпоновать существующие компоненты, не добавляя зависимостей.

## Common Pitfalls

### Pitfall 1: Конфликт max-h и snap points в Vaul
**Что происходит:** MobilePanel.tsx имеет `max-h-[90vh]` на Drawer.Content. При snap point 0.95 контент может обрезаться, т.к. 90vh < 95vh.
**Почему:** max-h CSS ограничивает высоту элемента независимо от snap point position Vaul.
**Как избежать:** Заменить `max-h-[90vh]` на `max-h-[97%]` (как в документации Vaul) или убрать полностью -- snap points сами контролируют высоту drawer.
**Признаки:** Контент панели обрезается снизу при максимальном snap point.

### Pitfall 2: Overflow menu показывает кнопки, которые уже видны
**Что происходит:** На sm экране кнопка Оглавления видна И в шапке, И в overflow menu.
**Почему:** Radix DropdownMenu рендерит все пункты, а видимость кнопок определяется CSS.
**Как избежать:** Пункты overflow menu должны иметь обратные responsive classes: `className="xs:hidden"` для пункта Оглавление (показывать в overflow только когда кнопка скрыта). Это чисто CSS-решение без JS.
**Признаки:** Дублирование действий в UI.

### Pitfall 3: Клавиатура при открытии оглавления на мобильных
**Что происходит:** TocSidebar.tsx (строка 123) делает `inputRef.current?.focus()` при открытии, вызывая клавиатуру.
**Почему:** setTimeout + focus() работает и на мобильных, где focus на input вызывает virtual keyboard.
**Как избежать:** Обернуть в проверку: `if (!isMobile) inputRef.current?.focus()`.
**Признаки:** PNL-02 -- клавиатура выскакивает при открытии оглавления.

### Pitfall 4: SearchPanel statusText на 320px
**Что происходит:** На 320px input + statusText (min-w-[80px]) + nav buttons + close button могут не поместиться.
**Почему:** min-w-[80px] на statusText занимает фиксированное пространство, сжимая input.
**Как избежать:** На маленьких экранах скрыть statusText или уменьшить min-w. Использовать `hidden xs:inline` или сделать statusText адаптивным.
**Признаки:** Input поиска слишком узкий или кнопка X обрезается.

### Pitfall 5: Потеря onInfoOpen callback chain
**Что происходит:** При переносе «Инфо» в TocSidebar нужно обновить всю цепочку: EpubReader -> ReaderUI -> ReaderHeader.
**Почему:** onInfoOpen передаётся через 3 уровня (EpubReader -> ReaderUI -> ReaderHeader).
**Как избежать:** Удалить onInfoOpen из всех уровней. Вместо этого добавить prop `initialTab` в TocSidebar и вызывать `setIsTocOpen(true)` с нужным табом.
**Признаки:** TypeScript ошибки при удалении prop, runtime error если забыть убрать из одного уровня.

## Code Examples

### Адаптивная шапка (ReaderHeader) -- ключевые изменения

```tsx
// Источник: анализ текущего ReaderHeader.tsx + CONTEXT.md решения

// Структура шапки: [Назад] [Оглавление?] [Прогресс по центру] [Сущности?] [Поиск?] [Настройки?] [Overflow?]
// ? = условно видимы в зависимости от breakpoint

import { MoreVertical, List, Search, Library, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/UI/dropdown-menu';

// Внутри ReaderHeader:
<div className="flex items-center justify-between px-2 xs:px-4 py-3 gap-2">
  {/* Левая часть: Назад + Оглавление (от xs) */}
  <div className="flex items-center gap-1 xs:gap-2 flex-shrink-0">
    <button onClick={onBack} className="min-h-[44px] min-w-[44px] ...">
      <ArrowLeft className="w-5 h-5" />
      {/* Текст "Назад" -- только от sm */}
      <span className="hidden sm:inline font-medium">{t('reader.header.back')}</span>
    </button>
    {/* Оглавление -- видна от xs (375px) */}
    <button onClick={onTocToggle} className="hidden xs:flex w-11 h-11 ...">
      <List className="w-5 h-5" />
    </button>
  </div>

  {/* Центр: Прогресс */}
  <div className="flex-1 flex flex-col items-center min-w-0">
    {/* Название книги -- только md */}
    <h1 className="hidden md:block text-lg font-semibold truncate">{title}</h1>
    <div className="flex items-center gap-1.5">
      <span className="hidden sm:inline text-xs text-muted-foreground">
        {currentPage}/{totalPages}
      </span>
      <span className="font-bold text-sm tabular-nums">{formatProgress(progress)}</span>
    </div>
    {/* Полоса -- от xs */}
    <div className="hidden xs:block w-full max-w-[200px] h-1.5 rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
    </div>
  </div>

  {/* Правая часть: кнопки + overflow */}
  <div className="flex items-center gap-1 xs:gap-2 flex-shrink-0">
    {/* Сущности -- видны от sm */}
    <button onClick={onEntitiesOpen} className="hidden sm:flex w-11 h-11 ...">
      <Library className="w-5 h-5" />
    </button>
    {/* Поиск -- виден от sm */}
    <button onClick={onSearchToggle} className="hidden sm:flex w-11 h-11 ...">
      <Search className="w-5 h-5" />
    </button>
    {/* Настройки -- видны от md */}
    <button onClick={onSettingsOpen} className="hidden md:flex w-11 h-11 ...">
      <Settings className="w-5 h-5" />
    </button>

    {/* Overflow -- скрыт от md */}
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="md:hidden flex w-11 h-11 ...">
          <MoreVertical className="w-5 h-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onTocToggle} className="xs:hidden">
          <List className="w-5 h-5" /> Оглавление
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEntitiesOpen} className="sm:hidden">
          <Library className="w-5 h-5" /> Сущности
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSearchToggle} className="sm:hidden">
          <Search className="w-5 h-5" /> Поиск
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSettingsOpen} className="md:hidden">
          <Settings className="w-5 h-5" /> Настройки
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</div>
```

### MobilePanel -- исправление snap points

```tsx
// Источник: текущий MobilePanel.tsx + Vaul docs + CONTEXT.md

// БЫЛО:
<Drawer.Content className="... max-h-[90vh] ...">

// СТАЛО:
<Drawer.Content className="... max-h-[97%] ...">
// Или вообще убрать max-h -- snap point 0.95 сам ограничивает

// БЫЛО (вызовы):
snapPoints={[0.5, 0.9]}

// СТАЛО:
snapPoints={[0.5, 0.95]}
```

### TocSidebar -- фикс автофокуса + таб Инфо

```tsx
// Источник: текущий TocSidebar.tsx строка 123-126

// БЫЛО:
useEffect(() => {
  if (isOpen && activeTab === 'toc') {
    setTimeout(() => inputRef.current?.focus(), 100);
  }
}, [isOpen, activeTab]);

// СТАЛО:
useEffect(() => {
  if (isOpen && activeTab === 'toc' && !isMobile) {
    setTimeout(() => inputRef.current?.focus(), 100);
  }
}, [isOpen, activeTab, isMobile]);

// Добавить таб 'info':
type SidebarTab = 'toc' | 'notes' | 'info';

const tabs = [
  { key: 'toc', label: t('reader.sidebar.toc') },
  { key: 'notes', label: t('reader.sidebar.notes'), count: bookmarks.length },
  { key: 'info', label: t('reader.sidebar.info') },
];
```

## State of the Art

| Старый подход | Текущий подход | Когда изменилось | Impact |
|--------------|----------------|------------------|--------|
| tailwind.config.js | CSS-first @theme в globals.css | Tailwind v4 | Breakpoints определяются в CSS, не в JS config |
| Фиксированные snap points [0.5, 0.9] | [0.5, 0.95] с max-h-[97%] | Vaul 1.x best practice | Контент на полную высоту экрана |
| BookInfo как отдельный модал | Таб внутри TocSidebar | Решение пользователя для Phase 17 | Одна кнопка меньше в шапке, вся навигация в одном месте |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + @testing-library/react |
| Config file | `frontend/vitest.config.ts` |
| Quick run command | `cd frontend && npm test -- --run` |
| Full suite command | `cd frontend && npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HDR-01 | Шапка помещается на 320px, overflow menu работает | manual-only | Нет автоматической команды -- визуальная проверка в DevTools | N/A |
| HDR-02 | Поле поиска и крестик видны на любом экране | manual-only | Нет автоматической команды -- визуальная проверка | N/A |
| PNL-01 | Панели показывают всё содержимое (snap 0.95) | manual-only | Нет автоматической команды -- визуальная проверка на устройстве | N/A |
| PNL-02 | Клавиатура не открывается при открытии оглавления | unit | `cd frontend && npx vitest run src/components/Reader/__tests__/TocSidebar.test.tsx` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd frontend && npm run build` (TypeScript compilation check)
- **Per wave merge:** `cd frontend && npm test`
- **Phase gate:** Build green + ручное тестирование в Chrome DevTools (320px, 375px, 768px viewports)

### Wave 0 Gaps
- [ ] TypeScript build must pass: `cd frontend && npm run build` -- проверка типов после удаления onInfoOpen prop chain
- [ ] Ручное тестирование: Chrome DevTools responsive mode (320px, 375px, 640px, 768px)

*Основной тип тестирования для этой фазы -- визуальный/ручной (responsive layout). Автоматическое тестирование ограничено unit-тестом на isMobile-conditional autofocus и TypeScript compilation.*

## Open Questions

1. **Overflow menu: показывать ли пункты через DropdownMenuItem с className="xs:hidden" или через JS?**
   - Что знаем: Radix рендерит все пункты в DOM, CSS `display: none` скроет их визуально
   - Что неясно: Radix DropdownMenuItem с `display: none` -- корректно ли это для accessibility (aria)?
   - Рекомендация: Использовать CSS-подход (`className="xs:hidden"`). Radix items со скрытым display не участвуют в keyboard navigation. Если будут проблемы с accessibility -- переключиться на JS-фильтрацию через useIsMobile + дополнительные breakpoint хуки.

2. **TocSidebar: как передать initialTab при открытии из overflow menu?**
   - Что знаем: Сейчас TocSidebar управляет activeTab внутренним useState
   - Что неясно: Нужен ли prop `initialTab` или controlled `activeTab` + `onTabChange`
   - Рекомендация: Добавить prop `activeTab` + `onTabChange` (controlled mode). В EpubReader: `const [tocTab, setTocTab] = useState<SidebarTab>('toc')`. При `onInfoOpen` (из overflow на маленьких экранах -- если решим сохранить): `setTocTab('info'); setIsTocOpen(true)`.

## Sources

### Primary (HIGH confidence)
- Исходный код проекта: ReaderHeader.tsx, MobilePanel.tsx, TocSidebar.tsx, SearchPanel.tsx, dropdown-menu.tsx, useIsMobile.ts, EpubReader.tsx, ReaderUI.tsx, ReaderModals.tsx, BookInfo.tsx, ReaderControls.tsx
- package.json: версии vaul ^1.1.2, @radix-ui/react-dropdown-menu ^2.1.16, tailwindcss ^4.1.18
- globals.css: кастомный breakpoint xs: 375px
- Vaul type definitions (node_modules/vaul/dist/index.d.ts): snap points API

### Secondary (MEDIUM confidence)
- [Vaul Snap Points Documentation](https://vaul.emilkowal.ski/snap-points) -- рекомендация max-h-[97%] для Content
- [Vaul GitHub Issue #579](https://github.com/emilkowalski/vaul/issues/579) -- конфликт snap points и max-h

### Tertiary (LOW confidence)
Нет.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- все библиотеки уже в проекте, версии проверены из package.json
- Architecture: HIGH -- все файлы прочитаны, структура понятна, integration points задокументированы
- Pitfalls: HIGH -- каждый pitfall подтверждён анализом исходного кода (номера строк указаны)

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (стабильные зависимости, нет fast-moving APIs)