# Ultimate Implementation Plan: Fancai v16 Refactor

**Goal:** Transform Fancai into a Production-Grade AI Application using Gemini 3 and Modern Async Patterns.
**Basis:** [Comprehensive LLM Analysis](2026-01-23-comprehensive-llm-analysis.md) & [v16 Prompt](ultimate_implementation_prompt.md)

---

## Phase 0: Database & Schema (Foundation)
**Objective:** Prepare Postgres to store Graph and Importance scores.

### 1. Entity Model Upgrade (`backend/app/models/entity.py`)
- [x] Add `importance = Column(Integer)` field.
- [x] Add `linked_entity_ids = Column(JSONB)` field.

### 2. Create Graph Table (`backend/app/models/entity_relationship.py`)
- [x] Create new file `entity_relationship.py`.
- [x] Define `EntityRelationship` class (Adjacency List Pattern):
    - `source_id` (FK -> entities.id)
    - `target_id` (FK -> entities.id)
    - `type` (String: KINSHIP, ALLY, ENEMY)
    - `weight` (Integer: -100 to 100)

### 3. Migrations
- [x] Run `alembic revision --autogenerate -m "v16_schema_upgrade"` (Manually Created).
- [ ] Run `alembic upgrade head` (Pending Execution).

---

## Phase 1: Core Architecture (Speed & Context)

### 1. Increase Context Window (`backend/app/services/gemini_extractor.py`)
- [x] Update `GeminiConfig`: `max_chunk_chars = 100000` (was 4000).
- [x] Disable `RecursiveTextChunker` default behavior (allow pass-through).
- [x] Update `GeminiDirectExtractor.EXTRACTION_PROMPT`:
    - Inject "Evaluate IMPORTANCE (1-10)" instruction.
    - Inject "Extract Top-15 ONLY" instruction.

### 2. Parallel Processing (`backend/app/core/tasks.py`)
- [x] Remove `for chapter in chapters` loop.
- [x] Implement `asyncio.TaskGroup` context manager.
- [x] Wrap `analyze_chapter` calls in `tg.create_task()`.
- [x] Add `asyncio.Semaphore(10)` to prevent API flooding.

---

## Phase 2: Logic & Intelligence (Quality)

### 1. Map-Reduce Service (`backend/app/services/consistency_manager.py`)
- [x] Create `EntityResolverService` or method `optimize_book_entities`.
- [x] Implement **Reduce Phase Prompt**: "Merge duplicates... Remove importance < 7".
- [x] Call this method as a "Barrier" after all chapters are extracted.

### 2. Graph Analysis (`backend/app/services/graph_service.py`)
- [x] Integrate `networkx`.
- [x] Implement `calculate_pagerank(book_id)` -> updates `Entity.importance`.

---

## Phase 3: DevOps, Safety & Caching (Reliability)

### 1. Docker Limits (`docker-compose.lite.yml`)
- [ ] Update `celery_worker` service.
- [ ] Set `mem_limit: 2.5g`.
- [ ] Set `mem_reservation: 2.0g`.

### 2. Safety Handling (`backend/app/services/imagen_generator.py`)
- [ ] Import `BlockedPromptException` from `google.api_core.exceptions`.
- [ ] Wrap `generate_image` in `try/except BlockedPromptException`.
- [ ] Implement "Graceful Failure": return placeholder image or `status='safety_block'`.

### 3. Cost Optimization (`backend/app/services/imagen_generator.py`)
- [ ] **Semantic Caching**: Implement Redis check `hash(prompt + seed)` before generation.
- [ ] **Gatekeeper Logic**: In `tasks.py`, BEFORE calling generation, check `if entity.importance < 7: skip`.
- [ ] **Asset Linking (Gatekeeper)**: Only link descriptions to entities if `importance >= 7`.

---

## Output Artifacts
- API: `GET /books/{id}/graph` (returning JSON for visualization).
- API: `GET /books/{id}/entities/{id}` (returning Rich Card JSON-LD).
