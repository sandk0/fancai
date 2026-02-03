# План миграции зависимостей fancai
**Дата составления:** 3 февраля 2026  
**Версия документа:** 1.0

---

## Резюме

### Общая информация о проекте
- **Проект:** fancai — веб-приложение для чтения художественной литературы с AI-иллюстрациями
- **Frontend:** React 19 + TypeScript 5.7 + Vite 6 + TailwindCSS 3 + TanStack Query 5 + Zustand 5
- **Backend:** FastAPI + Python 3.11 + PostgreSQL + Redis + Celery
- **Общее количество устаревших пакетов:** 68 (33 frontend, 34 backend, 1 root)

### Ключевые метрики

| Категория | Количество | Общая оценка трудозатрат |
|-----------|------------|--------------------------|
| Frontend major bumps | 15 | 15-30 дней |
| Backend major bumps | 21 | 20-35 дней |
| Minor/patch updates | 32 | 1-2 дня |
| **ИТОГО** | **68** | **36-67 дней** |

### Распределение по уровням риска

| Уровень риска | Количество пакетов | Примеры |
|---------------|-------------------|---------|
| **ОЧЕНЬ НИЗКИЙ** | 32 | react 19.2.3→19.2.4, aiofiles 24.1→25.1 |
| **НИЗКИЙ** | 18 | vite 6→7, black 24→26, pytest-cov 6→7 |
| **СРЕДНИЙ** | 12 | tailwindcss 3→4, vitest 2→4, redis-py 5→7 |
| **ВЫСОКИЙ** | 6 | zod 3→4, pytest-asyncio 0.25→1.3, cryptography 44→46 |

### Критические миграции (требуют особого внимания)

1. **tailwindcss 3→4** — полная переработка архитектуры конфигурации
2. **zod 3→4** — изменения API валидации, есть codemod
3. **pytest-asyncio 0.25→1.3** — удаление `event_loop` fixture
4. **redis-py 5→7** — изменения async API
5. **vitest 2→4** — двухфазная миграция (v2→v3→v4)

---

## Волны миграции

### Wave 0 — Безопасные обновления (1-2 дня)
**Риск:** ОЧЕНЬ НИЗКИЙ  
**Приоритет:** ВЫСОКИЙ  
**Можно выполнить немедленно**

Все minor/patch обновления без breaking changes. Включает 32 пакета.

#### Frontend (16 пакетов)
- react 19.2.3 → 19.2.4
- react-dom 19.2.3 → 19.2.4
- react-router-dom 7.11.0 → 7.13.0
- @tanstack/react-query 5.90.12 → 5.90.20
- @radix-ui/react-dialog 1.1.4 → 1.1.5
- @radix-ui/react-dropdown-menu 2.1.4 → 2.1.5
- @radix-ui/react-label 2.1.1 → 2.1.2
- @radix-ui/react-select 2.1.4 → 2.1.5
- @radix-ui/react-slider 1.2.2 → 1.2.3
- @radix-ui/react-slot 1.1.1 → 1.1.2
- @radix-ui/react-switch 1.1.2 → 1.1.3
- @radix-ui/react-tabs 1.1.2 → 1.1.3
- @radix-ui/react-toast 1.2.4 → 1.2.5
- @testing-library/react 16.3.1 → 16.3.2
- @types/node 25.0.3 → 25.2.0
- @types/react 19.2.7 → 19.2.10
- axios 1.13.1 → 1.13.4
- dexie 4.2.1 → 4.3.0
- dompurify 3.3.0 → 3.3.1
- autoprefixer 10.4.21 → 10.4.24
- globals 17.2.0 → 17.3.0
- i18next 25.8.0 → 25.8.1
- tailwind-merge 3.3.1 → 3.4.0
- zustand 5.0.10 → 5.0.11
- react-hook-form 7.65.0 → 7.71.1

#### Backend (16 пакетов)
- sqlalchemy 2.0.45 → 2.0.46
- alembic 1.14.0 → 1.18.3
- aiohttp 3.11.11 → 3.13.3
- asyncpg 0.30.0 → 0.31.0
- aiofiles 24.1.0 → 25.1.0
- networkx 3.4.2 → 3.6.1
- beautifulsoup4 4.12.3 → 4.14.3
- ebooklib 0.19 → 0.20
- requests 2.32.3 → 2.32.5
- aiosqlite 0.20.0 → 0.22.1
- prometheus-client 0.21.1 → 0.24.1
- prometheus-fastapi-instrumentator 7.0.0 → 7.1.0
- tenacity 9.0.0 → 9.1.2
- google-genai 1.59.0 → 1.61.0
- sentry-sdk 2.19.2 → 2.51.0 (32 минорных версии, но без breaking changes)
- celery 5.6.2 (уже последняя версия)

**Команды для выполнения:**
```bash
# Frontend
cd frontend
npm update react react-dom react-router-dom @tanstack/react-query
npm update @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label
npm update @radix-ui/react-select @radix-ui/react-slider @radix-ui/react-slot
npm update @radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-toast
npm update @testing-library/react @types/node @types/react
npm update axios dexie dompurify autoprefixer globals i18next tailwind-merge zustand
npm update react-hook-form

# Backend
cd ../backend
pip install --upgrade sqlalchemy alembic aiohttp asyncpg aiofiles
pip install --upgrade networkx beautifulsoup4 ebooklib requests aiosqlite
pip install --upgrade prometheus-client prometheus-fastapi-instrumentator tenacity
pip install --upgrade google-genai sentry-sdk
```

**Тестирование:**
```bash
# Frontend
npm run type-check
npm run lint
npm test
npm run build

# Backend
pytest -v
mypy app/
```

---

### Wave 1 — Build-система frontend (1-2 дня)
**Риск:** НИЗКИЙ-СРЕДНИЙ  
**Приоритет:** ВЫСОКИЙ  
**Зависимости:** Wave 0

#### 1.1. vite 6.4.1 → 7.3.1

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 1-2 часа

**Breaking changes:**
- Node.js 20.19+ или 22.12+ обязателен
- Целевые браузеры по умолчанию: Chrome 107+, Safari 16+ (baseline-widely-available)
- `splitVendorChunkPlugin` удалён → использовать `manualChunks`
- Sass legacy API опция удалена
- `transformIndexHtml` hook: `enforce` → `order`, `transform` → `handler`

**Шаги миграции:**

1. Проверить версию Node.js:
```bash
node --version  # Должно быть ≥20.19 или ≥22.12
```

2. Обновить `vite.config.ts`:
```typescript
// БЫЛО
import { splitVendorChunkPlugin } from 'vite'

export default defineConfig({
  plugins: [splitVendorChunkPlugin()]
})

// СТАЛО
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom']
        }
      }
    }
  }
})
```

3. Если используется `transformIndexHtml`:
```typescript
// БЫЛО
{
  name: 'my-plugin',
  transformIndexHtml: {
    enforce: 'pre',
    transform(html) { return html }
  }
}

// СТАЛО
{
  name: 'my-plugin',
  transformIndexHtml: {
    order: 'pre',
    handler(html) { return html }
  }
}
```

4. Обновить пакет:
```bash
npm install vite@^7.3.1
```

5. Тестирование:
```bash
npm run dev      # Проверить dev-сервер
npm run build    # Проверить production build
npm run preview  # Проверить preview
```

---

#### 1.2. @vitejs/plugin-react 4.7.0 → 5.1.3

**Уровень риска:** НИЗКИЙ-СРЕДНИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- Node.js 20.19+ обязателен
- `exclude` по умолчанию теперь `[/\/node_modules\//]` (можно переопределить)
- Больше не добавляет react/react-dom в `resolve.dedupe` автоматически
- React Compiler: старая опция `runtimeModule` удалена, использовать `target`
- Тип возвращаемого значения: `PluginOption[]` → `Plugin[]`

**Шаги миграции:**

1. Обновить `vite.config.ts`:
```typescript
// Если использовался React Compiler
// БЫЛО
react({
  babel: {
    plugins: [
      ['babel-plugin-react-compiler', { runtimeModule: 'react/compiler-runtime' }]
    ]
  }
})

// СТАЛО
react({
  babel: {
    plugins: [
      ['babel-plugin-react-compiler', { target: '19' }]
    ]
  }
})
```

2. Обновить пакет:
```bash
npm install @vitejs/plugin-react@^5.1.3
```

3. Тестирование:
```bash
npm run dev
npm run build
```

---

#### 1.3. eslint-plugin-react-hooks 5.2.0 → 7.0.1

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 30 минут

**Breaking changes:**
- Документированных breaking changes нет
- Вероятно, добавлена поддержка ESLint 9 flat config

**Шаги миграции:**

1. Обновить пакет:
```bash
npm install eslint-plugin-react-hooks@^7.0.1
```

2. Запустить линтер:
```bash
npm run lint
```

