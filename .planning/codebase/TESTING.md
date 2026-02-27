# Testing Patterns

**Analysis Date:** 2026-02-27

## Test Framework

### Frontend

**Runner:**
- Vitest 4.x
- Config: `frontend/vitest.config.ts`

**Assertion Library:**
- Vitest built-in `expect` + `@testing-library/jest-dom` matchers

**Run Commands:**
```bash
cd frontend && npm test              # Run all tests (vitest run)
cd frontend && npm run test:watch    # Watch mode
cd frontend && npm run test:ui       # Vitest UI (browser)
cd frontend && npm run test:e2e      # Playwright E2E
```

### Backend

**Runner:**
- pytest with `pytest-asyncio` (asyncio_mode = auto)
- Config: `backend/pytest.ini`

**Assertion Library:**
- pytest built-in `assert`

**Run Commands:**
```bash
cd backend && pytest -v                           # Run all tests with coverage
cd backend && pytest tests/routers/ -v           # Routers only
cd backend && pytest tests/integration/ -v       # Integration tests only
cd backend && pytest -m unit -v                  # Unit tests only
cd backend && pytest -m "not slow" -v            # Exclude slow tests
```

## Test File Organization

### Frontend

**Location:** Co-located `__tests__/` subdirectory within source tree

**Naming pattern:** `{SourceFileName}.test.{ts|tsx}`

**Structure:**
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

**Global test setup:** `frontend/src/test/setup.ts`

### Backend

**Location:** Dedicated `backend/tests/` directory (separate from source)

**Naming pattern:** `test_{module_name}.py`

