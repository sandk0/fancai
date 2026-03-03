# Паттерны тестирования

**Дата анализа:** 2026-02-27

## Тестовый фреймворк

### Фронтенд

**Раннер:**
- Vitest 4.x
- Конфигурация: `frontend/vitest.config.ts`

**Библиотека утверждений:**
- Встроенный `expect` Vitest + матчеры `@testing-library/jest-dom`

**Команды запуска:**
```bash
cd frontend && npm test              # Запуск всех тестов (vitest run)
cd frontend && npm run test:watch    # Режим наблюдения
cd frontend && npm run test:ui       # Vitest UI (браузер)
cd frontend && npm run test:e2e      # E2E-тесты Playwright
```

### Бэкенд

**Раннер:**
- pytest с `pytest-asyncio` (asyncio_mode = auto)
- Конфигурация: `backend/pytest.ini`

**Библиотека утверждений:**
- Встроенный `assert` pytest

**Команды запуска:**
```bash
cd backend && pytest -v                           # Запуск всех тестов с покрытием
cd backend && pytest tests/routers/ -v           # Только роутеры
cd backend && pytest tests/integration/ -v       # Только интеграционные тесты
cd backend && pytest -m unit -v                  # Только модульные тесты
cd backend && pytest -m "not slow" -v            # Исключить медленные тесты
```

## Организация тестовых файлов

### Фронтенд

**Расположение:** совмещённый подкаталог `__tests__/` внутри дерева исходного кода

**Паттерн именования:** `{ИмяИсходногоФайла}.test.{ts|tsx}`

**Структура:**
```
frontend/src/
├── api/
│   └── __tests__/
│       └── books.test.ts
├── components/
│   ├── __tests__/
│   │   └── ErrorBoundary.test.tsx
│   └── Reader/
│       └── __tests__/
│           └── EpubReader.test.tsx
├── hooks/
│   ├── __tests__/
│   │   ├── useReadingSession.test.ts
│   │   └── useOnlineStatus.test.tsx
│   ├── api/
│   │   └── __tests__/
│   │       └── useBooks.test.tsx
│   └── epub/
│       └── __tests__/
│           ├── useDescriptionHighlighting.test.tsx
│           ├── useChapterMapping.test.ts
│           ├── useProgressSync.test.tsx
│           └── useProgressSync.simple.test.tsx
├── pages/
│   └── __tests__/
│       ├── LibraryPage.test.tsx
│       ├── ForgotPasswordPage.test.tsx
│       └── ResetPasswordPage.test.tsx
├── services/
│   └── __tests__/
│       ├── chapterCache.test.ts
│       └── syncQueue.test.ts
├── stores/
│   └── __tests__/
│       └── auth.test.ts
└── utils/
    └── text-search/
        └── __tests__/
            ├── normalization.test.ts
            └── strategies.test.ts
```

**Глобальная настройка тестов:** `frontend/src/test/setup.ts`

### Бэкенд

**Расположение:** выделенный каталог `backend/tests/` (отдельно от исходного кода)

**Паттерн именования:** `test_{имя_модуля}.py`

**Структура:**
```
backend/tests/
├── conftest.py                      # Общие фикстуры для всех тестов
├── fixtures/
│   ├── __init__.py
│   └── reading_sessions.py
├── routers/
│   ├── conftest.py                  # Фикстуры для роутеров
│   ├── test_auth.py (via test_auth.py)
│   ├── test_chapters.py
│   ├── test_descriptions.py
│   ├── test_health.py
│   ├── test_reading_progress.py
│   ├── test_reading_sessions.py
│   └── test_feature_flags_api.py
├── integration/
│   ├── test_auth_flow_integration.py
│   ├── test_books_router_integration.py
│   ├── test_book_parsing_service_integration.py
│   ├── test_reading_sessions_flow.py
│   └── test_entity_concurrent_upsert.py
├── performance/
│   └── test_reading_sessions_load.py
├── schemas/
│   ├── test_response_schemas_phase11.py
│   └── test_response_schemas_phase12.py
└── tasks/
    └── test_reading_sessions_tasks.py
```

