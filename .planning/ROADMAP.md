# Дорожная карта: fancai

## Milestones

- v1.0 Готовность к продакшену (shipped 2026-03-09) -- archived
- v1.1 Reader Mobile / PWA (shipped 2026-03-09) -- archived
- v1.2 Reader Stability & Polish (shipped 2026-03-13) -- archived
- v1.3 iOS Reader Navigation Fixes (shipped 2026-03-23) -- archived
- v1.4 Оптимизация обработки книг (abandoned 2026-03-27: strategic pivot to Modal)
- v1.5 Modal Batch Processing & Production Stability (closed-partial 2026-03-29: Phases 35-36 shipped, Phase 37/38 abandoned — Modal staging failed)
- v1.6 Gemini Direct + Vertex AI (shipped 2026-06-16 вне формальных GSD-фаз)
- Next: Production Reliability Baseline (proposed 2026-07-18; версия не назначена)

## Phases

<details>
<summary>v1.0 Готовность к продакшену (Phases 1-8) -- SHIPPED 2026-03-09</summary>

- [x] Phase 1: Безопасность продакшена (2/2 plans) -- completed 2026-03-01
- [x] Phase 2: Очистка мертвого кода (2/2 plans) -- completed 2026-03-01
- [x] Phase 3: Миграция сервисов (4/4 plans) -- completed 2026-03-01
- [x] Phase 4: Обслуживание инфраструктуры (3/3 plans) -- completed 2026-03-02
- [x] Phase 4.1: Фиксы интеграции и ребрендинг (3/3 plans) -- completed 2026-03-04
- [x] Phase 5: Стабилизация AI и техдолг (2/2 plans) -- completed 2026-03-04
- [x] Phase 6: Качество Entity Wiki (2/2 plans) -- completed 2026-03-04
- [x] Phase 7: Обработка ошибок и UX (2/2 plans) -- completed 2026-03-05
- [x] Phase 8: Функции ридера (3/3 plans) -- completed 2026-03-07

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>v1.1 Reader Mobile / PWA (Phases 9-14) -- SHIPPED 2026-03-09</summary>

- [x] Phase 9: Стабилизация навигации (2/2 plans) -- completed 2026-03-09
- [x] Phase 10: Follow-finger свайпы (2/2 plans) -- completed 2026-03-09
- [x] Phase 11: Единый gesture handler и мобильный UI (3/3 plans) -- completed 2026-03-09
- [x] Phase 12: Viewport и iOS (2/2 plans) -- completed 2026-03-09
- [x] Phase 13: PWA и offline (2/2 plans) -- completed 2026-03-09
- [x] Phase 14: Фикс описаний (2/2 plans) -- completed 2026-03-09

Full details: `.planning/milestones/v1.1-ROADMAP.md`

</details>

<details>
<summary>v1.2 Reader Stability & Polish (Phases 16-20) -- SHIPPED 2026-03-13</summary>

- [x] Phase 16: Навигация и свайпы (2/2 plans) -- completed 2026-03-11
- [x] Phase 17: Шапка и панели (5/5 plans) -- completed 2026-03-11
- [x] Phase 18: Выделение текста и заметки (2/2 plans) -- completed 2026-03-11
- [x] Phase 19: Описания и Entity Popup (2/2 plans) -- completed 2026-03-11
- [x] Phase 19.1: UAT-фиксы (3/3 plans) -- completed 2026-03-12
- [x] Phase 19.2: Мобильные баги ридера (2/2 plans) -- completed 2026-03-12
- [x] Phase 19.3: ResizeObserver cascade fix (3/3 plans) -- completed 2026-03-12
- [x] Phase 20: Очистка dead code (2/2 plans) -- completed 2026-03-13

Full details: `.planning/milestones/v1.2-ROADMAP.md`

</details>

<details>
<summary>v1.3 iOS Reader Navigation Fixes (Phases 21-28.2) -- SHIPPED 2026-03-23</summary>

- [x] Phase 21: Диагностика iOS touch pipeline (1/1 plans) -- completed 2026-03-15
- [x] Phase 22: Корневой фикс touch event pipeline (1/1 plans) -- completed 2026-03-16
- [x] Phase 23: Навигация и iOS overlay ревизия (2/2 plans) -- completed 2026-03-16
- [x] Phase 24: Выделение текста на iOS (1/1 plans) -- completed 2026-03-23
- [x] Phase 25: Регрессионное тестирование (1/1 plans) -- completed 2026-03-23
- [x] Phase 26: fix(images) (2/2 plans) -- completed 2026-03-16
- [x] Phase 27: Надёжность генерации изображений (2/2 plans) -- completed 2026-03-16
- [x] Phase 28: Аудит Frontend генерации (2/2 plans) -- completed 2026-03-16
- [x] Phase 28.1: fix: blob URL revoked ImageModal (1/1 plans) -- completed 2026-03-16
- [x] Phase 28.2: fix: OpenRouter 2/3 + iOS storage (2/2 plans) -- completed 2026-03-17

