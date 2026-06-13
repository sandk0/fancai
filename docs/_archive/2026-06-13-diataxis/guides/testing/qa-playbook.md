# Testing & QA Playbook - Execution Guide
**Version:** 1.0
**Last Updated:** November 3, 2025

---

## PHASE 1: FIX BROKEN TESTS (Week 1)

### Task 1.1: Fix Multi-NLP Manager Async Fixture
**Status:** CRITICAL
**Time:** 3-4 hours
**Impact:** Enables 11 failing tests

#### Problem
```python
# Current: conftest.py (lines 43-56) - BROKEN ASYNC FIXTURE
@pytest_asyncio.fixture(scope="function")
async def test_db():
    """Create test database tables."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
```

Issue: Tests that use async managers aren't properly awaiting fixtures.

#### Solution
```python
# Fixed version
@pytest_asyncio.fixture(scope="function")
async def test_db():
    """Create test database tables."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

# ADD THIS NEW FIXTURE for async managers:
@pytest_asyncio.fixture(scope="function")
async def multi_nlp_manager():
    """Fixture for Multi-NLP Manager with proper async handling."""
    from app.services.multi_nlp_manager import MultiNLPManager

    manager = MultiNLPManager()
    # Initialize if needed
    await manager.initialize()
    yield manager
    # Cleanup if needed
    await manager.cleanup()

# In test files:
@pytest.mark.asyncio
async def test_manager_initialization(multi_nlp_manager):
    """Test manager initialization."""
    status = await multi_nlp_manager.get_status()
    assert status['initialized'] is True
```

#### Commands
```bash
# Apply fix to conftest.py (lines 43-56)
# 1. Add new fixture after existing fixtures
# 2. Update all NLP manager tests to use @pytest.mark.asyncio
# 3. Run failing tests:

docker exec fancai-vibe-hackathon-backend-1 pytest \
  /app/tests/services/nlp/test_multi_nlp_integration.py \
  -v --tb=short

# Expected: 12 tests passing (11 fixed + 1 original)
```

---

### Task 1.2: Fix Database Connection String
**Status:** HIGH
**Time:** 1 hour
**Impact:** Removes DB setup errors

#### Problem
```python
# conftest.py line 17 - HARDCODED
TEST_DATABASE_URL = "postgresql+asyncpg://postgres:postgres123@postgres:5432/bookreader_test"
```

Issue: Password hardcoded, hostname assumes Docker network

#### Solution
```python
# Use environment variables with fallback:
import os
from app.core.config import settings

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres123@postgres:5432/bookreader_test"
)
```

#### Alternative (Better)
```python
# Or use settings:
TEST_DATABASE_URL = settings.DATABASE_URL.replace(
    settings.DATABASE_NAME or "bookreader",
    "bookreader_test"
)
```

---

### Task 1.3: Fix Pydantic v1 Deprecation Warnings
**Status:** MEDIUM
**Time:** 2-3 hours
**Impact:** Removes warnings, ensures Pydantic v3 compatibility

#### Problem
Multiple deprecation warnings during test runs:
```
PydanticDeprecatedSince20: Support for class-based `config` is deprecated
PydanticDeprecatedSince20: `min_items` is deprecated, use `min_length`
PydanticDeprecatedSince20: `json_encoders` is deprecated
```

#### Solution 1: Update Validators

Before:
```python
# app/routers/reading_sessions.py line 52
from pydantic import validator

class ReadingSession(BaseModel):
    device_type: str

    @validator("device_type")
    def validate_device(cls, v):
        return v.lower()
```

After:
```python
from pydantic import field_validator

class ReadingSession(BaseModel):
    device_type: str

    @field_validator("device_type")
    @classmethod
    def validate_device(cls, v):
        return v.lower()
```

#### Solution 2: Fix Field Definitions
```python
# Before
class Book(BaseModel):
    tags: List[str] = Field(min_items=1, max_items=10)

# After
class Book(BaseModel):
    tags: List[str] = Field(min_length=1, max_length=10)
```

#### Solution 3: Update Config Classes
```python
# Before
class Config:
    json_encoders = {
        datetime: lambda v: v.isoformat()
    }

# After (Pydantic v2)
from pydantic import ConfigDict
model_config = ConfigDict(
    ser_json_timedelta='float',
    # Use field serializers instead of json_encoders
)
```

