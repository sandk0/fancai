# Modal AI Pipeline Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the full AI pipeline (LLM extraction + image generation + entity reduce) from OpenRouter to Modal self-hosted (Qwen3.5-9B + FLUX.2 Klein 4B).

**Architecture:** Two Modal `@app.cls()` classes (LLMExtractor on L4 + ImageGenerator on L4) deployed as a single app `fancai-pipeline`. VPS Celery workers call Modal via `modal.Cls.from_name().remote()`, receive JSON/bytes results, write to local PostgreSQL. Feature flag `USE_MODAL_PIPELINE` for rollback to OpenRouter path.

**Tech Stack:** Modal, vLLM (StructuredOutputsParams), diffusers (Flux2KleinPipeline), Celery, asyncio, Pydantic, Alembic

**Spec:** `docs/superpowers/specs/2026-03-26-modal-pipeline-migration-design.md`

---

## File Map

### New Files

| File                                            | Responsibility                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `modal/app.py`                                  | Modal app definition, container images, volume                     |
| `modal/config.py`                               | Model IDs, GPU config, timeouts                                    |
| `modal/llm_extractor.py`                        | LLMExtractor class: extract_chapter + reduce_entities              |
| `modal/image_generator.py`                      | ImageGenerator class: FLUX.2 Klein generate                        |
| `modal/schemas.py`                              | Pydantic schemas for Modal LLM structured output                   |
| `backend/app/schemas/extraction.py`             | Shared dataclasses extracted from gemini_extractor.py              |
| `backend/app/services/modal_client.py`          | Modal helper: get_extractor(), get_generator(), response converter |
| `backend/app/models/usage_record.py`            | UsageRecord model for cost tracking                                |
| `backend/tests/services/test_modal_client.py`   | Tests for response converter                                       |
| `backend/tests/tasks/test_modal_integration.py` | Tests for Celery → Modal path                                      |
| `.github/workflows/modal-deploy.yml`            | CI/CD for Modal deployment                                         |

### Modified Files

| File                                          | Change                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `backend/app/services/gemini_extractor.py`    | Import dataclasses from shared `schemas/extraction.py` instead of defining locally |
| `backend/app/services/ner_service.py`         | Import dataclasses from shared `schemas/extraction.py`                             |
| `backend/app/tasks/book_tasks.py`             | Add Modal path behind `USE_MODAL_PIPELINE` flag (swap line ~442)                   |
| `backend/app/tasks/image_tasks.py`            | Add Modal path for on-demand + batch image generation                              |
| `backend/app/services/consistency_manager.py` | Replace OpenRouter `_single_reduce_pass()` with Modal `reduce_entities`            |
| `backend/app/models/feature_flag.py`          | Add `USE_MODAL_PIPELINE` default flag                                              |
| `backend/app/models/description.py`           | Add `image_prompt_en` column                                                       |
| `docker-compose.prod.yml`                     | Add `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` env vars                                |
| `backend/requirements.txt`                    | Add `modal`                                                                        |

---

## Task 1: Extract Shared Schemas

Move dataclasses from `gemini_extractor.py` to a shared module so both Gemini and Modal paths can use them without circular imports.

**Files:**

- Create: `backend/app/schemas/extraction.py`
- Create: `backend/app/schemas/__init__.py`
- Modify: `backend/app/services/gemini_extractor.py:114-211`
- Modify: `backend/app/services/ner_service.py` (imports)
- Test: existing tests must still pass

- [ ] **Step 1: Create shared schemas module**

Verify `backend/app/schemas/__init__.py` exists (directory already has files). Create `backend/app/schemas/extraction.py` with all dataclasses copied **verbatim** from `gemini_extractor.py`, plus Pydantic schemas for Modal (needed to generate JSON schema strings on VPS):

