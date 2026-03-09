---
name: tech-stack
description: Use when discussing architecture, adding features, or understanding fancai project structure. Provides technology overview and conventions.
---

# fancai Technology Stack

## Overview

Fiction reader with AI illustrations and interactive entity glossary/wiki. Two core AI features: image generation from descriptions + spoiler-free entity encyclopedia (characters, locations, objects) with chapter tracking.

## Frontend (frontend/)

- **Framework:** React 19.0.0 + TypeScript 5.7.2
- **Build:** Vite 7.3.1
- **State:** TanStack Query 5.90.12 (server), Zustand 5.0.10 (client)
- **EPUB:** epub.js 0.3.93 with CFI navigation
- **Styling:** Tailwind CSS 4.1.18, shadcn/ui (Radix UI)
- **Validation:** zod 4.3.6
- **Storage:** Dexie 4.2.1 (IndexedDB)
- **i18n:** i18next (1000+ keys, ru/en)

### Key Directories

- `src/components/Reader/` — EPUB reader (22 files)
- `src/components/Entities/` — Entity glossary UI (12 files)
- `src/hooks/api/` — TanStack Query hooks (8 files)
- `src/hooks/epub/` — EPUB functionality (26 files)
- `src/services/` — IndexedDB caching

## Backend (backend/)

- **Framework:** FastAPI 0.135.1 + Python 3.12
- **Database:** PostgreSQL 17.9-alpine + SQLAlchemy 2.0.47
- **Cache:** Redis 7.4.8-alpine
- **Background:** Celery 5.6.2
- **Migrations:** Alembic 1.18.4
- **Validation:** Pydantic 2.12.5
- **Auth:** PyJWT[crypto] 2.10.1

### Key Services

- `app/services/book_parser.py` — EPUB/FB2 parsing
- `app/services/gemini_extractor.py` — Description extraction via OpenRouter
- `app/services/entity_service.py` — Entity network, spoiler-free filtering
- `app/services/entity_deduplication_service.py` — Fuzzy + LLM dedup
- `app/core/openrouter_client.py` — Unified AI client (generate_text, generate_structured, generate_image)
- `app/routers/books/` — Subpackage (crud.py, entities.py, processing.py, validation.py)

## AI Integration

All AI via OpenRouter (`backend/app/core/openrouter_client.py`):

- **LLM:** Gemini 3.0 Flash (primary), fallbacks: Claude Haiku 4.5, Gemini 2.5 Flash Lite
- **Images:** FLUX.2 Klein via OpenRouter

## Commands

```bash
# Frontend
cd frontend && npm run dev      # Development
cd frontend && npm test         # Tests
cd frontend && npm run build    # Build

# Backend
cd backend && pytest -v         # Tests
cd backend && alembic upgrade head  # Migrations
docker compose up -d            # Start all services (NOT docker-compose)
```

## Conventions

### TypeScript

- Functional components with hooks
- TanStack Query for all API calls — no direct fetch()
- CFI for EPUB position tracking (never page numbers)
- Extract logic from EpubReader.tsx into hooks before editing

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
- Web server: Caddy 2.11.1-alpine
- Deploy: `docker-compose.prod.yml`
- Dev: `docker-compose.dev.yml`
- Monitoring: Hawk Tracker (frontend + backend), Netdata, VictoriaMetrics, Uptime Kuma, Dozzle, Flower
