---
phase: 37-sub-batch
plan: 01
subsystem: infra
tags: [modal, vllm, batch-processing, compile-cache, token-estimation]

requires:
  - phase: 36-error-classification-observability
    provides: "ErrorClassifier, structured per-chapter logging, finish_reason check, Modal response wrapper"
provides:
  - "batch_grouping.py: estimate_tokens(), group_chapters_into_batches(), process_batch_outputs()"
  - "extract_chapters_batch() в Modal LLMExtractor — vLLM continuous batching"
  - "Compile cache volumes (fancai-compile-cache, fancai-triton-cache, fancai-nv-cache)"
  - "TORCHINDUCTOR env vars для ускорения cold start"
  - "Batch константы: OVERSIZED_THRESHOLD_TOKENS=32K, BATCH_TOKEN_BUDGET=128K, MAX=12, MIN=2"
affects: [37-02, orchestration, modal-deploy]

tech-stack:
  added: []
  patterns:
    - "Token estimation len//2 для русского текста — простая эвристика для routing decisions"
    - "process_batch_outputs() — чистая функция для тестирования без Modal/vLLM"
    - "Compile cache volumes mounted в /root/.inductor-cache, /root/.triton, /root/.nv"

key-files:
  created:
    - "backend/app/services/batch_grouping.py"
    - "backend/tests/tasks/test_batch_grouping.py"
    - "backend/tests/tasks/test_batch_extraction.py"
    - "backend/tests/tasks/test_modal_compile_cache.py"
  modified:
    - "modal/config.py"
    - "modal/app.py"
    - "modal/llm_extractor.py"

key-decisions:
  - "process_batch_outputs() вынесен как чистая функция в batch_grouping.py — тестируется на VPS без vLLM"
  - "LLM_TIMEOUT увеличен до 1800s (30 мин) — safety net для batch processing на Modal"
  - "Compile cache mount в /root/.inductor-cache (не /root/.cache/torch) — точный путь из RESEARCH.md"
  - "Остаток < BATCH_MIN_CHAPTERS -> oversized — консервативная стратегия, один chapter не стоит batch overhead"

patterns-established:
  - "Чистые функции для Modal логики — testable на VPS без GPU зависимостей"
  - "Sequential grouping с budget/max/min constraints — детерминированный порядок глав"

requirements-completed: [BATCH-01, BATCH-02, BATCH-03]

duration: 8min
completed: 2026-03-28
---

# Phase 37 Plan 01: Modal batch-инфраструктура Summary

**VPS-side batch grouping (token estimation + oversized routing) + Modal extract_chapters_batch() с vLLM continuous batching + compile cache volumes для ускорения cold start**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-28T01:09:15Z
- **Completed:** 2026-03-28T01:17:40Z
- **Tasks:** 2/2
- **Files modified:** 7

## Accomplishments

- `batch_grouping.py` с `estimate_tokens()`, `group_chapters_into_batches()`, `process_batch_outputs()` — чистые функции для VPS-side группировки
- `extract_chapters_batch()` в Modal LLMExtractor — vLLM continuous batching, per-item finish_reason, batch_size в metrics
- 3 compile cache volumes (inductor, triton, nv) + TORCHINDUCTOR env vars для 20-30s экономии на cold start
- 26 Wave 0 тестов проходят (15 grouping + 6 extraction + 5 compile cache)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 тесты + batch_grouping + Modal config/app** — TDD cycle:
   - `1676bdc` (test: failing tests for batch grouping, extraction, compile cache)
   - `625f98c` (feat: batch_grouping module, Modal config/app with compile cache)
2. **Task 2: extract_chapters_batch() в Modal LLMExtractor** — `54a2e0b` (feat)

## Files Created/Modified

- `backend/app/services/batch_grouping.py` — estimate_tokens, group_chapters_into_batches, process_batch_outputs
- `backend/tests/tasks/test_batch_grouping.py` — 15 unit tests: token estimation, oversized routing, batch creation, constants
- `backend/tests/tasks/test_batch_extraction.py` — 6 tests: per-item results, partial truncation, empty, metrics, cold start
- `backend/tests/tasks/test_modal_compile_cache.py` — 5 tests: volume names, env vars, mount paths
- `modal/config.py` — LLM_TIMEOUT=1800, OVERSIZED_THRESHOLD_TOKENS=32000, BATCH_TOKEN_BUDGET=128000, MAX/MIN
- `modal/app.py` — compile_cache + triton_cache + nv_cache volumes, TORCHINDUCTOR env vars, updated COMMON_CLS_KWARGS
- `modal/llm_extractor.py` — extract_chapters_batch() с vLLM continuous batching

## Decisions Made

- `process_batch_outputs()` вынесен как чистая функция в `batch_grouping.py` — тестируется на VPS без vLLM. Modal `extract_chapters_batch()` содержит ту же логику inline (Modal container не импортирует backend).
- LLM_TIMEOUT увеличен с 900 до 1800 (30 мин) — batch из 12 глав может занять больше 15 мин, 30 мин — safety net.
- Compile cache mount path `/root/.inductor-cache` — подтверждён в RESEARCH.md, CONTEXT.md D-13 содержал менее точный путь.
- Остаток < BATCH_MIN_CHAPTERS (2) перемещается в oversized — 1 глава не стоит batch overhead, обрабатывается sequential.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `batch_grouping.py` готов для импорта из orchestrator (Plan 02)
- `extract_chapters_batch()` доступен для вызова через Modal client
- Compile cache volumes будут автоматически созданы при первом Modal deploy
- Plan 02 (orchestration) может использовать `group_chapters_into_batches()` + `extract_chapters_batch()`

## Self-Check: PASSED

All 8 files verified. All 3 commits verified (1676bdc, 625f98c, 54a2e0b).

---
*Phase: 37-sub-batch*
*Completed: 2026-03-28*