```python
# backend/app/schemas/extraction.py
"""Shared extraction dataclasses used by Gemini, Modal, and NER pipelines."""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from app.models.description import DescriptionType


@dataclass
class ExtractedEntity:
    name: str
    type: str  # character, location, object
    visual_summary: str
    aliases: List[str] = field(default_factory=list)
    confidence: float = 0.0
    importance: int = 0
    first_mention_offset: Optional[int] = None
    chapter_event_action: Optional[str] = None
    chapter_event_inner: Optional[str] = None


@dataclass
class ExtractedRelationship:
    source: str
    target: str
    type: str
    weight: float
    context: str = ""


@dataclass
class ExtractedDescription:
    content: str
    description_type: DescriptionType
    confidence: float
    entities: List[Dict[str, Any]] = field(default_factory=list)
    attributes: Dict[str, Any] = field(default_factory=dict)
    position: int = 0
    source_span: Tuple[int, int] = (0, 0)

    def to_dict(self) -> Dict[str, Any]:
        """Конвертация в формат Multi-NLP системы. VERBATIM from gemini_extractor.py:152-180."""
        entity_names = []
        for e in self.entities:
            if isinstance(e, dict):
                entity_names.append(e.get("name", ""))
            elif isinstance(e, str):
                entity_names.append(e)
            else:
                entity_names.append(str(e))
        return {
            "content": self.content,
            "type": self.description_type.value,
            "confidence_score": self.confidence,
            "priority_score": self._calculate_priority(),
            "source": "gemini_direct",
            "position": self.position,
            "word_count": len(self.content.split()),
            "entities_mentioned": entity_names,
            "metadata": {
                "llm_extracted": True, "entities": self.entities,
                "attributes": self.attributes, "source_span": self.source_span,
                "char_length": len(self.content),
            },
        }

    def _calculate_priority(self) -> float:
        """VERBATIM from gemini_extractor.py:182-202."""
        type_priority = {
            DescriptionType.LOCATION: 75, DescriptionType.CHARACTER: 60,
            DescriptionType.ATMOSPHERE: 45, DescriptionType.OBJECT: 50,
        }.get(self.description_type, 40)
        length = len(self.content)
        if 200 <= length <= 500: length_bonus = 15
        elif 100 <= length < 200: length_bonus = 10
        elif 500 < length <= 1000: length_bonus = 5
        else: length_bonus = 0
        confidence_bonus = self.confidence * 10
        return min(100.0, type_priority + length_bonus + confidence_bonus)


@dataclass
class ChapterAnalysisResult:
    descriptions: List[ExtractedDescription]
    entities: List[ExtractedEntity]
    relationships: List[ExtractedRelationship]


# --- Pydantic schemas for Modal structured output (also duplicated in modal/schemas.py) ---
from pydantic import BaseModel, Field

class ModalEntitySchema(BaseModel):
    name: str
    type: str = Field(default="character")
    visual_summary: str = Field(default="")
    aliases: List[str] = Field(default_factory=list)
    confidence: float = Field(default=1.0)
    importance: int = Field(default=5)
    first_mention_offset: Optional[int] = None
    chapter_event_action: Optional[str] = None
    chapter_event_inner: Optional[str] = None

class ModalDescriptionSchema(BaseModel):
    content: str
    type: str = Field(default="location")
    confidence: float = Field(default=1.0)
    entities: List[str] = Field(default_factory=list)
    text_offset: Optional[int] = None
    image_prompt_en: str = Field(default="", description="English image prompt, 30-60 words, SFW")

class ModalRelationshipSchema(BaseModel):
    source: str; target: str; type: str
    weight: float = Field(default=0.5); context: str = Field(default="")

class ModalExtractionResponse(BaseModel):
    descriptions: List[ModalDescriptionSchema]
    entities: List[ModalEntitySchema]
    relationships: List[ModalRelationshipSchema]

class ModalReduceResponse(BaseModel):
    merge_operations: List[dict] = Field(default_factory=list)
    delete_operations: List[dict] = Field(default_factory=list)
```

These Pydantic models serve two purposes:

1. **On VPS:** `ModalExtractionResponse.model_json_schema()` generates the JSON schema string passed to vLLM
2. **On Modal:** `modal/schemas.py` has the same models (duplicated, since Modal and VPS are separate runtimes)

- [ ] **Step 2: Update gemini_extractor.py imports**

In `backend/app/services/gemini_extractor.py`, replace the dataclass definitions (lines ~114-211) with imports:

```python
from app.schemas.extraction import (
    ChapterAnalysisResult,
    ExtractedDescription,
    ExtractedEntity,
    ExtractedRelationship,
)
```

Keep the Pydantic schemas (`GeminiEntitySchema`, `GeminiDescriptionSchema`, `GeminiResponseSchema`) in `gemini_extractor.py` — those are Gemini-specific.

- [ ] **Step 3: Update ner_service.py imports**

In `backend/app/services/ner_service.py`, change:

```python
# Before:
from app.services.gemini_extractor import ChapterAnalysisResult, ExtractedEntity, ExtractedDescription
# After:
from app.schemas.extraction import ChapterAnalysisResult, ExtractedEntity, ExtractedDescription
```

- [ ] **Step 4: Update all other imports**

Search for any file importing these dataclasses from `gemini_extractor` and update to `app.schemas.extraction`:

```bash
cd backend && grep -rn "from app.services.gemini_extractor import.*ExtractedEntity\|from app.services.gemini_extractor import.*ChapterAnalysisResult" --include="*.py"
```

Key files to check: `consistency_manager.py`, `book_tasks.py`, `description_extraction_service.py`, any test files. Note: `utility_tasks.py` imports the service instance `gemini_extractor` (not dataclasses) — no change needed there.

- [ ] **Step 5: Run all existing tests**

```bash
cd backend && uv run python -m pytest -v --tb=short 2>&1 | tail -30
```

Expected: All previously passing tests still pass. No import errors.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/ backend/app/services/gemini_extractor.py backend/app/services/ner_service.py
git commit -m "refactor: extract shared dataclasses to app.schemas.extraction"
```

---

## Task 2: Alembic Migrations

Add `image_prompt_en` column to descriptions, `usage_records` table, and `USE_MODAL_PIPELINE` feature flag.

**Files:**

- Modify: `backend/app/models/description.py`
- Create: `backend/app/models/usage_record.py`
- Modify: `backend/app/models/feature_flag.py`
- Create: Alembic migration file

- [ ] **Step 1: Add `image_prompt_en` to Description model**

In `backend/app/models/description.py`, add after `pipeline_version` (line ~105):

```python
    image_prompt_en: Mapped[str | None] = mapped_column(
        Text, nullable=True, default=None,
        comment="Pre-computed English image prompt from LLM extraction"
    )
```

- [ ] **Step 2: Create UsageRecord model**

Create `backend/app/models/usage_record.py`:

```python
"""Cost tracking for Modal GPU usage."""
from datetime import datetime
from typing import Optional

from sqlalchemy import Float, Integer, String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    chapter_idx: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)  # modal_llm, modal_image, openrouter
    operation: Mapped[str] = mapped_column(String(50), nullable=False)  # extract, reduce, generate_image
    gpu_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    tokens_in: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

- [ ] **Step 3: Add USE_MODAL_PIPELINE feature flag**

In `backend/app/models/feature_flag.py`, add to `DEFAULT_FEATURE_FLAGS` dict:

```python
"USE_MODAL_PIPELINE": {
    "name": "USE_MODAL_PIPELINE",
    "description": "Use Modal self-hosted LLM + image gen instead of OpenRouter",
    "enabled": False,
    "category": "infrastructure",
},
```

