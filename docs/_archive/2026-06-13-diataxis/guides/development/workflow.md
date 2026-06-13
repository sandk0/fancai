# Development Workflow

Complete guide to the development process from idea to deployment.

## Table of Contents

- [Overview](#overview)
- [Development Cycle](#development-cycle)
- [Branch Strategy](#branch-strategy)
- [Feature Development](#feature-development)
- [Code Review Process](#code-review-process)
- [Testing Strategy](#testing-strategy)
- [Documentation Process](#documentation-process)
- [Deployment Process](#deployment-process)
- [Best Practices](#best-practices)

---

## Overview

BookReader AI follows a structured development workflow to ensure code quality, maintainability, and team coordination.

### Key Principles

1. **Incremental Development** - Small, focused changes
2. **Test-Driven** - Write tests first (TDD encouraged)
3. **Documentation First** - Update docs with code
4. **Code Review** - All changes reviewed
5. **Continuous Integration** - Automated testing and deployment

### Development Phases

```
Idea → Planning → Implementation → Testing → Review → Merge → Deploy
```

---

## Development Cycle

### 1. Planning Phase

**Before writing code:**

1. **Check Existing Issues**
   - Search GitHub issues
   - Avoid duplicate work
   - Comment on related issues

2. **Create/Update Issue**
   - Use issue template
   - Clear description
   - Acceptance criteria
   - Estimated time

3. **Get Approval** (for major features)
   - Discuss with team
   - Architectural review
   - Resource allocation

**Example Issue:**
```markdown
Title: Add EPUB metadata extraction

Description:
Extract publisher, ISBN, language from EPUB files

Acceptance Criteria:
- [ ] Parse EPUB metadata.opf
- [ ] Extract publisher, ISBN, language fields
- [ ] Store in book_metadata JSONB column
- [ ] Add tests for extraction
- [ ] Update API to return new fields

Estimated Time: 4 hours

Labels: enhancement, backend, parser
```

### 2. Implementation Phase

**Development setup:**

```bash
# Create feature branch
git checkout -b feature/epub-metadata-extraction

# Set up environment
docker-compose -f docker-compose.dev.yml up -d

# Run in watch mode for development
# Terminal 1: Backend
cd backend && uvicorn app.main:app --reload

# Terminal 2: Frontend
cd frontend && npm run dev
```

**Development loop:**

```
1. Write failing test
2. Implement feature
3. Make test pass
4. Refactor code
5. Update documentation
6. Commit changes
7. Repeat
```

### 3. Testing Phase

**Test at multiple levels:**

```bash
# Unit tests
cd backend && pytest tests/unit/ -v

# Integration tests
cd backend && pytest tests/integration/ -v

# E2E tests
cd frontend && npm run test:e2e

# Type checking
cd backend && mypy app/ --strict
cd frontend && npm run type-check

# Linting
cd backend && ruff check . && black .
cd frontend && npm run lint
```

### 4. Review Phase

**Self-review checklist:**
- [ ] All tests pass
- [ ] Code follows style guide
- [ ] Documentation updated
- [ ] No console.log or debug statements
- [ ] No commented-out code
- [ ] Environment variables documented
- [ ] Database migrations created (if needed)
- [ ] Changelog updated

**Submit PR:**
- Use PR template
- Link related issues
- Add screenshots (for UI changes)
- Request reviewers

### 5. Merge Phase

**After approval:**
1. Resolve conflicts (if any)
2. Squash commits (optional)
3. Merge to main/develop
4. Delete feature branch
5. Close related issues

### 6. Deployment Phase

See [Deployment Process](#deployment-process) below.

---

## Branch Strategy

### Main Branches

- **main** - Production-ready code
- **develop** - Development integration branch (optional)

### Supporting Branches

- **feature/** - New features
- **fix/** - Bug fixes
- **refactor/** - Code refactoring
- **docs/** - Documentation only
- **test/** - Test improvements

### Branch Naming

```bash
# Features
feature/epub-metadata-extraction
feature/dark-theme-support

# Fixes
fix/pagination-mobile-overflow
fix/jwt-token-expiration

# Refactoring
refactor/admin-router-modularization
refactor/books-service-split

# Documentation
docs/update-api-documentation
docs/add-troubleshooting-guide

# Tests
test/add-e2e-book-upload
test/improve-nlp-coverage
```

### Branch Workflow

```bash
# Create branch from main
git checkout main
git pull origin main
git checkout -b feature/your-feature

# Make changes and commit
git add .
git commit -m "feat(parser): add EPUB metadata extraction"

# Push to remote
git push origin feature/your-feature

# Create PR on GitHub

# After merge, cleanup
git checkout main
git pull origin main
git branch -d feature/your-feature
```

---

## Feature Development

### Step-by-Step Guide

#### 1. Create Branch

```bash
git checkout main
git pull
git checkout -b feature/new-feature-name
```

#### 2. Implement Feature

**Backend Example (FastAPI endpoint):**

```python
# backend/app/routers/books/crud.py

@router.post("/books/{book_id}/export", response_model=ExportResponse)
async def export_book_annotations(
    book_id: UUID,
    request: ExportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ExportResponse:
    """
    Export book annotations to various formats.

    Args:
        book_id: Book UUID
        request: Export parameters (format, filters)
        current_user: Authenticated user
        db: Database session

    Returns:
        Export job details with download link

    Raises:
        HTTPException: If book not found or unauthorized
    """
    # Implementation
    pass
```

**Frontend Example (React component):**

```typescript
// frontend/src/components/ExportModal.tsx

interface ExportModalProps {
  bookId: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal for exporting book annotations
 *
 * @param bookId - Book UUID to export
 * @param isOpen - Modal visibility state
 * @param onClose - Close handler
 */
export const ExportModal: React.FC<ExportModalProps> = ({
  bookId,
  isOpen,
  onClose,
}) => {
  // Implementation
};
```

#### 3. Write Tests

**Backend test:**

```python
# backend/tests/integration/test_export.py

import pytest
from app.schemas.export import ExportRequest

@pytest.mark.asyncio
async def test_export_book_annotations(
    client,
    test_book,
    test_user,
    auth_headers,
):
    """Test exporting book annotations."""
    request_data = {
        "format": "pdf",
        "include_highlights": True,
        "include_bookmarks": True,
    }

    response = await client.post(
        f"/api/v1/books/{test_book.id}/export",
        json=request_data,
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert "job_id" in data
    assert "download_url" in data
```

**Frontend test:**

```typescript
// frontend/tests/components/ExportModal.test.tsx

import { render, screen, fireEvent } from '@testing-library/react';
import { ExportModal } from '@/components/ExportModal';

describe('ExportModal', () => {
  it('renders export options', () => {
    render(
      <ExportModal
        bookId="test-id"
        isOpen={true}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Export Annotations')).toBeInTheDocument();
    expect(screen.getByLabelText('Format')).toBeInTheDocument();
  });

  it('submits export request', async () => {
    // Test implementation
  });
});
```

#### 4. Update Documentation

**Required updates:**

1. **README.md** (if user-facing feature)
   ```markdown
   ## Features
   - ✅ Export annotations to PDF/DOCX
   ```

2. **API Documentation**
   ```markdown
   ### POST /api/v1/books/{book_id}/export

   Export book annotations in various formats.

   **Request:**
   ```json
   {
     "format": "pdf",
     "include_highlights": true
   }
   ```
   ```

3. **Changelog**
   ```markdown
   ## 2025-11-14 - Export Feature

   ### Added
   - **Books API**: New endpoint POST /books/{id}/export
     - Export annotations to PDF, DOCX, JSON formats
     - Configurable export filters
     - Background job processing
     - Files: `backend/app/routers/books/crud.py`
   ```

4. **Docstrings** (shown above)

#### 5. Commit Changes

```bash
# Stage changes
git add backend/app/routers/books/crud.py
git add backend/tests/integration/test_export.py
git add docs/reference/api/books.md
git add docs/development/changelog/2025.md

# Commit with conventional commit message
git commit -m "$(cat <<'EOF'
feat(books): add annotation export endpoint

- Implement POST /books/{id}/export endpoint
- Support PDF, DOCX, JSON export formats
- Add export filtering options (highlights, bookmarks, notes)
- Celery task for background processing
- Add comprehensive tests (95% coverage)
- Update API documentation

Closes #123

Files:
- backend/app/routers/books/crud.py
- backend/app/services/export_service.py
- backend/tests/integration/test_export.py
- docs/reference/api/books.md
EOF
)"
```

#### 6. Push and Create PR

```bash
# Push to remote
git push origin feature/annotation-export

# Create PR on GitHub
gh pr create --title "feat(books): add annotation export endpoint" \
  --body "$(cat <<'EOF'
## Description
Add endpoint for exporting book annotations to PDF, DOCX, JSON formats.

## Type of Change
- [x] New feature (non-breaking change which adds functionality)

## Testing
- [x] Backend tests pass (95% coverage)
- [x] Frontend tests pass
- [x] Manual testing completed

## Documentation
- [x] Code includes docstrings
- [x] API documentation updated
- [x] Changelog updated

## Related Issues
Closes #123

## Screenshots
![Export Modal](screenshots/export-modal.png)
EOF
)"
```

---

## Code Review Process

### For Authors

**Before requesting review:**
1. Self-review your changes
2. Ensure all tests pass
3. Update documentation
4. Run linters and formatters
5. Add descriptive PR title and body
6. Link related issues

**During review:**
1. Respond to comments promptly
2. Make requested changes
3. Push updates (no force-push unless requested)
4. Re-request review after changes
5. Be open to feedback

**After approval:**
1. Resolve conflicts (if any)
2. Wait for CI/CD to pass
3. Merge when all checks green
4. Delete branch after merge

### For Reviewers

**Review checklist:**

- [ ] **Code Quality**
  - Follows style guide
  - No code smells
  - Proper error handling
  - No security issues

- [ ] **Functionality**
  - Meets requirements
  - Edge cases handled
  - Performance acceptable
  - No breaking changes (or documented)

- [ ] **Tests**
  - Adequate coverage (>70%)
  - Tests are meaningful
  - Tests pass

- [ ] **Documentation**
  - Docstrings present
  - API docs updated
  - Changelog updated
  - README updated (if needed)

**Review guidelines:**

1. **Be constructive**
   - "Consider using X instead" > "This is wrong"
   - Explain why, not just what

2. **Be timely**
   - Review within 24-48 hours
   - Communicate delays

3. **Be thorough**
   - Check all changed files
   - Test locally if needed
   - Verify documentation

4. **Use labels**
   - `nit:` - Minor suggestion
   - `question:` - Need clarification
   - `blocking:` - Must be fixed before merge

---

## Testing Strategy

### Testing Pyramid

```
           E2E Tests (10%)
         ↗               ↖
    Integration Tests (30%)
   ↗                       ↖
Unit Tests (60%)
```

### Test Levels

**1. Unit Tests (Fast, Isolated)**

```python
# Test individual functions
def test_extract_chapter_title():
    content = "<h1>Chapter 1</h1>"
    result = extract_chapter_title(content)
    assert result == "Chapter 1"
```

**2. Integration Tests (Medium, Dependencies)**

```python
# Test multiple components together
async def test_book_upload_and_parse(client, db):
    # Upload book
    response = await client.post("/books", files={"file": book_file})
    book_id = response.json()["id"]

    # Verify parsing happened
    book = await db.get(Book, book_id)
    assert book.chapters_count > 0
```

**3. E2E Tests (Slow, Full System)**

```typescript
// Test complete user flow
test('user can upload and read book', async ({ page }) => {
  await page.goto('/');
  await page.click('text=Upload Book');
  await page.setInputFiles('input[type=file]', 'sample.epub');
  await page.waitForSelector('text=Upload complete');
  await page.click('text=Open Book');
  expect(await page.textContent('.reader')).toContain('Chapter 1');
});
```

### Test Organization

```
backend/tests/
├── unit/              # Fast, isolated tests
│   ├── test_parsers.py
│   ├── test_nlp.py
│   └── test_utils.py
├── integration/       # Database, API tests
│   ├── test_books_api.py
│   ├── test_auth.py
│   └── test_nlp_processing.py
└── fixtures/          # Test data
    ├── sample.epub
    └── sample.fb2

frontend/tests/
├── unit/              # Component tests
│   └── components/
├── integration/       # API integration
│   └── api/
└── e2e/               # Playwright tests
    └── workflows/
```

### Running Tests

```bash
# All tests
npm run test:all

# Backend only
cd backend && pytest -v --cov=app

# Frontend only
cd frontend && npm test

# E2E only
cd frontend && npm run test:e2e

# Watch mode (development)
cd backend && pytest -v --watch
cd frontend && npm test -- --watch

# Specific test
pytest backend/tests/integration/test_books_api.py::test_upload_book

# Coverage report
cd backend && pytest --cov=app --cov-report=html
open htmlcov/index.html
```

---

## Documentation Process

### Documentation Requirements

**CRITICAL:** Every code change MUST update documentation!

### What to Document

1. **Code Level:**
   - Docstrings for all functions/classes
   - Inline comments for complex logic
   - Type hints (Python, TypeScript)

2. **API Level:**
   - Endpoint descriptions
   - Request/response examples
   - Error codes

3. **Project Level:**
   - README updates
   - Changelog entries
   - Architecture decisions

### Documentation Workflow

```
Code Change → Update Docs → Commit Together
```

**Never commit code without docs!**

### Documentation Checklist

After implementing a feature:

- [ ] **README.md** - New feature listed (if user-facing)
- [ ] **docs/development/planning/development-plan.md** - Task marked complete
- [ ] **docs/development/planning/development-calendar.md** - Date recorded
- [ ] **docs/development/changelog/2025.md** - Detailed entry added
- [ ] **docs/development/status/current-status.md** - Status updated
- [ ] **Code docstrings** - All new functions documented
- [ ] **API docs** - New endpoints documented (if applicable)
- [ ] **Architecture docs** - Updated (for significant changes)

For details, see [CLAUDE.md - Documentation Standards](../../../CLAUDE.md#documentation-standards).

---

## Deployment Process

### Development Deployment

```bash
# Deploy to development environment
docker-compose -f docker-compose.dev.yml up -d
```

### Staging Deployment

```bash
# Deploy to staging for testing
./scripts/deploy.sh staging
```

### Production Deployment

```bash
# Full production deployment
./scripts/deploy.sh init      # First time only
./scripts/deploy.sh ssl       # Set up SSL
./scripts/deploy.sh deploy    # Deploy application
./scripts/deploy.sh status    # Verify deployment
```

### Deployment Checklist

- [ ] All tests pass
- [ ] Code reviewed and approved
- [ ] Documentation updated
- [ ] Database migrations tested
- [ ] Environment variables configured
- [ ] SSL certificates valid
- [ ] Monitoring configured
- [ ] Backup verified
- [ ] Rollback plan ready

For details, see [Production Deployment Guide](../deployment/production-deployment.md).

---

## Best Practices

### Code Quality

1. **Follow Style Guides**
   - Backend: PEP 8, Black formatting
   - Frontend: ESLint, Prettier

2. **Write Self-Documenting Code**
   - Clear variable names
   - Small functions (<50 lines)
   - Single Responsibility Principle

3. **Handle Errors Properly**
   - Use custom exceptions
   - Provide helpful error messages
   - Log errors appropriately

### Git Practices

1. **Atomic Commits**
   - One logical change per commit
   - Commit often
   - Write clear commit messages

2. **Keep Branches Small**
   - <500 lines changed
   - Focus on single feature/fix
   - Merge frequently

3. **Never Force Push**
   - Unless absolutely necessary
   - Communicate with team first
   - Only on personal branches

### Testing Practices

1. **Test-Driven Development**
   - Write test first
   - Watch it fail
   - Make it pass

2. **Test Edge Cases**
   - Empty inputs
   - Maximum values
   - Invalid data
   - Concurrent access

3. **Keep Tests Fast**
   - Unit tests <100ms each
   - Integration tests <1s each
   - Use fixtures and mocks

### Documentation Practices

1. **Update Documentation First**
   - Before writing code
   - Clarifies requirements
   - Prevents forgotten updates

2. **Write for Humans**
   - Clear language
   - Examples included
   - Context provided

3. **Keep Docs Current**
   - Update with every PR
   - Remove outdated content
   - Version documentation

## Quick Reference

### Common Commands

```bash
# Start development
docker-compose -f docker-compose.dev.yml up -d

# Run tests
cd backend && pytest -v --cov=app
cd frontend && npm test

# Format code
cd backend && black . && ruff check .
cd frontend && npm run lint:fix

# Type check
cd backend && mypy app/ --strict
cd frontend && npm run type-check

# Create migration
cd backend && alembic revision --autogenerate -m "description"

# Apply migrations
cd backend && alembic upgrade head

# View logs
docker-compose logs -f backend
docker-compose logs -f celery-worker
```

### Useful Links

- [Contributing Guide](../../../CONTRIBUTING.md)
- [Testing Guide](../testing/testing-guide.md)
- [API Documentation](../../reference/api/overview.md)
- [CLAUDE.md](../../../CLAUDE.md)

---

**Last Updated:** November 14, 2025