Full details: `.planning/milestones/v1.3-ROADMAP.md`

</details>

<details>
<summary>v1.4 Оптимизация обработки книг (Phases 29-34) -- ABANDONED 2026-03-27</summary>

**Milestone Goal:** Миграция с all-LLM pipeline на гибридную архитектуру (GLiNER2 + classifier + pgvector + LLM synthesis).

**Причина отмены:** Стратегический разворот — отказ от self-hosted LLM (GLiNER2, pgvector embeddings, local classifier) в пользу Modal (vLLM batch) + OpenRouter (fallback). Решение принято после серии аудитов (7 документов, 2 LLM-аудитора), показавших что:
1. Modal pipeline уже в production и требует стабилизации (10/23 глав падают)
2. Self-hosted модели добавляют operational complexity (Docker, RAM, GPU) без пропорциональной выгоды
3. vLLM batch processing на Modal L40S даёт 7-13x ускорение при 86-93% экономии

**Что сохраняется из v1.4:**
- Phase 29 (Docker/DB инфраструктура) — completed, pgvector и feature flags в production
- Phase 30 Plan 01 (NERService core) — код написан, но не rollout'ен; может быть использован как fallback

**Что отменено:** Phases 30 (Plan 02), 31, 32, 33, 34

- [x] Phase 29: Docker и DB инфраструктура (completed 2026-03-23)
- [~] Phase 30: GLiNER2 NER Service (Plan 01 done, Plan 02 abandoned)
- [ ] ~~Phase 31: Description Classifier~~ (abandoned)
- [ ] ~~Phase 32: pgvector Embeddings~~ (abandoned)
- [ ] ~~Phase 33: LLM Batch Synthesis~~ (abandoned)
- [ ] ~~Phase 34: Rollout и интеграция~~ (abandoned)

Full details: `.planning/milestones/v1.4-ROADMAP.md`

</details>

### v1.5 Modal Batch Processing & Production Stability — CLOSED-PARTIAL 2026-03-29

**Milestone Goal:** Стабилизация сломанного Modal pipeline (10/23 глав падают) и переход от sequential per-chapter к chunked sub-batch обработке. Ожидаемый эффект: корректные статусы книг, 7-13x ускорение, $3.48 -> $0.26-0.49 за книгу.

**Фактический результат:** Phases 35-36 успешно в production (status semantics + observability дают честные статусы книг и типизированные ошибки). Phase 37 staging провалился — batch отрабатывал 40+ минут вместо ожидаемых 7-8 минут (Modal SDK 1.4.0 compat fix `d1eef1e0` не помог). Phase 38 (auto-fallback Modal → OpenRouter) cancelled вместе с pivot. Стратегический разворот: вместо стабилизации Modal — переход на OpenRouter оптимизацию (Gemini 2.5 Flash tiered + Gemini 3.1 Flash Lite, -75% input cost).

- [x] **Phase 35: Стабилизация production semantics** - Корректные статусы книг, schema constraints, timeout/budget защита (completed 2026-03-27)
- [x] **Phase 36: Error classification и observability** - Типизированная классификация ошибок, structured logging, finish_reason проверка (completed 2026-03-27)
- [~] **Phase 37: Sub-batch архитектура** - Plan 01 deployed but unused, Plan 02 abandoned 2026-03-29 (Modal staging failed)
- [ ] ~~**Phase 38: Auto-fallback и production hardening**~~ — CANCELLED 2026-03-29 (Modal pivot abandoned)

### v1.6 Gemini Direct + Vertex AI — SHIPPED 2026-06-16

**Goal:** заменить OpenRouter-primary на прямой `google-genai` provider, сохранив
операционный rollback path и добавив Vertex AI backend для GCP trial.

**Фактический результат:** provider protocol/factory внедрены; основной extraction и
synthesis path работает через `GeminiClient`; production env использует
`AI_PROVIDER=gemini`, `GEMINI_BACKEND=vertex`, `GCP_LOCATION=global`. Extraction model —
`gemini-3.5-flash`, Gemini image branch — `gemini-3.1-flash-image`. Production cutover и
backend/celery smoke завершены на commit `a1f89900`.

**Ограничение:** миграция не охватила весь pipeline. Production
`USE_MODAL_PIPELINE=false`, поэтому extraction/synthesis/images идут по Gemini branches,
но `ConsistencyManager` в этой ветке напрямую вызывает OpenRouter для reduce и обходит
`AI_PROVIDER`. Полного text+image rollback contract нет.

