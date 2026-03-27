# Requirements: fancai v1.5

**Defined:** 2026-03-27
**Core Value:** Пользователь загружает книгу, читает её, получает AI-сгенерированный глоссарий персонажей без спойлеров, видит иллюстрации, делает заметки и выделения — и всё это работает стабильно на любом устройстве.

## v1.5 Requirements

Modal Batch Processing & Production Stability. Стабилизация сломанного pipeline и переход от sequential к batch-обработке глав.
Эталонный документ: `docs/research/FINAL-consolidated-audit.md`

### Стабилизация

- [ ] **STAB-01**: Пользователь видит корректный статус книги — `descriptions_extracted=True` только при 0 failed chapters, WebSocket публикует `completed_with_errors` при partial failures
- [ ] **STAB-02**: Существующие книги с inconsistent статусами обнаружены и помечены для переобработки (reconciliation script)
- [x] **STAB-03**: Все string поля в Pydantic-схемах Modal имеют `max_length` constraints, предотвращающие broken JSON от неограниченной генерации
- [x] **STAB-04**: llm_extractor проверяет `finish_reason` перед `json.loads()` — при `finish_reason="length"` помечает результат как incomplete
- [ ] **STAB-05**: Modal вызовы защищены VPS-side timeout (`asyncio.wait_for(..., timeout=LLM_TIMEOUT+60)`) — Celery поток не блокируется при зависании Modal
- [ ] **STAB-06**: `LLM_TIMEOUT=900s` + per-task Celery time budget check предотвращает превышение hard limit
- [x] **STAB-07**: `num_gpu_blocks_override` настроен в Modal config — обход KV cache overestimation для Qwen3.5 (Bug #37121)
- [x] **STAB-08**: `reduce_entities` max_tokens увеличен до 16384 — корректная обработка книг со 100+ entities
- [ ] **STAB-09**: Все файлы с `logger.opt()` проверены — Loguru import гарантирован; файлы в Modal контейнере используют стандартный logging API

### Error & Observability

- [x] **OBS-01**: ErrorClassifier модуль раздельно обрабатывает `FunctionTimeoutError`, `RemoteError`, `InputCancellation`, `JSONDecodeError` — `error_type` сохраняется в `chapter.parsing_error`
- [x] **OBS-02**: Per-chapter structured JSON log содержит `chapter_id`, `duration_ms`, `result_type`, `error_type`, `finish_reason` + Modal возвращает метрики `cold_start_ms`, `inference_ms`

### Batch Processing

- [ ] **BATCH-01**: Pre-validation длины глав — oversized chapters (>32K estimated tokens) маршрутизируются в sequential path
- [ ] **BATCH-02**: `extract_chapters_batch()` обрабатывает sub-batch из 4-8 глав (до 12 по результатам profiling) за один Modal вызов через batch chat API с checkpoint после каждого sub-batch
- [ ] **BATCH-03**: Compile cache volume в Modal сохраняет `torch.compile` артефакты между cold starts (-20-30s)

### Resilience

- [ ] **RESIL-01**: Auto-fallback на OpenRouter (Gemini 3.0 Flash) при 3 consecutive Modal failures — circuit breaker с автоматическим recovery
- [ ] **RESIL-02**: Batch path использует `StructuredOutputsConfig(backend=...)` — выбор backend (xgrammar/guidance/auto) определяется A/B-тестом на 3+ книгах

## v2 Requirements

Отложены за пределы v1.5. Не в текущем roadmap.

### Оптимизация

- **OPT-01**: GPU snapshot POC — тестирование `snap=True` с `vllm.LLM` + Modal для 9B модели
- **OPT-02**: xgrammar vs auto benchmark matrix — сравнение backend'ов для structured output при стабильном batch
- **OPT-03**: Server mode migration — переход с offline LLM class на vLLM server для расширенных возможностей

### Из v1.4 (abandoned)

- **NER-01**: NER extraction через GLiNER2 (отменено — стратегический разворот к Modal/OpenRouter)
- **DESC-01**: Description classifier (отменено — стратегический разворот)
- **EMB-01**: pgvector embeddings (отменено — стратегический разворот)

## Out of Scope

Явно исключено. Документировано для предотвращения scope creep.

| Feature | Reason |
|---------|--------|
| GPU snapshots (в основном milestone) | Alpha 8+ месяцев, ноль примеров `vllm.LLM` + `snap=True`, нет benchmark'ов для 9B |
| Thinking mode Qwen3.5 | Issue #35700 (OPEN): structured output конфликтует с thinking mode |
| Real-time progress через modal.Queue | Overkill — текущий WebSocket progress + VPS-side loop достаточен |
| Prometheus push gateway | Overkill для текущего масштаба (1 user). Loguru structured + return metadata достаточно |
| Auto scale-up GPU containers | $3.90-5.85/hr при 2+ контейнерах, user base не требует |
| FlashInfer/Triton backend | FA2 оптимален для L40S (Ada Lovelace SM 8.9) |
| Self-hosted LLM на VPS | 12 vCPU без GPU — 2-5 tokens/sec неприемлемо (решение v1.4) |
| Server mode vLLM | Offline LLM class достаточен для batch; server mode — v2 если blocker |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STAB-01 | Phase 35 | Pending |
| STAB-02 | Phase 35 | Pending |
| STAB-03 | Phase 35 | Complete (35-01) |
| STAB-04 | Phase 36 | Complete |
| STAB-05 | Phase 35 | Pending |
| STAB-06 | Phase 35 | Pending |
| STAB-07 | Phase 35 | Complete (35-01) |
| STAB-08 | Phase 35 | Complete (35-01) |
| STAB-09 | Phase 35 | Pending |
| OBS-01 | Phase 36 | Complete |
| OBS-02 | Phase 36 | Complete |
| BATCH-01 | Phase 37 | Pending |
| BATCH-02 | Phase 37 | Pending |
| BATCH-03 | Phase 37 | Pending |
| RESIL-01 | Phase 38 | Pending |
| RESIL-02 | Phase 38 | Pending |

**Coverage:**
- v1.5 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-03-27*
*Last updated: 2026-03-27 after roadmap creation*
