---
paths:
  - "backend/app/core/openrouter_client.py"
  - "backend/app/services/gemini_extractor.py"
  - "backend/app/services/imagen_generator.py"
  - "backend/app/services/image_generator.py"
  - "backend/app/services/entity_service.py"
  - "backend/app/services/entity_deduplication_service.py"
  - "backend/app/services/entity_synthesis_service.py"
  - "backend/app/services/description_extraction_service.py"
  - "backend/app/services/consistency_manager.py"
  - "backend/app/tasks/image_tasks.py"
  - "backend/app/tasks/book_tasks.py"
---

## AI Pipeline Rules

### OpenRouter Client

- ALL AI calls through `core/openrouter_client.py` — NEVER call Google/Anthropic APIs directly
- Always use retry decorators from `core/retry.py`
- Gemini response may be wrapped in 'data' wrapper — always unwrap
- Structured output uses `_inline_defs()` for Pydantic JSON Schema

### Models

- LLM: google/gemini-3-flash-preview (fallbacks: claude-haiku-4.5, gemini-2.5-flash-lite)
- Images: black-forest-labs/flux.2-klein-4b
- Env: OPENROUTER_API_KEY (NOT GOOGLE_API_KEY)

### Extraction

- 100K char chunks with 15% overlap (entity loss at boundaries — known issue)
- Two modes: TSA (XML tags, default) and Legacy (JSON)
- Descriptions AND entities extracted in single `analyze_chapter()` call

### Entity System

- Spoiler-free is NON-NEGOTIABLE
- `_apply_chapter_filter()` must NEVER leak future data
- Fuzzy matching threshold: 0.85 (known to be too high)
- Deduplication: fuzzy + LLM-based semantic merge (DEDUPLICATION_PROMPT)
