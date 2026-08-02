# Паттерны тестирования

**Дата анализа:** 2026-03-04

> **Historical test-pattern snapshot.** Команды/паттерны ниже полезны, но версии и counts
> устарели. Audit 2026-07-18: frontend 564 passed + 1 skipped; backend broad run —
> 672 passed, 16 skipped, 72 failed, 387 test-DB errors. Действующий baseline и причины —
> [`.planning/STATE.md`](../STATE.md).

## Фреймворк (Frontend)

**Запускатель:**
- Vitest 4.x
- Конфиг: `frontend/vitest.config.ts`
- Среда: jsdom (браузерное окружение)
- Setup: `frontend/src/test/setup.ts`

**Библиотеки утверждений:**
- `@testing-library/react` v16 — рендеринг компонентов и хуков
- `@testing-library/jest-dom` v6 — DOM-матчеры (`toBeInTheDocument`, `toHaveClass`)
- `@testing-library/user-event` v14 — симуляция пользовательских событий

**E2E:**
- Playwright 1.49 — браузерные тесты
- Конфиг: `frontend/playwright.config.ts`
- Браузеры: Chromium, Firefox, WebKit, Mobile Chrome (Pixel 5), Mobile Safari (iPhone 12)

**Команды запуска:**
```bash
cd frontend && npm test                    # Все unit-тесты (vitest run)
cd frontend && npm run test:watch          # Watch-режим
cd frontend && npm run test:ui             # Vitest UI
cd frontend && npm run test:e2e            # Playwright E2E
cd frontend && npm run test:e2e:chromium   # E2E только Chromium
cd frontend && npm run test:e2e:debug      # E2E с отладкой
```

## Фреймворк (Backend)

**Запускатель:**
- pytest с плагинами: `pytest-asyncio`, `pytest-cov`, `httpx`
- Конфиг: `backend/pytest.ini`
- Режим asyncio: `asyncio_mode = auto` (все async-тесты запускаются автоматически)

**Команды запуска:**
```bash
cd backend && pytest -v                         # Все тесты
cd backend && pytest -v --tb=short              # Краткий трейсбек
cd backend && pytest -v -m unit                 # Только unit-тесты
cd backend && pytest -v -m integration          # Только интеграционные
cd backend && pytest -v -m "not slow"           # Без медленных тестов
cd backend && pytest tests/services/ -v         # Конкретная директория
```

## Организация тестовых файлов

**Frontend:**
- Расположение: co-located `__tests__/` директории рядом с тестируемым кодом
- Именование: `<ModuleName>.test.ts` или `<ModuleName>.test.tsx`
- `.skip` суффикс для временно отключённых тестов (`BookReader.test.tsx.skip`, `client.test.ts.skip`)

```
frontend/src/
├── stores/__tests__/auth.test.ts
├── components/Reader/__tests__/EpubReader.test.tsx
├── components/__tests__/ErrorBoundary.test.tsx
├── hooks/__tests__/useReadingSession.test.ts
├── hooks/api/__tests__/useBooks.test.tsx
├── hooks/epub/__tests__/useDescriptionHighlighting.test.tsx
├── hooks/epub/__tests__/useChapterMapping.test.ts
├── hooks/epub/__tests__/useProgressSync.simple.test.tsx
├── pages/__tests__/LibraryPage.test.tsx
├── api/__tests__/books.test.ts
└── services/__tests__/chapterCache.test.ts
```

**Backend:**
- Расположение: отдельная директория `backend/tests/`
- Иерархия: `tests/routers/`, `tests/services/`, `tests/integration/`, `tests/performance/`, `tests/core/`, `tests/schemas/`, `tests/middleware/`
- Именование: `test_<module_name>.py`
- Общие фикстуры: `backend/tests/conftest.py` (глобальные), `backend/tests/routers/conftest.py` (роутеры)
- Маркеры: `@pytest.mark.unit`, `@pytest.mark.integration`, `@pytest.mark.slow`, `@pytest.mark.benchmark`

```
backend/tests/
├── conftest.py                         # Глобальные фикстуры
├── test_auth.py                        # Unit-тесты аутентификации
├── test_books.py
├── test_security.py
├── routers/
│   ├── conftest.py                     # Фикстуры роутеров (feature flags)
│   ├── test_reading_sessions.py
│   └── test_reading_progress.py
├── services/
│   ├── test_entity_deduplication.py
│   └── test_feature_flag_model.py
├── integration/
│   ├── test_auth_flow_integration.py
│   ├── test_books_router_integration.py
│   └── test_entity_concurrent_upsert.py
├── performance/
│   └── test_reading_sessions_load.py   # Locust нагрузочные тесты
├── fixtures/
│   └── reading_sessions.py
└── core/
    └── test_openrouter_client.py
```

## Структура тестов