## Структура тестов

### Организация тестовых наборов фронтенда

```typescript
/**
 * Краткое описание того, что тестируется
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ComponentOrHookName', () => {
  // Общая настройка
  beforeEach(() => {
    vi.clearAllMocks();
    // Настройка моков
  });

  afterEach(() => {
    vi.useRealTimers();  // если использовались фейковые таймеры
    vi.restoreAllMocks();
  });

  describe('Логическая группа', () => {
    it('should describe specific behavior', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

**Наблюдаемые паттерны:**
- Структура Arrange/Act/Assert (часто неявная, без комментариев на фронтенде)
- Вложенные блоки `describe` группируют связанные поведения
- `beforeEach` / `afterEach` для настройки/очистки
- `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` для логики, зависящей от времени
- Всегда `vi.clearAllMocks()` в `beforeEach`

### Организация тестовых наборов бэкенда

```python
class TestComponentName:
    """Тестовый набор для конкретного компонента."""

    @pytest.mark.asyncio
    async def test_behavior_description(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Краткое описание того, что проверяет этот тест."""
        # Arrange
        ...

        # Act
        response = await client.get("/api/v1/endpoint")

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["field"] == expected_value
```

**Наблюдаемые паттерны:**
- Тестовые наборы на основе классов: `class TestSuiteName:` группирует связанные тесты
- Явные комментарии `# Arrange / # Act / # Assert` в сложных тестах
- `@pytest.mark.asyncio` (хотя `asyncio_mode = auto` делает это избыточным — всё равно используется для ясности)
- `monkeypatch.setattr()` для замены функций на уровне модуля
- `db_session.add()` + `await db_session.commit()` для подготовки тестовых данных

## Мокирование

### Фронтенд: `vitest` (`vi`)

**Мокирование на уровне модуля:**
```typescript
// Мокирование всего модуля — размещать в начале файла, перед импортами
vi.mock('@/api/books');
vi.mock('@/services/chapterCache');
vi.mock('@/stores/auth');

// Мокирование с пользовательской реализацией
vi.mock('@/utils/text-search/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/text-search/cache')>();
  return {
    ...actual,
    getFromCache: () => undefined,  // Переопределение конкретных экспортов
  };
});
```

**Инлайн-шпионы:**
```typescript
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery');
```

**Использование мок-функций:**
```typescript
// Установка возвращаемого значения
vi.mocked(booksAPI.getBooks).mockResolvedValue(mockBooks);
vi.mocked(booksAPI.getBooks)
  .mockResolvedValueOnce(firstResponse)
  .mockResolvedValueOnce(secondResponse);

// Имитация реализаций
vi.mocked(booksAPI.uploadBook).mockImplementation(async (_formData, config) => {
  if (config?.onUploadProgress) {
    config.onUploadProgress({ loaded: 50, total: 100 } as any);
  }
  return { book: {...} };
});
```

**Что мокировать:**
- Все внешние API-вызовы (`booksAPI`, `authAPI` и др.)
- Браузерные API, отсутствующие в jsdom: `IntersectionObserver`, `ResizeObserver`, `matchMedia`, `localStorage`, `scrollTo`
- Сервисы с побочными эффектами: `chapterCache`, `imageCache`, `tabSync`
- Логгер: `vi.mock('@/lib/logger', ...)`

**Что НЕ мокировать:**
- Сам тестируемый модуль
- Чистые утилитарные функции (нормализация, стратегии)
- Dexie/IndexedDB — использовать `fake-indexeddb` из глобальной настройки (`frontend/src/test/setup.ts`)

### Бэкенд: `unittest.mock` + фикстуры `pytest`

**AsyncMock для асинхронных методов:**
```python
from unittest.mock import AsyncMock, MagicMock

mock_book_parser = AsyncMock()
mock_book_parser.parse_book.return_value = MockParsedBook()
mock_book_parser.detect_format.return_value = "epub"
```

**monkeypatch для замены функций:**
```python
async def mock_check_database(db):
    return ComponentHealthResponse(status="ok", message="DB OK", latency_ms=5.2)

monkeypatch.setattr("app.routers.health.check_database", mock_check_database)
```

**Переопределение внедрения зависимостей FastAPI:**
```python
# Переопределение через app.dependency_overrides
app.dependency_overrides[get_book_parser_dep] = lambda: mock_book_parser
# Всегда очищать после теста
app.dependency_overrides.clear()
DependencyContainer.reset_all()
DependencyContainer.clear_caches()
```

**Что мокировать:**
- Внешние сервисы: Gemini API, Imagen API (Phase 3: мигрируют на OpenRouter), почтовый сервис
- Задачи Celery (использовать фикстуру `app_with_mock_services`)
- Функции проверки здоровья для изолированного тестирования

**Что НЕ мокировать:**
- Операции с БД в интеграционных тестах — использовать реальную тестовую БД
- Хеширование паролей в auth-сервисе — использовать реальный `AuthService`

## Фикстуры и фабрики

### Фронтенд

**Паттерн обёртки QueryClient:**
```typescript
const createWrapper = () => {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Свежий QueryClient для каждого теста
queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  },
});
```

**Инлайн-фабрики мок-данных (без общих фабричных функций):**
```typescript
const mockBooks = {
  books: [{ id: '1', title: 'Book 1', author: 'Author 1' }] as Book[],
  total: 1,
  skip: 0,
  limit: 10,
};
```

**Расположение:** инлайн в тестовых файлах; общего каталога фикстур на фронтенде нет

### Бэкенд

**Общие фикстуры:** `backend/tests/conftest.py` — загружаются глобально для всех тестов

**Ключевые фикстуры:**
- `test_db` — создаёт/удаляет все таблицы для каждого теста (scope: function)
- `db_session` — асинхронная сессия SQLAlchemy, привязанная к тестовой БД
- `client` — `httpx.AsyncClient` с ASGI-транспортом к тестовому приложению
- `test_user` — сохранённая модель `User` в тестовой БД
- `test_book` — сохранённые модели `Book` + 3 `Chapter` в тестовой БД
- `auth_headers` / `admin_auth_headers` — JWT bearer-заголовки для аутентифицированных запросов
- `mock_book_parser` / `mock_gemini_extractor` / `mock_image_generator_service` — предварительно настроенные объекты `AsyncMock`
- `app_with_mock_services` — приложение с мокированными внешними сервисами, реальная БД

**Фабрики на основе dataclass:**
```python
@dataclass
class MockImageGenerationResult:
    success: bool = True
    image_url: Optional[str] = "https://example.com/test-image.png"
    local_path: Optional[str] = "/app/storage/test-image.png"
    generation_time_seconds: Optional[float] = 5.0
    model_used: Optional[str] = "imagen-4"  # Phase 3: мигрирует на FLUX.2 через OpenRouter

@dataclass
class MockParsedBook:
    metadata: Metadata = None
    chapters: List = None
    file_format: str = "epub"
```

## Покрытие

### Фронтенд

**Требования:** 40% строк/функций/ветвлений/выражений (задано через `vitest.config.ts`)
- `autoUpdate: true` — пороги автоматически обновляются после прохождения

**Просмотр покрытия:**
```bash
cd frontend && npm test -- --coverage
```

**Форматы отчётов:** text, json, html, lcov (провайдер: v8)

### Бэкенд

**Требования:** минимум 70% (`--cov-fail-under=70` в `pytest.ini`)

**Просмотр покрытия:**
```bash
cd backend && pytest --cov=app --cov-report=html:htmlcov
open backend/htmlcov/index.html
```

**Форматы отчётов:** term-missing (консоль), html (htmlcov/)

## Типы тестов

### Фронтенд

**Модульные тесты:**
- Область: отдельные хуки, сервисы, утилитарные функции
- Примеры: `useChapterMapping.test.ts`, `normalization.test.ts`, `chapterCache.test.ts`
- Паттерн: тесты чистых функций или `renderHook` для React-хуков

**Интеграционные тесты:**
- Область: хук + API + взаимодействие QueryClient
- Примеры: `useBooks.test.tsx`, `auth.test.ts`
- Паттерн: `renderHook` с обёрткой `QueryClientProvider`, API мокирован

**Компонентные тесты:**
- Область: отрендеренные React-компоненты
- Примеры: `EpubReader.test.tsx`, `ErrorBoundary.test.tsx`, `LibraryPage.test.tsx`
- Паттерн: `render` + `screen.getBy*` + `userEvent`

**E2E-тесты:**
- Фреймворк: Playwright (отдельно от Vitest)
- Расположение: `frontend/tests/`
- Конфигурация: `frontend/playwright.config.ts`
- Запуск: `npm run test:e2e`

### Бэкенд

**Модульные тесты:** (`@pytest.mark.unit`) — логика сервисов с мокированной БД
**Интеграционные тесты:** (`@pytest.mark.integration`) — реальная тестовая БД, мокированные внешние сервисы
**Тесты роутеров:** — `httpx.AsyncClient` поверх реального FastAPI-приложения + тестовая БД
**Тесты производительности:** (`@pytest.mark.benchmark`) — нагрузочные/конкурентные тесты

## Общие паттерны

### Фронтенд: Асинхронное тестирование

```typescript
// Хуки, возвращающие асинхронное состояние — использовать waitFor
await waitFor(() => {
  expect(result.current.isSuccess).toBe(true);
});

// Запуск асинхронных мутаций
await act(async () => {
  await result.current.mutateAsync({ file: mockFile });
});

// Хуки, зависящие от времени — использовать фейковые таймеры
vi.useFakeTimers({ shouldAdvanceTime: true });
await act(async () => {
  await vi.advanceTimersByTimeAsync(11000);
});

// EPUB-рендеринг с idle-коллбэками
await act(async () => {
  await vi.advanceTimersByTimeAsync(300);
  await vi.advanceTimersByTimeAsync(300);
  await vi.advanceTimersByTimeAsync(300);
});
```

### Фронтенд: Тестирование ошибок

```typescript
// Ошибки асинхронных мутаций
await expect(
  act(async () => {
    await result.current.mutateAsync({ file: mockFile });
  })
).rejects.toThrow('Upload failed');

// Состояние ошибки запроса
vi.mocked(booksAPI.getBooks).mockRejectedValue(new Error('Network error'));
await waitFor(() => {
  expect(result.current.isError).toBe(true);
});
expect(result.current.error).toEqual(error);
```

### Фронтенд: Тестирование оптимистичных обновлений

```typescript
// Использовать localQC с gcTime > 0, чтобы предотвратить GC до проверки утверждения
const localQC = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 30000 }, mutations: { retry: false } },
});
localQC.setQueryData(['books', mockUser.id, 'list', undefined], mockBooks);

// Медленный мок для перехвата оптимистичного состояния
vi.mocked(booksAPI.deleteBook).mockImplementation(
  () => new Promise((resolve) => setTimeout(() => resolve(mockResponse), 5000))
);

// Проверка оптимистичного удаления до подтверждения сервером
await waitFor(() => {
  const data = localQC.getQueryData<typeof mockBooks>([...]);
  expect(data!.books.find((b) => b.id === 'book-1')).toBeUndefined();
});
```

### Бэкенд: Тестирование роутеров

```python
# Стандартный паттерн тестирования роутера
@pytest.mark.asyncio
async def test_endpoint(
    self,
    client: AsyncClient,
    auth_headers: dict,  # из фикстуры conftest
    test_book: Book,     # из фикстуры conftest
):
    response = await client.get(
        f"/api/v1/books/{test_book.id}/chapters/1",
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "chapter" in data
```

### Бэкенд: Тестирование сервисов с БД

```python
# Создание тестовых данных в сессии без коммита до готовности
db_session.add(entity)
await db_session.flush()  # Получить ID без коммита

await db_session.commit()
await db_session.refresh(entity)  # Загрузить поля, установленные сервером
```

---

*Анализ тестирования: 2026-02-27*
