# Testing Guide

Complete guide for running and writing tests in BookReader AI.

---

## Quick Start

### Backend Tests

```bash
# Run all backend tests
docker-compose exec backend pytest -v

# Run with coverage
docker-compose exec backend pytest -v --cov=app

# Run specific test file
docker-compose exec backend pytest -v tests/test_multi_nlp_manager.py

# Run specific test
docker-compose exec backend pytest -v tests/test_book_service.py::TestBookCreation::test_create_book_from_upload
```

### Frontend Tests

```bash
# Run all frontend tests
cd frontend && npm test -- --run

# Run with coverage
cd frontend && npm test -- --run --coverage

# Run in watch mode (during development)
cd frontend && npm test

# Run specific test file
cd frontend && npm test books.test.ts
```

---

## Test Structure

### Backend Tests

**Location:** `backend/tests/`

```
backend/tests/
├── conftest.py              # Fixtures and test configuration
├── test_auth.py            # Authentication tests (14 tests)
├── test_books.py           # Books API tests (16 tests)
├── test_multi_nlp_manager.py  # Multi-NLP Manager tests (24 tests)
├── test_book_parser.py     # Book Parser tests (18 tests)
└── test_book_service.py    # Book Service tests (21 tests)
```

**Test Naming Convention:**
- Files: `test_*.py`
- Classes: `Test*`
- Functions: `test_*`

**Example:**
```python
# backend/tests/test_book_service.py
import pytest
from app.services.book_service import BookService

class TestBookCreation:
    """Tests for book creation."""

    @pytest.mark.asyncio
    async def test_create_book_from_upload(
        self,
        book_service: BookService,
        db_session: AsyncSession,
        test_user: User,
        parsed_book_data: ParsedBook
    ):
        """Test creating book from uploaded file."""
        # Test implementation
```

### Frontend Tests

**Location:** `frontend/src/`

```
frontend/src/
├── api/__tests__/
│   └── books.test.ts       # Books API tests (16 tests)
├── stores/__tests__/
│   ├── books.test.ts       # Books store tests (12 tests)
│   └── auth.test.ts        # Auth store tests (14 tests)
└── components/__tests__/
    └── BookReader.test.tsx.skip  # (To be fixed in Phase 2)
```

**Test Naming Convention:**
- Files: `*.test.ts` or `*.test.tsx`
- Describe blocks: Feature/Component name
- It blocks: Specific scenario

**Example:**
```typescript
// frontend/src/api/__tests__/books.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { booksAPI } from '../books';

describe('Books API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBooks', () => {
    it('should fetch books without params', async () => {
      // Test implementation
    });
  });
});
```

---

## Available Fixtures

### Backend Fixtures (pytest)

**Database Fixtures:**
```python
# In tests - use these fixtures as parameters

async def test_something(
    db_session: AsyncSession,    # Database session
    test_user: User,             # User in DB
    test_book: Book,             # Book in DB
    test_chapter: Chapter        # Chapter in DB
):
    # Your test code
```

**API Fixtures:**
```python
async def test_api(
    client: AsyncClient,          # HTTP client
    authenticated_headers: dict   # Auth headers
):
    response = await client.get("/api/v1/books", headers=authenticated_headers)
```

**Data Fixtures:**
```python
def test_with_data(
    sample_user_data: dict,       # User data dict
    sample_book_data: dict,       # Book data dict
    sample_chapter_data: dict     # Chapter data dict
):
    # Your test code
```

**Service Fixtures:**
```python
async def test_services(
    book_service: BookService,        # Book service instance
    mock_nlp_processor: AsyncMock,    # Mocked NLP processor
    mock_image_generator: AsyncMock   # Mocked image generator
):
    # Your test code
```

### Frontend Fixtures (vitest)

**Test Utils:**
```typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

// Mock API
vi.mock('@/api/books');

// Render hook
const { result } = renderHook(() => useMyHook());

// Act on hook
await act(async () => {
  await result.current.someAction();
});

// Wait for async updates
await waitFor(() => {
  expect(result.current.data).toBeDefined();
});
```

---

## Writing Tests

### Backend Test Example

