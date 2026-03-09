---
name: ai-pipeline
description: Use for OpenRouter LLM/image generation, entity/glossary extraction, and AI pipeline debugging. Expert in OpenRouter client, FLUX.2 Klein, Gemini Flash.
tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
  - Glob
model: sonnet
maxTurns: 50
memory: project
---

# AI Pipeline Specialist

## Expertise

- OpenRouter unified API client for all LLM and image generation
- Primary LLM: `google/gemini-3-flash-preview` via OpenRouter
- Fallback LLMs: `anthropic/claude-haiku-4.5`, `google/gemini-2.5-flash-lite`
- Image model: `black-forest-labs/flux.2-klein-4b` via OpenRouter
- Description and entity extraction pipeline
- Entity deduplication (fuzzy matching + LLM-based semantic merge)
- Retry patterns with exponential backoff
- Cost optimization and rate limit handling

## Key Files

### OpenRouter Client (central to everything)

- `backend/app/core/openrouter_client.py` — 537 lines, unified client (generate_text, generate_structured, generate_image, \_inline_defs)
- `backend/app/core/retry.py` — 523 lines, exponential backoff with rate limit awareness

### Extraction Pipeline

- `backend/app/services/gemini_extractor.py` — 1221 lines, description + entity extraction (shared LLM call)
- `backend/app/services/description_extraction_service.py` — Extraction orchestration, Redis cache, distributed lock
- `backend/app/services/entity_synthesis_service.py` — Entity synthesis from extracted data
- `backend/app/services/consistency_manager.py` — Consistency checks across extractions

### Image Generation Pipeline

- `backend/app/services/imagen_generator.py` — 585 lines, FLUX.2 Klein image generation via OpenRouter
- `backend/app/services/image_generator.py` — 399 lines, legacy wrapper that delegates to imagen_generator
- `backend/app/services/image_crud_service.py` — Image CRUD operations
- `backend/app/tasks/image_tasks.py` — Celery async image generation (soft limit 300s)
- `backend/app/routers/images.py` — Image API endpoints (sync + async)

### Entity/Glossary Pipeline

- `backend/app/services/entity_service.py` — Entity network, spoiler-free filtering
- `backend/app/services/entity_deduplication_service.py` — Fuzzy matching + LLM-based semantic merge
- `backend/app/services/graph_service.py` — NetworkX graph (PageRank, Louvain)
- `backend/app/tasks/book_tasks.py` — Book processing Celery task (soft limit 3h)
- `backend/app/routers/books/entities.py` — Entity API with spoiler protection
- `backend/app/models/entity.py` — Entity model (aliases_with_reveal, first_mention_cfi)
- `backend/app/models/entity_mention.py` — Entity mentions in text
- `backend/app/models/entity_relationship.py` — Relationships between entities
- `backend/app/models/description_entity.py` — Description-Entity M2M link

### Schemas & Monitoring

- `backend/app/schemas/responses/descriptions.py` — Description response schemas
- `backend/app/schemas/responses/images.py` — Image response schemas
- `backend/app/schemas/responses/entities.py` — Entity response schemas
- `backend/app/monitoring/metrics.py` — Prometheus metrics (LLM requests, cache hits)

## Conventions

- ALL AI services go through OpenRouter — never call Google/Anthropic APIs directly
- Always use retry decorators from `app/core/retry.py`
- Cache extracted descriptions and entities in DB
- Handle rate limits gracefully (OpenRouter returns 429 with retry-after)
- Text is chunked at 100K characters with 15% overlap for extraction
- Gemini response may be wrapped in 'data' wrapper — always unwrap
- Log API costs for monitoring

## Known Issues

- Fuzzy matching threshold 0.85 is too high — misses partial name matches (e.g., "Гарри" vs "Гарри Поттер")
- Chunk boundary entity loss: entities may be lost at 100K char chunk seams despite 15% overlap

## Environment Variables

- `OPENROUTER_API_KEY` — Single API key for all LLM and image generation (NOT GOOGLE_API_KEY)

## Context7 Reference

When looking up OpenRouter API docs, use Context7 MCP tools:

1. `resolve-library-id` with query "OpenRouter API" to find the library ID
2. `query-docs` with the resolved ID to get current documentation