- [ ] **Step 4: Register UsageRecord in models **init\*\*\*\*

Add `from app.models.usage_record import UsageRecord` to `backend/app/models/__init__.py`.

- [ ] **Step 5: Generate Alembic migration**

```bash
cd backend && alembic revision --autogenerate -m "add image_prompt_en, usage_records, modal flag"
```

- [ ] **Step 6: Review and run migration**

```bash
cd backend && alembic upgrade head
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/ backend/alembic/versions/
git commit -m "feat: add image_prompt_en column, usage_records table, USE_MODAL_PIPELINE flag"
```

---

## Task 3: Modal App Scaffolding

Create the Modal app with config, container images, and shared volume.

**Files:**

- Create: `modal/app.py`
- Create: `modal/config.py`
- Create: `modal/__init__.py`

- [ ] **Step 1: Create modal/config.py**

```python
"""Modal pipeline configuration."""

# Models
LLM_MODEL_ID = "Qwen/Qwen3.5-9B"
IMAGE_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
VOLUME_PATH = "/models"
VOLUME_NAME = "fancai-models"

# GPU
LLM_GPU = "L4"
IMAGE_GPU = "L4"

# vLLM
MAX_MODEL_LEN = 65536
GPU_MEMORY_UTILIZATION = 0.90
KV_CACHE_DTYPE = "fp8"

# Timeouts
LLM_TIMEOUT = 600       # 10 min
IMAGE_TIMEOUT = 120      # 2 min
SCALEDOWN_WINDOW = 120   # 2 min idle before scale-to-zero

# Image generation
IMAGE_WIDTH = 768
IMAGE_HEIGHT = 768
IMAGE_NUM_STEPS = 4
IMAGE_GUIDANCE_SCALE = 1.0  # 1.0 for distilled Klein 4B
```

- [ ] **Step 2: Create modal/app.py**

```python
"""Modal app definition for fancai AI pipeline."""
import modal

from config import (
    VOLUME_NAME, VOLUME_PATH, LLM_GPU, IMAGE_GPU,
    SCALEDOWN_WINDOW, LLM_TIMEOUT, IMAGE_TIMEOUT,
)

app = modal.App("fancai-pipeline")

model_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

llm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("vllm>=0.18.0", "pydantic>=2.0")
)

diffusers_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("diffusers>=0.37", "torch>=2.5", "transformers>=4.45", "accelerate>=1.0")
)

# Shared config for both classes
COMMON_CLS_KWARGS = dict(
    volumes={VOLUME_PATH: model_volume},
    scaledown_window=SCALEDOWN_WINDOW,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
```

