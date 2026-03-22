# Frontend UX/UI Аудит — fancai

**Дата:** 2026-03-15
**Охват:** 100+ TSX/TS файлов, 4 области (Reader, Entity Wiki, Pages & Layout, UI Components & Design System)
**Найдено:** 109 проблем (8 critical, 31 major, 48 minor, 22 suggestion)

---

## Оглавление

1. [Сводная таблица по областям](#1-сводная-таблица-по-областям)
2. [Critical — требуют немедленного исправления](#2-critical)
3. [Major — существенно влияют на UX](#3-major)
4. [Minor — мелкие улучшения](#4-minor)
5. [Suggestions — рекомендации](#5-suggestions)
6. [Legacy & Dead Code](#6-legacy--dead-code)
7. [Дизайн-система: проблемы консистентности](#7-дизайн-система)
8. [Дорожная карта исправлений](#8-дорожная-карта)

---

## 1. Сводная таблица по областям

| Область                             | Critical | Major  | Minor  | Suggestion | Итого   |
| ----------------------------------- | -------- | ------ | ------ | ---------- | ------- |
| Reader (EpubReader, hooks, pages)   | 2        | 8      | 11     | —          | 21      |
| Entity Wiki (Drawer, List, Profile) | 1        | 7      | 17     | 4          | 29      |
| Pages & Layout (навигация, формы)   | 3        | 7      | 11     | 4          | 25      |
| UI Components & Design System       | 2        | 9      | 10     | 13         | 34      |
| **Итого**                           | **8**    | **31** | **49** | **21**     | **109** |

---

## 2. Critical

### C-01. iOS: Overlay центрального тапа — захардкоженная высота хедера

**Файл:** `hooks/epub/useGestureController.ts:932-946`
**Категория:** iOS Safari, UX
**Проблема:** Overlay для center-tap использует `top: calc(env(safe-area-inset-top) + 64px)`, но 64px — фиксированная высота хедера. В immersive mode (хедер скрыт) overlay сдвинут на 64px ниже реальной зоны тапа. Пользователь промахивается.
**Исправление:** Передавать `isHeaderVisible` в useGestureController, динамически вычислять offset:

```ts
const headerOffset = isHeaderVisible ? 64 : 0;
overlay.style.top = `calc(env(safe-area-inset-top) + ${headerOffset}px)`;
```

### C-02. Нет empty state на LibraryPage после фильтрации

**Файл:** `pages/LibraryPage.tsx:450-461`
**Категория:** UX
**Проблема:** Когда `displayBooks.length === 0` после фильтров — пустая страница без объяснения. Пользователь не понимает, фильтры сработали или ошибка.
**Исправление:** Показывать «Книги не найдены» + кнопка «Сбросить фильтры».

### C-03. Битая ссылка: BookImagesPage → неправильный маршрут

**Файл:** `pages/BookImagesPage.tsx:117`
**Категория:** Navigation
**Проблема:** `to={/books/${bookId}}` — маршрут `/books/:id` не существует (правильный: `/book/:id`). Кнопка «Читать книгу» ведёт на 404.
**Исправление:** `to={/book/${bookId}/read}`.

### C-04. Непоследовательная навигация: Header vs BottomNav vs Sidebar

**Файл:** `Layout/Header.tsx:67-70`, `Navigation/BottomNav.tsx:30-36`, `Layout/Sidebar.tsx`
**Категория:** UX, IA
**Проблема:** Desktop Header — Home + Library. Mobile BottomNav — Home + Library + Gallery + Settings + Profile. Sidebar — ещё один набор. Три уровня навигации с разным составом пунктов.
**Исправление:** Унифицировать навигационную модель: desktop — Header + Sidebar, mobile — BottomNav only. Задокументировать в design system.

### C-05. DebugPanel: захардкоженные цвета вне дизайн-системы

**Файл:** `components/UI/DebugPanel.tsx` (25 мест)
**Категория:** Design System, Theme
**Проблема:** Используются hex-цвета (`#22c55e`, `#ef4444`, `#0f172a`, и т.д.) в inline styles. Не работают с sepia/outdoor темами. Ломает визуальную консистентность.
**Исправление:** Заменить на CSS-переменные: `var(--color-text-default)`, `var(--color-error)` и т.д.

### C-06. ErrorMessage: цвета не из дизайн-системы

**Файл:** `components/UI/ErrorMessage.tsx:31-32, 39-40`
**Категория:** Theme
**Проблема:** `text-red-600`, `bg-red-50`, `dark:bg-red-900/20` — работает только в light/dark, не поддерживает sepia/outdoor. Не использует `--color-error`.
**Исправление:** `text-[var(--color-error)] bg-[var(--color-error-muted)]`.

### C-07. EntityPopup: неверный i18n-ключ

**Файл:** `components/Reader/EntityPopup.tsx:132`
**Категория:** UX (показывается raw ключ)
**Проблема:** `t('entities.types.${entity.type}')` — в файле переводов ключи `type_character`, не `types.character`. Пользователь увидит `entities.types.character` вместо «Персонаж».
**Исправление:** `t('entities.type_${entity.type}')`. Но компонент — dead code (см. L-01), поэтому проще удалить.

### C-08. EntityEventTimeline: отсутствует проверка isEntityMet

**Файл:** `components/Entities/EntityEventTimeline.tsx:10-50`
**Категория:** Spoiler Safety
**Проблема:** Фильтрует события только по `currentChapter`, но не проверяет, встречал ли читатель саму сущность. Может показать спойлерные события если chapter numbers рассинхронизированы.
**Исправление:** Добавить проверку `isEntityMetCFI()` перед рендерингом.

---

## 3. Major

### Reader

| ID   | Проблема                                                                            | Файл                                              | Строка       |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------- | ------------ |
| M-01 | SelectionMenu не учитывает safe-area-inset — меню попадает под notch/home indicator | `Reader/SelectionMenu.tsx`                        | 142-167      |
| M-02 | Gesture controller недоступен с клавиатуры — только тач/клик                        | `hooks/epub/useGestureController.ts`              | 712          |
| M-03 | ProgressSaveIndicator: setState во время render — React warning                     | `Reader/ProgressSaveIndicator.tsx`                | 13-17        |
| M-04 | FollowFingerContainer: pointerEvents: 'none' может заблокировать взаимодействие     | `Reader/FollowFingerContainer.tsx`                | 54-62        |
| M-05 | iOS bounce scroll не отключён в ReaderPage                                          | `pages/ReaderPage.tsx`                            | 19-44        |
| M-06 | useAnnotationRendering: хрупкий regex для CFI без кеширования                       | `hooks/epub/useAnnotationRendering.ts`            | 82-132       |
| M-07 | Cross-page selection detection: порог 2000px слишком широкий                        | `hooks/epub/useTextSelection.ts`                  | 207          |
| M-08 | EntityPopup + EntityBottomSheet: дублированный код getEntityIcon/truncation         | `Reader/EntityPopup.tsx`, `EntityBottomSheet.tsx` | 40-48, 16-24 |

### Entity Wiki

| ID   | Проблема                                                       | Файл                                           | Строка  |
| ---- | -------------------------------------------------------------- | ---------------------------------------------- | ------- |
| M-09 | EntityCard и EntityProfile без React.memo — лишние ре-рендеры  | `Entities/EntityCard.tsx`, `EntityProfile.tsx` | —       |
| M-10 | EntityDrawer: обработчики без useCallback                      | `Entities/EntityDrawer.tsx`                    | 81-100  |
| M-11 | EntityList: поиск без debounce — лаг на 100+ сущностях         | `Entities/EntityList.tsx`                      | 81-83   |
| M-12 | Breadcrumb в EntityDrawer без aria-label                       | `Entities/EntityDrawer.tsx`                    | 111-146 |
| M-13 | EntityPopup: hardcoded z-index: 500, конфликт с Z_INDEX        | `Reader/EntityPopup.tsx`                       | 36      |
| M-14 | RelationshipCard: circular navigation без breadcrumb контекста | `Entities/RelationshipCard.tsx`                | 112-129 |
| M-15 | Нет loading skeleton для EntityProfile при переключении        | `Entities/EntityDrawer.tsx`                    | —       |

### Pages & Layout

| ID   | Проблема                                                    | Файл                                  | Строка  |
| ---- | ----------------------------------------------------------- | ------------------------------------- | ------- |
| M-16 | Разные loading indicators на каждой странице                | Multiple                              | —       |
| M-17 | ReadOnly поля в Settings без визуальной индикации disabled  | `Settings/AccountSettingsSection.tsx` | 33-49   |
| M-18 | Пароль: требования показываются только после фокуса         | `Auth/RegistrationForm.tsx`           | 136-154 |
| M-19 | BookGalleryPage: raw CSS variables вместо Tailwind semantic | `pages/BookGalleryPage.tsx`           | 59+     |
| M-20 | Генерические error messages без различения типов ошибок     | `pages/BookPage.tsx`                  | 59-81   |
| M-21 | Upload modal: disabled close button без visual feedback     | `Books/BookUploadModal.tsx`           | 283-290 |
| M-22 | Header logo скрыт на mobile без альтернативы                | `Layout/Header.tsx`                   | 87-89   |

### UI Components

| ID   | Проблема                                                                    | Файл                      | Строка   |
| ---- | --------------------------------------------------------------------------- | ------------------------- | -------- |
| M-23 | MobilePanel: z-50 вместо Z_INDEX системы                                    | `UI/MobilePanel.tsx`      | 66       |
| M-24 | Badge: нет CVA-вариантов, нет размеров, hardcoded цвета                     | `UI/badge.tsx`            | 1-35     |
| M-25 | Switch: белый thumb захардкожен — невидим в sepia теме                      | `UI/Switch.tsx`           | 133      |
| M-26 | LoadingSpinner: вариант `white` не работает в sepia/outdoor                 | `UI/LoadingSpinner.tsx`   | 26-30    |
| M-27 | Dialog: icon background `destructive/10` вместо `--color-error-muted`       | `UI/Dialog.tsx`           | 194-201  |
| M-28 | LoadingSpinner: неверный import path `@/utils/cn`                           | `UI/LoadingSpinner.tsx`   | 2        |
| M-29 | ImageGallery: badge цвета не из дизайн-системы                              | `Images/ImageGallery.tsx` | 277, 313 |
| M-30 | Нет aria-live region при фильтрации — screen readers не получают обновления | `pages/LibraryPage.tsx`   | 289-301  |
| M-31 | LoadingSpinner: отсутствует sr-only текст без prop `text`                   | `UI/LoadingSpinner.tsx`   | 41-44    |

---

## 4. Minor

### Accessibility (12)

| ID   | Проблема                                                                 | Файл                                        |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------- |
| m-01 | Backdrop элементы без role="presentation"                                | `SelectionMenu.tsx`, `HighlightTooltip.tsx` |
| m-02 | ReaderPage: нет focus management после закрытия модалок                  | `ReaderPage.tsx`                            |
| m-03 | ExtractionIndicator: emoji вместо lucide icons, плохо для screen readers | `ExtractionIndicator.tsx:37`                |
| m-04 | EntityBottomSheet: snap points без ARIA labels                           | `EntityBottomSheet.tsx:14`                  |
| m-05 | EntityCard ChevronRight: aria-label без «View details»                   | `EntityCard.tsx:107`                        |
| m-06 | EntityProfile Relations: нет aria-disabled для not-met                   | `EntityProfile.tsx:195`                     |
| m-07 | SpoilerText: `<span>` с onClick вместо `<button>`                        | `SpoilerText.tsx:43`                        |
| m-08 | ProfilePage progress bars без role="progressbar"                         | `ProfilePage.tsx:284`                       |
| m-09 | NotFoundPage: нет focus-visible ring на кнопках                          | `NotFoundPage.tsx:95`                       |
| m-10 | Skeleton loading без aria-busy="true"                                    | `Home/Skeletons.tsx`                        |
| m-11 | ContinueReadingCard: div с role="button" вместо `<button>`               | `Home/ContinueReadingCard.tsx:49`           |
| m-12 | Checkbox aria-invalid: undefined вместо false                            | `UI/Checkbox.tsx:256`                       |

### UI & Responsive (15)

| ID   | Проблема                                                                    | Файл                                      |
| ---- | --------------------------------------------------------------------------- | ----------------------------------------- |
| m-13 | ReaderHeader: hidden xs:flex ломается на 320px экранах                      | `ReaderHeader.tsx:54`                     |
| m-14 | HighlightTooltip: estimated height 120px — неточное позиционирование        | `HighlightTooltip.tsx:56`                 |
| m-15 | SelectionMenu backdrop: opacity 0.01 — нет feedback при тапе                | `SelectionMenu.tsx:207`                   |
| m-16 | EntityDrawer desktop: фиксированная 420px ширина, cramped на iPad           | `EntityDrawer.tsx:253`                    |
| m-17 | Непоследовательные размеры аватаров: 48px vs 40px                           | `EntityCard.tsx:65`, `EntityMiniCard.tsx` |
| m-18 | LibraryPage sort dropdown overflow на mobile                                | `LibraryPage.tsx:323`                     |
| m-19 | Header email truncated без tooltip                                          | `Header.tsx:215`                          |
| m-20 | Sidebar: hardcoded `text-[var(--color-text-muted)]` вместо semantic classes | `Sidebar.tsx:122`                         |
| m-21 | Inconsistent entity description truncation: 50/80/100 chars                 | Multiple entity files                     |
| m-22 | EntityList filter: нет visual distinction для пустых фильтров               | `EntityList.tsx:115`                      |
| m-23 | Stagger animation ограничена 10 items — items 11+ появляются мгновенно      | `EntityList.tsx:15`                       |
| m-24 | Safe-area edge case в ReaderPage parsing indicator                          | `ReaderPage.tsx:188`                      |
| m-25 | Upload errors joined с \n в toast — плохое форматирование                   | `BookUploadModal.tsx:179`                 |
| m-26 | Непоследовательные имена файлов: PascalCase vs kebab-case в UI/             | `UI/badge.tsx`, `scroll-area.tsx` и др.   |
| m-27 | Input required indicator: aria-hidden вместо aria-label="required"          | `UI/Input.tsx:102`                        |

### Performance (10)

| ID   | Проблема                                                             | Файл                            |
| ---- | -------------------------------------------------------------------- | ------------------------------- |
| m-28 | EpubReader: handleCenterTap с 4+ deps → частое пересоздание          | `EpubReader.tsx`                |
| m-29 | useAnnotationRendering: debounce без cleanup на unmount              | `useAnnotationRendering.ts:286` |
| m-30 | pendingNavRef: потеря events при 3+ быстрых тапах                    | `useGestureController.ts:182`   |
| m-31 | EntityList: virtualization threshold 30 — DOM bloat при 25 entities  | `EntityList.tsx:13`             |
| m-32 | EntityList search: нет debounce — re-filter на каждый keystroke      | `EntityList.tsx:81`             |
| m-33 | Book cover images: нет HTTP cache headers                            | Multiple                        |
| m-34 | EntityEventTimeline: non-null assertion `grouped.get(ch)!` без guard | `EntityEventTimeline.tsx:36`    |
| m-35 | RelationshipCard: CFI validation failure → silent spoiler            | `RelationshipCard.tsx:33`       |
| m-36 | Avatar и Badge: дублированная fn cn() вместо import из lib/utils     | `UI/avatar.tsx`, `UI/badge.tsx` |
| m-37 | ErrorMessage: неверный import path `@/utils/cn`                      | `UI/ErrorMessage.tsx:4`         |

### i18n (2)

| ID   | Проблема                                                                  | Файл                             |
| ---- | ------------------------------------------------------------------------- | -------------------------------- |
| m-38 | entityTypeLabels Proxy: нет logging для missing keys                      | `Entities/entityTypeLabels.ts:9` |
| m-39 | EntityDrawer: `entityDrawer.title` vs `entities.drawer_title` — проверить | `EntityDrawer.tsx:120`           |

---

## 5. Suggestions

| ID   | Тема                          | Описание                                                             |
| ---- | ----------------------------- | -------------------------------------------------------------------- |
| S-01 | EntityDrawer controlled state | Anti-pattern: setState вне useEffect (строки 56-68)                  |
| S-02 | RelationshipCard weight       | Значение `+3`/`-2` без контекста — добавить подсказку                |
| S-03 | EntityCard summary            | `truncate` → `line-clamp-2` для multi-line                           |
| S-04 | Copy entity name              | Добавить click-to-copy на именах сущностей                           |
| S-05 | Share entity                  | Кнопка «Поделиться» для профиля сущности                             |
| S-06 | RecapPanel                    | Нет error boundary — добавить fallback                               |
| S-07 | NotFoundPage upload           | TODO: trigger upload modal — реализовать или убрать                  |
| S-08 | Typography scale              | Нет документированной шкалы: fluid-h1..fluid-body vs text-sm/text-lg |
| S-09 | Line heights                  | Inconsistent: leading-none (Card), default (Input), undocumented     |
| S-10 | Checkbox animation            | Добавить will-change-transform для GPU оптимизации                   |
| S-11 | Switch thumb                  | Добавить will-change-transform                                       |
| S-12 | Theme preview                 | Нет инструмента для preview компонентов во всех 5 темах              |
| S-13 | Touch target debug            | Добавить CSS utility для визуализации зон тапа в dev-mode            |

---

## 6. Legacy & Dead Code

| ID   | Файл                                               | Описание                                             | Действие                                       |
| ---- | -------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| L-01 | `Reader/EntityPopup.tsx`                           | 154 строки, orphaned — не импортируется в production | **Удалить**                                    |
| L-02 | `Reader/EntityPopup.tsx` + `EntityBottomSheet.tsx` | Дублированные getEntityIcon() и truncation           | Извлечь в shared utility                       |
| L-03 | `UI/avatar.tsx`, `UI/badge.tsx`                    | Дублированная `cn()` вместо import                   | Заменить на `import { cn } from '@/lib/utils'` |
| L-04 | `UI/LoadingSpinner.tsx`, `UI/ErrorMessage.tsx`     | Неверный import path `@/utils/cn`                    | Исправить на `@/lib/utils`                     |
| L-05 | `Entities/index.ts`                                | Экспортирует EntityPopup (dead code)                 | Убрать из exports                              |
| L-06 | `NotFoundPage.tsx:38-42`                           | TODO: trigger upload modal — не реализован           | Реализовать или убрать quick link              |

---

## 7. Дизайн-система

### Проблемы консистентности

**Цвета:**

- 3 паттерна использования: `bg-background` (Tailwind semantic), `bg-[var(--color-bg-base)]` (CSS var), `bg-red-50` (hardcoded)
- DebugPanel, ErrorMessage, ImageGallery badge — вне системы
- Switch thumb, LoadingSpinner `white` — не работают с 5 темами

**Z-Index:**

- Система `Z_INDEX` в `lib/zIndex.ts` используется Modal/ImageModal (верно)
- MobilePanel, EntityPopup — hardcoded `z-50`, `z-500`
- Потенциальные конфликты при наложении

**Именование файлов:**

- PascalCase: `Button.tsx`, `Card.tsx`, `Modal.tsx`
- kebab-case: `badge.tsx`, `scroll-area.tsx`, `dropdown-menu.tsx`
- Нет единого стандарта

**Типографика:**

- Fluid scale в globals.css (h1: 24-48px, body: 14-16px)
- Компоненты используют Tailwind: `text-sm`, `text-lg` — не связаны с fluid scale
- Нет документации по выбору размера

### Рекомендации

1. **Единый паттерн цветов:** Всегда `var(--color-*)` в компонентах, Tailwind semantic (`bg-background`) только в pages/layouts
2. **Z_INDEX повсеместно:** Удалить все hardcoded z-_ классы, использовать только `Z_INDEX._`
3. **Унифицировать именование:** PascalCase для всех component файлов
4. **Документировать typography scale:** Связать fluid utilities с Tailwind size tokens

---

## 8. Дорожная карта исправлений

### Неделя 1 — Critical & Safety

| Приоритет | Задача                                                 | Effort |
| --------- | ------------------------------------------------------ | ------ |
| P0        | C-03: Исправить маршрут BookImagesPage                 | 5 min  |
| P0        | C-07: Удалить EntityPopup dead code (L-01)             | 15 min |
| P0        | C-08: Добавить isEntityMet check в EntityEventTimeline | 30 min |
| P0        | C-01: Динамический header offset в gesture controller  | 1 hr   |
| P0        | C-02: Empty state для LibraryPage                      | 30 min |

### Неделя 2 — Major UX

| Приоритет | Задача                                             | Effort |
| --------- | -------------------------------------------------- | ------ |
| P1        | M-01: Safe-area в SelectionMenu                    | 1 hr   |
| P1        | M-03: ProgressSaveIndicator → useEffect            | 15 min |
| P1        | M-09: React.memo для EntityCard, EntityProfile     | 30 min |
| P1        | M-10: useCallback для EntityDrawer handlers        | 30 min |
| P1        | M-11: Debounce в EntityList search                 | 30 min |
| P1        | M-16: Единый PageLoadingState component            | 2 hr   |
| P1        | M-12: aria-labels в EntityDrawer breadcrumb        | 30 min |
| P1        | L-02, L-03, L-04: Cleanup dead code и import paths | 1 hr   |

### Неделя 3 — Design System & Theme

| Приоритет | Задача                                             | Effort |
| --------- | -------------------------------------------------- | ------ |
| P2        | C-05: DebugPanel → CSS variables                   | 2 hr   |
| P2        | C-06: ErrorMessage → design system tokens          | 30 min |
| P2        | M-23-M-29: UI components → consistent theme tokens | 3 hr   |
| P2        | Z_INDEX: унифицировать все z-index                 | 1 hr   |
| P2        | Файлы: переименовать kebab-case → PascalCase       | 1 hr   |

### Неделя 4 — Polish & Accessibility

| Приоритет | Задача                                                 | Effort |
| --------- | ------------------------------------------------------ | ------ |
| P3        | m-01..m-12: Accessibility fixes (ARIA, roles, focus)   | 4 hr   |
| P3        | C-04: Унифицировать навигацию Header/BottomNav/Sidebar | 4 hr   |
| P3        | M-17, M-18: Form UX (readonly, password requirements)  | 2 hr   |
| P3        | m-28..m-37: Performance optimizations                  | 3 hr   |

---

_Отчёт сгенерирован автоматически на основе аудита 4 параллельных агентов._
_Для вопросов по конкретным находкам — указаны файлы и строки для навигации._