Admin panel из `docs/research/gemini-admin-panel-plan-2026-03-31.md` не входила в
cutover и остаётся deferred до восстановления quality/operations baseline.

### Next: Production Reliability Baseline — PROPOSED 2026-07-18

**Goal:** восстановить обязательные CI/security gates и исправить подтверждённые
production defects до начала нового feature-milestone.

**Порядок:**

1. P0: ротация Postbox credentials; восстановление Celery consumers и безопасная очистка
   stale `light` backlog; устранение mixed provider routing; CI DB contract; включение
   GitHub Actions; dependency security updates; зелёный baseline.
2. P1: Netdata networking/export; Workbox precache; canonical `.env` deploy;
   VPS outage runbook.
3. P2: production EPUB canary после восстановления `heavy` queue и provider contract.

Детальный executable plan:
[`docs/superpowers/plans/2026-07-18-production-reliability-baseline.md`](../docs/superpowers/plans/2026-07-18-production-reliability-baseline.md).

## Phase Details

### Phase 35: Стабилизация production semantics
**Goal**: Pipeline выдаёт корректные статусы книг и не создаёт broken JSON — каждая обработанная книга отражает реальный результат
**Depends on**: Nothing (первая фаза v1.5)
**Requirements**: STAB-01, STAB-02, STAB-03, STAB-05, STAB-06, STAB-07, STAB-08, STAB-09
**Success Criteria** (what must be TRUE):
  1. Книга со сбойными главами получает статус `completed_with_errors`, а не `descriptions_extracted=True` — пользователь видит честный результат
  2. Существующие книги с inconsistent статусами в БД обнаружены reconciliation-скриптом и помечены для переобработки
  3. Modal не генерирует broken JSON — все string поля ограничены `maxLength`, reduce_entities обрабатывает книги со 100+ entities
  4. Celery task не блокируется при зависании Modal — VPS-side timeout + time budget check предотвращают превышение hard limit
  5. `num_gpu_blocks_override` настроен — снижение timeout rate из-за KV cache overestimation Qwen3.5
  6. Push notification `send_book_ready_notification` НЕ отправляется при `completed_with_errors`
**Plans:** 3/3 plans complete

Plans:
- [x] 35-01-PLAN.md — Modal constraints: max_length schemas, num_gpu_blocks_override, LLM_TIMEOUT=900
- [ ] 35-02-PLAN.md — Семантика статусов: корректные статусы книг, VPS-side timeout, time budget check
- [ ] 35-03-PLAN.md — Reconciliation endpoint + верификация STAB-08/STAB-09

### Phase 36: Error classification и observability
**Goal**: Каждая ошибка pipeline классифицирована по типу, каждая глава имеет structured log с метриками — основа для retry-стратегий и диагностики
**Depends on**: Phase 35
**Requirements**: STAB-04, OBS-01, OBS-02
**Success Criteria** (what must be TRUE):
  1. `ErrorClassifier` раздельно обрабатывает timeout, JSON error, Modal error, cancelled — `error_type` сохраняется в `chapter.parsing_error`
  2. `finish_reason` проверяется до `json.loads()` — при `finish_reason="length"` результат помечается как truncated, а не падает с JSONDecodeError
  3. Per-chapter structured JSON log содержит `chapter_id`, `duration_ms`, `result_type`, `error_type`, `finish_reason` + метрики cold start/inference от Modal
**Plans:** 2/2 plans complete

Plans:
- [x] 36-01-PLAN.md — Modal metrics transport: finish_reason проверка до json.loads, cold_start_ms timing, metrics dict в return
- [x] 36-02-PLAN.md — ErrorClassifier + Alembic migration + structured logging + truncated retry + modal_client backward compat

### Phase 37: Sub-batch архитектура — ABANDONED 2026-03-29
**Goal**: Pipeline обрабатывает 4-8 глав за один Modal вызов вместо sequential per-chapter — ускорение 7-13x с checkpoint после каждого sub-batch
**Depends on**: Phase 36
**Requirements**: BATCH-01, BATCH-02, BATCH-03
**Status:** Plan 01 deployed (batch_grouping, extract_chapters_batch, compile cache), но не использован в production. Plan 02 (VPS orchestration) abandoned 2026-03-29 после провала staging — реальный batch время 40+ мин против ожидаемых 7-8 мин. Modal pipeline отброшен из стратегии целиком.
**Success Criteria** (what must be TRUE):
  1. Oversized главы (>32K estimated tokens) автоматически маршрутизируются в sequential path — batch не падает из-за одной большой главы
  2. `extract_chapters_batch()` обрабатывает sub-batch из 4-8 глав за один Modal вызов с checkpoint после каждого sub-batch
  3. Compile cache volume сохраняет `torch.compile` артефакты между cold starts — повторные запуски на 20-30 секунд быстрее
  4. При падении sub-batch каждая глава из него retry'ится individual'но — partial failure не теряет весь batch
  5. Staging тестирование на 3-5 реальных книгах проведено перед production rollout — **FAILED**
  6. E2E обработка 23 глав < 15 минут, cost < $0.50/book, success rate > 95% chapters — **FAILED**
  7. `reduce_entities`/`ConsistencyManager` вызываются один раз после завершения всех sub-batches, не после каждого