```python
# backend/tests/test_my_feature.py
import pytest
from app.services.my_service import MyService

class TestMyFeature:
    """Tests for my feature."""

    @pytest.mark.asyncio
    async def test_feature_success(
        self,
        db_session: AsyncSession,
        test_user: User
    ):
        """Test successful feature execution."""
        # Arrange
        service = MyService()
        input_data = {"key": "value"}

        # Act
        result = await service.process(db_session, test_user.id, input_data)

        # Assert
        assert result is not None
        assert result.status == "success"

    @pytest.mark.asyncio
    async def test_feature_validation_error(self, db_session: AsyncSession):
        """Test feature with invalid input."""
        # Arrange
        service = MyService()
        invalid_data = {}

        # Act & Assert
        with pytest.raises(ValueError, match="Input cannot be empty"):
            await service.process(db_session, None, invalid_data)
```

### Frontend Test Example

```typescript
// frontend/src/features/__tests__/myFeature.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMyFeature } from '../useMyFeature';
import { myAPI } from '@/api/myAPI';

vi.mock('@/api/myAPI');

describe('useMyFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle feature successfully', async () => {
    // Arrange
    const mockData = { id: '123', name: 'Test' };
    vi.mocked(myAPI.getData).mockResolvedValue(mockData);

    // Act
    const { result } = renderHook(() => useMyFeature());

    await act(async () => {
      await result.current.loadData();
    });

    // Assert
    expect(result.current.data).toEqual(mockData);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle errors', async () => {
    // Arrange
    vi.mocked(myAPI.getData).mockRejectedValue(new Error('API Error'));

    // Act
    const { result } = renderHook(() => useMyFeature());

    await act(async () => {
      try {
        await result.current.loadData();
      } catch (error) {
        // Expected
      }
    });

    // Assert
    expect(result.current.error).toBeDefined();
  });
});
```

---

## Best Practices

### 1. Test Organization

**AAA Pattern (Arrange-Act-Assert):**
```python
def test_example():
    # Arrange - Set up test data
    user = create_user()

    # Act - Execute the code under test
    result = process_user(user)

    # Assert - Verify the result
    assert result.success is True
```

**Given-When-Then (BDD):**
```python
def test_user_can_upload_book():
    # Given - a logged-in user
    user = authenticated_user()

    # When - they upload a book
    book = user.upload_book("test.epub")

    # Then - book appears in library
    assert book in user.library
```

### 2. Test Isolation

```python
# ✅ Good - Each test is independent
def test_create_user():
    user = User(email="test@example.com")
    assert user.email == "test@example.com"

def test_update_user():
    user = User(email="test@example.com")
    user.email = "new@example.com"
    assert user.email == "new@example.com"

# ❌ Bad - Tests depend on each other
user = None

def test_create_user():
    global user
    user = User(email="test@example.com")

def test_update_user():
    global user  # Depends on previous test
    user.email = "new@example.com"
```

### 3. Descriptive Test Names

```python
# ✅ Good - Describes what and why
def test_book_upload_fails_when_file_too_large():
    pass

def test_reading_progress_updates_with_cfi():
    pass

# ❌ Bad - Unclear purpose
def test_book():
    pass

def test_1():
    pass
```

### 4. Mock External Dependencies

```python
# ✅ Good - Mock external API
@patch('app.services.pollinations_api.generate_image')
async def test_image_generation(mock_generate):
    mock_generate.return_value = {"url": "http://example.com/image.jpg"}
    result = await generate_book_image("dark forest")
    assert result.url == "http://example.com/image.jpg"

# ❌ Bad - Real API call (slow, unreliable)
async def test_image_generation():
    result = await generate_book_image("dark forest")  # Real API call
    assert result.url is not None
```

```typescript
// ✅ Good - Mock API
vi.mock('@/api/books');

it('should upload book', async () => {
  vi.mocked(booksAPI.upload).mockResolvedValue({ id: '123' });
  const result = await uploadMyBook(file);
  expect(result.id).toBe('123');
});

// ❌ Bad - Real API call
it('should upload book', async () => {
  const result = await booksAPI.upload(file);  // Real API
  expect(result.id).toBeDefined();
});
```

### 5. Test Edge Cases

```python
def test_book_parser():
    # ✅ Test multiple scenarios

    # Happy path
    result = parse_book("valid.epub")
    assert result.success

    # Empty file
    with pytest.raises(ValueError):
        parse_book("empty.epub")

    # Corrupted file
    with pytest.raises(ParseError):
        parse_book("corrupted.epub")

    # Large file
    with pytest.raises(FileSizeError):
        parse_book("huge.epub")

    # Invalid format
    with pytest.raises(FormatError):
        parse_book("invalid.txt")
```

