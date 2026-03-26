# Modal AI Pipeline Migration — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Scope:** Full migration of AI pipeline (LLM extraction + image generation) from OpenRouter to Modal self-hosted
**Based on:** 7 research documents in `docs/research/modal-*`, `docs/research/gpu-*`

---

## 1. Executive Summary

Migrate the entire fancai AI pipeline from OpenRouter (Gemini 3.0 Flash + FLUX.2 Klein) to Modal self-hosted (Qwen3.5-9B + FLUX.2 Klein). Big Bang approach — both LLM and images in a single deployment.

**Cost impact:** $6.13/book → $0.45-1.34/book (78-93% savings). Includes ~$0.06/session idle cost (scaledown_window=120s × 2 containers).
**Books/month on $30 free tier:** ~5 → 20-60 (accounting for ~$2.50/month idle overhead)

### Key Decisions

| Decision              | Choice                      | Rationale                                                                                                                                                             |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM model             | Qwen3.5-9B (BF16, L4)       | Fits L4 with ~3.6GB usable headroom (gpu_memory_utilization=0.90), 91.5 IFEval, no MoE bugs. Gated DeltaNet: only 8/32 layers use KV cache → 65K+ context easily fits |
| Backup LLM            | Qwen3.5-35B-A3B (GPTQ-Int4) | Test if 9B quality insufficient                                                                                                                                       |
| Image model           | FLUX.2 Klein 4B (L4)        | Same as current, 53x cheaper self-hosted                                                                                                                              |
| Character consistency | Deferred                    | Add later as premium feature                                                                                                                                          |
| KV cache              | FP8 dtype                   | 64K context on L4 (conservative; up to 128K possible)                                                                                                                 |
| Fallback              | None                        | Modal only, no OpenRouter fallback                                                                                                                                    |
| Image storage (R2)    | Deferred                    | VPS disk sufficient for now                                                                                                                                           |
| Monetization          | Deferred                    | Research credit-based vs subscription later                                                                                                                           |
| Translation           | In extraction schema        | `image_prompt_en` field, single LLM call                                                                                                                              |
| Migration approach    | Big Bang                    | One deployment, feature flag for rollback                                                                                                                             |
| v1.4 phases 31-32     | Cancelled                   | Modal LLM replaces classifier + pgvector                                                                                                                              |

---

## 2. Architecture

### Target State

```
VPS (fancai.ru)                          Modal (US region)
+---------------------+                  +--------------------------+
| FastAPI              |                  | fancai-pipeline app      |
| Celery Worker        |                  |                          |
|                      |  .remote()       | +----------------------+ |
| book_tasks.py -------+---------------->| | LLMExtractor (cls)   | |
|   process_book()     |  JSON result     | | Qwen3.5-9B, L4 GPU   | |
| <--------------------+----------------<| | vLLM + FP8 KV cache  | |
|                      |                  | +----------------------+ |
|                      |  .remote()       |                          |
| image_tasks.py ------+---------------->| +----------------------+ |
|   generate_image()   |  bytes result    | | ImageGenerator (cls)  | |
| <--------------------+----------------<| | FLUX.2 Klein 4B, L4  | |
|                      |                  | | diffusers pipeline    | |
| PostgreSQL (local)   |                  | +----------------------+ |
| Redis (local)        |                  |                          |
| /app/storage/images/ |                  | Modal Volume (weights)   |
+---------------------+                  +--------------------------+
```

### Design Principles

1. **Two separate `@app.cls()` on Modal** — LLM and Image Gen scale independently
2. **Celery -> Modal synchronous** — `modal.Function.from_name().remote()` blocks Celery worker
3. **Modal -> VPS via return values only** — JSON (<50KB) and bytes (<500KB). PostgreSQL not exposed
4. **Single Modal app** — `fancai-pipeline` with two classes, one deploy command
5. **Shared Modal Volume** — model weights (~26GB total: 18GB Qwen + 8GB FLUX)
6. **Scale-to-zero** — both classes shut down after 5 min idle. GPU snapshot for fast cold start

---

## 3. Modal App Design

### File Structure

```
modal/
+-- app.py              # Modal app definition, shared config
+-- llm_extractor.py    # LLMExtractor class (Qwen3.5-9B + vLLM)
+-- image_generator.py  # ImageGenerator class (FLUX.2 Klein + diffusers)
+-- schemas.py          # Pydantic schemas (shared with backend)
+-- config.py           # Model paths, GPU config, timeouts
```

