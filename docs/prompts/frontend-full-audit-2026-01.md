# Задача: Полный архитектурный аудит Frontend fancai

**Дата:** 29 января 2026
**Модель:** Gemini 3 Pro / Claude Opus 4.5
**Язык ответа:** Русский

---

## Контекст проекта

**fancai** — веб-приложение для чтения книг (EPUB/FB2) с AI-генерацией изображений по описаниям.
- **Frontend:** React 19 + TypeScript 5.7 + Vite 6 + TailwindCSS 4
- **State Management:** TanStack Query v5 (Server State) + Zustand v5 (Client State)
- **Reader Engine:** epub.js с кастомными хуками
- **Persistence:** IndexedDB (Dexie.js) для оффлайн-работы + LocalStorage
- **PWA:** VitePWA, workbox для background sync

### Структура Frontend (`/frontend/src/`)
- **components/**: Организованы по фичам (Reader, Library, Settings) + Shared UI
- **hooks/**: 
  - `api/` — TanStack Query хуки (useBooks, useChapter...)
  - `epub/` — Хуки для epub.js (useRendition, useLocation...)
  - `reader/` — Логика UI читалки
- **stores/**: Zustand сторы (auth, reader settings, ui)
- **services/**: Dexie DB слой, кэширование
- **api/**: Axios клиент, типизированные эндпоинты
- **types/**: TypeScript определения (API, State, Entity)

### Ключевые файлы для анализа
- `src/components/Reader/EpubReader.tsx` — Главный компонент читалки
- `src/hooks/epub/useEpub.ts` — Инициализация движка
- `src/hooks/api/useBooks.ts` — Работа с книгами
- `src/stores/reader.ts` — Настройки читалки
- `src/services/db.ts` — Схема IndexedDB
- `src/App.tsx` — Роутинг и провайдеры

---

## Цель аудита

Провести **глубокий, всесторонний аудит** Frontend по следующим направлениям:

### 1. Бизнес-логика и State Management
- **Offline-first:** Корректность работы без сети, синхронизация через Background Sync
- **State Split:** Правильное разделение между Server State (Query) и Client State (Zustand)
- **Auth Flow:** Token refresh (silent), обработка 401, logout, persistence
- **Reader Logic:** Синхронизация прогресса (CFI), обработка ошибок парсинга
- **Data Consistency:** Синхронизация между IndexedDB, Cache API и Server State

### 2. UX/UI и Mobile Experience
- **iOS Specifics:** Safe Area (notch), overscroll behavior, touch gestures, text selection issues
- **Reader UX:** Настройки шрифтов/тем, плавность перелистывания, сохранение позиции
- **Responsive:** Адаптивность Library, Settings, Reader controls
- **A11y:** Keyboard navigation, ARIA attributes, semantic HTML
- **PWA:** Install prompt, offline fallback, service worker updates

### 3. Архитектура и Проектирование
- **Component Patterns:** Composition vs Inheritance, Render Props, Slots, Barrel exports
- **Custom Hooks:** Выделение логики из компонентов, переиспользование, правильная абстракция
- **API Layer:** Типизация ответов (zod/generics), централизованная обработка ошибок
- **Project Structure:** Circular dependencies, модульность
- **Clean Code:** DRY, SOLID на уровне компонентов, именование

### 4. Производительность (Core Web Vitals)
- **Renders:** Избыточные ререндеры (React Compiler awareness, useMemo/useCallback)
- **Bundle Size:** Lazy loading маршрутов и компонентов, tree shaking
- **Images:** Lazy loading, форматы (WebP/AVIF), размеры, CLS prevention
- **Virtualization:** Списки книг, длинные списки глав
- **Loading States:** Skeletons vs Spinners, Optimistic UI

### 5. Безопасность
- **XSS:** Санитизация контента книг (DOMPurify), рендеринг HTML
- **Data Leakage:** Чувствительные данные в LocalStorage/IndexedDB
- **Auth Handling:** Безопасное хранение токенов (memory vs storage)

### 6. Качество кода и Типизация
- **TypeScript:** Strict mode compliance, отсутствие `any`, использование Generics
- **Props:** Четкие интерфейсы пропсов, дефолтные значения
- **Error Handling:** Error Boundaries, Fallback UI, Toast notifications
- **Tests:** Покрытие критического функционала (Vitest, Playwright)

---

## Лучшие практики 2026 (для сравнения)

### React 19 & Ecosystem
- Использование `use()` хука для ресурсов
- Actions и `useActionState` для форм
- Automatic memoization (React Compiler compatibility)
- TypeScript 5.7 features (satisfies, using keywords)

### TanStack Query v5
- Centralized Query Keys (Factory pattern)
- Optimistic Updates
- `staleTime` vs `gcTime` strategies
- Prefetching patterns (hover/mount)

---

## Формат отчёта

### Структура отчёта

```markdown
## Executive Summary
- Общая оценка (X/10)
- Ключевые проблемы (top 5)
- Ключевые сильные стороны (top 5)

## Часть 1: Бизнес-логика и State
### 1.1 Критические проблемы (P0)
### 1.2 Важные проблемы (P1)
### 1.3 Рекомендации

## Часть 2: UX/UI и Mobile
[аналогично]

## Часть 3: Архитектура
[аналогично]

... [для каждого направления]

## Консолидированный план действий

### P0 — Critical (немедленно)
| ID | Задача | Файл | Время |
|----|--------|------|-------|
| TD-FRONT-01 | ... | ... | ... |

### P1 — High (этот спринт)
[таблица]

### P2 — Medium (backlog)
[таблица]

## Статистика аудита
| Категория | Найдено | Выполнено | Осталось |
```

### Формат каждой проблемы

```markdown
#### TD-FRONT-XX: [Краткое название]

**Файл:** `path/to/file.tsx:line_number`
**Приоритет:** P0/P1/P2
**Категория:** Business Logic / UX / Architecture / Performance / Security

**Текущий код:**
\`\`\`typescript
[проблемный код]
\`\`\`

**Проблема:** [Описание проблемы, почему это плохо, влияние на пользователя]

**Исправление:**
\`\`\`typescript
[исправленный код или описание решения]
\`\`\`

**Время исправления:** Xч/Xмин
```

---

## Инструкции по выполнению

### Шаг 1: Изучение
Изучи структуру проекта, `package.json`, конфигурации (vite, tsconfig, tailwind). Пойми архитектурные паттерны.

### Шаг 2: Глубокий аудит
Проанализируй код по 6 направлениям. Используй поиск по паттернам.
- Ищи `useEffect` без зависимостей или со сложной логикой
- Ищи `any` в типах
- Проверяй обработку ошибок в API запросах
- Проверяй отсутствие `loading` состояний
- Проверяй hardcoded строки (i18n readiness)

### Шаг 3: Приоритизация
- **P0 Critical:** Ошибки, ломающие приложение, потеря данных, уязвимости.
- **P1 High:** Заметные баги UI, проблемы производительности, плохой UX.
- **P2 Medium:** Технический долг, оптимизации, кодстайл.

### Шаг 4: Формирование отчёта
Создай файл `/docs/reports/frontend-full-audit-2026-01.md` с результатами.

---

## Команды для проверки

```bash
# Type check
cd frontend && npm run type-check

# Lint
cd frontend && npm run lint

# Tests
cd frontend && npm test
```
