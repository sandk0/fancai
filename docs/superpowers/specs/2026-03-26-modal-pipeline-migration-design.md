# Modal AI Pipeline Migration — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Scope:** Full migration of AI pipeline (LLM extraction + image generation) from OpenRouter to Modal self-hosted
**Based on:** 7 research documents in `docs/research/modal-*`, `docs/research/gpu-*`

---

## 1. Executive Summary

Migrate the entire fancai AI pipeline from OpenRouter (Gemini 3.0 Flash + FLUX.2 Klein) to Modal self-hosted (Qwen3.5-9B + FLUX.2 Klein). Big Bang approach — both LLM and images in a single deployment.

**Cost impact:** $6.13/book → $0.45-1.34/book (78-93% savings)
**Books/month on $30 free tier:** ~5 → 22-67

### Key Decisions

| Decision              | Choice                      | Rationale                                             |
| --------------------- | --------------------------- | ----------------------------------------------------- |
| LLM model             | Qwen3.5-9B (BF16, L4)       | Fits L4 with 6GB headroom, 91.5 IFEval, no MoE bugs   |
| Backup LLM            | Qwen3.5-35B-A3B (GPTQ-Int4) | Test if 9B quality insufficient                       |
| Image model           | FLUX.2 Klein 4B (L4)        | Same as current, 53x cheaper self-hosted              |
| Character consistency | Deferred                    | Add later as premium feature                          |
| KV cache              | FP8 dtype                   | 64K context on L4 (conservative; up to 128K possible) |
| Fallback              | None                        | Modal only, no OpenRouter fallback                    |
| Image storage (R2)    | Deferred                    | VPS disk sufficient for now                           |
| Monetization          | Deferred                    | Research credit-based vs subscription later           |
| Translation           | In extraction schema        | `image_prompt_en` field, single LLM call              |
| Migration approach    | Big Bang                    | One deployment, feature flag for rollback             |
| v1.4 phases 31-32     | Cancelled                   | Modal LLM replaces classifier + pgvector              |

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
    .pip_install("diffusers>=0.32", "torch>=2.5", "transformers", "accelerate")
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
    scaledown_window=300,
    timeout=600,
    enable_memory_snapshot=True,
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
            reasoning_parser="qwen3",
            chat_template_kwargs={"enable_thinking": False},
        )

    @modal.method()
    def extract_chapter(self, chapter_text: str, system_prompt: str,
                        schema_json: str) -> dict:
        from vllm import SamplingParams
        params = SamplingParams(
            max_tokens=8192,
            temperature=0.1,
            guided_json=schema_json,
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"<book_text>{chapter_text}</book_text>"},
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
    scaledown_window=300,
    timeout=120,
    enable_memory_snapshot=True,
)
class ImageGenerator:
    @modal.enter()
    def load_model(self):
        from diffusers import FluxPipeline
        import torch
        self.pipe = FluxPipeline.from_pretrained(
            FLUX_MODEL_ID,
            torch_dtype=torch.bfloat16,
            cache_dir=VOLUME_PATH,
        ).to("cuda")

    @modal.method()
    def generate(self, prompt: str, width: int = 768,
                 height: int = 768, num_steps: int = 4) -> bytes:
        image = self.pipe(
            prompt=prompt, width=width, height=height,
            num_inference_steps=num_steps, guidance_scale=3.5,
        ).images[0]
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()
```

### Key Config

- `enable_thinking: False` — thinking mode incompatible with structured output in Qwen3.5
- `guided_json` — vLLM structured output via XGrammar, no MTP (avoids Issue #35700)
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

**Important:** The existing `process_book_task` uses `asyncio.Semaphore(10)` + `asyncio.gather()` for parallel chapter processing. The Modal integration preserves this architecture — it swaps the internal `gemini_extractor.analyze_chapter()` call for `extractor.extract_chapter.remote()` within the existing parallel loop. No change to the chapter orchestration pattern.

```python
# Inside existing process_book_task — swap extraction call
async def process_single_chapter(chapter_text, chapter_idx):
    async with semaphore:
        extractor = get_llm_extractor()
        # Modal .remote() is synchronous — wrap in asyncio.to_thread()
        result = await asyncio.to_thread(
            extractor.extract_chapter.remote,
            chapter_text=chapter_text,
            system_prompt=EXTRACTION_PROMPT,
            schema_json=ENTITY_SCHEMA_JSON,
        )
        validated = ChapterAnalysisResult.model_validate(result)

        # Image generation per description
        generator = get_image_generator()
        for desc in validated.descriptions:
            image_bytes = await asyncio.to_thread(
                generator.generate.remote, prompt=desc.image_prompt_en
            )
            save_image_to_disk(image_bytes, book_id, desc.id)

        return validated