---

#### 1.4. eslint-plugin-react-refresh 0.4.24 → 0.5.0

**Уровень риска:** СРЕДНИЙ-ВЫСОКИЙ  
**Трудозатраты:** 2-4 часа

**Breaking changes:**
- ESM-only, требует ESLint 9+, Node 20+
- Требует flat config
- `customHOCs` → `extraHOCs`
- Hardcoded `connect` удалён, нужно добавить в `extraHOCs` если используется react-redux
- API: default export удалён, использовать `reactRefresh.configs.vite()`

**Шаги миграции:**

1. Обновить до ESLint 9 (если ещё не обновлено):
```bash
npm install eslint@^9
```

2. Конвертировать в flat config (`eslint.config.js`):
```javascript
// БЫЛО (eslintrc)
module.exports = {
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { 
      customHOCs: ['withAuth'] 
    }]
  }
}

// СТАЛО (flat config)
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  {
    plugins: {
      'react-refresh': reactRefresh
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { 
        extraHOCs: ['withAuth', 'connect']  // connect теперь нужно указывать явно
      }]
    }
  }
]

// ИЛИ использовать готовый конфиг
export default [
  reactRefresh.configs.vite()
]
```

3. Обновить пакет:
```bash
npm install eslint-plugin-react-refresh@^0.5.0
```

4. Тестирование:
```bash
npm run lint
```

**Итого Wave 1:** 4-7 часов

---

### Wave 2 — Тестовая инфраструктура frontend (2-3 дня)
**Риск:** СРЕДНИЙ  
**Приоритет:** ВЫСОКИЙ  
**Зависимости:** Wave 1

#### 2.1. vitest 2.1.9 → 4.0.18

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 6-8 часов

**Breaking changes:**

**v2 → v3:**
- `vi.mock()` factory должна использовать `vi.hoisted()` для переменных из внешней области
- `threads: true` → `pool: 'threads'`
- `defineConfig` импортировать из `vitest/config`, не из `vite`

**v3 → v4:**
- `vi.resetModules()` теперь async (нужно await)
- `--testNamePattern` → `--test-name-pattern`
- `expect.assertions()` теперь бросает исключение при несовпадении (раньше warning)
- `vi.spyOn()` автоматически восстанавливается после каждого теста
- `setupFiles` выполняются последовательно

**Шаги миграции:**

1. **Фаза 1: v2 → v3**

Обновить `vitest.config.ts`:
```typescript
// БЫЛО
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    threads: true
  }
})

// СТАЛО
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'threads'
  }
})
```

Обновить моки:
```typescript
// БЫЛО
const mockData = { foo: 'bar' }
vi.mock('./module', () => ({
  getData: () => mockData  // Ошибка: mockData из внешней области
}))

// СТАЛО
const mockData = vi.hoisted(() => ({ foo: 'bar' }))
vi.mock('./module', () => ({
  getData: () => mockData
}))
```

2. **Фаза 2: v3 → v4**

Обновить async операции:
```typescript
// БЫЛО
beforeEach(() => {
  vi.resetModules()
})

// СТАЛО
beforeEach(async () => {
  await vi.resetModules()
})
```

Обновить CLI команды в `package.json`:
```json
{
  "scripts": {
    "test": "vitest",
    "test:specific": "vitest --test-name-pattern=\"my test\""
  }
}
```

Проверить использование `expect.assertions()`:
```typescript
// Теперь бросает исключение, если количество не совпадает
test('should call twice', () => {
  expect.assertions(2)  // Если будет 1 или 3 вызова - тест упадёт
  expect(true).toBe(true)
  expect(false).toBe(false)
})
```

3. Обновить пакет:
```bash
npm install vitest@^4.0.18
```

4. Запустить тесты:
```bash
npm test
```

5. Исправить все падающие тесты согласно новым правилам.

---

#### 2.2. @vitest/coverage-v8 2.1.9 → 4.0.18

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- Пороги (thresholds) теперь явные (по умолчанию 0)
- `text` reporter показывает непокрытые строки по умолчанию
- Опция `all` по умолчанию изменена на `false`

**Шаги миграции:**

1. Обновить `vitest.config.ts`:
```typescript
// БЫЛО (неявные пороги)
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html']
    }
  }
})

// СТАЛО (явные пороги)
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      all: true,  // Если нужно покрытие всех файлов
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
})
```

2. Обновить пакет:
```bash
npm install @vitest/coverage-v8@^4.0.18
```

3. Запустить coverage:
```bash
npm run test -- --coverage
```

---

#### 2.3. @vitest/ui 2.1.9 → 4.0.18

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 15 минут

**Breaking changes:**
- Теперь peer dependency (нужно установить явно)
- Порт по умолчанию изменён: 51204 → 51205

**Шаги миграции:**

1. Обновить пакет:
```bash
npm install @vitest/ui@^4.0.18
```

2. Обновить `vitest.config.ts` (если порт был захардкожен):
```typescript
export default defineConfig({
  test: {
    ui: {
      port: 51205  // Новый порт по умолчанию
    }
  }
})
```

3. Запустить UI:
```bash
npm run test -- --ui
```

---

#### 2.4. jsdom 25.0.1 → 28.0.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 2-4 часа

**Breaking changes:**
- Node.js 18+ обязателен
- Более строгий парсинг URL
- `requestAnimationFrame` отключён по умолчанию (использовать `pretendToBeVisual: true`)
- Коллбэки `MutationObserver` теперь в очереди микрозадач
- `form.submit()` больше не вызывает событие submit (использовать `requestSubmit()`)

**Шаги миграции:**

1. Обновить `vitest.config.ts`:
```typescript
export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        pretendToBeVisual: true  // Включить requestAnimationFrame
      }
    }
  }
})
```

2. Обновить тесты с формами:
```typescript
// БЫЛО
const form = document.querySelector('form')
form.submit()  // Не вызывает событие submit

// СТАЛО
const form = document.querySelector('form')
form.requestSubmit()  // Вызывает событие submit
```

3. Обновить тесты с MutationObserver:
```typescript
// Теперь коллбэки выполняются в микрозадачах
test('mutation observer', async () => {
  const observer = new MutationObserver((mutations) => {
    console.log('mutations:', mutations)
  })
  
  observer.observe(element, { childList: true })
  element.appendChild(child)
  
  await new Promise(resolve => queueMicrotask(resolve))  // Дождаться микрозадачи
})
```

4. Обновить пакет:
```bash
npm install jsdom@^28.0.0
```

5. Запустить тесты:
```bash
npm test
```

---

#### 2.5. @playwright/test 1.56.1 → 1.58.1

**Уровень риска:** НИЗКИЙ-СРЕДНИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- Удалён `Page#accessibility` API
- Удалены `_react` и `_vue` селекторы
- Удалён `:light` selector engine suffix
- Новое: Speedboard, Chrome for Testing, Playwright Agents

**Шаги миграции:**

1. Найти использование удалённых API:
```bash
cd frontend
grep -r "accessibility" tests/
grep -r "_react=" tests/
grep -r "_vue=" tests/
grep -r ":light" tests/
```

2. Заменить удалённые селекторы:
```typescript
// БЫЛО
await page.locator('_react=MyComponent').click()
await page.locator('button:light').click()

// СТАЛО
await page.locator('[data-testid="my-component"]').click()
await page.locator('button').click()
```

3. Обновить пакеты:
```bash
npm install @playwright/test@^1.58.1
npm install -D playwright@^1.58.1
```

4. Установить браузеры:
```bash
npx playwright install
```

5. Запустить E2E тесты:
```bash
npm run test:e2e
```

**Итого Wave 2:** 10-14 часов (2-3 дня)

---

### Wave 3 — UI фреймворк (2-3 дня)
**Риск:** СРЕДНИЙ  
**Приоритет:** СРЕДНИЙ  
**Зависимости:** Wave 1, Wave 2

#### 3.1. tailwindcss 3.4.18 → 4.1.18

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 4-8 часов

**Breaking changes:**
- Полная переработка архитектуры: CSS-first конфигурация вместо JS
- `@tailwind base/components/utilities` → `@import "tailwindcss"`
- `tailwind.config.js` → CSS `@theme` директива
- PostCSS: `tailwindcss` → `@tailwindcss/postcss` (или `@tailwindcss/vite` для Vite)
- `autoprefixer` больше не нужен (встроен)
- Переименованные утилиты:
  - `shadow-sm` → `shadow-xs`
  - `shadow` → `shadow-sm`
  - `rounded-sm` → `rounded-xs`
  - `rounded` → `rounded-sm`
  - `blur-sm` → `blur-xs`
  - `blur` → `blur-sm`
  - `outline-none` → `outline-hidden`
  - `ring` → `ring-3`