**Frontend (suite-организация):**
```typescript
/**
 * Tests for useDescriptionHighlighting hook
 *
 * Блок описания покрываемых сценариев
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('useDescriptionHighlighting', () => {
  let mockRendition: Partial<Rendition>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.clearAllMocks();
    // Подавление console-вывода в тестах
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Initial Setup', () => {
    it('should skip highlighting when rendition is null', () => { ... });
  });

  describe('Event Listeners', () => {
    it('should register "rendered" event listener on mount', () => { ... });
  });
});
```

**Backend (class-организация):**
```python
"""
Docstring описания тестового модуля с перечнем покрываемых сценариев.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

class TestStartSession:
    """Test suite для POST /reading-sessions/start endpoint."""

    @pytest.mark.asyncio
    async def test_start_session_success(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
    ):
        """Test successful start of a new reading session."""
        # Arrange
        request_data = { ... }

        # Act
        response = await client.post(...)

        # Assert
        assert response.status_code == 201
```

## Моки

**Frontend (Vitest):**

Паттерн мока API-модуля:
```typescript
vi.mock('@/api/auth', () => ({
  authAPI: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    refreshToken: vi.fn(),
  },
}));

// Использование
vi.mocked(authAPI.login).mockResolvedValue(mockResponse);
vi.mocked(authAPI.login).mockRejectedValue(new Error('Invalid credentials'));
```

Паттерн мока хука с конкретными возвращаемыми значениями:
```typescript
vi.mock('@/hooks/useReadingSession', () => ({
  useReadingSession: vi.fn(() => ({})),
}));
```

Мок с частичной реализацией (`importOriginal`):
```typescript
vi.mock('@/utils/text-search/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/text-search/cache')>();
  return {
    ...actual,
    getFromCache: () => undefined,
    addToCache: () => {},
  };
});
```

Что мокировать:
- Все API-вызовы (`@/api/*`)
- Сторонние сервисы (IndexedDB через `fake-indexeddb`)
- Браузерные API (IntersectionObserver, ResizeObserver, matchMedia, localStorage — в setup.ts)
- epub.js Rendition и Book объекты (сложные внешние зависимости)

**Backend (unittest.mock):**

```python
# AsyncMock для async-методов
mock = AsyncMock()
mock.extract.return_value = [{"content": "...", "type": "location"}]

# MagicMock для sync-методов
mock = MagicMock()
mock.is_available.return_value = True
mock.generate_image = AsyncMock(return_value=MockImageGenerationResult())

# Переопределение FastAPI dependency
app.dependency_overrides[get_book_parser_dep] = lambda: mock_book_parser
# Очистка после теста
app.dependency_overrides.clear()
DependencyContainer.reset_all()
DependencyContainer.clear_caches()
```

## Фикстуры и фабрики

**Frontend (setup.ts — глобальные моки браузера):**
```typescript
// frontend/src/test/setup.ts
import 'fake-indexeddb/auto';        // IndexedDB для Dexie
import '@testing-library/jest-dom';  // DOM-матчеры

global.IntersectionObserver = class IntersectionObserver { ... };
global.ResizeObserver = vi.fn(() => ({ ... }));
window.matchMedia = vi.fn().mockImplementation(query => ({ ... }));
global.localStorage = localStorageMock;
```

**Backend (conftest.py — иерархические фикстуры):**
```python
# Тестовая БД: автоматически создаётся/удаляется для каждого теста
@pytest_asyncio.fixture(scope="function")
async def test_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

# Сессия БД
@pytest_asyncio.fixture(scope="function")
async def db_session(test_db): ...

# HTTP-клиент с тестовой БД
@pytest_asyncio.fixture(scope="function")
async def client(override_get_database):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

# Готовые объекты данных
@pytest_asyncio.fixture
async def test_user(db_session, sample_user_data): ...  # Пользователь в БД

@pytest_asyncio.fixture
async def test_book(db_session, test_user): ...          # Книга с главами

@pytest_asyncio.fixture
async def auth_headers(db_session, client): ...         # Bearer-заголовки

@pytest_asyncio.fixture
async def admin_auth_headers(db_session, client): ...   # Admin Bearer-заголовки
```

Мок-сервисы (в conftest.py, для инжекции через DI):
- `mock_book_parser` — мок BookParser
- `mock_image_generator_service` — мок ImageGeneratorService
- `mock_gemini_extractor` — мок GeminiDirectExtractor
- `mock_auth_service` — мок AuthService (реальное хэширование паролей)
- `mock_token_blacklist` — мок TokenBlacklist
- `app_with_mock_services` — приложение со всеми мок-сервисами, но реальной БД

Вспомогательная функция для DI-переопределений:
```python
overrides = create_mock_dependency_overrides(
    book_parser=mock_book_parser,
    image_generator=mock_image_generator,
)
app.dependency_overrides.update(overrides)
```

