---
paths:
  - "frontend/src/**/*.test.ts"
  - "frontend/src/**/*.test.tsx"
  - "backend/tests/**"
---

## Test Rules

### Frontend (Vitest + Testing Library)

- `cd frontend && npm test -- --watchAll=false`
- Use React Testing Library patterns (getByRole, getByText)
- Mock TanStack Query hooks
- Mock epub.js rendition for Reader tests

### Backend (pytest)

- `cd backend && pytest -v --tb=short`
- Mock OpenRouter API calls — NEVER make real API calls in tests
- Use pytest fixtures for DB session, client, auth
- Mock Celery tasks with `celery.contrib.pytest`

### Requirements

- Bug fixes MUST include regression test
- Entity system: always test spoiler-free filtering
- AI pipeline: test with mocked LLM responses