- Удалены утилиты opacity (`bg-opacity-*` → синтаксис `bg-black/50`)
- Цвет border по умолчанию изменён с `gray-200` на `currentColor`
- Hover на мобильных только на устройствах с поддержкой hover
- Требования к браузерам: Safari 16.4+, Chrome 111+, Firefox 128+
- Node.js 20+ обязателен

**Шаги миграции:**

1. **Автоматическая миграция (рекомендуется):**
```bash
cd frontend
npx @tailwindcss/upgrade
```

Инструмент автоматически:
- Конвертирует `tailwind.config.js` в CSS `@theme`
- Обновляет импорты в CSS
- Переименовывает утилиты в HTML/JSX
- Настраивает Vite plugin

2. **Ручная миграция (если автоматическая не подходит):**

**Шаг 2.1:** Обновить `src/index.css`:
```css
/* БЫЛО */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* СТАЛО */
@import "tailwindcss";
```

**Шаг 2.2:** Конвертировать `tailwind.config.js` в CSS:
```javascript
// БЫЛО (tailwind.config.js)
export default {
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        secondary: '#8b5cf6'
      },
      spacing: {
        '128': '32rem'
      }
    }
  }
}
```

```css
/* СТАЛО (в src/index.css или отдельном файле) */
@import "tailwindcss";

@theme {
  --color-primary: #3b82f6;
  --color-secondary: #8b5cf6;
  --spacing-128: 32rem;
}
```

**Шаг 2.3:** Обновить `vite.config.ts`:
```typescript
// БЫЛО
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

export default defineConfig({
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer]
    }
  }
})

// СТАЛО
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss()
  ]
})
```

**Шаг 2.4:** Удалить `postcss.config.js` (больше не нужен для Vite).

**Шаг 2.5:** Обновить утилиты в компонентах:
```tsx
// БЫЛО
<div className="shadow rounded blur outline-none ring bg-opacity-50">

// СТАЛО
<div className="shadow-sm rounded-sm blur-sm outline-hidden ring-3 bg-black/50">
```

**Шаг 2.6:** Обновить border (если использовался дефолтный):
```tsx
// БЫЛО (border был gray-200)
<div className="border">

// СТАЛО (border теперь currentColor, нужно явно указать цвет)
<div className="border border-gray-200">
```

**Шаг 2.7:** Обновить hover на мобильных:
```tsx
// БЫЛО (hover работал на всех устройствах)
<button className="hover:bg-blue-500">

// СТАЛО (hover только на устройствах с поддержкой)
// Поведение изменилось автоматически, но можно явно указать:
<button className="hover:bg-blue-500 touch:active:bg-blue-500">
```

3. **Обновить пакеты:**
```bash
npm uninstall autoprefixer  # Больше не нужен
npm install tailwindcss@^4.1.18 @tailwindcss/vite@^4.1.18
```

4. **Тестирование:**
```bash
npm run dev      # Проверить визуально все страницы
npm run build    # Проверить production build
npm run lint     # Проверить отсутствие ошибок
```

5. **Проверить все компоненты:**
- Кнопки (shadows, rounded)
- Формы (outline, ring)
- Модальные окна (blur)
- Карточки (border)
- Hover эффекты на мобильных

**Итого Wave 3:** 4-8 часов

---

### Wave 4 — Формы и валидация (2-3 дня)
**Риск:** СРЕДНИЙ-ВЫСОКИЙ  
**Приоритет:** СРЕДНИЙ  
**Зависимости:** Wave 0

#### 4.1. zod 3.25.76 → 4.3.6

**Уровень риска:** СРЕДНИЙ-ВЫСОКИЙ  
**Трудозатраты:** 1-2 дня

**Breaking changes:**
- `message` → `error` параметр
- `.strict()` → `z.strictObject()`
- `.merge()` → `.extend()` или object spread
- `.email()` → `z.email()` (top-level функция)
- `.default()` теперь ожидает output type (использовать `.prefault()` для старого поведения)
- `z.record(valueSchema)` → `z.record(keySchema, valueSchema)`
- `.format()`/`.flatten()` → `z.treeifyError()`
- `.deepPartial()` удалён
- Производительность: объекты в 6.5x быстрее, bundle на 57% меньше

**Шаги миграции:**

1. **Автоматическая миграция (рекомендуется):**
```bash
cd frontend
npx zod-v3-to-v4
```

2. **Ручная миграция:**

**Шаг 2.1:** Обновить custom messages:
```typescript
// БЫЛО
const schema = z.string({
  required_error: "Обязательное поле",
  invalid_type_error: "Должна быть строка"
})

// СТАЛО
const schema = z.string({
  error: {
    required: "Обязательное поле",
    invalid_type: "Должна быть строка"
  }
})
```

**Шаг 2.2:** Обновить strict objects:
```typescript
// БЫЛО
const schema = z.object({
  name: z.string()
}).strict()

// СТАЛО
const schema = z.strictObject({
  name: z.string()
})
```

**Шаг 2.3:** Обновить merge:
```typescript
// БЫЛО
const baseSchema = z.object({ id: z.string() })
const extendedSchema = baseSchema.merge(z.object({ name: z.string() }))

// СТАЛО (вариант 1 - extend)
const extendedSchema = baseSchema.extend({ name: z.string() })

// СТАЛО (вариант 2 - spread)
const extendedSchema = z.object({
  ...baseSchema.shape,
  name: z.string()
})
```

**Шаг 2.4:** Обновить email:
```typescript
// БЫЛО
const schema = z.string().email()

// СТАЛО
const schema = z.email()
```

**Шаг 2.5:** Обновить default:
```typescript
// БЫЛО (default принимал input type)
const schema = z.string().transform(s => s.toUpperCase()).default("hello")

// СТАЛО (default принимает output type)
const schema = z.string().transform(s => s.toUpperCase()).default("HELLO")

// ИЛИ использовать prefault для старого поведения
const schema = z.string().transform(s => s.toUpperCase()).prefault("hello")
```

**Шаг 2.6:** Обновить record:
```typescript
// БЫЛО
const schema = z.record(z.number())  // Ключи - любые строки

// СТАЛО
const schema = z.record(z.string(), z.number())  // Явно указать тип ключей
```

**Шаг 2.7:** Обновить error formatting:
```typescript
// БЫЛО
const result = schema.safeParse(data)
if (!result.success) {
  const formatted = result.error.format()
  const flattened = result.error.flatten()
}

// СТАЛО
const result = schema.safeParse(data)
if (!result.success) {
  const tree = z.treeifyError(result.error)
}
```

**Шаг 2.8:** Удалить deepPartial:
```typescript
// БЫЛО
const schema = z.object({
  user: z.object({
    name: z.string(),
    email: z.string()
  })
}).deepPartial()

// СТАЛО (использовать рекурсивную функцию)
function deepPartial<T extends z.ZodTypeAny>(schema: T): z.ZodOptional<T> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape
    const newShape: any = {}
    for (const key in shape) {
      newShape[key] = deepPartial(shape[key])
    }
    return z.object(newShape).partial() as any
  }
  return schema.optional() as any
}

const schema = deepPartial(z.object({
  user: z.object({
    name: z.string(),
    email: z.string()
  })
}))
```

3. **Обновить пакет:**
```bash
npm install zod@^4.3.6
```

4. **Тестирование:**
```bash
npm run type-check  # Проверить типы
npm test           # Запустить тесты
```

5. **Проверить все формы:**
- Регистрация
- Логин
- Настройки
- Загрузка книг
- Валидация на клиенте

---

#### 4.2. @hookform/resolvers 3.10.0 → 5.2.2

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 1-2 часа

**Breaking changes:**
- v5 требует react-hook-form ≥7.55.0
- Автоматический вывод типов из схем (input/output)
- Best practice: позволить типам выводиться автоматически, удалить ручные аннотации

**Шаги миграции:**

1. Обновить react-hook-form (если ещё не обновлено):
```bash
npm install react-hook-form@^7.71.1
```

2. Обновить типы форм:
```typescript
// БЫЛО (ручные типы)
interface FormData {
  email: string
  password: string
}

const schema = z.object({
  email: z.email(),
  password: z.string().min(8)
})

const { register, handleSubmit } = useForm<FormData>({
  resolver: zodResolver(schema)
})

// СТАЛО (автоматический вывод)
const schema = z.object({
  email: z.email(),
  password: z.string().min(8)
})

const { register, handleSubmit } = useForm({
  resolver: zodResolver(schema)
})
// Типы выводятся автоматически из schema
```

3. Обновить пакет:
```bash
npm install @hookform/resolvers@^5.2.2
```

4. Тестирование:
```bash
npm run type-check
npm test
```

**Итого Wave 4:** 1-2 дня

---

### Wave 5 — Анимации и иконки (1 день)
**Риск:** НИЗКИЙ-СРЕДНИЙ  
**Приоритет:** НИЗКИЙ  
**Зависимости:** Wave 0