**Plans:** 1/2 plans executed (Plan 01 dead code, Plan 02 abandoned)

Plans:
- [x] 37-01-PLAN.md — Modal batch-инфраструктура: extract_chapters_batch(), compile cache volumes, batch_grouping модуль (deployed but unused)
- [~] 37-02-PLAN.md — ABANDONED: VPS-side batch orchestration не реализован, Modal staging failed

### Phase 38: Auto-fallback и production hardening — CANCELLED 2026-03-29
**Goal**: При недоступности Modal pipeline автоматически переключается на OpenRouter (Gemini 3.0 Flash) — пользователь всегда получает результат
**Depends on**: Phase 37
**Requirements**: RESIL-01, RESIL-02
**Status:** Cancelled 2026-03-29. Auto-fallback Modal → OpenRouter не нужен после полного отказа от Modal pipeline. OpenRouter стал primary path (Gemini 3.1 Flash Lite primary с 2026-03-29).
**Success Criteria** (what must be TRUE — N/A, cancelled):
  1. ~~После 3 consecutive Modal failures circuit breaker переключает pipeline на OpenRouter~~
  2. ~~Batch path использует `StructuredOutputsConfig(backend=...)` — выбор backend определяется A/B-тестом~~
**Plans**: cancelled

Plans:
- [ ] ~~38-01: TBD~~ — CANCELLED

### Pivot к OpenRouter оптимизации (2026-03-29..30, вне фаз)

После провала Modal staging работа продолжилась без формальных GSD-фаз. Зафиксировать здесь для исторической прозрачности:

- `e8f6a2f0` 2026-03-30 — A/B Qwen3.5-397B на Russian extraction
- `5f6f3093` 2026-03-30 — Победитель A/B: Gemini 2.5 Flash tiered strategy
- `0b2b3a45` 2026-03-29 — Gemini 3.1 Flash Lite primary (-75% input cost vs Gemini 3.0 Flash)
- `ab2ec5ca` 2026-03-29 — gemini-3-flash убран из fallback chain
- `c0b5bdfb` 2026-03-29 — SW preloadResponse.ok check
- `7a373d7f` 2026-03-29 — CSP font-src blob: и data: для epub.js
- `d8e38aea` 2026-03-28 — security: redact OpenRouter API key из research
- `cededd96` 2026-04-24 — GSD toolchain v1.32.0 → v1.38.3 (организационно)

### Gemini Direct / Vertex delivery (2026-06-15..16, вне фаз)

- `b13e57b9` — provider abstraction + `GeminiClient` Stage A.
- `9181586d` — Gemini response hardening.
- `faddcae0` — Vertex backend sub-mode.
- `d27017dd` — default Vertex location `global`.
- `326dd935` — Vertex global region finalization.
- `34f2431c` — production compose consistency.
- `a1f89900` — merge Stage A + Vertex backend; фактический deployed commit.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-8 | v1.0 | 23/23 | Complete | 2026-03-07 |
| 9-14 | v1.1 | 13/13 | Complete | 2026-03-09 |
| 16-20 | v1.2 | 21/21 | Complete | 2026-03-13 |
| 21-28.2 | v1.3 | 14/14 | Complete | 2026-03-23 |
| 29-34 | v1.4 | 1/2 | Abandoned | 2026-03-27 |
| 35. Стабилизация production semantics | v1.5 | 1/3 | Complete    | 2026-03-27 |
| 36. Error classification и observability | v1.5 | 2/2 | Complete    | 2026-03-27 |
| 37. Sub-batch архитектура | v1.5 | 1/2 | Abandoned | 2026-03-29 |
| 38. Auto-fallback и production hardening | v1.5 | 0/? | Cancelled | 2026-03-29 |
| Gemini Direct + Vertex AI | v1.6 | delivered вне GSD plans | Complete | 2026-06-16 |
| Production Reliability Baseline | next | 0/5 workstreams | Proposed | - |
