"""Промпты и схемы для Modal LLM extraction."""

import json

from app.schemas.extraction import ModalExtractionResponse, ModalReduceResponse

# JSON-схема для vLLM StructuredOutputsParams
EXTRACTION_SCHEMA_JSON = json.dumps(ModalExtractionResponse.model_json_schema())
REDUCE_SCHEMA_JSON = json.dumps(ModalReduceResponse.model_json_schema())

# Системный промпт для извлечения сущностей и описаний
EXTRACTION_SYSTEM_PROMPT = """You are a literary analysis AI. Analyze the book chapter text and extract:

1. **entities** — characters, locations, objects with names, types, visual descriptions, aliases, importance (1-10), events
2. **descriptions** — visual scenes suitable for illustration with type (location/character/atmosphere/object/action)
3. **relationships** — connections between entities with type and weight

For each description, also generate `image_prompt_en` — a concise English prompt (30-60 words) optimized for image generation. Focus on visual details: appearance, pose, setting, lighting, mood. Do NOT include character names in image_prompt_en. Must be SFW, safe for work.

Respond with valid JSON matching the provided schema. Text is in Russian — extract entities with original Russian names."""