**Structure:**
```
backend/tests/
├── conftest.py                      # Shared fixtures for all tests
├── fixtures/
│   ├── __init__.py
│   └── reading_sessions.py
├── routers/
│   ├── conftest.py                  # Router-specific fixtures
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

## Test Structure

### Frontend Suite Organization

```typescript
/**
 * Brief description of what's being tested
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ComponentOrHookName', () => {
  // Shared setup
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup mocks
  });

  afterEach(() => {
    vi.useRealTimers();  // if fake timers used
    vi.restoreAllMocks();
  });

  describe('Logical Group', () => {
    it('should describe specific behavior', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

**Patterns observed:**
- Arrange/Act/Assert structure (often implicit, not commented in frontend)
- Nested `describe` blocks group related behaviors
- `beforeEach` / `afterEach` for setup/teardown
- `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` for time-dependent logic
- Always `vi.clearAllMocks()` in `beforeEach`

### Backend Suite Organization

```python
class TestComponentName:
    """Test suite for specific component."""

    @pytest.mark.asyncio
    async def test_behavior_description(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Test brief description of what this verifies."""
        # Arrange
        ...

        # Act
        response = await client.get("/api/v1/endpoint")

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["field"] == expected_value
```

**Patterns observed:**
- Class-based test suites: `class TestSuiteName:` groups related tests
- Explicit `# Arrange / # Act / # Assert` comments in complex tests
- `@pytest.mark.asyncio` (though `asyncio_mode = auto` makes this redundant — still used for clarity)
- `monkeypatch.setattr()` to replace functions at module level
- `db_session.add()` + `await db_session.commit()` for test data setup

## Mocking

### Frontend Framework: `vitest` (`vi`)

**Module-level mocking:**
```typescript
// Mock entire module — place at top of file, before imports
vi.mock('@/api/books');
vi.mock('@/services/chapterCache');
vi.mock('@/stores/auth');

// Mock with custom implementation
vi.mock('@/utils/text-search/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/text-search/cache')>();
  return {
    ...actual,
    getFromCache: () => undefined,  // Override specific exports
  };
});
```

**Inline spying:**
```typescript
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery');
```

**Mock function usage:**
```typescript
// Set return value
vi.mocked(booksAPI.getBooks).mockResolvedValue(mockBooks);
vi.mocked(booksAPI.getBooks)
  .mockResolvedValueOnce(firstResponse)
  .mockResolvedValueOnce(secondResponse);

// Simulate implementations
vi.mocked(booksAPI.uploadBook).mockImplementation(async (_formData, config) => {
  if (config?.onUploadProgress) {
    config.onUploadProgress({ loaded: 50, total: 100 } as any);
  }
  return { book: {...} };
});
```

**What to mock:**
- All external API calls (`booksAPI`, `authAPI`, etc.)
- Browser APIs absent in jsdom: `IntersectionObserver`, `ResizeObserver`, `matchMedia`, `localStorage`, `scrollTo`
- Services with side effects: `chapterCache`, `imageCache`, `tabSync`
- Logger: `vi.mock('@/lib/logger', ...)`

**What NOT to mock:**
- The actual module under test
- Pure utility functions (normalization, strategies)
- Dexie/IndexedDB — use `fake-indexeddb` from global setup (`frontend/src/test/setup.ts`)

### Backend Framework: `unittest.mock` + `pytest` fixtures

**AsyncMock for async methods:**
```python
from unittest.mock import AsyncMock, MagicMock

mock_book_parser = AsyncMock()
mock_book_parser.parse_book.return_value = MockParsedBook()
mock_book_parser.detect_format.return_value = "epub"
```

**monkeypatch for function replacement:**
```python
async def mock_check_database(db):
    return ComponentHealthResponse(status="ok", message="DB OK", latency_ms=5.2)

monkeypatch.setattr("app.routers.health.check_database", mock_check_database)
```

**FastAPI dependency injection override:**
```python
# Override via app.dependency_overrides
app.dependency_overrides[get_book_parser_dep] = lambda: mock_book_parser
# Always clean up after test
app.dependency_overrides.clear()
DependencyContainer.reset_all()
DependencyContainer.clear_caches()
```

**What to mock:**
- External services: Gemini API, Imagen API, email service
- Celery tasks (use `app_with_mock_services` fixture)
- Health check functions for isolated testing

**What NOT to mock:**
- Database operations in integration tests — use real test DB
- Auth service password hashing — use real `AuthService`

## Fixtures and Factories

### Frontend

**QueryClient wrapper pattern:**
```typescript
const createWrapper = () => {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Fresh QueryClient per test
queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  },
});
```

**Inline mock data factories (no shared factory functions):**
```typescript
const mockBooks = {
  books: [{ id: '1', title: 'Book 1', author: 'Author 1' }] as Book[],
  total: 1,
  skip: 0,
  limit: 10,
};
```

**Location:** Inline in test files; no shared fixture directory on frontend

### Backend

**Shared fixtures:** `backend/tests/conftest.py` — loaded globally for all tests

**Key fixtures:**
- `test_db` — Creates/drops all tables per test (function scope)
- `db_session` — Async SQLAlchemy session bound to test DB
- `client` — `httpx.AsyncClient` with ASGI transport against test app
- `test_user` — Persisted `User` model in test DB
- `test_book` — Persisted `Book` + 3 `Chapter` models in test DB
- `auth_headers` / `admin_auth_headers` — JWT bearer headers for authenticated requests
- `mock_book_parser` / `mock_gemini_extractor` / `mock_image_generator_service` — Pre-configured `AsyncMock` objects
- `app_with_mock_services` — App with all external services mocked, real DB

**Factory dataclasses:**
```python
@dataclass
class MockImageGenerationResult:
    success: bool = True
    image_url: Optional[str] = "https://example.com/test-image.png"
    local_path: Optional[str] = "/app/storage/test-image.png"
    generation_time_seconds: Optional[float] = 5.0
    model_used: Optional[str] = "imagen-4"

@dataclass
class MockParsedBook:
    metadata: Metadata = None
    chapters: List = None
    file_format: str = "epub"
```

## Coverage

### Frontend

**Requirements:** 40% lines/functions/branches/statements (enforced via `vitest.config.ts`)
- `autoUpdate: true` — thresholds auto-update after passing

**View Coverage:**
```bash
cd frontend && npm test -- --coverage
```

**Report formats:** text, json, html, lcov (provider: v8)

### Backend

**Requirements:** 70% minimum (`--cov-fail-under=70` in `pytest.ini`)

**View Coverage:**
```bash
cd backend && pytest --cov=app --cov-report=html:htmlcov
open backend/htmlcov/index.html
```

**Report formats:** term-missing (console), html (htmlcov/)

## Test Types

### Frontend

**Unit Tests:**
- Scope: individual hooks, services, utility functions
- Examples: `useChapterMapping.test.ts`, `normalization.test.ts`, `chapterCache.test.ts`
- Pattern: pure function tests or `renderHook` for React hooks

**Integration Tests:**
- Scope: hook + API + QueryClient interaction
- Examples: `useBooks.test.tsx`, `auth.test.ts`
- Pattern: `renderHook` with `QueryClientProvider` wrapper, API mocked

**Component Tests:**
- Scope: rendered React components
- Examples: `EpubReader.test.tsx`, `ErrorBoundary.test.tsx`, `LibraryPage.test.tsx`
- Pattern: `render` + `screen.getBy*` + `userEvent`

**E2E Tests:**
- Framework: Playwright (separate from Vitest)
- Location: `frontend/tests/`
- Config: `frontend/playwright.config.ts`
- Run: `npm run test:e2e`

### Backend

**Unit Tests:** (`@pytest.mark.unit`) — service logic with mocked DB
**Integration Tests:** (`@pytest.mark.integration`) — real test DB, mocked external services
**Router Tests:** — `httpx.AsyncClient` over real FastAPI app + test DB
**Performance Tests:** (`@pytest.mark.benchmark`) — load/concurrency tests

## Common Patterns

### Frontend: Async Testing

```typescript
// Hooks returning async state — use waitFor
await waitFor(() => {
  expect(result.current.isSuccess).toBe(true);
});

// Triggering async mutations
await act(async () => {
  await result.current.mutateAsync({ file: mockFile });
});

// Time-based hooks — use fake timers
vi.useFakeTimers({ shouldAdvanceTime: true });
await act(async () => {
  await vi.advanceTimersByTimeAsync(11000);
});

// EPUB rendering with idle callbacks
await act(async () => {
  await vi.advanceTimersByTimeAsync(300);
  await vi.advanceTimersByTimeAsync(300);
  await vi.advanceTimersByTimeAsync(300);
});
```

### Frontend: Error Testing

```typescript
// Async mutation errors
await expect(
  act(async () => {
    await result.current.mutateAsync({ file: mockFile });
  })
).rejects.toThrow('Upload failed');

// Query error state
vi.mocked(booksAPI.getBooks).mockRejectedValue(new Error('Network error'));
await waitFor(() => {
  expect(result.current.isError).toBe(true);
});
expect(result.current.error).toEqual(error);
```

### Frontend: Optimistic Update Testing

```typescript
// Use localQC with gcTime > 0 to prevent GC before assertion
const localQC = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 30000 }, mutations: { retry: false } },
});
localQC.setQueryData(['books', mockUser.id, 'list', undefined], mockBooks);

// Slow mock to catch optimistic state
vi.mocked(booksAPI.deleteBook).mockImplementation(
  () => new Promise((resolve) => setTimeout(() => resolve(mockResponse), 5000))
);

// Assert optimistic removal before server confirms
await waitFor(() => {
  const data = localQC.getQueryData<typeof mockBooks>([...]);
  expect(data!.books.find((b) => b.id === 'book-1')).toBeUndefined();
});
```

### Backend: Router Testing

```python
# Standard router test pattern
@pytest.mark.asyncio
async def test_endpoint(
    self,
    client: AsyncClient,
    auth_headers: dict,  # from conftest fixture
    test_book: Book,     # from conftest fixture
):
    response = await client.get(
        f"/api/v1/books/{test_book.id}/chapters/1",
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "chapter" in data
```

### Backend: Service Testing with DB

```python
# Build test data in-session without committing until ready
db_session.add(entity)
await db_session.flush()  # Get ID without committing

await db_session.commit()
await db_session.refresh(entity)  # Load server-set fields
```

---

*Testing analysis: 2026-02-27*
