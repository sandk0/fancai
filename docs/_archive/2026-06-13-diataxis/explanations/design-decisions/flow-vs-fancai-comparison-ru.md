# Сравнительный анализ Flow и fancai: EPUB-читалки

**Дата:** Январь 2026
**Статус:** Анализ завершён
**Язык документа:** Русский

---

## Содержание

1. [Краткое резюме](#краткое-резюме)
2. [Архитектура Flow](#архитектура-flow)
3. [Архитектура fancai](#архитектура-fancai)
4. [Детальное сравнение](#детальное-сравнение)
5. [Сильные и слабые стороны](#сильные-и-слабые-стороны)
6. [Рекомендации по миграции](#рекомендации-по-миграции)
7. [План миграции](#план-миграции)

---

## Краткое резюме

### Общие характеристики

| Характеристика | Flow | fancai |
|----------------|------|--------|
| **epub.js версия** | Форк @flow/epubjs (base 0.3.x) | 0.3.93 (npm) |
| **React версия** | 18.0.0 | 19.x |
| **Фреймворк** | Next.js 12.3.4 | Vite 6 + React |
| **State Management** | Valtio + Recoil | Zustand + TanStack Query |
| **Хранилище** | Dexie.js (IndexedDB) | Dexie.js (IndexedDB) |
| **Облачная синхронизация** | Dropbox | Собственный API (PostgreSQL) |
| **PWA поддержка** | next-pwa 5.6.0 | Vite PWA plugin |
| **GitHub Stars** | ~3,000 | N/A (приватный) |

### Ключевые отличия

1. **Flow** — полноценное standalone-приложение для чтения
2. **fancai** — читалка с AI-функционалом (генерация изображений, извлечение описаний)
3. **Flow** хранит книги локально (файлы в IndexedDB)
4. **fancai** загружает книги с сервера (ArrayBuffer по запросу)

---

## Архитектура Flow

### Структура проекта

```
apps/reader/
├── src/
│   ├── components/
│   │   ├── Reader.tsx          # Главный компонент (multi-pane grid)
│   │   ├── TextSelectionMenu.tsx
│   │   ├── Annotation.tsx
│   │   └── pages/              # Page-level компоненты
│   ├── hooks/
│   │   ├── useTextSelection.ts
│   │   ├── useDisablePinchZooming.ts
│   │   ├── useMobile.ts
│   │   ├── useTypography.ts
│   │   └── useLibrary.ts
│   ├── models/
│   │   └── reader.ts           # BookTab класс (Valtio proxy)
│   ├── db.ts                   # Dexie IndexedDB схема
│   ├── state.ts                # Recoil atoms
│   ├── sync.ts                 # Dropbox синхронизация
│   ├── annotation.ts           # Хайлайты и аннотации
│   └── file.ts                 # Обработка EPUB файлов
└── packages/
    └── epubjs/                 # Форк epub.js
```

### Навигация в Flow

#### Touch-навигация (Reader.tsx)

```typescript
// Flow использует 30% зоны по краям
if (isTouchScreen && container) {
  const w = container.clientWidth
  const x = e.clientX % w
  const threshold = 0.3
  const side = w * threshold

  if (x < side) { tab.prev() }
  else if (w - x < side) { tab.next() }
  else if (mobile) { setNavbar((a) => !a) }  // Центр - toggle navbar
}
```

#### Swipe-навигация

```typescript
// Velocity-based swipe detection
const handleTouchEnd = (e: TouchEvent) => {
  const deltaX = touch.clientX - swipeStartX
  const velocity = deltaX / duration

  if (Math.abs(deltaX) > 30 && Math.abs(velocity) > 0.3) {
    if (deltaX > 0) tab.prev()
    else tab.next()
  }
}
```

#### Клавиатурная навигация

```typescript
switch (e.code) {
  case 'ArrowLeft':
  case 'ArrowUp':
    tab?.prev()
    break
  case 'ArrowRight':
  case 'ArrowDown':
    tab?.next()
    break
  case 'Space':
    e.shiftKey ? tab?.prev() : tab?.next()
    break
}
```

### Сохранение прогресса в Flow

#### Схема IndexedDB (Dexie)

```typescript
interface BookRecord {
  id: string              // UUID
  name: string            // Название книги
  size: number            // Размер файла
  metadata: Metadata      // EPUB метаданные
  cfi: string             // Позиция чтения (CFI)
  percentage: number      // Прогресс 0-1
  definitions: Definition[]
  annotations: Annotation[]
  configuration?: {       // Настройки типографики
    typography?: Typography
  }
}
```

#### Автосохранение

```typescript
// В BookTab.updateBook()
updateBook(patch: Partial<BookRecord>) {
  // Обновление Valtio state
  Object.assign(this.book, patch)

  // Персистенция в IndexedDB
  db.books.update(this.book.id, patch)
}

// Вызывается при каждом 'relocated' событии
rendition.on('relocated', (location) => {
  this.updateBook({
    cfi: location.start.cfi,
    percentage: this.progress
  })
})
```

### Облачная синхронизация Flow

```typescript
// sync.ts - Dropbox integration
async function uploadData() {
  const books = await db.books.toArray()
  const data = JSON.stringify(books)

  await dropbox.filesUpload({
    path: '/data.json',
    contents: data,
    mode: { '.tag': 'overwrite' }
  })
}

async function downloadData() {
  const response = await dropbox.filesDownload({ path: '/data.json' })
  const books = JSON.parse(response.data)

  await db.books.bulkPut(books)
}
```

### Выделение текста в Flow

#### useTextSelection.ts

```typescript
export function useTextSelection(win = window) {
  const [selection, setSelection] = useState<Selection | null>(null)

  // Touch devices - слушаем selectionchange
  if (isTouchDevice) {
    document.addEventListener('selectionchange', () => {
      const sel = win.getSelection()
      if (hasSelection(sel)) setSelection(sel)
    })
  } else {
    // Desktop - mouseup
    win.addEventListener('mouseup', () => {
      const sel = win.getSelection()
      if (hasSelection(sel)) setSelection(sel)
    })
  }

  // Блокировка контекстного меню на Android
  if (isTouchDevice) {
    document.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  return [selection, setSelection]
}
```

#### Аннотации

```typescript
interface Annotation {
  id: string
  bookId: string
  cfi: string               // Позиция в книге
  spine: { index: number; title: string }
  createAt: number
  updatedAt: number
  type: 'highlight'
  color: 'yellow' | 'red' | 'green' | 'blue'
  notes?: string
  text: string              // Выделенный текст
}

// Цвета хайлайтов
const colorMap = {
  yellow: 'rgba(217, 119, 6, 0.2)',
  red: 'rgba(239, 68, 68, 0.2)',
  green: 'rgba(34, 197, 94, 0.2)',
  blue: 'rgba(59, 130, 246, 0.2)'
}
```

### iOS-специфичные решения Flow

#### Отключение pinch-zoom

```typescript
// useDisablePinchZooming.ts
function useDisablePinchZooming(win = window) {
  useEffect(() => {
    const handler = (e: TouchEvent) => e.preventDefault()

    // passive: false позволяет вызывать preventDefault
    win.document.addEventListener('touchmove', handler, { passive: false })

    return () => win.document.removeEventListener('touchmove', handler)
  }, [win])
}
```

#### Touch threshold для мобильных

```typescript
// 30% зона по краям экрана
const threshold = 0.3
const side = containerWidth * threshold
```

---

## Архитектура fancai

### Структура проекта

```
frontend/src/
├── components/Reader/
│   ├── EpubReader.tsx          # Главный оркестратор (573 lines)
│   ├── IOSTapZones.tsx         # iOS-специфичный overlay
│   ├── ReaderHeader.tsx
│   ├── TocSidebar.tsx
│   └── PositionConflictDialog.tsx
├── hooks/epub/
│   ├── useEpubLoader.ts        # Загрузка книги + iOS пиксельные fix'ы
│   ├── useEpubNavigation.ts    # Навигация + direct scroll (iOS)
│   ├── useTouchNavigation.ts   # Touch-события (non-iOS)
│   ├── useCFITracking.ts       # Трекинг позиции
│   ├── useContentHooks.ts      # CSS инъекция + iOS postMessage
│   ├── useDescriptionHighlighting.ts # 9-стратегийный поиск
│   ├── useProgressSync.ts      # Debounced сохранение
│   └── useEpubThemes.ts
├── services/
│   ├── epubCache.ts            # Кэш EPUB файлов
│   ├── chapterCache.ts         # Кэш описаний
│   ├── imageCache.ts           # Кэш AI-изображений
│   └── syncQueue.ts            # Очередь офлайн-операций
└── types/epub.ts               # TypeScript типы
```

### Навигация в fancai

#### iOS: IOSTapZones.tsx

```typescript
// 8% зоны по краям (уже, чем Flow)
const ZONE_WIDTH_PERCENT = 8

// Левая зона
<div
  style={{ left: 0, width: `${ZONE_WIDTH_PERCENT}%` }}
  onTouchEnd={(e) => handleTouchEnd(e, 'prev')}
/>

// Правая зона
<div
  style={{ right: 0, width: `${ZONE_WIDTH_PERCENT}%` }}
  onTouchEnd={(e) => handleTouchEnd(e, 'next')}
/>

// Центральная зона - postMessage для описаний
<div
  onTouchEnd={handleCenterTouchEnd}
>
  {/* Отправляет координаты в iframe через BroadcastChannel */}
</div>
```

#### iOS: Direct Scroll (useEpubNavigation.ts)

```typescript
// Обход epub.js navigation на iOS (новейший fix)
const iosDirectScroll = (direction: 'next' | 'prev'): boolean => {
  const manager = rendition.manager
  const stage = manager.stage?.container || manager.container

  const viewportWidth = stage.clientWidth
  const currentScroll = stage.scrollLeft
  const maxScroll = stage.scrollWidth - viewportWidth

  let newScroll: number
  if (direction === 'next') {
    newScroll = Math.min(currentScroll + viewportWidth, maxScroll)
  } else {
    newScroll = Math.max(currentScroll - viewportWidth, 0)
  }

  // Прямая манипуляция scrollLeft
  stage.scrollLeft = newScroll
  return true
}
```

#### Non-iOS: useTouchNavigation.ts

```typescript
// 25% зоны по краям
const LEFT_ZONE_END = 0.25
const RIGHT_ZONE_START = 0.75

// Привязка событий напрямую к iframe document
rendition.hooks.content.register((contents) => {
  const doc = contents.document

  doc.addEventListener('touchstart', handleTouchStart)
  doc.addEventListener('touchend', handleTouchEnd)
  doc.addEventListener('click', handleClick)
})
```

### Сохранение прогресса в fancai

#### Серверная модель

```typescript
// PUT /api/v1/books/{id}/progress
interface ReadingProgress {
  reading_location_cfi: string    // EPUB CFI
  scroll_offset_percent: number   // Доп. offset 0-100
  current_page: number            // Страница (если есть)
  total_pages: number
  chapter_number: number
}
```

#### Debounced сохранение (useProgressSync.ts)

```typescript
// 5-секундный debounce
useEffect(() => {
  if (timeoutRef.current) clearTimeout(timeoutRef.current)

  timeoutRef.current = setTimeout(async () => {
    await onSave(cfi, progress, scrollOffset, chapter)
  }, 5000)
}, [currentCFI, progress])

// beforeunload fallback
window.addEventListener('beforeunload', saveImmediate)
```

#### Конфликт позиций (multi-device)

```typescript
// PositionConflictDialog.tsx
// Показывается когда diff > 5% между локальной и серверной позицией

interface PositionConflictDialogProps {
  localProgress: number
  serverProgress: number
  onUseLocal: () => void
  onUseServer: () => void
}
```

### Выделение текста в fancai

#### useDescriptionHighlighting.ts (9 стратегий)

```typescript
// Не выделение пользователем, а автоматическая подсветка AI-описаний

const strategies = [
  'S1: First 40 chars',           // 85% success
  'S2: Skip 10, take 10-50',      // 75% success
  'S5: First 5 words',            // 70% success
  'S4: Full match',               // 60% success
  'S3: Skip 20, take 20-60',      // 50% success
  'S7: Middle section',           // 40% success
  'S9: First sentence (case-insensitive)', // 35%
  'S8: LCS Fuzzy',                // 25% (slow)
]

// Highlight creation
const highlightSpan = document.createElement('span')
highlightSpan.className = 'description-highlight'
highlightSpan.dataset.descriptionId = description.id
highlightSpan.style.backgroundColor = 'rgba(96, 165, 250, 0.25)'
```

#### useTextSelection.ts (пользовательское выделение)

```typescript
// Показ меню при выделении текста
const selection = window.getSelection()

if (selection && !selection.isCollapsed) {
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()

  setMenuPosition({
    x: rect.left + rect.width / 2,
    y: rect.top - 10
  })
  setShowMenu(true)
}
```

### iOS-специфичные решения fancai

#### 1. IOSTapZones overlay

Отдельный компонент с прозрачными div'ами поверх iframe.
WebKit Bug: iframe не пробрасывает touch-события в iOS PWA.

#### 2. BroadcastChannel для описаний

```typescript
// IOSTapZones -> iframe через BroadcastChannel
const channel = new BroadcastChannel('ios-tap-coordinates')
channel.postMessage({ type: 'TAP_COORDINATES', x, y })

// В iframe (useContentHooks.ts)
const tapChannel = new BroadcastChannel('ios-tap-coordinates')
tapChannel.onmessage = (event) => {
  const { x, y } = event.data
  const element = document.elementFromPoint(x, y)
  // Найти description-highlight и отправить обратно
}
```

#### 3. Explicit Pixel Dimensions

```typescript
// useEpubLoader.ts
if (isIOSDevice) {
  let width = Math.floor(containerRect.width)
  if (width % 2 !== 0) width = width - 1  // Чётное число!

  renditionWidth = width  // НЕ проценты!
  renditionHeight = Math.floor(containerRect.height)
}
```

#### 4. Force divisor=1

```typescript
// На событии 'layout'
rendition.on('layout', (layout) => {
  if (layout.divisor !== 1) {
    layout.divisor = 1
    layout._spread = 'none'
  }
})
```

#### 5. Direct Scroll Navigation

```typescript
// Обход epub.js rendition.next()/prev()
const iosDirectScroll = (direction) => {
  stage.scrollLeft = currentScroll + viewportWidth
  return true
}
```

---

## Детальное сравнение

### Навигация

| Аспект | Flow | fancai |
|--------|------|--------|
| **Ширина tap-зоны** | 30% (по 30% с каждого края) | 8% iOS / 25% Android |
| **Центральная зона** | Toggle navbar | Клик на описание (AI) |
| **Swipe** | Да (velocity-based) | Нет (только tap) |
| **Клавиатура** | Arrows, Space | Arrows, Space |
| **iOS обход** | Нет специального | IOSTapZones overlay + Direct Scroll |

**Вывод:** Flow использует более широкие зоны (30% vs 8%), что проще для пользователя, но fancai намеренно сузил их для кликов на описания в центре. Flow имеет swipe-навигацию, fancai — нет.

### Сохранение прогресса

| Аспект | Flow | fancai |
|--------|------|--------|
| **Хранилище** | IndexedDB only | Server + IndexedDB backup |
| **CFI** | Да | Да |
| **Percentage** | Да | Да |
| **Scroll offset** | Нет | Да (pixel-perfect restore) |
| **Debounce** | Мгновенно (Valtio) | 5 секунд |
| **Conflict resolution** | Нет (перезапись) | Да (диалог >5% diff) |
| **Offline queue** | Нет | Да (syncQueue) |

**Вывод:** fancai имеет более продвинутую систему синхронизации с обработкой конфликтов и офлайн-очередью. Flow проще, но без серверной синхронизации между устройствами (только Dropbox backup).

### Выделение текста

| Аспект | Flow | fancai |
|--------|------|--------|
| **Тип** | Пользовательские highlights | AI-автоматические + пользовательские |
| **Хранение** | IndexedDB (в BookRecord) | Сервер (descriptions) |
| **Цвета** | 4 (yellow, red, green, blue) | 1 (blue) |
| **Notes** | Да | Нет |
| **Поиск текста** | Точное совпадение | 9 стратегий fuzzy-matching |

**Вывод:** Flow ориентирован на классические аннотации с заметками. fancai использует AI-извлечённые описания с fuzzy-matching для подсветки.

### iOS PWA совместимость

| Аспект | Flow | fancai |
|--------|------|--------|
| **Touch forwarding** | Стандартный rendition.on() | IOSTapZones overlay |
| **Multi-page bug** | Не упоминается в issues | Активно борются |
| **Pinch zoom block** | useDisablePinchZooming | CSS touch-action |
| **Pixel dimensions** | Проценты | Explicit pixels (even) |
| **divisor=1 fix** | Нет | Да |
| **Direct scroll** | Нет | Да (обход epub.js) |

**Вывод:** fancai имеет значительно больше iOS-специфичных workaround'ов. Flow менее инвазивен, но может иметь те же проблемы (нет данных из issues).

---

## Сильные и слабые стороны

### Flow

#### Сильные стороны

1. **Multi-pane interface** — можно читать несколько книг одновременно
2. **Drag & drop tabs** — гибкое управление вкладками
3. **Swipe navigation** — естественная навигация на мобильных
4. **Полноценные аннотации** — с цветами и заметками
5. **Проще архитектура** — меньше кода, проще поддержка
6. **Dropbox sync** — готовая облачная синхронизация
7. **Большое сообщество** — 3k stars, активная разработка

#### Слабые стороны

1. **Нет серверного бэкенда** — книги только локально
2. **Нет AI-функционала** — нет извлечения описаний/изображений
3. **Меньше iOS fixes** — потенциальные те же проблемы
4. **Next.js 12** — устаревшая версия (current 15+)
5. **AGPL-3 лицензия** — copyleft, требует open-source
6. **Нет conflict resolution** — перезапись при синхронизации
7. **Issue #88** — навигация на touch-устройствах open

### fancai

#### Сильные стороны

1. **AI-функционал** — извлечение описаний, генерация изображений
2. **Серверная архитектура** — прогресс на сервере, multi-device
3. **Продвинутая iOS поддержка** — множество workaround'ов
4. **Conflict resolution** — диалог при расхождении позиций
5. **Offline sync queue** — очередь офлайн-операций
6. **9-стратегийный highlighting** — robustный fuzzy-matching
7. **Modern stack** — React 19, Vite 6, TypeScript 5.7

#### Слабые стороны

1. **Сложная архитектура** — 17+ hooks, много кода
2. **Узкие tap-зоны** — 8% может быть неудобно
3. **Нет swipe** — только tap-навигация
4. **Нет пользовательских аннотаций** — только AI-описания
5. **Нет multi-pane** — один экран = одна книга
6. **iOS проблемы продолжаются** — multi-page bug не решён полностью
7. **Высокая связность** — сложно тестировать изолированно

---

## Рекомендации по миграции

### Что можно позаимствовать из Flow

#### 1. Swipe Navigation

Flow использует velocity-based swipe detection:

```typescript
// Можно добавить в fancai
const handleTouchEnd = (e: TouchEvent) => {
  const deltaX = touch.clientX - swipeStartX
  const duration = Date.now() - swipeStartTime
  const velocity = deltaX / duration

  if (Math.abs(deltaX) > 30 && Math.abs(velocity) > 0.3) {
    if (deltaX > 0) prevPage()
    else nextPage()
  }
}
```

**Рекомендация:** Добавить swipe как дополнительный метод навигации (не заменяя tap).

#### 2. Расширение tap-зон

Flow использует 30% зоны vs 8% в fancai:

**Рекомендация:** Увеличить до 15-20% на Android, оставить 8% на iOS (для описаний).

#### 3. Аннотации с заметками

```typescript
// Flow annotation schema
interface Annotation {
  color: 'yellow' | 'red' | 'green' | 'blue'
  notes?: string
  text: string
}
```

**Рекомендация:** Добавить пользовательские highlights помимо AI-описаний.

#### 4. Dropbox/iCloud sync как fallback

**Рекомендация:** Добавить опциональный export/import через Dropbox для резервного копирования.

### Что НЕ стоит брать из Flow

1. **Next.js 12** — устаревший, лучше оставаться на Vite
2. **Valtio + Recoil** — уже есть Zustand + TanStack Query
3. **Multi-pane** — не нужно для mobile-first приложения
4. **Локальное хранение книг** — fancai требует сервер для AI

### Что Flow мог бы взять из fancai

1. **IOSTapZones** — для решения iOS touch issues
2. **BroadcastChannel** — для iframe коммуникации
3. **Direct scroll navigation** — обход epub.js багов
4. **Conflict resolution dialog** — при multi-device
5. **Offline sync queue** — для устойчивости к сети

---

## План миграции

### Вариант 1: Частичная миграция (Рекомендуется)

**Цель:** Позаимствовать лучшие практики из Flow без полной замены архитектуры.

**Длительность:** 2-3 недели

#### Фаза 1: Swipe Navigation (3-5 дней)

**Файлы для изменения:**
- `useTouchNavigation.ts` — добавить swipe detection
- `IOSTapZones.tsx` — добавить swipe в центральной зоне

```typescript
// Добавить в useTouchNavigation.ts
const SWIPE_THRESHOLD = 30  // px
const VELOCITY_THRESHOLD = 0.3  // px/ms

const handleSwipe = (deltaX: number, duration: number) => {
  const velocity = Math.abs(deltaX) / duration

  if (Math.abs(deltaX) > SWIPE_THRESHOLD && velocity > VELOCITY_THRESHOLD) {
    if (deltaX > 0) prevPage()
    else nextPage()
    return true
  }
  return false
}
```

**Тестирование:**
- iOS Safari, iOS PWA
- Android Chrome
- Desktop Chrome, Firefox, Safari

#### Фаза 2: Расширенные Tap-зоны (2-3 дня)

**Файлы для изменения:**
- `IOSTapZones.tsx` — опциональные настройки ширины
- `useTouchNavigation.ts` — синхронизация с настройками

```typescript
// Добавить в ReaderSettings
interface ReaderSettings {
  tapZoneWidth: 'narrow' | 'medium' | 'wide'  // 8%, 15%, 25%
}

const TAP_ZONE_WIDTHS = {
  narrow: 8,   // Для AI-описаний
  medium: 15,  // Баланс
  wide: 25     // Максимальное удобство
}
```

**Тестирование:**
- Проверить описания кликаются при разных настройках
- Навигация работает при всех настройках

#### Фаза 3: Пользовательские аннотации (5-7 дней)

**Новые файлы:**
- `types/annotation.ts` — TypeScript types
- `hooks/useAnnotations.ts` — управление аннотациями
- `components/Reader/AnnotationMenu.tsx` — UI создания

**Backend изменения:**
- Новая модель `Annotation` в PostgreSQL
- CRUD endpoints `/api/v1/annotations/`

```typescript
// types/annotation.ts
interface UserAnnotation {
  id: string
  userId: string
  bookId: string
  cfi: string
  text: string
  color: 'yellow' | 'blue' | 'green' | 'red'
  notes?: string
  createdAt: Date
  updatedAt: Date
}
```

**Тестирование:**
- Создание/редактирование/удаление
- Синхронизация между устройствами
- Оффлайн-создание + sync

#### Фаза 4: Улучшение iOS (3-5 дней)

**Изменения:**
- Тестирование direct scroll на реальных iOS устройствах
- Добавление fallback если direct scroll не работает
- Логирование для диагностики

```typescript
// Enhanced iOS navigation with fallback
const iosNavigate = async (direction: 'next' | 'prev') => {
  // Method 1: Direct scroll
  const scrolled = iosDirectScroll(direction)
  if (scrolled) {
    logNavigation('direct-scroll', direction)
    return
  }

  // Method 2: epub.js with pre-fixed layout
  forceLayoutDivisor(1)
  await (direction === 'next' ? rendition.next() : rendition.prev())
  logNavigation('epub-fixed', direction)
}
```

**Тестирование:**
- iPhone 13/14/15 с iOS 18
- iPad с iOS 18
- Симулятор iOS 26 (beta)

### Вариант 2: Полная миграция на Flow

**НЕ рекомендуется** по следующим причинам:

1. **Потеря AI-функционала** — Flow не поддерживает генерацию изображений
2. **Потеря серверной архитектуры** — нужно переделывать бэкенд
3. **AGPL лицензия** — юридические ограничения
4. **Трудозатраты** — 2-3 месяца vs 2-3 недели
5. **Риски** — Flow тоже использует epub.js с теми же проблемами

### Вариант 3: Миграция на Readium Web

**Для рассмотрения в будущем** (6-12 месяцев):

1. **Профессиональное решение** — EDRLab backing
2. **iOS thoroughly tested** — нет CSS column issues
3. **Active development** — Dec 2025 releases
4. **DRM support** — LCP для защиты контента

**Но:**
- Требует значительной переработки (16-23 дня)
- Другая парадигма (Locator vs CFI)
- Больший bundle size (~800KB)

---

## Сводная таблица плана

| Фаза | Что делаем | Срок | Риск |
|------|------------|------|------|
| **1** | Swipe navigation | 3-5 дней | Низкий |
| **2** | Настраиваемые tap-зоны | 2-3 дня | Низкий |
| **3** | Пользовательские аннотации | 5-7 дней | Средний |
| **4** | Улучшение iOS | 3-5 дней | Средний |
| **Итого** | | **13-20 дней** | |

### Приоритеты

1. **Критический:** Фаза 4 (iOS) — пользователи не могут нормально читать
2. **Высокий:** Фаза 1 (Swipe) — улучшение UX
3. **Средний:** Фаза 2 (Tap-зоны) — настраиваемость
4. **Низкий:** Фаза 3 (Аннотации) — новый функционал

### Рекомендуемый порядок

```
Фаза 4 (iOS) → Фаза 1 (Swipe) → Фаза 2 (Tap-зоны) → Фаза 3 (Аннотации)
```

---

## Заключение

### Ключевые выводы

1. **Flow и fancai решают разные задачи** — Flow это standalone reader, fancai это AI-платформа
2. **epub.js проблемы общие** — обе реализации страдают от iOS issues
3. **fancai более продвинут в iOS fixes** — но проблема multi-page до конца не решена
4. **Flow проще** — но менее функционален для enterprise-use

### Рекомендация

**Частичная миграция** (Вариант 1) с фокусом на:

1. Исправление iOS multi-page navigation (приоритет 1)
2. Добавление swipe navigation (приоритет 2)
3. Настраиваемые tap-зоны (приоритет 3)
4. Пользовательские аннотации (приоритет 4)

При этом:
- Не отказываться от текущей архитектуры
- Сохранить все AI-функции
- Сохранить серверную синхронизацию
- Сохранить offline-first подход

---

## Источники

### Flow

- [GitHub Repository](https://github.com/pacexy/flow)
- [Official Website](https://www.flowoss.com/)
- [Issue #88: Navigation on Touch Devices](https://github.com/pacexy/flow/issues/88)

### epub.js

- [GitHub Repository](https://github.com/futurepress/epub.js)
- [Issue #204: iOS Rendering Problems](https://github.com/futurepress/epub.js/issues/204)
- [Issue #657: Page Skipping](https://github.com/futurepress/epub.js/issues/657)

### iOS PWA

- [PWA on iOS 2025 Status](https://brainhub.eu/library/pwa-on-ios)
- [Apple Developer Forums: Safari Issues](https://developer.apple.com/forums/thread/737827)

---

*Документ создан: Январь 2026*
*Автор: Claude Code Analysis*