### Container Images

Two separate images — LLM and Image Gen have different dependencies:

```python
llm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("vllm>=0.18.0", "pydantic>=2.0")
)

diffusers_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("diffusers>=0.37", "torch>=2.5", "transformers", "accelerate")
)
```

### LLMExtractor Class

```python
MODEL_ID = "Qwen/Qwen3.5-9B"
VOLUME_PATH = "/models"
model_volume = modal.Volume.from_name("fancai-models", create_if_missing=True)

@app.cls(
    image=llm_image,
    gpu="L4",
    volumes={VOLUME_PATH: model_volume},
    scaledown_window=120,                                    # 2 min idle (saves ~$2.40/month vs 300s)
    timeout=600,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},       # GPU memory snapshot (alpha)
)
class LLMExtractor:
    @modal.enter()
    def load_model(self):
        from vllm import LLM
        self.llm = LLM(
            model=MODEL_ID,
            download_dir=VOLUME_PATH,
            max_model_len=65536,
            gpu_memory_utilization=0.90,
            kv_cache_dtype="fp8",
            dtype="bfloat16",
            enable_prefix_caching=True,
            # NOTE: reasoning_parser omitted — unnecessary with enable_thinking=False
            chat_template_kwargs={"enable_thinking": False},
        )

    @modal.method()
    def extract_chapter(self, chapter_text: str, system_prompt: str,
                        schema_json: str) -> dict:
        """Extract entities/descriptions from one chapter."""
        import json
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
        """Entity deduplication (replaces OpenRouter in ConsistencyManager)."""
        import json
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams
        params = SamplingParams(
            max_tokens=4096, temperature=0.0,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": entities_json},
        ]
        result = self.llm.chat(messages, params)
        return json.loads(result[0].outputs[0].text)
```

### ImageGenerator Class

```python
FLUX_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"

@app.cls(
    image=diffusers_image,
    gpu="L4",
    volumes={VOLUME_PATH: model_volume},
    scaledown_window=120,                                    # 2 min idle
    timeout=120,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
class ImageGenerator:
    @modal.enter()
    def load_model(self):
        from diffusers import Flux2KleinPipeline              # NOT FluxPipeline (FLUX.1)
        import torch
        self.pipe = Flux2KleinPipeline.from_pretrained(
            FLUX_MODEL_ID,
            torch_dtype=torch.bfloat16,
            cache_dir=VOLUME_PATH,
        ).to("cuda")

    @modal.method()
    def generate(self, prompt: str, width: int = 768,
                 height: int = 768, num_steps: int = 4) -> bytes:
        import io
        image = self.pipe(
            prompt=prompt, width=width, height=height,
            num_inference_steps=num_steps,
            guidance_scale=1.0,                                # 1.0 for distilled Klein 4B
        ).images[0]
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()
```

### Key Config

