# Backend — FastAPI 0.135.1 + Python 3.12

## Key Conventions

- Type hints required on all functions
- Pydantic v2 for validation (pydantic 2.12.5)
- SQLAlchemy 2.0 with `lazy="raise"` — always use explicit selectinload/joinedload
- Tenacity retry decorators (core/retry.py) for all external calls
- All AI through OpenRouter (core/openrouter_client.py), env: OPENROUTER_API_KEY

## Architecture

- `routers/` — 97 routes + 1 websocket across 25 files
- `routers/books/` — subpackage: crud.py (792), entities.py, processing.py, validation.py
- `services/` — 28 services, largest: gemini_extractor.py (1221), book_parser.py (1199)
- `models/` — 18 SQLAlchemy models, 47 alembic migrations
- `tasks/` — 10 Celery tasks (image: 300s soft limit, book: 3h soft limit)

## AI Models (via OpenRouter)

- LLM: google/gemini-3-flash-preview (fallbacks: claude-haiku-4.5, gemini-2.5-flash-lite)
- Images: black-forest-labs/flux.2-klein-4b
- Extraction: 100K char chunks with 15% overlap (entity loss at boundaries)

## Testing

- pytest -v --tb=short
- 46 test files across services/, routers/, integration/, performance/
