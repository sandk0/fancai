---
description: Run project tests (frontend and/or backend)
allowed-tools: Bash
---

# Run Tests

## Usage
- `/test` — run all tests
- `/test frontend` — only frontend
- `/test backend` — only backend

## Commands

### Frontend (Jest + React Testing Library)
```bash
cd frontend && npm test -- --watchAll=false
```

### Backend (pytest)
```bash
cd backend && uv run python -m pytest -v --tb=short
```

## Report
After running tests, provide:
1. Number of passed/failed tests
2. Summary of failures (if any)
3. Recommendations for fixes