#### 5.1. framer-motion 11.18.2 → 12.31.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 1-2 часа

**Breaking changes:**
- Пакет переименован: `framer-motion` → `motion`
- Путь импорта: `"framer-motion"` → `"motion/react"`
- НЕТ изменений API — только переименование

**Шаги миграции:**

1. **Автоматическая замена импортов:**
```bash
cd frontend/src

# macOS/Linux
find . -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' 's/from "framer-motion"/from "motion\/react"/g' {} +

# Linux (без '')
find . -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i 's/from "framer-motion"/from "motion\/react"/g' {} +
```

2. **Ручная замена (если автоматическая не сработала):**
```typescript
// БЫЛО
import { motion, AnimatePresence } from "framer-motion"

// СТАЛО
import { motion, AnimatePresence } from "motion/react"
```

3. **Обновить пакеты:**
```bash
npm uninstall framer-motion
npm install motion@^12.31.0
```

4. **Тестирование:**
```bash
npm run type-check
npm run dev  # Проверить анимации визуально
```

---

#### 5.2. lucide-react 0.469.0 → 0.563.0

**Уровень риска:** НИЗКИЙ-СРЕДНИЙ  
**Трудозатраты:** 2-3 часа

**Breaking changes:**
- По умолчанию `aria-hidden="true"` на всех иконках
- Нужно добавить `aria-label` для семантических иконок
- Новые иконки добавлены, некоторые дизайны обновлены

**Шаги миграции:**

1. **Найти все использования иконок:**
```bash
cd frontend/src
grep -r "lucide-react" . --include="*.tsx" --include="*.ts"
```

2. **Обновить семантические иконки:**
```tsx
// БЫЛО (иконка была видна для screen readers)
<Button>
  <Trash2 />
  Удалить
</Button>

// СТАЛО (иконка скрыта, текст доступен)
<Button>
  <Trash2 aria-hidden="true" />
  Удалить
</Button>

// Если иконка БЕЗ текста - добавить aria-label
// БЫЛО
<button>
  <Search />
</button>

// СТАЛО
<button aria-label="Поиск">
  <Search aria-hidden="true" />
</button>
```

3. **Обновить пакет:**
```bash
npm install lucide-react@^0.563.0
```

4. **Тестирование:**
```bash
npm run dev  # Проверить визуально
npm run test:e2e  # Проверить accessibility
```

**Итого Wave 5:** 3-5 часов

---

### Wave 6 — Python безопасность (1-2 дня)
**Риск:** ВЫСОКИЙ  
**Приоритет:** ВЫСОКИЙ  
**Зависимости:** Wave 0

#### 6.1. cryptography 44.0.0 → 46.0.4

**Уровень риска:** ВЫСОКИЙ  
**Трудозатраты:** 4-8 часов

**Breaking changes:**
- Python 3.8+ обязателен
- Поведение загрузки SSH ключей изменено (TypeError вместо ValueError)
- CAST5, SEED, IDEA, Blowfish перемещены в `cryptography.hazmat.decrepit`
- `get_attribute_for_oid` удалён → использовать `Attributes.get_attribute_for_oid()`
- OpenSSL < 3.0 deprecated (будет удалён в v47)

**Шаги миграции:**

1. **Найти использование устаревших алгоритмов:**
```bash
cd backend
grep -r "CAST5\|SEED\|IDEA\|Blowfish" app/ tests/
```

2. **Обновить импорты:**
```python
# БЫЛО
from cryptography.hazmat.primitives.ciphers import algorithms

cipher = algorithms.CAST5(key)

# СТАЛО
from cryptography.hazmat.decrepit.ciphers import algorithms as decrepit_algorithms

cipher = decrepit_algorithms.CAST5(key)
```

3. **Обновить обработку SSH ключей:**
```python
# БЫЛО
try:
    key = serialization.load_ssh_private_key(data, password)
except ValueError as e:
    print(f"Invalid key: {e}")

# СТАЛО
try:
    key = serialization.load_ssh_private_key(data, password)
except TypeError as e:  # Теперь TypeError
    print(f"Invalid key: {e}")
```

4. **Обновить Attributes API:**
```python
# БЫЛО
from cryptography import x509

attr = cert.get_attribute_for_oid(oid)

# СТАЛО
from cryptography import x509

attr = x509.Attributes.get_attribute_for_oid(cert.attributes, oid)
```

5. **Обновить пакет:**
```bash
pip install cryptography==46.0.4
```

6. **Тестирование:**
```bash
pytest tests/ -v
pytest tests/test_auth.py -v  # Если есть тесты аутентификации
```

---

#### 6.2. python-jose 3.4.0 → 3.5.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- Python 3.9+ обязателен
- `JWKError` больше не раскрывает данные ключа (улучшение безопасности)

**Шаги миграции:**

1. **Проверить обработку ошибок:**
```python
# БЫЛО (ошибка могла содержать данные ключа)
try:
    jwk = JWK.from_json(data)
except JWKError as e:
    logger.error(f"JWK error: {e}")  # Могло логировать секретные данные

# СТАЛО (ошибка не содержит данных ключа)
try:
    jwk = JWK.from_json(data)
except JWKError as e:
    logger.error(f"JWK error: {e}")  # Безопасно
```

2. **Обновить пакет:**
```bash
pip install python-jose==3.5.0
```

3. **Тестирование:**
```bash
pytest tests/test_auth.py -v
```

**Итого Wave 6:** 5-9 часов

---

### Wave 7 — Python тестирование (3-5 дней)
**Риск:** ВЫСОКИЙ  
**Приоритет:** ВЫСОКИЙ  
**Зависимости:** Wave 0

#### 7.1. pytest 8.3.4 → 9.0.2

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 4-6 часов

**Breaking changes:**
- Python 3.10+ обязателен
- Все `PytestRemovedIn9Warning` теперь ошибки
- Нативная TOML конфигурация: `[tool.pytest]` в `pyproject.toml`
- Встроенные subtests (удалить `pytest-subtests` если используется)
- Изменена обработка дублирующихся/перекрывающихся путей

**Шаги миграции:**

1. **Проверить версию Python:**
```bash
python --version  # Должно быть ≥3.10
```

2. **Найти все warnings:**
```bash
cd backend
pytest --collect-only -W default::PytestRemovedIn9Warning 2>&1 | grep "PytestRemovedIn9Warning"
```

3. **Мигрировать конфигурацию в pyproject.toml:**
```toml
# БЫЛО (pytest.ini или setup.cfg)
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --strict-markers

# СТАЛО (pyproject.toml)
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = "-v --strict-markers"
```

4. **Удалить pytest-subtests (если используется):**
```bash
pip uninstall pytest-subtests
```

Обновить тесты:
```python
# БЫЛО (с pytest-subtests)
def test_multiple_cases(subtests):
    for i in range(10):
        with subtests.test(i=i):
            assert i % 2 == 0

# СТАЛО (встроенные subtests)
def test_multiple_cases():
    for i in range(10):
        with pytest.subtest(i=i):
            assert i % 2 == 0
```

5. **Обновить пакет:**
```bash
pip install pytest==9.0.2
```

6. **Тестирование:**
```bash
pytest -v
```

---

#### 7.2. pytest-asyncio 0.25.2 → 1.3.0

**Уровень риска:** ВЫСОКИЙ  
**Трудозатраты:** 3-5 дней (самая сложная миграция в backend)

**Breaking changes:**
- `event_loop` fixture полностью удалён
- `scope` → `loop_scope` параметр
- Нужно установить `asyncio_default_fixture_loop_scope` в конфигурации
- Синхронные тесты с async fixtures deprecated
- Python 3.10+ обязателен

**Шаги миграции:**

1. **Обновить конфигурацию:**
```toml
# pyproject.toml
[tool.pytest.ini_options]
asyncio_default_fixture_loop_scope = "function"  # или "session", "module", "class"
```

2. **Удалить event_loop fixture:**
```python
# БЫЛО
import pytest
import asyncio

@pytest.fixture
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

# СТАЛО
# Удалить полностью, pytest-asyncio управляет event loop автоматически
```

3. **Обновить scope на loop_scope:**
```python
# БЫЛО
@pytest.fixture(scope="session")
async def db_session():
    async with create_session() as session:
        yield session

# СТАЛО
@pytest.fixture(loop_scope="session")
async def db_session():
    async with create_session() as session:
        yield session
```

4. **Обновить синхронные тесты с async fixtures:**
```python
# БЫЛО (deprecated)
@pytest.fixture
async def async_data():
    return await fetch_data()

def test_sync_with_async_fixture(async_data):  # Синхронный тест с async fixture
    assert async_data is not None

# СТАЛО (сделать тест async)
@pytest.fixture
async def async_data():
    return await fetch_data()

async def test_async_with_async_fixture(async_data):  # Async тест
    assert async_data is not None
```

