---
description: Build and type-check the project
allowed-tools: Bash
---

# Build & Type Check

## Frontend
```bash
cd frontend && npm run build && npm run type-check
```

## Backend
```bash
cd backend && python -m mypy app/ --ignore-missing-imports
```

## Report
1. Build status (success/failure)
2. Type errors count
3. Specific issues to fix