#### Commands
```bash
# Find all deprecated patterns:
cd backend && grep -r "@validator" app/ --include="*.py"
cd backend && grep -r "min_items" app/ --include="*.py"
cd backend && grep -r "json_encoders" app/ --include="*.py"

# Fix file by file (2-3 files affected)
# Re-run tests to verify:
docker exec fancai-vibe-hackathon-backend-1 pytest /app/tests/ -v -W error::DeprecationWarning
```

---

### Task 1.4: Fix FastAPI Deprecated Handlers
**Status:** MEDIUM
**Time:** 1 hour
**Impact:** Removes deprecation warnings, future-proofs code

#### Problem
```python
# app/main.py lines 99, 160
@app.on_event("startup")
async def startup_event():
    pass

@app.on_event("shutdown")
async def shutdown_event():
    pass
```

#### Solution (Recommended for FastAPI 0.93+)
```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    # Startup
    print("Starting up")
    yield
    # Shutdown
    print("Shutting down")

app = FastAPI(lifespan=lifespan)
```

#### Simple Migration
```python
from fastapi import FastAPI

app = FastAPI()

# Explicitly set lifespan for now
@app.on_event("startup")
async def startup():
    """Initialize services on startup."""
    logger.info("Application startup")

@app.on_event("shutdown")
async def shutdown():
    """Cleanup on shutdown."""
    logger.info("Application shutdown")
```

---

### Task 1.5: Fix vitest Coverage Plugin
**Status:** HIGH
**Time:** 1-2 hours
**Impact:** Enables frontend coverage reports

#### Problem
```
SyntaxError: The requested module 'vitest/node' does not provide an export named 'parseAstAsync'
```

#### Solution
Update package.json dependencies:

```json
{
  "devDependencies": {
    "vitest": "^1.0.0",  // Update from 0.34.6
    "@vitest/ui": "^1.0.0",
    "@vitest/coverage-v8": "^1.0.0"
  }
}
```

#### Commands
```bash
cd frontend

# Update vitest ecosystem
npm install --save-dev vitest@latest @vitest/ui@latest @vitest/coverage-v8@latest

# Verify vitest config
cat vitest.config.ts

# Test coverage generation
npm test -- --coverage

# Expected: Coverage report generated in coverage/
```

---

## PHASE 2: CRITICAL PATH TESTS (Weeks 2-3)

### Task 2.1: Book CRUD API Tests
**Status:** CRITICAL
**Time:** 2 hours per endpoint (8 endpoints = 16 hours)
**Impact:** Validates core user-facing functionality

#### Endpoints to Test

1. **POST /api/v1/books/upload**
   - Happy path: valid EPUB file
   - Error: Invalid file type
   - Error: File too large
   - Error: Concurrent uploads

2. **GET /api/v1/books**
   - Happy path: List all books
   - Pagination: skip/limit parameters
   - Sorting: by date, title, author
   - Filtering: by status (parsing, ready)

