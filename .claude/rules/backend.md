---
paths:
  - "backend/**"
---

## Backend Rules

### FastAPI Conventions

- Type hints required on all functions
- Pydantic v2 for all request/response schemas
- Use `selectinload`/`joinedload` for relationships (models use `lazy="raise"`)
- Custom exceptions from `core/exceptions.py` (RFC 9457 format)
- Tenacity retry decorators from `core/retry.py` for all LLM/external calls

### AI Pipeline (OpenRouter)

- All AI calls go through `core/openrouter_client.py` (unified client, 3 fallback models)
- Env var: `OPENROUTER_API_KEY` (not GOOGLE_API_KEY)
- `gemini_extractor.py` extracts descriptions AND entities in one `analyze_chapter()` call
- Response may be wrapped in 'data' — always unwrap
- Two extraction modes: TSA (default, XML tags) and Legacy (JSON)
- Chunk size: 100K chars with 15% overlap — entities may be lost at boundaries
- Translation RU→EN for image prompts via OpenRouter
- Images: FLUX.2 Klein via OpenRouter (not Imagen)

### Database

- All models use `lazy="raise"` — explicit eager loading required in queries
- N+1 risk: always use `selectinload` for lists, `joinedload` for single relations
- Alembic for migrations: `cd backend && alembic revision --autogenerate -m "description"`

### Celery Tasks

- Image generation: `image_tasks.py` (soft limit 300s)
- Book processing: `book_tasks.py` (soft limit 3h)
- Always use distributed lock for book processing

### Key Backend Files

- `routers/images.py` — 957 строк (13 routes, image generation endpoints)
- `routers/reading_sessions.py` — 1089 строк (8 routes, session management)
- `routers/books/` — subpackage: crud.py (792), entities.py, processing.py, validation.py
- `services/gemini_extractor.py` — 1221 строк (крупнейший сервис, LLM extraction via OpenRouter)
- `services/book_parser.py` — 1199 строк (EPUB/FB2 parsing)
- `services/entity_service.py` — 680 строк (entity management, spoiler-free)
- `core/openrouter_client.py` — 537 строк (unified AI client, 3 fallback models)