# Parallel chapter processing (existing pattern preserved)
results = await asyncio.gather(*[
    process_single_chapter(ch.text, idx) for idx, ch in enumerate(chapters)
])
```

**VPS environment:** `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` must be added to VPS environment (docker-compose or .env) for Celery workers to call Modal.

### Feature Flag Rollback

```python
if await flag_manager.is_enabled("USE_MODAL_PIPELINE"):
    result = modal_extract(chapter_text, ...)
else:
    result = gemini_extract(chapter_text, ...)  # old path (kept until A/B passes)
```

Old code (`gemini_extractor.py`, `openrouter_client.py`, `imagen_generator.py`) is NOT deleted until A/B test passes on 2-3 books.

### Translation in Extraction Schema

`image_prompt_en` field added to description schema. Single LLM call per chapter handles extraction + English prompt generation. Eliminates 60-100 separate translation calls per book.

```python
class DescriptionResult(BaseModel):
    entity_name: str
    description_text: str       # Russian
    description_type: str
    image_prompt_en: str        # English, 30-60 words, for FLUX.2
```

### Parallel Chapter Processing

Chapters processed in parallel within a book (existing `asyncio.Semaphore(10)` pattern preserved). Order of DB writes is controlled by chapter index, not processing order — spoiler-free glossary is safe. vLLM on Modal naturally batches concurrent requests from parallel chapters.

### Data Flow

```
VPS -> Modal: chapter_text (str, <100KB), system_prompt, schema_json
Modal -> VPS: extraction result (JSON, <50KB), image bytes (<500KB)
VPS local:    PostgreSQL writes, image file saves to /app/storage/
```

### Image Tasks (On-Demand)

`image_tasks.py` handles on-demand image generation (user clicks "generate" in the reader). This also needs the Modal path:

```python
# backend/app/tasks/image_tasks.py
if MODAL_AVAILABLE and await flag_manager.is_enabled("USE_MODAL_PIPELINE"):
    generator = get_image_generator()
    image_bytes = await asyncio.to_thread(generator.generate.remote, prompt=prompt_en)
else:
    image_bytes = await imagen_service.generate(prompt_en)  # old OpenRouter path
```

### Prompt Engineering Preservation

The current `ImagenPromptEngineer` (imagen_generator.py) contains genre-aware templates, type-specific prefixes, and SFW suffixes. Two options:

1. **Embed rules in LLM system prompt** — add prompt engineering instructions to the extraction system prompt so `image_prompt_en` output already includes style/SFW directives
2. **Post-process on VPS** — keep `ImagenPromptEngineer` as a post-processing step that enriches `image_prompt_en` before sending to Modal FLUX.2

**Decision:** Option 1 for simplicity. The extraction system prompt will include image prompt guidelines (genre awareness, SFW requirements, style directives). If quality is insufficient, fall back to Option 2.

### Code Changes

| File                     | Change                                       |
| ------------------------ | -------------------------------------------- |
| `book_tasks.py`          | Add Modal path behind feature flag           |
| `image_tasks.py`         | Add Modal path behind feature flag           |
| `models/description.py`  | **NEW:** Add `image_prompt_en` column        |
| `models/usage_record.py` | **NEW:** Cost tracking model                 |
| Alembic migration        | **NEW:** `image_prompt_en` + `usage_records` |
| `gemini_extractor.py`    | Keep (delete after A/B)                      |
| `imagen_generator.py`    | Keep (delete after A/B)                      |
| `openrouter_client.py`   | Keep (delete after A/B)                      |
| `ner_service.py`         | Keep as CPU fallback behind flag             |
| `consistency_manager.py` | No changes                                   |
| `Dockerfile.celery`      | Add `modal` dependency                       |
| `requirements.txt`       | Add `modal`                                  |
| `docker-compose.yml`     | Add `MODAL_TOKEN_ID/SECRET` env vars         |

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