3. **GET /api/v1/books/{book_id}**
   - Happy path: Get book details
   - Error: Non-existent book
   - Error: Permission denied (other user's book)

4. **PUT /api/v1/books/{book_id}**
   - Happy path: Update metadata
   - Partial updates
   - Error: Forbidden (not owner)

5. **DELETE /api/v1/books/{book_id}**
   - Happy path: Delete book
   - Cascade: Check chapters deleted
   - Error: Non-existent book

6. **GET /api/v1/books/{book_id}/chapters**
   - List chapters
   - Pagination
   - Sorting

7. **GET /api/v1/books/{book_id}/progress**
   - Get current reading position
   - CFI handling
   - Scroll offset

8. **PUT /api/v1/books/{book_id}/progress**
   - Update reading position
   - Save CFI location
   - Timestamp updates

#### Test Template

```python
# backend/tests/routers/test_books_crud.py
import pytest
from fastapi import status
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

@pytest.mark.asyncio
class TestBooksCRUD:
    """Test Books CRUD endpoints."""

    async def test_upload_book_success(
        self,
        client: AsyncClient,
        auth_headers: dict,
        sample_epub_file: bytes
    ):
        """Test successful book upload."""
        # Arrange
        files = {"file": ("test.epub", sample_epub_file, "application/epub+zip")}

        # Act
        response = await client.post(
            "/api/v1/books/upload",
            headers=auth_headers,
            files=files
        )

        # Assert
        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert "id" in data
        assert data["title"] is not None
        assert data["is_parsed"] is False  # Should start parsing

    async def test_upload_book_invalid_type(
        self,
        client: AsyncClient,
        auth_headers: dict
    ):
        """Test upload with invalid file type."""
        # Arrange
        files = {"file": ("test.txt", b"not an epub", "text/plain")}

        # Act
        response = await client.post(
            "/api/v1/books/upload",
            headers=auth_headers,
            files=files
        )

        # Assert
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "epub" in response.json()["detail"].lower()

    async def test_list_books_pagination(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_books: list  # Fixture with 15 books
    ):
        """Test books list pagination."""
        # Arrange
        limit = 10
        skip = 0

        # Act
        response = await client.get(
            f"/api/v1/books?skip={skip}&limit={limit}",
            headers=auth_headers
        )

        # Assert
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data["items"]) == min(limit, 15)
        assert data["total"] >= 15

        # Next page
        response2 = await client.get(
            f"/api/v1/books?skip={limit}&limit={limit}",
            headers=auth_headers
        )
        data2 = response2.json()
        assert data["items"][0]["id"] != data2["items"][0]["id"]

    async def test_get_book_permission_denied(
        self,
        client: AsyncClient,
        auth_headers_user2: dict,
        test_book: Book
    ):
        """Test getting another user's book."""
        # Act
        response = await client.get(
            f"/api/v1/books/{test_book.id}",
            headers=auth_headers_user2
        )

        # Assert
        assert response.status_code == status.HTTP_403_FORBIDDEN
```

#### File Structure
```
backend/tests/routers/
├── test_books_crud.py (NEW - 16 tests)
├── test_books_filtering.py (NEW - 8 tests)
└── test_books_validation.py (NEW - 6 tests)
```

---

### Task 2.2: Critical Frontend Hooks Tests
**Status:** CRITICAL
**Time:** 1.5-2 hours per hook
**Impact:** Ensures state management reliability

#### Hook Priority Order

1. **useAuth** (2 hours) - Security critical
   ```typescript
   // frontend/src/hooks/__tests__/useAuth.test.ts
   describe('useAuth', () => {
       it('logs in user with credentials')
       it('stores token in localStorage')
       it('refreshes token when expired')
       it('logs out and clears token')
       it('rejects invalid credentials')
       it('handles network errors gracefully')
       it('persists auth on page reload')
   })
   ```

2. **useEpubReader** (3 hours) - Most complex
   ```typescript
   describe('useEpubReader', () => {
       it('loads EPUB file')
       it('navigates to next chapter')
       it('navigates to previous chapter')
       it('goes to specific page via CFI')
       it('persists reading position')
       it('handles large files')
       it('recovers from read errors')
   })
   ```

3. **useBookLoader** (2 hours) - Data fetching
   ```typescript
   describe('useBookLoader', () => {
       it('loads book metadata')
       it('handles loading state')
       it('handles error state')
       it('retries on network error')
       it('caches book data')
   })
   ```

4. **useReadingProgress** (2 hours)
   ```typescript
   describe('useReadingProgress', () => {
       it('updates progress when page changes')
       it('saves progress to server')
       it('handles sync conflicts')
       it('persists CFI location')
   })
   ```

5. **Other Hooks** (4 hours for remaining)

#### Test Template

```typescript
// frontend/src/hooks/__tests__/useAuth.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import * as authAPI from '@/api/auth'

// Mock API
vi.mock('@/api/auth')

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('logs in user with credentials', async () => {
    // Arrange
    const mockToken = 'test-token-123'
    vi.mocked(authAPI.login).mockResolvedValue({
      access_token: mockToken,
      user: { id: '1', email: 'test@example.com' }
    })

    // Act
    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.login('test@example.com', 'password')
    })

    // Assert
    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.user?.email).toBe('test@example.com')
    expect(localStorage.getItem('token')).toBe(mockToken)
  })

  it('handles invalid credentials', async () => {
    // Arrange
    const error = new Error('Invalid credentials')
    vi.mocked(authAPI.login).mockRejectedValue(error)

    // Act & Assert
    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

    await act(async () => {
      try {
        await result.current.login('test@example.com', 'wrong')
      } catch (e) {
        // Expected
      }
    })

    expect(result.current.isAuthenticated).toBe(false)
    expect(localStorage.getItem('token')).toBeNull()
  })

  // Add more tests...
})
```

---

### Task 2.3: Book Service Unit Tests
**Status:** HIGH
**Time:** 2 hours
**Impact:** Validates business logic

#### Tests Needed
```python
# backend/tests/services/book/test_book_service_crud.py
import pytest
from uuid import uuid4

@pytest.mark.asyncio
class TestBookService:
    """Test BookService CRUD operations."""

    async def test_create_book(
        self,
        book_service,
        db_session,
        test_user
    ):
        """Test creating a book."""
        # Arrange
        book_data = {
            "title": "Test Book",
            "author": "Test Author",
            "genre": "fiction",
            "file_path": "/path/to/file.epub"
        }

        # Act
        book = await book_service.create_book(
            db_session,
            user_id=test_user.id,
            **book_data
        )

        # Assert
        assert book.title == "Test Book"
        assert book.user_id == test_user.id
        assert book.is_parsed is False

    async def test_get_book_with_permission(
        self,
        book_service,
        db_session,
        test_book,
        test_user
    ):
        """Test retrieving book with permission."""
        # Act
        book = await book_service.get_book(
            db_session,
            book_id=test_book.id,
            user_id=test_user.id
        )

        # Assert
        assert book.id == test_book.id

    async def test_get_book_permission_denied(
        self,
        book_service,
        db_session,
        test_book,
        other_user
    ):
        """Test permission check."""
        # Act & Assert
        with pytest.raises(PermissionError):
            await book_service.get_book(
                db_session,
                book_id=test_book.id,
                user_id=other_user.id
            )

    async def test_delete_book_cascade(
        self,
        book_service,
        db_session,
        test_book
    ):
        """Test cascade delete."""
        # Arrange
        book_id = test_book.id

        # Act
        await book_service.delete_book(db_session, book_id)

        # Assert - book is deleted
        deleted = await db_session.get(Book, book_id)
        assert deleted is None

        # Assert - chapters also deleted
        chapters = await db_session.query(Chapter).filter_by(
            book_id=book_id
        ).all()
        assert len(chapters) == 0
```

---

## PHASE 3: INTEGRATION & EDGE CASES (Weeks 3-4)

### Task 3.1: End-to-End Book Processing Flow
**Status:** HIGH
**Time:** 3-4 hours
**Impact:** Validates core user journey

#### Test Scenario
```python
# backend/tests/integration/test_book_processing_flow.py
@pytest.mark.asyncio
@pytest.mark.integration
class TestBookProcessingFlow:
    """Test complete book processing workflow."""

    async def test_complete_flow(
        self,
        client: AsyncClient,
        auth_headers: dict,
        sample_epub_file: bytes,
        db_session: AsyncSession
    ):
        """Test: Upload → Parse → Generate Images → Display."""

        # Step 1: Upload book
        upload_response = await client.post(
            "/api/v1/books/upload",
            headers=auth_headers,
            files={"file": ("test.epub", sample_epub_file)}
        )
        assert upload_response.status_code == 201
        book_id = upload_response.json()["id"]

        # Step 2: Verify book in library
        list_response = await client.get(
            "/api/v1/books",
            headers=auth_headers
        )
        assert list_response.status_code == 200
        books = list_response.json()["items"]
        assert any(b["id"] == book_id for b in books)

        # Step 3: Check parsing status
        progress_response = await client.get(
            f"/api/v1/books/{book_id}",
            headers=auth_headers
        )
        assert progress_response.status_code == 200
        book = progress_response.json()
        assert book["is_parsed"] in [True, False]  # Should be parsing

        # Step 4: Wait for parsing completion
        max_wait = 30  # seconds
        for _ in range(max_wait):
            check_response = await client.get(
                f"/api/v1/books/{book_id}",
                headers=auth_headers
            )
            book = check_response.json()
            if book["is_parsed"]:
                break
            await asyncio.sleep(1)

        assert book["is_parsed"] is True
        assert book["total_chapters"] > 0

        # Step 5: Get book content
        chapters_response = await client.get(
            f"/api/v1/books/{book_id}/chapters",
            headers=auth_headers
        )
        assert chapters_response.status_code == 200
        chapters = chapters_response.json()
        assert len(chapters) > 0

        # Step 6: Get descriptions for first chapter
        first_chapter = chapters[0]
        descriptions_response = await client.get(
            f"/api/v1/chapters/{first_chapter['id']}/descriptions",
            headers=auth_headers
        )
        assert descriptions_response.status_code == 200
        descriptions = descriptions_response.json()
        assert len(descriptions) > 0  # Should have extracted descriptions

        # Step 7: Check image generation
        images_response = await client.get(
            f"/api/v1/books/{book_id}/images",
            headers=auth_headers
        )
        assert images_response.status_code == 200
        # Images may be still generating, but endpoint should work

        # Step 8: Update reading progress
        progress_update = await client.put(
            f"/api/v1/books/{book_id}/progress",
            headers=auth_headers,
            json={
                "current_chapter": 1,
                "reading_location_cfi": "/2/4!/4/2/18,/1:0,/1:9",
                "scroll_offset_percent": 0.25
            }
        )
        assert progress_update.status_code == 200

        # Step 9: Verify reading progress saved
        progress_get = await client.get(
            f"/api/v1/books/{book_id}/progress",
            headers=auth_headers
        )
        assert progress_get.status_code == 200
        progress = progress_get.json()
        assert progress["scroll_offset_percent"] == 0.25
```

---

### Task 3.2: Error Scenario Testing
**Status:** MEDIUM
**Time:** 2-3 hours
**Impact:** Ensures robustness

#### Error Scenarios
```python
# backend/tests/scenarios/test_error_handling.py

async def test_large_file_handling():
    """Test handling of files larger than limit."""
    # Should reject >100MB files gracefully

async def test_corrupted_epub():
    """Test handling of corrupted EPUB file."""
    # Should provide helpful error message

async def test_concurrent_uploads():
    """Test multiple simultaneous uploads."""
    # Should not corrupt data

async def test_database_constraint_violation():
    """Test duplicate email registration."""
    # Should return 409 Conflict

async def test_network_timeout_during_parsing():
    """Test recovery from network issues."""
    # Should retry or notify user

async def test_payment_processing_failure():
    """Test failed subscription."""
    # Should maintain data integrity
```

---

## PHASE 4: CI/CD INTEGRATION

### Add Pre-commit Hooks
```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/psf/black
    rev: 23.10.0
    hooks:
      - id: black
        language_version: python3.11

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.1.3
    hooks:
      - id: ruff
        args: [--fix]

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.6.0
    hooks:
      - id: mypy
        additional_dependencies: [types-all]

  - repo: local
    hooks:
      - id: pytest
        name: pytest
        entry: pytest
        language: system
        types: [python]
        stages: [commit]
        pass_filenames: false
        always_run: true
        args: [--tb=short, --cov=app, --cov-fail-under=70]
```

### Add GitHub Actions Workflow
```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          cd backend
          pip install -r requirements.txt

      - name: Run tests
        run: |
          cd backend
          pytest --cov=app --cov-fail-under=70

  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: |
          cd frontend
          npm ci

      - name: Run tests
        run: |
          cd frontend
          npm test

      - name: Generate coverage
        run: |
          cd frontend
          npm test -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./frontend/coverage/coverage-final.json
```

---

## TESTING CHECKLIST

### Before Deployment
- [ ] All backend tests passing (644/644)
- [ ] All frontend tests passing (56/56)
- [ ] Coverage > 70% for both backend and frontend
- [ ] No deprecation warnings in test output
- [ ] API endpoints manually tested with real EPUB files
- [ ] Payment processing validated
- [ ] Error scenarios tested

### Before Release
- [ ] E2E tests passing (Playwright)
- [ ] Performance benchmarks met
- [ ] Security tests passed (OWASP Top 10)
- [ ] Load testing completed
- [ ] Mobile/accessibility testing done
- [ ] Documentation updated

---

## QUICK REFERENCE COMMANDS

```bash
# Backend
docker exec fancai-vibe-hackathon-backend-1 pytest /app/tests/ -v
docker exec fancai-vibe-hackathon-backend-1 pytest /app/tests/ --cov=app --cov-report=html

# Frontend
cd frontend && npm test
cd frontend && npm test -- --ui
cd frontend && npm test -- --coverage

# Single test
docker exec fancai-vibe-hackathon-backend-1 pytest /app/tests/test_book_parser.py -v -k "test_extract"

# Watch mode
cd backend && pytest-watch

# Generate HTML report
cd backend && pytest --cov=app --cov-report=html
# Open htmlcov/index.html
```

---

**This playbook provides step-by-step instructions for implementing Phase 1-4 testing improvements.**
