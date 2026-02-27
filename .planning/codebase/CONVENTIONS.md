# Coding Conventions

**Analysis Date:** 2026-02-27

## Naming Patterns

**Files:**
- React components: PascalCase — `EpubReader.tsx`, `EntityCard.tsx`, `LibraryPage.tsx`
- Hooks: camelCase with `use` prefix — `useBooks.ts`, `useDescriptionHighlighting.ts`, `useProgressSync.ts`
- Services/utilities: camelCase — `chapterCache.ts`, `syncQueue.ts`, `cacheManager.ts`
- Backend Python: snake_case — `entity_service.py`, `book_parser.py`, `auth_service.py`
- Test files: mirror source file with `__tests__/` subdir — `useBooks.ts` → `__tests__/useBooks.test.tsx`
- Backend test files: `test_` prefix — `test_auth.py`, `test_chapters.py`

**Functions:**
- TypeScript: camelCase — `getOfflineBooksPlaceholder()`, `switchToFallback()`, `toCachedDescription()`
- Python: snake_case — `get_user_books()`, `check_database()`, `get_active_sessions_stats()`
- Private Python helpers: underscore prefix — `_normalize_name()`, `_build_test_database_url()`, `_get_earliest_cfi()`

**Variables:**
- TypeScript: camelCase — `queryClient`, `mockBooks`, `testUserId`
- Python: snake_case — `db_session`, `test_book`, `sample_user_data`
- Constants: SCREAMING_SNAKE_CASE — `MAX_CHAPTERS_PER_BOOK`, `STORAGE_KEYS`, `RATE_LIMIT_PRESETS`
- Unused parameters/variables: prefix with `_` to satisfy linting — `_rendition`, `_offset`

**Types:**
- TypeScript interfaces: PascalCase — `BookDetail`, `CacheStats`, `OfflineBookMarker`
- Pydantic models (backend): PascalCase — `UserRegistrationRequest`, `LogoutResponse`, `ProblemDetail`
- Generic type vars: single uppercase letter or descriptive — `T`, `TypeVar`
- Enum values: SCREAMING_SNAKE_CASE in Python — `BookGenre.FANTASY`

**React components:**
- Named exports preferred — `export const EpubReader = ...`
- Default exports allowed only for pages — `export default LibraryPage`

## Code Style

**Formatting:**
- TypeScript: No Prettier config detected — relies on ESLint rules and editor defaults
- Python: No Black config detected — standard PEP 8 indentation (4 spaces)
- TypeScript indentation: 2 spaces (observed from source)

**Linting (TypeScript):**
- Tool: `eslint` v9 with `typescript-eslint` — `frontend/eslint.config.js`
- `@typescript-eslint/no-unused-vars`: error (prefix `_` to suppress)
- `@typescript-eslint/no-explicit-any`: warn (allowed with `ignoreRestArgs: true`)
- `@typescript-eslint/explicit-module-boundary-types`: off
- `react-hooks/exhaustive-deps`: enforced (rule package v7)
- `prefer-const`: warn
- `no-console`: off (console allowed)

**Linting (Python):**
- mypy configured: `backend/mypy.ini` and `backend/pyrightconfig.json`
- Type hints required on all functions

## Import Organization

**TypeScript order (observed):**
1. External libraries — `import { describe, it } from 'vitest'`, `import React from 'react'`
2. Third-party packages — `import { QueryClient } from '@tanstack/react-query'`
3. Internal aliases — `import { booksAPI } from '@/api/books'`, `import type { Book } from '@/types/api'`
4. Relative imports — `import { createChapterId } from './db'`

**Path Aliases:**
- `@/` maps to `frontend/src/` — defined in `frontend/vitest.config.ts` and `frontend/tsconfig.json`
- Use `@/` for all cross-directory imports; relative only for same-directory imports

**Python order (observed):**
1. Standard library — `import logging`, `from typing import List, Optional`
2. Third-party — `from fastapi import Depends`, `from sqlalchemy.ext.asyncio import AsyncSession`
3. Internal app imports — `from app.models.entity import Entity`, `from app.core.config import settings`
4. Relative imports — `from ..core.database import get_database_session`

## Error Handling

**Frontend patterns:**
- Async operations in hooks: wrap in `try/catch`, re-throw after state cleanup
  ```typescript
  try {
    const response = await authAPI.login({ email, password });
    set({ user, isAuthenticated: true, isLoading: false });
  } catch (error) {
    set({ isLoading: false });
    throw error;  // Re-throw so callers can handle
  }
  ```