5. **Обновить conftest.py:**
```python
# БЫЛО
import pytest
import asyncio

@pytest.fixture(scope="session")
def event_loop():
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="session")
async def db():
    # setup
    yield database
    # teardown

# СТАЛО
import pytest

# event_loop удалён

@pytest.fixture(loop_scope="session")
async def db():
    # setup
    yield database
    # teardown
```

6. **Обновить пакет:**
```bash
pip install pytest-asyncio==1.3.0
```

7. **Тестирование (поэтапно):**
```bash
# Запустить один тестовый файл
pytest tests/test_auth.py -v

# Если работает, запустить все
pytest -v
```

8. **Исправить все падающие тесты:**
- Проверить все async fixtures
- Проверить все тесты с БД
- Проверить все тесты с Redis
- Проверить все интеграционные тесты

**Это самая трудоёмкая миграция в backend. Рекомендуется выделить 3-5 дней.**

---

#### 7.3. pytest-cov 6.0.0 → 7.0.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- Измерение subprocess через .pth удалено
- Нужно `patch = subprocess` в конфигурации coverage если используется subprocess coverage
- Минимум coverage.py 7.10.6

**Шаги миграции:**

1. **Обновить .coveragerc или pyproject.toml:**
```toml
# pyproject.toml
[tool.coverage.run]
source = ["app"]
omit = ["*/tests/*", "*/migrations/*"]
patch = "subprocess"  # Если нужно покрытие subprocess
```

2. **Обновить пакеты:**
```bash
pip install pytest-cov==7.0.0 coverage>=7.10.6
```

3. **Тестирование:**
```bash
pytest --cov=app --cov-report=html
```

**Итого Wave 7:** 3-5 дней

---

### Wave 8 — Python инфраструктура (2-3 дня)
**Риск:** СРЕДНИЙ  
**Приоритет:** ВЫСОКИЙ  
**Зависимости:** Wave 0, Wave 7

#### 8.1. redis-py 5.2.1 → 7.1.0

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 4-6 часов

**Breaking changes:**
- `StrictRedis` удалён → использовать `Redis`
- Async: `redis.asyncio.Redis` теперь единственный способ
- ConnectionPool: `decode_responses` нужно передавать в `Redis()`, не в pool
- `zadd(name, score, member)` удалён → `zadd(name, {member: score})`
- Дефолтный socket timeout теперь 30s
- `health_check_interval` рекомендуется для production
- `aclose()` вместо `close()` + `wait_closed()`

**Шаги миграции:**

1. **Обновить импорты:**
```python
# БЫЛО
from redis import StrictRedis

redis_client = StrictRedis(host='localhost', port=6379)

# СТАЛО
from redis import Redis

redis_client = Redis(host='localhost', port=6379)
```

2. **Обновить async клиент:**
```python
# БЫЛО
import redis.asyncio as aioredis

redis_client = await aioredis.create_redis_pool('redis://localhost')

# СТАЛО
from redis.asyncio import Redis

redis_client = Redis(
    host='localhost',
    port=6379,
    decode_responses=True,
    health_check_interval=30  # Рекомендуется для production
)
```

3. **Обновить ConnectionPool:**
```python
# БЫЛО
from redis import ConnectionPool, Redis

pool = ConnectionPool(host='localhost', port=6379, decode_responses=True)
redis_client = Redis(connection_pool=pool)

# СТАЛО
from redis import ConnectionPool, Redis

pool = ConnectionPool(host='localhost', port=6379)
redis_client = Redis(connection_pool=pool, decode_responses=True)  # decode_responses в Redis()
```

4. **Обновить zadd:**
```python
# БЫЛО
redis_client.zadd('myset', 1.0, 'member1')
redis_client.zadd('myset', 2.0, 'member2')

# СТАЛО
redis_client.zadd('myset', {'member1': 1.0, 'member2': 2.0})
```

5. **Обновить закрытие соединения:**
```python
# БЫЛО
await redis_client.close()
await redis_client.wait_closed()

# СТАЛО
await redis_client.aclose()
```

6. **Обновить пакет:**
```bash
pip install redis==7.1.0
```

7. **Тестирование:**
```bash
pytest tests/test_cache.py -v
pytest tests/test_sessions.py -v
```

---

#### 8.2. kombu 5.5.0 → 5.6.2

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 30 минут

**Breaking changes:**
- Нет breaking API changes
- Внутренний redis transport обновлён для redis-py 7.x

**Шаги миграции:**

1. **Обновить пакет:**
```bash
pip install kombu==5.6.2
```

2. **Тестирование:**
```bash
pytest tests/test_celery.py -v
```

---

#### 8.3. uvicorn 0.34.0 → 0.40.0

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 1-2 часа

**Breaking changes:**
- Python 3.10+ обязателен
- Обработка WebSocket close frame изменена

**Шаги миграции:**

1. **Проверить WebSocket код:**
```python
# Если используются WebSockets, проверить обработку закрытия соединения
# Поведение close frame изменилось, но API остался тем же

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"Echo: {data}")
    except WebSocketDisconnect:
        print("Client disconnected")
```

2. **Обновить пакет:**
```bash
pip install uvicorn==0.40.0
```

3. **Тестирование:**
```bash
# Запустить сервер
uvicorn app.main:app --reload

# Проверить WebSocket (если используется)
pytest tests/test_websocket.py -v
```

**Итого Wave 8:** 6-9 часов

---

### Wave 9 — Python веб-стек (1-2 дня)
**Риск:** СРЕДНИЙ-ВЫСОКИЙ  
**Приоритет:** СРЕДНИЙ  
**Зависимости:** Wave 0, Wave 6

#### 9.1. pydantic-settings 2.8.0 → 2.12.0

**Уровень риска:** ВЫСОКИЙ  
**Трудозатраты:** 2-4 часа

**Breaking changes:**
- Python 3.10+ обязателен
- Порядок приоритета источников изменён: init > env > dotenv > secrets > defaults
- Поведение env prefix fallback изменено

**Шаги миграции:**

1. **Проверить порядок приоритета:**
```python
# БЫЛО (старый порядок)
# 1. defaults
# 2. env
# 3. dotenv
# 4. secrets
# 5. init

# СТАЛО (новый порядок)
# 1. init (самый высокий приоритет)
# 2. env
# 3. dotenv
# 4. secrets
# 5. defaults (самый низкий приоритет)

# Пример
class Settings(BaseSettings):
    database_url: str = "sqlite:///default.db"  # Теперь самый низкий приоритет
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="APP_"
    )

# Если передать в конструктор - будет самый высокий приоритет
settings = Settings(database_url="postgresql://...")  # Переопределит всё
```

2. **Проверить env prefix fallback:**
```python
# БЫЛО (fallback на переменную без префикса)
class Settings(BaseSettings):
    database_url: str
    
    model_config = SettingsConfigDict(env_prefix="APP_")

# Искало: APP_DATABASE_URL, затем DATABASE_URL (fallback)

# СТАЛО (только с префиксом)
# Ищет только: APP_DATABASE_URL

# Если нужен fallback, использовать Field
from pydantic import Field

class Settings(BaseSettings):
    database_url: str = Field(validation_alias=AliasChoices("APP_DATABASE_URL", "DATABASE_URL"))
    
    model_config = SettingsConfigDict(env_prefix="APP_")
```

3. **Обновить пакет:**
```bash
pip install pydantic-settings==2.12.0
```

4. **Тестирование:**
```bash
pytest tests/test_config.py -v
python -c "from app.core.config import settings; print(settings.database_url)"
```

---

#### 9.2. python-multipart 0.0.20 → 0.0.22

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- Python 3.10+ обязателен
- `File.filename` теперь возвращает только basename (без пути к директории)

**Шаги миграции:**

1. **Проверить обработку filename:**
```python
# БЫЛО
from fastapi import UploadFile

@app.post("/upload")
async def upload_file(file: UploadFile):
    # file.filename мог содержать путь: "../../etc/passwd"
    safe_filename = os.path.basename(file.filename)
    
# СТАЛО
from fastapi import UploadFile

@app.post("/upload")
async def upload_file(file: UploadFile):
    # file.filename теперь всегда basename: "passwd"
    safe_filename = file.filename  # Уже безопасно
```

2. **Обновить пакет:**
```bash
pip install python-multipart==0.0.22
```

3. **Тестирование:**
```bash
pytest tests/test_upload.py -v
```

---

#### 9.3. pywebpush 2.0.0 → 2.2.0

**Уровень риска:** СРЕДНИЙ  
**Трудозатраты:** 1 час

**Breaking changes:**
- `Webpusher.encode` бросает `NoData` exception вместо возврата `None`

**Шаги миграции:**

