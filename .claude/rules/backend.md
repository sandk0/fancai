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

### Gemini/Imagen Pipeline
- `gemini_extractor.py` extracts descriptions AND entities in one `analyze_chapter()` call
- Response may be wrapped in 'data' — always unwrap
- Two extraction modes: TSA (default, XML tags) and Legacy (JSON)
- Chunk size: 100K chars with 15% overlap — entities may be lost at boundaries
- Translation RU→EN uses Gemini for Imagen prompts

### Database
- All models use `lazy="raise"` — explicit eager loading required in queries
- N+1 risk: always use `selectinload` for lists, `joinedload` for single relations
- Alembic for migrations: `cd backend && alembic revision --autogenerate -m "description"`

### Celery Tasks
- Image generation: `image_tasks.py` (soft limit 300s)
- Book processing: `book_tasks.py` (soft limit 3h)
- Always use distributed lock for book processing

### Critical Files (handle with care)
- `routers/images.py` — 33K lines, needs decomposition
- `routers/reading_sessions.py` — 41K lines, needs decomposition