- TanStack Query mutations: error surfaces via `result.current.isError` / `result.current.error`
- Fallback pattern for IndexedDB: `switchToFallback()` in `frontend/src/services/chapterCache.ts`

**Backend patterns:**
- Use `ProblemDetail` (RFC 9457) from `app/core/exceptions.py` for all HTTP errors
- Raise `HTTPException` with appropriate status codes in routers
- Use `monkeypatch` or `AsyncMock` to simulate failures in tests (not real errors)
- Tenacity decorators for all LLM/external API calls: `@retry_api_call`, `@retry_image_generation`, `@retry_llm_extraction` from `app/core/retry.py`
- Always unwrap Gemini API response — may be nested in `data` key

## Logging

**Frontend:**
- Module: `frontend/src/lib/logger.ts` — `import { logger } from '@/lib/logger'`
- `logger.debug()` and `logger.info()` are no-ops in production builds
- `logger.warn()` and `logger.error()` always active
- Never use `console.log` directly — use `logger.*` instead
- Debug messages use emoji prefixes (codebase convention): `'🧹 Clearing...'`, `'🔐 Login successful'`

**Backend:**
- Standard Python `logging` module: `logger = logging.getLogger(__name__)`
- Tenacity retries log via `before_sleep_log` and `after_log`

## Comments

**When to Comment:**
- Module-level docstrings: always, explain what the file/module does
- Complex algorithms: comment the "why," not the "what"
- Workarounds and edge cases: explain with `# Note:`, `# IMPORTANT:`
- TODOs: use `# TODO:` format — tracked in codebase

**JSDoc/TSDoc:**
- Used for public hooks and services with `@module`, `@param`, `@returns`
- Example from `frontend/src/hooks/api/useBooks.ts`:
  ```typescript
  /**
   * Загрузка offline книг из IndexedDB для placeholderData
   *
   * @param userId - ID пользователя
   * @returns Массив книг из IndexedDB или undefined
   */
  ```

**Python docstrings:**
- Classes and public methods: always documented with Attributes and Example sections
- Example from `backend/app/schemas/responses/auth.py`:
  ```python
  class LogoutResponse(BaseModel):
      """
      Response после успешного logout.
      Attributes:
          message: Сообщение об успешном выходе
      Example:
          {"message": "Logout successful", "logged_out_at": "..."}
      """
  ```

## Function Design

**TypeScript:**
- Prefer small, single-purpose functions extracted into hooks
- EpubReader logic: always extract into dedicated hooks, never edit `EpubReader.tsx` directly
- Helper functions inside hooks should be extracted if reused
- Async functions: always `async/await`, never raw `.then()` chains in hook code

**Python:**
- All functions have type hints on parameters and return values
- Service methods accept injected `AsyncSession` — no direct DB calls in routers
- Use `selectinload`/`joinedload` explicitly — models use `lazy="raise"` (N+1 prevention)
- Private helpers: prefix with `_`, may use `@lru_cache` for pure functions

## Module Design

**TypeScript exports:**
- Hooks: named exports from module file — `export function useBooks(...)`
- Services: singleton object exports — `export const chapterCache = new ChapterCacheService()`
- Types: re-export from `frontend/src/types/` barrel files
- No barrel files (`index.ts`) for hooks — import directly from hook file

**Python:**
- SQLAlchemy models: `from app.models import User, Book` (barrel pattern via `__init__.py`)
- Service classes: instantiated per-request, injected via FastAPI `Depends()`
- Container pattern: `frontend/src/core/container.py` for dependency injection factories

## TypeScript-Specific Conventions

**React patterns:**
- Functional components only — no class components
- State management: Zustand for global state (`frontend/src/stores/`), TanStack Query for server state
- No direct `fetch()` calls — all API calls through `@/api/` modules using `apiClient`
- EPUB positions: always use CFI strings, never page numbers
- Zustand stores: `create<State>()` with `persist` middleware for auth

**Pydantic (Backend):**
- All request/response types use Pydantic v2 `BaseModel`
- Schema examples provided via `model_config` / `class Config`
- Request models suffixed `Request` — `UserRegistrationRequest`
- Response models suffixed `Response` or `Schema` — `LoginResponse`, `EntityDetailSchema`

---

*Convention analysis: 2026-02-27*