1. **Обновить обработку ошибок:**
```python
# БЫЛО
from pywebpush import webpush, Webpusher

pusher = Webpusher(subscription_info)
encoded = pusher.encode(data)
if encoded is None:
    print("No data")

# СТАЛО
from pywebpush import webpush, Webpusher, NoData

pusher = Webpusher(subscription_info)
try:
    encoded = pusher.encode(data)
except NoData:
    print("No data")
```

2. **Обновить пакет:**
```bash
pip install pywebpush==2.2.0
```

3. **Тестирование:**
```bash
pytest tests/test_notifications.py -v
```

---

#### 9.4. gunicorn 23.0.0 → 25.0.1

**Уровень риска:** НЕИЗВЕСТНЫЙ (ВЫСОКИЙ)  
**Трудозатраты:** 4-8 часов

**Breaking changes:**
- Changelog недоступен, нужно проверить GitHub releases вручную

**Шаги миграции:**

1. **Проверить changelog на GitHub:**
```bash
# Открыть в браузере
https://github.com/benoitc/gunicorn/releases
```

2. **Создать тестовое окружение:**
```bash
python -m venv test_env
source test_env/bin/activate
pip install gunicorn==25.0.1
```

3. **Протестировать запуск:**
```bash
gunicorn app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker
```

4. **Проверить конфигурацию:**
```python
# gunicorn.conf.py
# Проверить все опции на совместимость
```

5. **Обновить пакет:**
```bash
pip install gunicorn==25.0.1
```

6. **Тестирование:**
```bash
# Запустить production-like сервер
gunicorn app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000

# Нагрузочное тестирование
ab -n 1000 -c 10 http://localhost:8000/api/v1/health
```

**Итого Wave 9:** 8-14 часов

---

### Wave 10 — Форматирование и линтинг (1 день)
**Риск:** СРЕДНИЙ  
**Приоритет:** НИЗКИЙ  
**Зависимости:** Wave 0

#### 10.1. black 24.10.0 → 26.1.0

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 1-3 часа

**Breaking changes:**
- Python 3.10+ обязателен
- 2026 stable style (переформатирование кода)
- .gitignore pathspec v1 поведение изменено

**Шаги миграции:**

1. **Создать ветку для форматирования:**
```bash
git checkout -b chore/black-26-formatting
```

2. **Обновить пакет:**
```bash
pip install black==26.1.0
```

3. **Запустить форматирование:**
```bash
black app/ tests/
```

4. **Проверить diff:**
```bash
git diff
```

5. **Закоммитить изменения:**
```bash
git add .
git commit -m "chore(backend): apply black 26.1.0 formatting"
```

6. **Тестирование:**
```bash
pytest -v
mypy app/
```

---

#### 10.2. ruff 0.8.4 → 0.14.14

**Уровень риска:** ВЫСОКИЙ (для форматирования)  
**Трудозатраты:** 2-4 часа

**Breaking changes:**
- MAJOR jump (6 минорных версий)
- 2026 style
- Много новых правил
- Изменения в форматировании

**Шаги миграции:**

1. **Создать ветку:**
```bash
git checkout -b chore/ruff-0.14-formatting
```

2. **Обновить пакет:**
```bash
pip install ruff==0.14.14
```

3. **Проверить новые правила:**
```bash
ruff check app/ tests/ --preview
```

4. **Обновить конфигурацию (если нужно):**
```toml
# pyproject.toml
[tool.ruff]
target-version = "py311"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W", "UP"]
ignore = []

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
```

5. **Применить автофиксы:**
```bash
ruff check app/ tests/ --fix
ruff format app/ tests/
```

6. **Проверить diff:**
```bash
git diff
```

7. **Закоммитить:**
```bash
git add .
git commit -m "chore(backend): apply ruff 0.14.14 formatting and linting"
```

8. **Тестирование:**
```bash
pytest -v
mypy app/
```

**Итого Wave 10:** 3-7 часов

---

### Wave 11 — Оставшиеся major bumps (2-3 дня)
**Риск:** СРЕДНИЙ  
**Приоритет:** НИЗКИЙ  
**Зависимости:** Wave 0

#### 11.1. lxml 5.3.0 → 6.0.2

**Уровень риска:** СРЕДНИЙ-ВЫСОКИЙ  
**Трудозатраты:** 6-12 часов

**Breaking changes:**
- Обработка HTML tag prefix изменена
- Поведение ElementPath изменено для prefixed tags
- Schematron deprecated
- HTTP/FTP прямой парсинг отключён
- MemDebug методы удалены

**Шаги миграции:**

1. **Найти использование lxml:**
```bash
cd backend
grep -r "from lxml" app/ tests/
grep -r "import lxml" app/ tests/
```

2. **Проверить HTTP/FTP парсинг:**
```python
# БЫЛО (прямой парсинг URL)
from lxml import etree

tree = etree.parse('http://example.com/data.xml')

# СТАЛО (нужно скачать сначала)
import requests
from lxml import etree

response = requests.get('http://example.com/data.xml')
tree = etree.fromstring(response.content)
```

3. **Проверить ElementPath с префиксами:**
```python
# Если используются XML namespaces, проверить поведение
from lxml import etree

xml = '<root xmlns:ns="http://example.com"><ns:item>text</ns:item></root>'
tree = etree.fromstring(xml)

# Проверить, что селекторы работают корректно
items = tree.xpath('//ns:item', namespaces={'ns': 'http://example.com'})
```

4. **Удалить Schematron (если используется):**
```python
# БЫЛО
from lxml import etree, isoschematron

schema = isoschematron.Schematron(schema_tree)

# СТАЛО
# Использовать альтернативу или удалить
```

5. **Обновить пакет:**
```bash
pip install lxml==6.0.2
```

6. **Тестирование:**
```bash
pytest tests/test_epub_parser.py -v
pytest tests/test_fb2_parser.py -v
```

---

#### 11.2. pillow 11.0.0 → 12.1.0

**Уровень риска:** НИЗКИЙ-СРЕДНИЙ  
**Трудозатраты:** 2-4 часа

**Breaking changes:**
- Python 3.10+ обязателен
- `ImageMath.eval()` удалён → использовать `lambda_eval()` или `unsafe_eval()`
- `ImageCms` константы удалены → использовать `ImageCms.Flags` класс
- `Image.getdata()` deprecated → `get_flattened_data()`
- BGR экспериментальные режимы удалены

**Шаги миграции:**

1. **Найти использование Pillow:**
```bash
cd backend
grep -r "from PIL" app/ tests/
grep -r "import PIL" app/ tests/
```

2. **Обновить ImageMath:**
```python
# БЫЛО
from PIL import ImageMath

result = ImageMath.eval("a + b", a=img1, b=img2)

# СТАЛО
from PIL import ImageMath

result = ImageMath.lambda_eval(lambda a, b: a + b, a=img1, b=img2)
# ИЛИ (если доверяете источнику)
result = ImageMath.unsafe_eval("a + b", a=img1, b=img2)
```

3. **Обновить ImageCms:**
```python
# БЫЛО
from PIL import ImageCms

intent = ImageCms.INTENT_PERCEPTUAL

# СТАЛО
from PIL import ImageCms

intent = ImageCms.Intent.PERCEPTUAL
```

4. **Обновить getdata:**
```python
# БЫЛО
from PIL import Image

img = Image.open("image.png")
data = img.getdata()

# СТАЛО
from PIL import Image

img = Image.open("image.png")
data = img.get_flattened_data()  # Или продолжить использовать getdata (deprecated, но работает)
```

5. **Обновить пакет:**
```bash
pip install pillow==12.1.0
```

6. **Тестирование:**
```bash
pytest tests/test_image_processing.py -v
pytest tests/test_cover_generation.py -v
```

---

#### 11.3. psutil 6.1.1 → 7.2.2

**Уровень риска:** НИЗКИЙ  
**Трудозатраты:** 1-3 часа

**Breaking changes:**
- `memory_info_ex()` удалён → `memory_full_info()`
- `connections()` → `net_connections()`
- `disk_partitions().maxfile/.maxpath` удалены

**Шаги миграции:**

1. **Найти использование psutil:**
```bash
cd backend
grep -r "import psutil" app/ tests/
grep -r "from psutil" app/ tests/
```

2. **Обновить memory_info_ex:**
```python
# БЫЛО
import psutil

process = psutil.Process()
mem = process.memory_info_ex()

# СТАЛО
import psutil

process = psutil.Process()
mem = process.memory_full_info()
```

3. **Обновить connections:**
```python
# БЫЛО
import psutil

conns = psutil.connections()

# СТАЛО
import psutil

conns = psutil.net_connections()
```

4. **Обновить disk_partitions:**
```python
# БЫЛО
import psutil

for partition in psutil.disk_partitions():
    print(partition.maxfile, partition.maxpath)

# СТАЛО
import psutil

for partition in psutil.disk_partitions():
    # maxfile и maxpath удалены, использовать другие атрибуты
    print(partition.device, partition.mountpoint)
```