- `enable_thinking: False` — thinking mode incompatible with structured output in Qwen3.5
- `StructuredOutputsParams(json=...)` — vLLM structured output (replaces removed `guided_json` param), no MTP (avoids Issue #35700)
- `<book_text>` XML delimiters — prompt injection protection
- `kv_cache_dtype="fp8"` — doubles effective KV cache memory; `max_model_len=65536` is conservative, can increase to 131072 if needed

---

## 4. VPS Integration

### Celery -> Modal

**Note:** Modal SDK must be conditionally imported to avoid breaking tests/local dev without Modal installed.

```python
# backend/app/tasks/book_tasks.py
try:
    import modal
    MODAL_AVAILABLE = True
except ImportError:
    MODAL_AVAILABLE = False

def get_llm_extractor():
    cls = modal.Cls.from_name("fancai-pipeline", "LLMExtractor")
    return cls()

def get_image_generator():
    cls = modal.Cls.from_name("fancai-pipeline", "ImageGenerator")
    return cls()
```

**Integration point:** The existing `process_book_task` uses `asyncio.Semaphore(10)` + `asyncio.gather()` for parallel chapter processing. Each chapter is processed by `process_chapter_safe(idx, chapter_id)` which loads the chapter text from DB, then calls `gemini_extractor.analyze_chapter()`. The Modal integration replaces **only that one call** — everything else (DB writes, ConsistencyManager, EntityEvents, WebSocket progress, Description/DescriptionEntity creation) remains untouched.

```python
# book_tasks.py line ~442 — THE ONLY LINE THAT CHANGES:

# Before (OpenRouter/Gemini):
result = await gemini_extractor.analyze_chapter(local_chapter.content)

# After (Modal):
if MODAL_AVAILABLE and use_modal:
    extractor = get_llm_extractor()
    modal_json = await asyncio.to_thread(
        extractor.extract_chapter.remote,
        chapter_text=local_chapter.content,
        system_prompt=EXTRACTION_PROMPT,
        schema_json=ENTITY_SCHEMA_JSON,
    )
    # Convert Modal JSON → existing dataclasses (NOT Pydantic .model_validate())
    result = modal_response_to_chapter_result(modal_json)
else:
    result = await gemini_extractor.analyze_chapter(local_chapter.content)
```

**Critical: `ChapterAnalysisResult` is a dataclass, not Pydantic.** The `modal_response_to_chapter_result()` converter must manually construct:

- `ChapterAnalysisResult(descriptions=List[ExtractedDescription], entities=List[ExtractedEntity], relationships=List[ExtractedRelationship])`
- These dataclasses are defined in `gemini_extractor.py` — extract them to a shared `schemas.py` module

**Image generation is NOT inline.** Images are generated separately via `image_tasks.py` (on-demand when user clicks "generate" or batch via `generate_image_batch_task`). Modal `ImageGenerator` integration goes in `image_tasks.py`, not `book_tasks.py`.

**ConsistencyManager `reduce_entities`** also migrates to Modal. The `optimize_book_entities()` → `_single_reduce_pass()` currently calls `get_openrouter_client().generate_text()`. Replace with `extractor.reduce_entities.remote()`.

**VPS environment:** `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` must be added to `docker-compose.prod.yml` celery-worker environment.

### Feature Flag Rollback

```python
if await flag_manager.is_enabled("USE_MODAL_PIPELINE"):
    result = modal_extract(chapter_text, ...)
else:
    result = gemini_extract(chapter_text, ...)  # old path (kept until A/B passes)
```

Old code (`gemini_extractor.py`, `openrouter_client.py`, `imagen_generator.py`) is NOT deleted until A/B test passes on 2-3 books.

### Translation in Extraction Schema

`image_prompt_en` field added to the Modal extraction output. The LLM generates English image prompts alongside extraction, eliminating separate translation calls during on-demand image generation.

**Note on current flow:** Currently, translation RU→EN happens on-demand inside `imagen_generator.py` when a user requests an image (not during book processing). With Modal, `image_prompt_en` is pre-computed during extraction and stored in the Description DB record, so on-demand image generation skips translation entirely.

**Modal extraction schema** must output fields compatible with existing dataclasses:

```python
# Modal LLM returns JSON with these fields → converted to dataclasses on VPS
{
    "entities": [
        {"name": "...", "entity_type": "...", "visual_summary": "...", ...}
    ],
    "descriptions": [
        {"content": "...", "type": "...", "confidence": 0.9,
         "entities": ["entity1", "entity2"],
         "image_prompt_en": "..."}   # NEW field
    ],
    "relationships": [...]
}
```

**DB field names** match existing schema: `content` (not `description_text`), `type` (not `description_type`), `entities` as list (not `entity_name`). The `image_prompt_en` is the only new column.

### Parallel Chapter Processing

Chapters processed in parallel within a book (existing `asyncio.Semaphore(10)` pattern preserved). Order of DB writes is controlled by chapter index, not processing order — spoiler-free glossary is safe. vLLM on Modal naturally batches concurrent requests from parallel chapters.

### Data Flow

```
VPS -> Modal: chapter_text (str, <100KB), system_prompt, schema_json
Modal -> VPS: extraction result (JSON, <50KB), image bytes (<500KB)
VPS local:    PostgreSQL writes, image file saves to /app/storage/
```

### Image Tasks (On-Demand)

`image_tasks.py` handles on-demand image generation. Currently receives **Russian text** and translates internally via `PromptTranslator`. With Modal:

- If `image_prompt_en` is pre-stored in Description record (from extraction) → use it directly
- If not (legacy descriptions without `image_prompt_en`) → translate on VPS via `ImagenPromptEngineer` (kept as fallback)

```python
# Inside _generate_image_async() in image_tasks.py
if MODAL_AVAILABLE and use_modal:
    # Use pre-computed English prompt if available, otherwise fallback
    prompt_en = description.image_prompt_en or translate_fallback(description.content)
    generator = get_image_generator()
    image_bytes = await asyncio.to_thread(generator.generate.remote, prompt=prompt_en)
else:
    image_bytes = await imagen_service.generate_image(
        description=description.content, ...)  # old OpenRouter path (Russian input)
```

**Rate limiting sleep (2s between images) can be removed** for Modal path — no API rate limits.

### Prompt Engineering Preservation

The current `ImagenPromptEngineer` (imagen_generator.py) contains genre-aware templates, type-specific prefixes, and SFW suffixes. Two options:

1. **Embed rules in LLM system prompt** — add prompt engineering instructions to the extraction system prompt so `image_prompt_en` output already includes style/SFW directives
2. **Post-process on VPS** — keep `ImagenPromptEngineer` as a post-processing step that enriches `image_prompt_en` before sending to Modal FLUX.2

**Decision:** Option 1 for simplicity. The extraction system prompt will include image prompt guidelines (genre awareness, SFW requirements, style directives). If quality is insufficient, fall back to Option 2.

### Code Changes

| File                      | Change                                                        |
| ------------------------- | ------------------------------------------------------------- |
| `book_tasks.py`           | Add Modal path behind feature flag                            |
| `image_tasks.py`          | Add Modal path behind feature flag                            |
| `models/description.py`   | **NEW:** Add `image_prompt_en` column                         |
| `models/usage_record.py`  | **NEW:** Cost tracking model                                  |
| Alembic migration         | **NEW:** `image_prompt_en` + `usage_records`                  |
| `gemini_extractor.py`     | Keep (delete after A/B)                                       |
| `imagen_generator.py`     | Keep (delete after A/B)                                       |
| `openrouter_client.py`    | Keep (delete after A/B)                                       |
| `ner_service.py`          | Keep as CPU fallback behind flag                              |
| `consistency_manager.py`  | Replace OpenRouter `reduce` call with Modal `reduce_entities` |
| `gemini_extractor.py`     | Extract dataclasses to shared `schemas.py` module             |
| `Dockerfile.celery`       | Add `modal` dependency                                        |
| `requirements.txt`        | Add `modal`                                                   |
| `docker-compose.prod.yml` | Add `MODAL_TOKEN_ID/SECRET` env vars                          |

---

## 5. Testing & Quality

### Smoke Test (Days 1-2 after deploy)

1. Run 3 chapters of "Vedmak. Perekrestok voronov" through Modal
2. Compare with production Gemini output:
   - Entity recall (baseline: 86.84% from GLiNER2 A/B)
   - Entity precision
   - Description count
   - JSON compliance (100% required)
   - `image_prompt_en` quality (manual review of 5-10 prompts)
3. Run 1 chapter through Modal FLUX.2 Klein — visual comparison with OpenRouter images

**Acceptance:** >= 85% entity recall, 100% JSON compliance, images visually comparable

### A/B Test (after smoke test passes)

- **Mini A/B:** 2-3 books (100-150 chapters), automated recall/precision vs Gemini baseline
- **Full A/B:** 10+ books if mini passes (p < 0.05)
- BERTScore for description quality (>= 0.85 F1)

### Unit/Integration Tests

```
test_modal_extraction_returns_valid_schema()  # Mock Modal, check Pydantic
test_modal_image_returns_valid_png()           # Mock Modal, check PNG bytes
test_celery_retries_on_modal_error()           # Mock RemoteError, check retry
test_chapter_processing_end_to_end()           # Integration with staging Modal
```

### Rollback Plan

1. Feature flag `USE_MODAL_PIPELINE` -> `false`
2. Old OpenRouter pipeline still in code
3. Rollback time: < 1 minute (flag toggle)

### If Qwen3.5-9B Fails Quality

1. Test Qwen3.5-35B-A3B (GPTQ-Int4, 21GB on L4)
   - Max 32K context (need to reduce chunk size to 45K chars)
   - ~20-40 tok/s throughput
2. If 35B also fails -> stay on OpenRouter, re-evaluate approach

---

## 6. CI/CD & Monitoring

### CI/CD

```yaml
# .github/workflows/modal-deploy.yml
name: Deploy Modal
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
        with: { python-version: "3.12" }
      - run: pip install modal
      - run: modal deploy modal/app.py
        env:
          MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}
          MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }}
```

### Monitoring (Minimal)

1. **Modal Dashboard** (free) — real-time logs, GPU utilization
2. **Cost tracking in PostgreSQL** — `usage_records` table per Modal call
3. **Log-based alerts** — slow extraction (>120s/chapter), high cost (>$0.10/chapter)
4. **Budget protection** — Modal workspace budget set to $30/month

### Modal Secrets

Not needed for current design (Modal returns results to Celery, doesn't write to DB). Models loaded from public HuggingFace.

---

## 7. Migration Timeline

### Week 1: Modal Infrastructure + Smoke Test

- Day 1-2: Modal setup, ImageGenerator class, deploy, test 1 image
- Day 3-4: LLMExtractor class, vLLM config, deploy, test 1 chapter
- Day 5: Smoke test (3 chapters vs Gemini baseline), GO/NO-GO decision

### Week 2: VPS Integration + Testing

- Day 6-7: Celery integration, feature flag, Pydantic schema, cost tracking
- Day 8-9: Unit tests, integration test, process 1 full book E2E
- Day 10: Production deploy (flag=false), enable flag, process 1 book

### Week 3: A/B Test + Cleanup

- Mini A/B: 2-3 books through Modal
- If quality OK: delete OpenRouter code, remove GLiNER2 from Celery Docker
- If quality NOT OK: test 35B-A3B or reassess

### v1.4 Roadmap Impact

| Phase             | Status    | Change                  |
| ----------------- | --------- | ----------------------- |
| 29: Docker & DB   | DONE      | Not affected            |
| 30: GLiNER2 NER   | DONE      | Remains as CPU fallback |
| 31: Classifier    | CANCELLED | Modal LLM replaces      |
| 32: pgvector      | CANCELLED | Modal LLM replaces      |
| 33: LLM Synthesis | REPLACED  | -> Modal full pipeline  |
| 34: Rollout       | REPLACED  | -> Modal rollout + A/B  |

---

## 8. Cost Comparison

| Component                    | Current (OpenRouter) | After (Modal)  |
| ---------------------------- | -------------------- | -------------- |
| LLM extraction (50 chapters) | $5.12                | ~$0.42-1.31    |
| Images (63 images)           | $1.01                | $0.026         |
| Translation prompts          | ~$0.15               | $0 (in schema) |
| **Total/book**               | **$6.13**            | **$0.45-1.34** |
| **Savings**                  | —                    | **78-93%**     |
| **Books/month on $30**       | ~5                   | **22-67**      |

---

## 9. Risk Matrix

| Risk                           | Probability | Impact | Mitigation                           |
| ------------------------------ | ----------- | ------ | ------------------------------------ |
| Qwen3.5-9B quality < Gemini    | Medium      | High   | Feature flag rollback. Test 35B-A3B. |
| Modal cold start >30s          | Low         | Low    | GPU snapshot, scaledown_window=300   |
| vLLM OOM on long chapters      | Low         | Medium | FP8 KV cache, max_model_len=65536    |
| $30 free tier insufficient     | Low         | Medium | 22-67 books/month covers MVP         |
| Structured output failures     | Low         | Medium | Pydantic validation + Celery retry   |
| Modal downtime (4.3 inc/month) | Medium      | Medium | Books queue and wait. No fallback.   |

---

## 10. Deferred Items

| Item                              | Reason                                         | When to revisit                    |
| --------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Cloudflare R2 image storage       | VPS disk sufficient                            | When disk >50% or user growth      |
| Character consistency (multi-ref) | Complexity, no users yet                       | Premium tier launch                |
| Premium/Free tiers                | No users, need credit vs subscription research | After 50+ active users             |
| OpenRouter fallback               | Simplicity, no users                           | If Modal reliability becomes issue |
| Prometheus/Grafana monitoring     | Overkill for MVP                               | After 50+ active users             |
| R2 + WebP migration               | Not critical (no base64 in DB)                 | When scaling images                |

---

## References

- `docs/research/modal-full-pipeline-research-v2.md` — main v2 report
- `docs/research/modal-full-pipeline-AUDIT.md` — v1 audit (5 critical errors)
- `docs/research/modal-full-pipeline-architecture.md` — Modal architecture
- `docs/research/modal-gpu-migration-plan.md` — migration plan v1
- `docs/research/modal-gpu-integration-research.md` — observability, DX
- `docs/research/gpu-serverless-pricing-research-2026-03.md` — platform comparison
- `docs/research/gliner2-inference-optimization.md` — GLiNER2 optimization
- `docs/research/rag-nlp-optimization-research.md` — hybrid NLP pipeline