- [ ] **Step 3: Create empty modal/**init**.py**

- [ ] **Step 4: Verify Modal CLI works**

```bash
pip install modal && modal setup
```

Expected: Modal CLI installed, token configured.

- [ ] **Step 5: Commit**

```bash
git add modal/
git commit -m "feat: scaffold Modal app with config and container images"
```

---

## Task 4: Modal LLMExtractor

**Files:**

- Create: `modal/llm_extractor.py`
- Create: `modal/schemas.py`

- [ ] **Step 1: Create modal/schemas.py**

Pydantic schemas for Modal LLM structured output. Must match fields that `gemini_extractor.py` returns so the converter can map them to shared dataclasses.

```python
"""Pydantic schemas for Modal LLM structured output."""
from typing import List, Optional
from pydantic import BaseModel, Field


class ModalEntitySchema(BaseModel):
    name: str
    type: str = Field(default="character", description="character, location, object")
    visual_summary: str = Field(default="")
    aliases: List[str] = Field(default_factory=list)
    confidence: float = Field(default=1.0)
    importance: int = Field(default=5)
    first_mention_offset: Optional[int] = None
    chapter_event_action: Optional[str] = None
    chapter_event_inner: Optional[str] = None


class ModalDescriptionSchema(BaseModel):
    content: str
    type: str = Field(default="location")
    confidence: float = Field(default=1.0)
    entities: List[str] = Field(default_factory=list)
    text_offset: Optional[int] = None
    image_prompt_en: str = Field(
        default="",
        description="English image prompt, 30-60 words, visual details only, SFW"
    )


class ModalRelationshipSchema(BaseModel):
    source: str
    target: str
    type: str
    weight: float = Field(default=0.5)
    context: str = Field(default="")


class ModalExtractionResponse(BaseModel):
    descriptions: List[ModalDescriptionSchema]
    entities: List[ModalEntitySchema]
    relationships: List[ModalRelationshipSchema]


class ModalReduceResponse(BaseModel):
    merge_operations: List[dict] = Field(default_factory=list)
    delete_operations: List[dict] = Field(default_factory=list)
```

- [ ] **Step 2: Create modal/llm_extractor.py**

```python
"""LLM Extractor — Qwen3.5-9B on vLLM for entity/description extraction."""
import json

import modal

from app import app, llm_image, model_volume, COMMON_CLS_KWARGS
from config import (
    LLM_MODEL_ID, VOLUME_PATH, LLM_GPU, LLM_TIMEOUT,
    MAX_MODEL_LEN, GPU_MEMORY_UTILIZATION, KV_CACHE_DTYPE,
)


@app.cls(
    image=llm_image,
    gpu=LLM_GPU,
    timeout=LLM_TIMEOUT,
    **COMMON_CLS_KWARGS,
)
class LLMExtractor:
    @modal.enter()
    def load_model(self):
        from vllm import LLM
        self.llm = LLM(
            model=LLM_MODEL_ID,
            download_dir=VOLUME_PATH,
            max_model_len=MAX_MODEL_LEN,
            gpu_memory_utilization=GPU_MEMORY_UTILIZATION,
            kv_cache_dtype=KV_CACHE_DTYPE,
            dtype="bfloat16",
            enable_prefix_caching=True,
            chat_template_kwargs={"enable_thinking": False},
        )

    @modal.method()
    def extract_chapter(self, chapter_text: str, system_prompt: str,
                        schema_json: str) -> dict:
        """Extract entities, descriptions, relationships from one chapter."""
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams

        params = SamplingParams(
            max_tokens=8192,
            temperature=0.1,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"<book_text>{chapter_text}</book_text>"},
        ]
        result = self.llm.chat(messages, params)
        return json.loads(result[0].outputs[0].text)

    @modal.method()
    def reduce_entities(self, entities_json: str, system_prompt: str,
                        schema_json: str) -> dict:
        """Entity deduplication — merge duplicates."""
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams

        params = SamplingParams(
            max_tokens=4096,
            temperature=0.0,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": entities_json},
        ]
        result = self.llm.chat(messages, params)
        return json.loads(result[0].outputs[0].text)
```

- [ ] **Step 3: Deploy and test LLM on Modal**

```bash
cd modal && modal deploy app.py
```

Then test with a simple chapter:

```bash
modal run llm_extractor.py::LLMExtractor.extract_chapter \
  --chapter-text "Геральт стоял у окна таверны." \
  --system-prompt "Extract entities and descriptions as JSON." \
  --schema-json '{"type":"object","properties":{"entities":{"type":"array"},"descriptions":{"type":"array"},"relationships":{"type":"array"}}}'
```

Expected: JSON response with entities/descriptions. Note cold start time.

- [ ] **Step 4: Commit**

```bash
git add modal/
git commit -m "feat: add Modal LLMExtractor with vLLM StructuredOutputsParams"
```

---

## Task 5: Modal ImageGenerator

**Files:**

- Create: `modal/image_generator.py`

- [ ] **Step 1: Create modal/image_generator.py**

```python
"""Image Generator — FLUX.2 Klein 4B on diffusers."""
import io

import modal

from app import app, diffusers_image, COMMON_CLS_KWARGS
from config import (
    IMAGE_MODEL_ID, VOLUME_PATH, IMAGE_GPU, IMAGE_TIMEOUT,
    IMAGE_WIDTH, IMAGE_HEIGHT, IMAGE_NUM_STEPS, IMAGE_GUIDANCE_SCALE,
)


@app.cls(
    image=diffusers_image,
    gpu=IMAGE_GPU,
    timeout=IMAGE_TIMEOUT,
    **COMMON_CLS_KWARGS,
)
class ImageGenerator:
    @modal.enter()
    def load_model(self):
        from diffusers import Flux2KleinPipeline
        import torch

        self.pipe = Flux2KleinPipeline.from_pretrained(
            IMAGE_MODEL_ID,
            torch_dtype=torch.bfloat16,
            cache_dir=VOLUME_PATH,
        ).to("cuda")

    @modal.method()
    def generate(self, prompt: str, width: int = IMAGE_WIDTH,
                 height: int = IMAGE_HEIGHT, num_steps: int = IMAGE_NUM_STEPS) -> bytes:
        """Generate one image, return PNG bytes."""
        image = self.pipe(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=num_steps,
            guidance_scale=IMAGE_GUIDANCE_SCALE,
        ).images[0]

        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()
```

- [ ] **Step 2: Deploy and test image generation**

```bash
cd modal && modal deploy app.py
modal run image_generator.py::ImageGenerator.generate \
  --prompt "A medieval tavern interior, warm candlelight, wooden tables, fantasy illustration"
```

Expected: PNG bytes returned. Verify by saving to file and opening:

```python
# Quick test script
import modal
cls = modal.Cls.from_name("fancai-pipeline", "ImageGenerator")
gen = cls()
img_bytes = gen.generate.remote(prompt="A medieval tavern, fantasy illustration")
with open("/tmp/test_modal_image.png", "wb") as f:
    f.write(img_bytes)
print(f"Image saved: {len(img_bytes)} bytes")
```

- [ ] **Step 3: Commit**

```bash
git add modal/image_generator.py
git commit -m "feat: add Modal ImageGenerator with Flux2KleinPipeline"
```

---

## Task 6: VPS Modal Client & Response Converter

Bridge between Modal JSON responses and existing dataclasses.

**Files:**

- Create: `backend/app/services/modal_client.py`
- Create: `backend/tests/services/test_modal_client.py`

- [ ] **Step 1: Write failing tests for response converter**

Create `backend/tests/services/test_modal_client.py`:

```python
"""Tests for Modal client response converter."""
import pytest

from app.models.description import DescriptionType
from app.schemas.extraction import (
    ChapterAnalysisResult, ExtractedDescription, ExtractedEntity, ExtractedRelationship,
)
from app.services.modal_client import modal_response_to_chapter_result


class TestModalResponseConverter:
    def test_converts_entities(self):
        modal_json = {
            "entities": [
                {"name": "Geralt", "type": "character", "visual_summary": "White-haired witcher",
                 "aliases": ["Butcher of Blaviken"], "confidence": 0.95, "importance": 9}
            ],
            "descriptions": [],
            "relationships": [],
        }
        result = modal_response_to_chapter_result(modal_json)
        assert isinstance(result, ChapterAnalysisResult)
        assert len(result.entities) == 1
        assert result.entities[0].name == "Geralt"
        assert result.entities[0].type == "character"
        assert result.entities[0].aliases == ["Butcher of Blaviken"]

    def test_converts_descriptions(self):
        modal_json = {
            "entities": [],
            "descriptions": [
                {"content": "Тёмная таверна с дубовыми столами", "type": "location",
                 "confidence": 0.9, "entities": ["Geralt"],
                 "image_prompt_en": "Dark tavern with oak tables, medieval fantasy"}
            ],
            "relationships": [],
        }
        result = modal_response_to_chapter_result(modal_json)
        assert len(result.descriptions) == 1
        desc = result.descriptions[0]
        assert desc.content == "Тёмная таверна с дубовыми столами"
        assert desc.description_type == DescriptionType.LOCATION

    def test_converts_relationships(self):
        modal_json = {
            "entities": [],
            "descriptions": [],
            "relationships": [
                {"source": "Geralt", "target": "Yennefer", "type": "romantic",
                 "weight": 0.8, "context": "Long-standing relationship"}
            ],
        }
        result = modal_response_to_chapter_result(modal_json)
        assert len(result.relationships) == 1
        assert result.relationships[0].source == "Geralt"

    def test_handles_empty_response(self):
        result = modal_response_to_chapter_result(
            {"entities": [], "descriptions": [], "relationships": []}
        )
        assert result.entities == []
        assert result.descriptions == []
        assert result.relationships == []

    def test_handles_missing_optional_fields(self):
        modal_json = {
            "entities": [{"name": "Tavern", "type": "location", "visual_summary": ""}],
            "descriptions": [{"content": "Text", "type": "atmosphere", "confidence": 0.5,
                              "entities": []}],
            "relationships": [],
        }
        result = modal_response_to_chapter_result(modal_json)
        assert result.entities[0].chapter_event_action is None
        assert result.descriptions[0].description_type == DescriptionType.ATMOSPHERE

    def test_description_type_mapping(self):
        """All DescriptionType values must be handled."""
        for dtype in ["location", "character", "atmosphere", "object", "action"]:
            modal_json = {
                "entities": [],
                "descriptions": [{"content": "x", "type": dtype, "confidence": 0.5, "entities": []}],
                "relationships": [],
            }
            result = modal_response_to_chapter_result(modal_json)
            assert result.descriptions[0].description_type.value == dtype
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && uv run python -m pytest tests/services/test_modal_client.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.services.modal_client'`

- [ ] **Step 3: Implement modal_client.py**

Create `backend/app/services/modal_client.py`:

```python
"""Modal client helpers — response converter and lazy references."""
import logging
import time
from typing import Any, Dict, Optional

from app.models.description import DescriptionType
from app.schemas.extraction import (
    ChapterAnalysisResult,
    ExtractedDescription,
    ExtractedEntity,
    ExtractedRelationship,
)

logger = logging.getLogger(__name__)

# Conditional import — Modal SDK not required for tests or local dev
try:
    import modal
    MODAL_AVAILABLE = True
except ImportError:
    modal = None  # type: ignore
    MODAL_AVAILABLE = False

# Description type string → enum mapping
_DESCRIPTION_TYPE_MAP = {dt.value: dt for dt in DescriptionType}


def get_llm_extractor():
    """Lazy reference to deployed Modal LLMExtractor."""
    if not MODAL_AVAILABLE:
        raise RuntimeError("Modal SDK not installed")
    cls = modal.Cls.from_name("fancai-pipeline", "LLMExtractor")
    return cls()


def get_image_generator():
    """Lazy reference to deployed Modal ImageGenerator."""
    if not MODAL_AVAILABLE:
        raise RuntimeError("Modal SDK not installed")
    cls = modal.Cls.from_name("fancai-pipeline", "ImageGenerator")
    return cls()


def modal_response_to_chapter_result(modal_json: Dict[str, Any]) -> ChapterAnalysisResult:
    """Convert Modal LLM JSON response to ChapterAnalysisResult dataclass.

    The Modal LLM returns JSON matching ModalExtractionResponse schema.
    This function converts it to the existing dataclass structure used by
    ConsistencyManager, book_tasks, and the rest of the pipeline.
    """
    entities = [
        ExtractedEntity(
            name=e.get("name", ""),
            type=e.get("type", "character"),
            visual_summary=e.get("visual_summary", ""),
            aliases=e.get("aliases", []),
            confidence=e.get("confidence", 0.0),
            importance=e.get("importance", 0),
            first_mention_offset=e.get("first_mention_offset"),
            chapter_event_action=e.get("chapter_event_action"),
            chapter_event_inner=e.get("chapter_event_inner"),
        )
        for e in modal_json.get("entities", [])
    ]

    descriptions = [
        ExtractedDescription(
            content=d.get("content", ""),
            description_type=_DESCRIPTION_TYPE_MAP.get(
                d.get("type", "location"), DescriptionType.LOCATION
            ),
            confidence=d.get("confidence", 0.0),
            entities=[{"name": name} for name in d.get("entities", [])],
            position=d.get("text_offset", 0) or 0,
        )
        for d in modal_json.get("descriptions", [])
    ]

    relationships = [
        ExtractedRelationship(
            source=r.get("source", ""),
            target=r.get("target", ""),
            type=r.get("type", ""),
            weight=r.get("weight", 0.5),
            context=r.get("context", ""),
        )
        for r in modal_json.get("relationships", [])
    ]

    return ChapterAnalysisResult(
        descriptions=descriptions,
        entities=entities,
        relationships=relationships,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && uv run python -m pytest tests/services/test_modal_client.py -v
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/modal_client.py backend/tests/services/test_modal_client.py
git commit -m "feat: add Modal response converter with tests"
```

---

## Task 7: Integrate Modal into book_tasks.py

The critical integration point — swap `gemini_extractor.analyze_chapter()` call.

**Files:**

- Modify: `backend/app/tasks/book_tasks.py:~280-285,~426-444`
- Create: `backend/tests/tasks/test_modal_integration.py`

- [ ] **Step 1: Write failing integration test**

Create `backend/tests/tasks/test_modal_integration.py`:

```python
"""Tests for Modal integration in book_tasks."""
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.schemas.extraction import ChapterAnalysisResult, ExtractedEntity
from app.services.modal_client import modal_response_to_chapter_result


class TestModalBookTaskIntegration:
    def test_modal_response_produces_valid_chapter_result(self):
        """Modal JSON → ChapterAnalysisResult → works with ConsistencyManager interface."""
        modal_json = {
            "entities": [
                {"name": "Геральт", "type": "character",
                 "visual_summary": "Седовласый ведьмак",
                 "aliases": ["Ведьмак", "Мясник из Блавикена"],
                 "confidence": 0.95, "importance": 9,
                 "chapter_event_action": "Вошёл в таверну",
                 "chapter_event_inner": "Настороженность"}
            ],
            "descriptions": [
                {"content": "Тёмная таверна", "type": "location",
                 "confidence": 0.9, "entities": ["Геральт"],
                 "image_prompt_en": "Dark medieval tavern, candlelight, SFW"}
            ],
            "relationships": [
                {"source": "Геральт", "target": "Таверна", "type": "located_in",
                 "weight": 0.7, "context": "Геральт вошёл в таверну"}
            ],
        }
        result = modal_response_to_chapter_result(modal_json)

        # Verify it has all fields ConsistencyManager expects
        assert isinstance(result, ChapterAnalysisResult)
        entity = result.entities[0]
        assert entity.name == "Геральт"
        assert entity.chapter_event_action == "Вошёл в таверну"
        assert entity.chapter_event_inner == "Настороженность"

        desc = result.descriptions[0]
        assert desc.to_dict()["type"] == "location"
        assert desc.to_dict()["word_count"] > 0
```

- [ ] **Step 2: Run test**

```bash
cd backend && uv run python -m pytest tests/tasks/test_modal_integration.py -v
```

Expected: PASS.

- [ ] **Step 3: Add Modal path to book_tasks.py**

In `backend/app/tasks/book_tasks.py`, add at the top (after existing imports):

```python
from app.services.modal_client import MODAL_AVAILABLE, get_llm_extractor, modal_response_to_chapter_result
```

Near line ~282 (where `use_gliner` is set), add:

```python
use_modal = await flag_manager.is_enabled("USE_MODAL_PIPELINE", default=False)
```

Replace the extraction block at lines ~426-444:

```python
# Before:
if use_gliner and ner_service:
    ner_result = await asyncio.to_thread(
        ner_service.extract_chapter,
        local_chapter.content,
        settings_mgr,
    )
    result = ner_result
else:
    result = await gemini_extractor.analyze_chapter(
        local_chapter.content
    )

# After:
if use_modal and MODAL_AVAILABLE:
    extractor = get_llm_extractor()
    modal_json = await asyncio.to_thread(
        extractor.extract_chapter.remote,
        chapter_text=local_chapter.content,
        system_prompt=EXTRACTION_SYSTEM_PROMPT,
        schema_json=EXTRACTION_SCHEMA_JSON,
    )
    result = modal_response_to_chapter_result(modal_json)
elif use_gliner and ner_service:
    ner_result = await asyncio.to_thread(
        ner_service.extract_chapter,
        local_chapter.content,
        settings_mgr,
    )
    result = ner_result
else:
    result = await gemini_extractor.analyze_chapter(
        local_chapter.content
    )
```

- [ ] **Step 4: Create extraction prompt constants**

Create `backend/app/prompts/modal_extraction.py`:

```python
"""Prompts and schemas for Modal LLM extraction."""
import json

from app.schemas.extraction import ModalExtractionResponse, ModalReduceResponse

# JSON schema string for vLLM StructuredOutputsParams
EXTRACTION_SCHEMA_JSON = json.dumps(ModalExtractionResponse.model_json_schema())
REDUCE_SCHEMA_JSON = json.dumps(ModalReduceResponse.model_json_schema())

# System prompt adapted from gemini_extractor.py (lines ~250-400)
# Copy the existing ANALYSIS_SYSTEM_PROMPT from gemini_extractor.py and add image_prompt_en instruction.
# The implementer MUST read gemini_extractor.py lines 250-400 and adapt the prompt.
EXTRACTION_SYSTEM_PROMPT = """You are a literary analysis AI. Analyze the book chapter text and extract:

1. **entities** — characters, locations, objects with names, types, visual descriptions, aliases, importance (1-10), events
2. **descriptions** — visual scenes suitable for illustration with type (location/character/atmosphere/object/action)
3. **relationships** — connections between entities with type and weight

For each description, also generate `image_prompt_en` — a concise English prompt (30-60 words) optimized for image generation. Focus on visual details: appearance, pose, setting, lighting, mood. Do NOT include character names in image_prompt_en. Must be SFW, safe for work.

Respond with valid JSON matching the provided schema. Text is in Russian — extract entities with original Russian names."""
```

Then in `book_tasks.py`, import:

```python
from app.prompts.modal_extraction import EXTRACTION_SYSTEM_PROMPT, EXTRACTION_SCHEMA_JSON
```

- [ ] **Step 5: Run all tests**

```bash
cd backend && uv run python -m pytest -v --tb=short 2>&1 | tail -30
```

Expected: All tests pass. No regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/app/tasks/book_tasks.py
git commit -m "feat: integrate Modal LLM extraction in book_tasks behind feature flag"
```

---

## Task 8: Integrate Modal into image_tasks.py

**Files:**

- Modify: `backend/app/tasks/image_tasks.py:~111-238,~318-432`

- [ ] **Step 1: Add Modal path to \_generate_image_async()**

In `backend/app/tasks/image_tasks.py`, add imports:

```python
from app.services.modal_client import MODAL_AVAILABLE, get_image_generator
```

Inside `_generate_image_async()` (line ~144), before `imagen_service.generate_image()`:

```python
# Check for Modal path
use_modal = False
if MODAL_AVAILABLE:
    async with AsyncSessionLocal() as db:
        flag_mgr = FeatureFlagManager(db)
        await flag_mgr.initialize()
        use_modal = await flag_mgr.is_enabled("USE_MODAL_PIPELINE", default=False)

if use_modal:
    # Use pre-computed image_prompt_en if available, otherwise translate on VPS
    prompt_en = None
    if description_id:
        async with AsyncSessionLocal() as db:
            desc = await db.get(DescriptionModel, description_id)
            if desc and desc.image_prompt_en:
                prompt_en = desc.image_prompt_en

    if not prompt_en:
        # Fallback: translate Russian text using existing PromptTranslator
        imagen_service = get_imagen_service()
        prompt_en = await imagen_service._prompt_engineer.create_prompt(
            description=description_content,
            description_type=description_type,
            genre=book_genre,
            custom_style=custom_style,
        )

    generator = get_image_generator()
    image_bytes = await asyncio.to_thread(
        generator.generate.remote, prompt=prompt_en
    )
    # Save image to disk (reuse existing _save_image pattern from imagen_generator.py)
    import hashlib, time
    from pathlib import Path
    filename = f"flux_{int(time.time())}_{hashlib.md5(prompt_en.encode()).hexdigest()[:8]}.png"
    storage_dir = Path("/app/storage/generated_images")
    storage_dir.mkdir(parents=True, exist_ok=True)
    local_path = storage_dir / filename
    local_path.write_bytes(image_bytes)

    generation_result = ImageGenerationResult(
        success=True, image_url=f"/api/v1/images/file/{filename}",
        local_path=str(local_path), prompt_used=prompt_en,
    )
else:
    generation_result = await imagen_service.generate_image(
        description=description_content, ...)
```

- [ ] **Step 2: Add Modal path to batch generation**

In `_generate_batch_async()` (line ~404), remove the `await asyncio.sleep(2)` rate-limiting when using Modal (no API rate limits).

- [ ] **Step 3: Run existing image tests**

```bash
cd backend && uv run python -m pytest tests/tasks/ -v -k "image" --tb=short
```

Expected: Existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add backend/app/tasks/image_tasks.py
git commit -m "feat: integrate Modal ImageGenerator in image_tasks behind feature flag"
```

---

## Task 9: Integrate Modal into ConsistencyManager

Replace OpenRouter `_single_reduce_pass()` with Modal `reduce_entities()`.

**Files:**

- Modify: `backend/app/services/consistency_manager.py:~554-624`

- [ ] **Step 1: Add Modal path to \_single_reduce_pass()**

In `consistency_manager.py`, add imports:

```python
from app.services.modal_client import MODAL_AVAILABLE, get_llm_extractor
```

Modify `_single_reduce_pass()` (line ~615) to branch on Modal:

```python
async def _single_reduce_pass(self, entities: list) -> dict:
    # ... existing entity_list_text formatting (lines 567-573) ...
    # ... existing REDUCE_PROMPT (lines 575-613) ...

    use_modal = False
    if MODAL_AVAILABLE:
        async with AsyncSessionLocal() as db:
            flag_mgr = FeatureFlagManager(db)
            await flag_mgr.initialize()
            use_modal = await flag_mgr.is_enabled("USE_MODAL_PIPELINE", default=False)

    if use_modal:
        import asyncio
        import json
        extractor = get_llm_extractor()
        reduce_schema = json.dumps(ModalReduceResponse.model_json_schema())
        raw_json = await asyncio.to_thread(
            extractor.reduce_entities.remote,
            entities_json=entity_list_text,
            system_prompt="Respond ONLY with valid JSON, no markdown.",
            schema_json=reduce_schema,
        )
        return raw_json  # already dict from Modal
    else:
        openrouter = get_openrouter_client()
        raw_text = await openrouter.generate_text(
            prompt=REDUCE_PROMPT,
            system_prompt="Respond ONLY with valid JSON, no markdown.",
            temperature=0.1,
        )
        plan: dict = parse_json_safe(raw_text)
        return plan
```

- [ ] **Step 2: Run existing consistency manager tests**

```bash
cd backend && uv run python -m pytest tests/ -v -k "consistency" --tb=short
```

Expected: Existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/consistency_manager.py
git commit -m "feat: route ConsistencyManager reduce through Modal LLM"
```

---

## Task 10: VPS Configuration

**Files:**

- Modify: `docker-compose.prod.yml`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add modal to requirements.txt**

```bash
echo "modal>=0.73" >> backend/requirements.txt
```

- [ ] **Step 2: Add Modal env vars to docker-compose.prod.yml**

In `docker-compose.prod.yml`, add to the celery-worker `environment` section:

```yaml
MODAL_TOKEN_ID: ${MODAL_TOKEN_ID}
MODAL_TOKEN_SECRET: ${MODAL_TOKEN_SECRET}
```

- [ ] **Step 3: Add Modal tokens to VPS .env**

SSH to VPS and add:

```bash
# On VPS: add to /app/.env
MODAL_TOKEN_ID=ak-...
MODAL_TOKEN_SECRET=as-...
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml backend/requirements.txt
git commit -m "chore: add modal SDK dependency and env vars"
```

---

## Task 11: CI/CD for Modal

**Files:**

- Create: `.github/workflows/modal-deploy.yml`

- [ ] **Step 1: Create GitHub Actions workflow**

```yaml
# .github/workflows/modal-deploy.yml
name: Deploy Modal Pipeline
on:
  push:
    branches: [main]
    paths: ["modal/**"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install modal
      - run: cd modal && modal deploy app.py
        env:
          MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}
          MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }}
```

- [ ] **Step 2: Add Modal secrets to GitHub repo**

```
GitHub → Settings → Secrets → Actions:
  MODAL_TOKEN_ID: ak-...
  MODAL_TOKEN_SECRET: as-...
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/modal-deploy.yml
git commit -m "ci: add Modal deployment workflow"
```

---

## Task 12: Smoke Test

Validate Modal output quality against current Gemini baseline.

**Files:**

- Create: `backend/scripts/modal_smoke_test.py`

- [ ] **Step 1: Create smoke test script**

```python
"""Smoke test: compare Modal Qwen3.5-9B extraction vs production Gemini output."""
import asyncio
import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.modal_client import get_llm_extractor, modal_response_to_chapter_result
from app.prompts.modal_extraction import EXTRACTION_SYSTEM_PROMPT, EXTRACTION_SCHEMA_JSON
from app.core.database import AsyncSessionLocal
from app.models.chapter import Chapter
from sqlalchemy import select


async def run_smoke_test(book_id: str, num_chapters: int = 3):
    """Run Modal extraction on N chapters and compare with production data."""
    extractor = get_llm_extractor()

    async with AsyncSessionLocal() as db:
        chapters = (await db.execute(
            select(Chapter).where(Chapter.book_id == book_id)
            .order_by(Chapter.position).limit(num_chapters)
        )).scalars().all()

    print(f"Testing {len(chapters)} chapters from book {book_id}")

    for ch in chapters:
        print(f"\n--- Chapter {ch.position}: {ch.title or 'Untitled'} ---")
        print(f"  Text length: {len(ch.content)} chars")

        # Call Modal
        import time
        start = time.time()
        modal_json = extractor.extract_chapter.remote(
            chapter_text=ch.content,
            system_prompt=EXTRACTION_SYSTEM_PROMPT,
            schema_json=EXTRACTION_SCHEMA_JSON,
        )
        elapsed = time.time() - start

        result = modal_response_to_chapter_result(modal_json)
        print(f"  Time: {elapsed:.1f}s")
        print(f"  Entities: {len(result.entities)}")
        print(f"  Descriptions: {len(result.descriptions)}")
        print(f"  Relationships: {len(result.relationships)}")

        for e in result.entities[:5]:
            print(f"    Entity: {e.name} ({e.type}) importance={e.importance}")

        for d in result.descriptions[:3]:
            print(f"    Desc: {d.content[:80]}...")

    print("\n=== Smoke test complete ===")


if __name__ == "__main__":
    book_id = sys.argv[1] if len(sys.argv) > 1 else "YOUR_BOOK_ID"
    asyncio.run(run_smoke_test(book_id))
```

- [ ] **Step 2: Run smoke test on Vedmak**

```bash
cd backend && uv run python scripts/modal_smoke_test.py <VEDMAK_BOOK_ID>
```

Expected: Entities and descriptions extracted. Compare manually with production data.

**Acceptance criteria:**

- > = 85% entity recall vs production
- 100% JSON compliance (no parsing errors)
- `image_prompt_en` present on descriptions (manual quality check)

- [ ] **Step 3: Document results**

Create `docs/research/modal-smoke-test-results.md` with findings.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/modal_smoke_test.py docs/research/modal-smoke-test-results.md
git commit -m "test: add Modal smoke test script and initial results"
```

---

## Task 13: Enable & Deploy

- [ ] **Step 1: Deploy Modal app to production**

```bash
cd modal && modal deploy app.py
```

- [ ] **Step 2: Deploy VPS with Modal SDK**

```bash
/deploy  # existing deploy skill
```

- [ ] **Step 3: Enable feature flag**

```sql
UPDATE feature_flags SET enabled = true WHERE name = 'USE_MODAL_PIPELINE';
```

- [ ] **Step 4: Process one test book**

Upload a book and monitor:

- Celery logs: `/logs celery 100`
- Modal dashboard: check GPU utilization
- DB: verify entities/descriptions created

- [ ] **Step 5: Verify cost tracking**

```sql
SELECT provider, operation, SUM(gpu_seconds), SUM(estimated_cost_usd)
FROM usage_records GROUP BY provider, operation;
```

---

## Task 14: Cleanup (after A/B test passes)

Only execute after Mini A/B (2-3 books) confirms quality.

- [ ] **Step 1: Remove OpenRouter dependency**

Delete files:

- `backend/app/core/openrouter_client.py`
- `backend/app/services/imagen_generator.py` (keep `ImagenPromptEngineer` if used for fallback)
- Remove `OPENROUTER_API_KEY` from docker-compose.prod.yml
- Remove `openai` from requirements.txt

- [ ] **Step 2: Remove GLiNER2 from Celery Docker**

In `Dockerfile.celery`, remove PyTorch CPU and GLiNER2 dependencies (~250MB savings).
Remove `backend/app/services/ner_service.py` or keep as dead code.

- [ ] **Step 3: Remove old feature flags**

```sql
DELETE FROM feature_flags WHERE name IN ('USE_GLINER_NER', 'USE_DESCRIPTION_CLASSIFIER', 'USE_HYBRID_PIPELINE', 'USE_PGVECTOR_EMBEDDINGS');
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: remove OpenRouter dependency and legacy NLP pipeline"
```