### 6. Use Meaningful Assertions

```python
# ✅ Good - Clear expectations
assert book.title == "Test Book"
assert len(book.chapters) == 5
assert book.is_parsed is True

# ❌ Bad - Vague assertions
assert book  # What are we checking?
assert book.chapters  # Just exists? What about content?
assert book.is_parsed  # True or False?
```

---

## Coverage Goals

### Current Status

**Backend:**
- Multi-NLP Manager: 80%+
- Book Parser: 75%+
- Book Service: 70%+
- Overall: 50%+ (targeting 70%+)

**Frontend:**
- API Layer: 70%+
- Zustand Stores: 80%+
- Overall: 40%+ (targeting 60%+)

### Target Coverage (Phase 2)

**Backend: 80%+**
- All services: >70%
- All routers: >80%
- Models: >90%
- Utils: >85%

**Frontend: 60%+**
- API layer: >80%
- Stores: >85%
- Components: >50%
- Hooks: >70%

### How to Check Coverage

**Backend:**
```bash
# Generate coverage report
docker-compose exec backend pytest --cov=app --cov-report=html

# View HTML report
open backend/htmlcov/index.html

# Check coverage percentage
docker-compose exec backend pytest --cov=app --cov-report=term-missing
```

**Frontend:**
```bash
# Generate coverage report
cd frontend && npm test -- --coverage

# View HTML report
open frontend/coverage/index.html

# Check specific file
npm test -- --coverage src/api/books.ts
```

---

## Debugging Tests

### Backend

**Run with verbose output:**
```bash
docker-compose exec backend pytest -v -s
```

**Run with pdb debugger:**
```python
def test_something():
    import pdb; pdb.set_trace()  # Add breakpoint
    result = my_function()
```

**Run specific test with logs:**
```bash
docker-compose exec backend pytest -v -s tests/test_book_service.py::test_create_book --log-cli-level=DEBUG
```

### Frontend

**Run with console output:**
```typescript
it('should debug', () => {
  console.log('Debug info:', myData);  // Will appear in test output
  expect(myData).toBeDefined();
});
```

**Run single test:**
```typescript
it.only('should run only this test', () => {
  // Only this test will run
});
```

**Skip test:**
```typescript
it.skip('should skip this test', () => {
  // This test will be skipped
});
```

---

## Continuous Integration

### Pre-commit Checks

```bash
# Run before committing
cd backend && pytest
cd frontend && npm test -- --run

# Or use pre-commit hook (recommended)
# .git/hooks/pre-commit
#!/bin/bash
cd backend && pytest || exit 1
cd frontend && npm test -- --run || exit 1
```

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Start services
        run: docker-compose up -d postgres redis

      - name: Run tests
        run: docker-compose exec backend pytest --cov=app --cov-fail-under=70

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./backend/coverage.xml

  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: cd frontend && npm ci

      - name: Run tests
        run: cd frontend && npm test -- --run --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./frontend/coverage/coverage-final.json
```

---

## Common Issues

### Backend

**Issue: Database connection errors**
```
Solution: Ensure PostgreSQL is running
docker-compose up -d postgres
```

**Issue: Module import errors**
```
Solution: Check PYTHONPATH and ensure you're in backend directory
cd backend && pytest
```

**Issue: Async test failures**
```
Solution: Ensure @pytest.mark.asyncio decorator
@pytest.mark.asyncio
async def test_something():
    pass
```

### Frontend

**Issue: Mock not working**
```
Solution: Ensure vi.mock() is at top of file
vi.mock('@/api/books');  // Must be at top level

describe('MyTest', () => {
  // Tests here
});
```

**Issue: Act warnings**
```
Solution: Wrap state updates in act()
await act(async () => {
  await result.current.loadData();
});
```

**Issue: localStorage not mocked**
```
Solution: Check setup.ts includes localStorage mock
// src/test/setup.ts
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  // ...
};
```

---

## Resources

- **Backend:** [pytest documentation](https://docs.pytest.org/)
- **Frontend:** [vitest documentation](https://vitest.dev/)
- **Testing Library:** [React Testing Library](https://testing-library.com/react)
- **Mocking:** [unittest.mock](https://docs.python.org/3/library/unittest.mock.html)
- **Coverage:** [coverage.py](https://coverage.readthedocs.io/)

---

**Last Updated:** 2025-10-24
**Version:** 1.0
