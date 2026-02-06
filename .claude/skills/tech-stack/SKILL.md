---
name: tech-stack
description: Use when discussing architecture, adding features, or understanding fancai project structure. Provides technology overview and conventions.
---

# fancai Technology Stack

## Overview
Web application for reading fiction with AI-generated images from book descriptions.

## Frontend (frontend/)
- **Framework:** React 19 + TypeScript 5.7
- **State:** TanStack Query 5.90 (server), Zustand 5 (client)
- **EPUB:** epub.js 0.3.93 with CFI navigation
- **Styling:** Tailwind CSS 3.4, shadcn/ui
- **Build:** Vite 7

### Key Directories
- `src/components/Reader/` — EPUB reader (15 files)
- `src/hooks/api/` — TanStack Query hooks
- `src/hooks/epub/` — EPUB functionality (22 files)
- `src/services/` — IndexedDB caching

## Backend (backend/)
- **Framework:** FastAPI 0.125 + Python 3.11
- **Database:** PostgreSQL 15 + SQLAlchemy 2.0
- **Cache:** Redis 7.4
- **Background:** Celery 5.6
- **Migrations:** Alembic 1.14

### Key Services
- `app/services/book_parser.py` — EPUB/FB2 parsing
- `app/services/gemini_extractor.py` — Description extraction
- `app/services/imagen_generator.py` — Image generation
- `app/core/retry.py` — Exponential backoff

## AI Integration
- **Extraction:** Google Gemini 3.0 Flash (~$0.02/book)
- **Generation:** Google Imagen 4 ($0.04/image)

## Commands
```bash
# Frontend
cd frontend && npm run dev      # Development
cd frontend && npm test         # Tests
cd frontend && npm run build    # Build

# Backend
cd backend && pytest -v         # Tests
cd backend && alembic upgrade head  # Migrations
```

## Conventions

### TypeScript
- Functional components with hooks
- TanStack Query for all API calls
- No direct fetch() — use query hooks
- CFI for EPUB position tracking

### Python
- Type hints required
- Pydantic for validation
- Repository pattern for DB
- tenacity for retries

### Commits
```
<type>(<scope>): <subject>
Types: feat, fix, docs, style, refactor, test, chore
```

## Production
- URL: https://fancai.ru
- Deploy: `docker-compose.lite.yml`