5. **Обновить пакет:**
```bash
pip install psutil==7.2.2
```

6. **Тестирование:**
```bash
pytest tests/test_monitoring.py -v
```

---

#### 11.4. aiofiles 24.1.0 → 25.1.0

**Уровень риска:** ОЧЕНЬ НИЗКИЙ  
**Трудозатраты:** 30 минут

**Breaking changes:**
- Python 3.9+ обязателен
- Нет API изменений

**Шаги миграции:**

1. **Обновить пакет:**
```bash
pip install aiofiles==25.1.0
```

2. **Тестирование:**
```bash
pytest tests/test_file_operations.py -v
```

---

#### 11.5. fastapi 0.125.0 → 0.128.0

**Уровень риска:** ВЫСОКИЙ (если используется Pydantic v1), иначе НИЗКИЙ  
**Трудозатраты:** 1-2 часа

**Breaking changes:**
- Pydantic v1 полностью удалён в 0.128.0
- Python 3.9+ обязателен

**Шаги миграции:**

1. **Проверить версию Pydantic:**
```bash
pip show pydantic
# Должно быть 2.x
```

2. **Если используется Pydantic v1, сначала мигрировать на v2:**
```bash
# Это отдельная большая миграция, не входит в этот план
# fancai уже использует Pydantic 2.12.5, поэтому безопасно
```

3. **Обновить пакет:**
```bash
pip install fastapi==0.128.0
```

4. **Тестирование:**
```bash
pytest tests/ -v
```

**Итого Wave 11:** 10-18 часов

---

## Детальная информация по пакетам

### Frontend

#### Пакеты с major bumps

| Пакет | Текущая | Целевая | Риск | Трудозатраты | Wave |
|-------|---------|---------|------|--------------|------|
| tailwindcss | 3.4.18 | 4.1.18 | СРЕДНИЙ | 4-8ч | 3 |
| vite | 6.4.1 | 7.3.1 | НИЗКИЙ | 1-2ч | 1 |
| @vitejs/plugin-react | 4.7.0 | 5.1.3 | НИЗКИЙ-СРЕДНИЙ | 1ч | 1 |
| vitest | 2.1.9 | 4.0.18 | СРЕДНИЙ | 6-8ч | 2 |
| @vitest/coverage-v8 | 2.1.9 | 4.0.18 | НИЗКИЙ | 1ч | 2 |
| @vitest/ui | 2.1.9 | 4.0.18 | НИЗКИЙ | 15мин | 2 |
| jsdom | 25.0.1 | 28.0.0 | НИЗКИЙ | 2-4ч | 2 |
| zod | 3.25.76 | 4.3.6 | СРЕДНИЙ-ВЫСОКИЙ | 1-2д | 4 |
| @hookform/resolvers | 3.10.0 | 5.2.2 | НИЗКИЙ | 1-2ч | 4 |
| framer-motion | 11.18.2 | 12.31.0 | НИЗКИЙ | 1-2ч | 5 |
| lucide-react | 0.469.0 | 0.563.0 | НИЗКИЙ-СРЕДНИЙ | 2-3ч | 5 |
| eslint-plugin-react-hooks | 5.2.0 | 7.0.1 | НИЗКИЙ | 30мин | 1 |
| eslint-plugin-react-refresh | 0.4.24 | 0.5.0 | СРЕДНИЙ-ВЫСОКИЙ | 2-4ч | 1 |
| @playwright/test | 1.56.1 | 1.58.1 | НИЗКИЙ-СРЕДНИЙ | 1ч | 2 |
| react-hook-form | 7.65.0 | 7.71.1 | НИЗКИЙ | 30мин | 0 |

#### Пакеты с minor/patch bumps (Wave 0)

| Пакет | Текущая | Целевая | Изменения |
|-------|---------|---------|-----------|
| react | 19.2.3 | 19.2.4 | Security fixes |
| react-dom | 19.2.3 | 19.2.4 | Security fixes |
| react-router-dom | 7.11.0 | 7.13.0 | Bug fixes |
| @tanstack/react-query | 5.90.12 | 5.90.20 | Bug fixes |
| @radix-ui/react-dialog | 1.1.4 | 1.1.5 | Bug fixes |
| @radix-ui/react-dropdown-menu | 2.1.4 | 2.1.5 | Bug fixes |
| @radix-ui/react-label | 2.1.1 | 2.1.2 | Bug fixes |
| @radix-ui/react-select | 2.1.4 | 2.1.5 | Bug fixes |
| @radix-ui/react-slider | 1.2.2 | 1.2.3 | Bug fixes |
| @radix-ui/react-slot | 1.1.1 | 1.1.2 | Bug fixes |
| @radix-ui/react-switch | 1.1.2 | 1.1.3 | Bug fixes |
| @radix-ui/react-tabs | 1.1.2 | 1.1.3 | Bug fixes |
| @radix-ui/react-toast | 1.2.4 | 1.2.5 | Bug fixes |
| @testing-library/react | 16.3.1 | 16.3.2 | React 19 types fix |
| @types/node | 25.0.3 | 25.2.0 | Type updates |
| @types/react | 19.2.7 | 19.2.10 | Type updates |
| axios | 1.13.1 | 1.13.4 | Socket hang up fix |
| dexie | 4.2.1 | 4.3.0 | Social auth, suspense hook |
| dompurify | 3.3.0 | 3.3.1 | Improved ADD_FORBID_CONTENTS |
| autoprefixer | 10.4.21 | 10.4.24 | Performance |
| globals | 17.2.0 | 17.3.0 | New globals |
| i18next | 25.8.0 | 25.8.1 | Selector fix |
| tailwind-merge | 3.3.1 | 3.4.0 | New features |
| zustand | 5.0.10 | 5.0.11 | Bug fixes |

---

### Backend

#### Пакеты с major bumps

| Пакет | Текущая | Целевая | Риск | Трудозатраты | Wave |
|-------|---------|---------|------|--------------|------|
| redis | 5.2.1 | 7.1.0 | СРЕДНИЙ | 4-6ч | 8 |
| pytest | 8.3.4 | 9.0.2 | СРЕДНИЙ | 4-6ч | 7 |
| pytest-asyncio | 0.25.2 | 1.3.0 | ВЫСОКИЙ | 3-5д | 7 |
| pytest-cov | 6.0.0 | 7.0.0 | НИЗКИЙ | 1ч | 7 |
| cryptography | 44.0.0 | 46.0.4 | ВЫСОКИЙ | 4-8ч | 6 |
| lxml | 5.3.0 | 6.0.2 | СРЕДНИЙ-ВЫСОКИЙ | 6-12ч | 11 |
| pillow | 11.0.0 | 12.1.0 | НИЗКИЙ-СРЕДНИЙ | 2-4ч | 11 |
| black | 24.10.0 | 26.1.0 | НИЗКИЙ | 1-3ч | 10 |
| psutil | 6.1.1 | 7.2.2 | НИЗКИЙ | 1-3ч | 11 |
| gunicorn | 23.0.0 | 25.0.1 | НЕИЗВЕСТНЫЙ | 4-8ч | 9 |
| aiofiles | 24.1.0 | 25.1.0 | ОЧЕНЬ НИЗКИЙ | 30мин | 11 |
| fastapi | 0.125.0 | 0.128.0 | НИЗКИЙ | 1-2ч | 11 |
| uvicorn | 0.34.0 | 0.40.0 | СРЕДНИЙ | 1-2ч | 8 |
| pydantic-settings | 2.8.0 | 2.12.0 | ВЫСОКИЙ | 2-4ч | 9 |
| python-jose | 3.4.0 | 3.5.0 | НИЗКИЙ | 1ч | 6 |
| python-multipart | 0.0.20 | 0.0.22 | СРЕДНИЙ | 1ч | 9 |
| pywebpush | 2.0.0 | 2.2.0 | СРЕДНИЙ | 1ч | 9 |
| kombu | 5.5.0 | 5.6.2 | НИЗКИЙ | 30мин | 8 |
| ruff | 0.8.4 | 0.14.14 | ВЫСОКИЙ | 2-4ч | 10 |

#### Пакеты с minor/patch bumps (Wave 0)