## Покрытие

**Frontend:**
- Провайдер: `@vitest/coverage-v8`
- Форматы отчётов: text, json, html, lcov
- Минимальный порог: 40% (lines, functions, branches, statements) с `autoUpdate: true`
- Текущее состояние: критически низкое (~1.9% компонентов UI имеют тесты — см. `frontend/TEST_COVERAGE_AUDIT.md`)
- Просмотр: `npm run test:ui` → Coverage вкладка

**Backend:**
- Провайдер: pytest-cov
- Минимальный порог: **70%** (`--cov-fail-under=70`)
- Отчёты: terminal (term-missing) + HTML (`backend/htmlcov/`)
- Покрывается: `app/` директория (`--cov=app`)

## Виды тестов

**Unit-тесты (Frontend):**
- Хуки: `renderHook()` из `@testing-library/react`
- Сторы Zustand: `renderHook(() => useAuthStore())` + `useAuthStore.setState()`
- Утилиты: прямой вызов функций
- Сервисы (IndexedDB): реальная IndexedDB через `fake-indexeddb`
- Примеры: `src/stores/__tests__/auth.test.ts`, `src/services/__tests__/chapterCache.test.ts`

**Unit-тесты (Backend):**
- Сервисы с мок-зависимостями: `@patch`, `AsyncMock`, `MagicMock`
- Pydantic-схемы: прямое создание объектов
- Примеры: `tests/core/test_openrouter_client.py`, `tests/services/test_entity_deduplication.py`

**Интеграционные тесты (Backend):**
- Маркер: `@pytest.mark.integration`
- Реальная тестовая БД PostgreSQL + мок внешних сервисов
- Фикстуры: `client`, `db_session`, `auth_headers`
- Паттерн: step-by-step flow с промежуточными ассертами
- Примеры: `tests/integration/test_auth_flow_integration.py`

**E2E-тесты (Frontend):**
- Playwright в директории `frontend/tests/`
- Базовый URL: `http://localhost:5173` (dev-сервер)
- Таймаут теста: 60s, таймаут действия: 10s, таймаут навигации: 30s
- Автоматический запуск dev-сервера перед тестами

**Нагрузочные тесты (Backend):**
- Locust: `tests/performance/test_reading_sessions_load.py`
- Запуск: `locust -f tests/performance/... --host=http://localhost:8000`
- Условно пропускаются, если locust не установлен

## Паттерны async-тестирования (Frontend)

```typescript
// Использование fake timers для debounce/timeout
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
});
afterEach(() => {
  vi.useRealTimers();
});

// Продвижение времени вперёд
await act(async () => {
  await vi.advanceTimersByTimeAsync(300);
});

// Ожидание асинхронного состояния
await waitFor(() => {
  expect(result.current.isLoading).toBe(false);
});
```

## Паттерны тестирования ошибок

**Frontend:**
```typescript
// Ожидание выброса исключения
await expect(
  act(async () => {
    await result.current.register('existing@example.com', 'password');
  })
).rejects.toThrow('Email already exists');

// Проверка состояния после ошибки
try {
  await act(async () => { await result.current.login(...); });
} catch {
  // Ожидаемое исключение
}
expect(result.current.isAuthenticated).toBe(false);
```

**Backend:**
```python
# HTTP-статус коды
assert response.status_code == 422  # Validation error
assert response.status_code == 401  # Unauthorized

# Содержимое ответа об ошибке
data = response.json()
assert "detail" in data
```

## Тестирование QueryClientProvider (Frontend)

Паттерн обёртки для TanStack Query-хуков:
```typescript
let queryClient: QueryClient;

const createWrapper = () => {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },     // Отключить retry в тестах
      mutations: { retry: false },
    },
  });
});

afterEach(() => {
  queryClient.clear();
});

// Использование
const { result } = renderHook(() => useBooks(), { wrapper: createWrapper() });
```

## Пробелы в покрытии

**Frontend (критические):**
- Компоненты UI (`src/components/UI/`) — практически не покрыты (см. `frontend/TEST_COVERAGE_AUDIT.md`)
- Страницы (`src/pages/`) — частично: только `LibraryPage`, `ForgotPasswordPage`, `ResetPasswordPage`
- Компоненты `Entities/` (`EntityCard`, `EntityList`, `EntityDrawer`) — не покрыты
- `EpubReader.tsx` — частичное покрытие (35 тестов, но сложные интеграционные сценарии не покрыты)

**Backend (заметные):**
- `services/gemini_extractor.py` (1221 строк) — тесты минимальны
- `routers/images.py` (957 строк) — интеграционные тесты ограничены
- `services/entity_service.py` — споилер-фри фильтрация не тестирована

---

*Анализ тестирования: 2026-03-04*