| Пакет | Текущая | Целевая | Изменения |
|-------|---------|---------|-----------|
| sqlalchemy | 2.0.45 | 2.0.46 | Bug fixes |
| alembic | 1.14.0 | 1.18.3 | Plugin system, pyproject.toml support |
| aiohttp | 3.11.11 | 3.13.3 | Security fixes, Zstd compression |
| asyncpg | 0.30.0 | 0.31.0 | Python 3.14 support |
| networkx | 3.4.2 | 3.6.1 | New algorithms, Python 3.10+ |
| beautifulsoup4 | 4.12.3 | 4.14.3 | Bug fixes |
| ebooklib | 0.19 | 0.20 | Better EPUB compatibility |
| requests | 2.32.3 | 2.32.5 | Python 3.14 support |
| aiosqlite | 0.20.0 | 0.22.1 | Bug fixes |
| prometheus-client | 0.21.1 | 0.24.1 | Native histograms, UTF-8 |
| prometheus-fastapi-instrumentator | 7.0.0 | 7.1.0 | Custom labels |
| tenacity | 9.0.0 | 9.1.2 | Python 3.13 support |
| google-genai | 1.59.0 | 1.61.0 | Distillation tuning, GCS files |
| sentry-sdk | 2.19.2 | 2.51.0 | AI integrations (32 minor versions) |
| celery | 5.6.2 | 5.6.2 | Уже последняя версия |

---

### Root

| Пакет | Текущая | Целевая | Риск | Трудозатраты | Wave |
|-------|---------|---------|------|--------------|------|
| playwright | 1.57.0 | 1.58.1 | НИЗКИЙ-СРЕДНИЙ | 1ч | 2 |

---

## Таблица рисков

### Критические риски (требуют особого внимания)

| Пакет | Риск | Причина | Митигация |
|-------|------|---------|-----------|
| pytest-asyncio | ВЫСОКИЙ | Удаление `event_loop` fixture, изменение всех async тестов | Выделить 3-5 дней, тестировать поэтапно |
| zod | СРЕДНИЙ-ВЫСОКИЙ | Изменения API валидации, влияет на все формы | Использовать codemod, тестировать все формы |
| cryptography | ВЫСОКИЙ | Изменения безопасности, влияет на аутентификацию | Тщательное тестирование auth flow |
| tailwindcss | СРЕДНИЙ | Полная переработка конфигурации, визуальные изменения | Использовать автоматический инструмент, визуальная проверка |
| pydantic-settings | ВЫСОКИЙ | Изменение порядка приоритета источников | Проверить все env переменные |
| gunicorn | НЕИЗВЕСТНЫЙ | Changelog недоступен | Тестирование в staging окружении |

### Средние риски

| Пакет | Риск | Причина | Митигация |
|-------|------|---------|-----------|
| vitest | СРЕДНИЙ | Двухфазная миграция v2→v3→v4 | Поэтапное обновление |
| redis-py | СРЕДНИЙ | Изменения async API | Тестирование кэширования и сессий |
| lxml | СРЕДНИЙ-ВЫСОКИЙ | Изменения парсинга HTML/XML | Тестирование EPUB/FB2 парсеров |
| uvicorn | СРЕДНИЙ | Изменения WebSocket | Тестирование WebSocket endpoints |
| ruff | ВЫСОКИЙ | Много новых правил, изменения форматирования | Отдельная ветка для форматирования |

### Низкие риски (безопасные обновления)

Все пакеты в Wave 0 (32 пакета) — minor/patch обновления без breaking changes.

---

## Рекомендуемый порядок выполнения

### Этап 1: Подготовка (1 день)
1. Создать отдельную ветку для миграции: `git checkout -b feat/dependency-migration-2026`
2. Настроить CI/CD для автоматического тестирования
3. Создать staging окружение для тестирования
4. Сделать backup базы данных

### Этап 2: Безопасные обновления (1-2 дня)
**Wave 0** — обновить все minor/patch пакеты (frontend + backend)

### Этап 3: Frontend инфраструктура (3-5 дней)
**Wave 1** — Build-система (vite, plugins, eslint)  
**Wave 2** — Тестовая инфраструктура (vitest, jsdom, playwright)

### Этап 4: Frontend UI (3-4 дня)
**Wave 3** — Tailwind CSS 4  
**Wave 4** — Zod 4 + react-hook-form resolvers  
**Wave 5** — Анимации и иконки

### Этап 5: Backend безопасность и тесты (4-7 дней)
**Wave 6** — Безопасность (cryptography, python-jose)  
**Wave 7** — Тестирование (pytest, pytest-asyncio, pytest-cov)

### Этап 6: Backend инфраструктура (3-5 дней)
**Wave 8** — Redis, Kombu, Uvicorn  
**Wave 9** — Веб-стек (pydantic-settings, gunicorn, multipart)

### Этап 7: Финализация (3-4 дня)
**Wave 10** — Форматирование (black, ruff)  
**Wave 11** — Оставшиеся пакеты (lxml, pillow, psutil, fastapi)

### Этап 8: Тестирование и деплой (2-3 дня)
1. Полное регрессионное тестирование
2. Нагрузочное тестирование
3. Тестирование в staging
4. Production деплой

---

## Общая оценка трудозатрат

| Этап | Трудозатраты | Календарные дни |
|------|--------------|-----------------|
| Подготовка | 8ч | 1 день |
| Wave 0 | 8-16ч | 1-2 дня |
| Wave 1 | 4-7ч | 1 день |
| Wave 2 | 10-14ч | 2-3 дня |
| Wave 3 | 4-8ч | 1 день |
| Wave 4 | 8-16ч | 1-2 дня |
| Wave 5 | 3-5ч | 1 день |
| Wave 6 | 5-9ч | 1-2 дня |
| Wave 7 | 24-40ч | 3-5 дней |
| Wave 8 | 6-9ч | 1-2 дня |
| Wave 9 | 8-14ч | 1-2 дня |
| Wave 10 | 3-7ч | 1 день |
| Wave 11 | 10-18ч | 2-3 дня |
| Тестирование | 16-24ч | 2-3 дня |
| **ИТОГО** | **117-195ч** | **20-35 дней** |

**Рекомендация:** Выделить 6-8 недель календарного времени с учётом параллельной работы над другими задачами.

---

## Чеклист перед началом миграции

- [ ] Создана ветка для миграции
- [ ] Настроен CI/CD для автоматического тестирования
- [ ] Создано staging окружение
- [ ] Сделан backup базы данных
- [ ] Команда ознакомлена с планом миграции
- [ ] Выделено достаточно времени (6-8 недель)
- [ ] Определены ответственные за каждую волну
- [ ] Настроен мониторинг для отслеживания проблем

---

## Чеклист после каждой волны

- [ ] Все тесты проходят (frontend + backend)
- [ ] Type-check проходит без ошибок
- [ ] Lint проходит без ошибок
- [ ] Build успешен
- [ ] Визуальная проверка UI (для frontend волн)
- [ ] Код зарелизен в staging
- [ ] Проведено smoke тестирование в staging
- [ ] Создан PR с описанием изменений
- [ ] PR прошёл code review
- [ ] PR смержен в main ветку

---

## Контакты и ресурсы

### Документация пакетов

**Frontend:**
- [Tailwind CSS 4 Migration Guide](https://tailwindcss.com/docs/upgrade-guide)
- [Vite 7 Migration Guide](https://vite.dev/guide/migration)
- [Vitest 4 Migration Guide](https://vitest.dev/guide/migration)
- [Zod 4 Migration Guide](https://zod.dev/migration)
- [Framer Motion → Motion](https://motion.dev/docs/migrate-from-framer-motion)

**Backend:**
- [pytest 9 Changelog](https://docs.pytest.org/en/stable/changelog.html)
- [pytest-asyncio 1.0 Migration](https://pytest-asyncio.readthedocs.io/en/latest/reference/changelog.html)
- [redis-py 7.0 Migration](https://redis-py.readthedocs.io/en/stable/migration.html)
- [cryptography Changelog](https://cryptography.io/en/latest/changelog/)
- [FastAPI Changelog](https://fastapi.tiangolo.com/release-notes/)

### Инструменты автоматической миграции

- `npx @tailwindcss/upgrade` — Tailwind CSS 3→4
- `npx zod-v3-to-v4` — Zod 3→4
- `black app/ tests/` — Black форматирование
- `ruff check --fix` — Ruff автофиксы

---

## Заключение

Миграция 68 устаревших пакетов — масштабная задача, требующая 6-8 недель работы. Ключевые риски:

1. **pytest-asyncio 0.25→1.3** — самая сложная миграция (3-5 дней)
2. **tailwindcss 3→4** — визуальные изменения, требует тщательной проверки
3. **zod 3→4** — влияет на все формы
4. **cryptography 44→46** — критично для безопасности

**Рекомендуемая стратегия:**
- Начать с Wave 0 (безопасные обновления)
- Выполнять волны последовательно
- Тестировать после каждой волны
- Использовать staging окружение
- Не спешить с production деплоем

**Ожидаемые выгоды:**
- Улучшенная безопасность (cryptography, python-jose)
- Лучшая производительность (Zod 4 в 6.5x быстрее, Tailwind 4 меньше bundle)
- Современный стек технологий
- Исправленные баги и новые возможности

Удачи в миграции! 🚀
