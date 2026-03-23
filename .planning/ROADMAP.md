# Дорожная карта: fancai

## Milestones

- v1.0 Готовность к продакшену (shipped 2026-03-09) -- archived
- v1.1 Reader Mobile / PWA (shipped 2026-03-09) -- archived
- v1.2 Reader Stability & Polish (shipped 2026-03-13) -- archived
- v1.3 iOS Reader Navigation Fixes (shipped 2026-03-23) -- archived
- v1.4 Оптимизация обработки книг (in progress)

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

### v1.4 Оптимизация обработки книг (In Progress)

**Milestone Goal:** Миграция с all-LLM pipeline на гибридную архитектуру (GLiNER2 + classifier + pgvector + LLM synthesis). Стоимость обработки книги: $1.50 -> $0.02-0.05 (97-99% экономия).

- [x] **Phase 29: Docker и DB инфраструктура** - pgvector image, Celery worker limits, schema migration, feature flags, отдельный Dockerfile
- [ ] **Phase 30: GLiNER2 NER Service** - Локальная entity extraction с chunking, adapter для ConsistencyManager, A/B тест на 5 книгах
- [ ] **Phase 31: Description Classifier** - TF-IDF + LogReg classifier с leave-one-book-out CV, rule-based prefilter, LLM enrichment top-K
- [ ] **Phase 32: pgvector Embeddings** - EmbeddingService (multilingual-e5-small), HNSW индекс, vector search для entity context
- [ ] **Phase 33: LLM Batch Synthesis** - Один batch вызов на книгу через DeepSeek V3.2, context caching, cost monitoring
- [ ] **Phase 34: Rollout и интеграция** - E2E integration tests, поэтапный rollout через feature flags

## Phase Details

### Phase 29: Docker и DB инфраструктура
**Goal**: Инфраструктура готова для NLP-моделей — pgvector работает с мигрированными данными, Celery worker настроен на 4GB RAM, schema поддерживает hybrid pipeline, feature flags контролируют rollout
**Depends on**: Nothing (first phase of v1.4)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05
**Success Criteria** (what must be TRUE):
  1. PostgreSQL запущен на pgvector/pgvector:pg17, все существующие данные доступны, ORDER BY на русском тексте корректен
  2. Celery worker стартует с concurrency=1 и memory limit 4GB без OOM при загрузке PyTorch CPU
  3. Колонки extraction_source и pipeline_version существуют в таблицах entities и descriptions, таблица chapter_embeddings создана с vector(384)
  4. Четыре feature flags (USE_GLINER_NER, USE_DESCRIPTION_CLASSIFIER, USE_HYBRID_PIPELINE, USE_PGVECTOR_EMBEDDINGS) зарегистрированы и по умолчанию выключены
  5. docker compose build собирает отдельный Celery image с PyTorch CPU-only (~250MB wheel, не ~2.5GB CUDA)
**Plans:** 2/2 plans complete

Plans:
- [x] 29-01-PLAN.md — Docker инфраструктура: Dockerfile.celery + docker-compose.prod.yml (pgvector, Celery 4GB, nlp_models volume)
- [x] 29-02-PLAN.md — Schema, модели, feature flags, Alembic-миграция, тесты

### Phase 30: GLiNER2 NER Service
**Goal**: Пользователь получает entity extraction сопоставимого качества с LLM, но бесплатно через локальную GLiNER2 модель
**Depends on**: Phase 29
**Requirements**: NER-01, NER-02, NER-03, NER-04, NER-05
**Success Criteria** (what must be TRUE):
  1. NERService извлекает персонажей, локации, артефакты и организации из текста главы через GLiNER2 с корректными character offsets
  2. Главы >512 токенов корректно разбиваются на чанки с overlap на границах предложений, entity spans на границах дедуплицируются
  3. NEREntity -> ExtractedEntity adapter обеспечивает backward compatibility — ConsistencyManager работает без изменений
  4. A/B тест на 5 книгах показывает entity recall >= 80% по сравнению с текущим LLM baseline
  5. Confidence threshold откалиброван для русской художественной литературы (ожидаемый диапазон 0.3-0.5)
**Plans**: TBD

Plans:
- [ ] 30-01: TBD
- [ ] 30-02: TBD

### Phase 31: Description Classifier
**Goal**: Описания классифицируются локально через TF-IDF/sentence-transformer вместо LLM, с верифицированным качеством через leave-one-book-out cross-validation
**Depends on**: Phase 29
**Requirements**: DESC-01, DESC-02, DESC-03, DESC-04, DESC-05
**Success Criteria** (what must be TRUE):
  1. Training data экспортирована из production БД с корректным per-book split (>= 500 positive + >= 500 negative samples)
  2. TF-IDF + LogReg classifier обучен с leave-one-book-out CV и достигает F1 >= 0.70 (или автоматический upgrade на sentence-transformer)
  3. Rule-based prefilter отсеивает очевидно не-визуальные предложения с recall >= 90%
  4. LLM вызывается только для top-K candidate описаний (тип, entities_mentioned, visual_summary), остальные классифицируются локально
**Plans**: TBD

Plans:
- [ ] 31-01: TBD
- [ ] 31-02: TBD

### Phase 32: pgvector Embeddings
**Goal**: Релевантные текстовые чанки находятся по семантической близости для обогащения entity context при synthesis
**Depends on**: Phase 29
**Requirements**: EMB-01, EMB-02, EMB-03, EMB-04
**Success Criteria** (what must be TRUE):
  1. pgvector extension активен, таблица chapter_embeddings с vector(384) создана через Alembic migration
  2. EmbeddingService кодирует главы через multilingual-e5-small как singleton, модель загружается один раз и персистит в памяти worker
  3. HNSW индекс создан для vector_cosine_ops, vector search возвращает top-K релевантных чанков за < 50ms
  4. Vector search интегрирован в synthesis pipeline — entity context обогащается релевантными чанками вместо полного текста главы
**Plans**: TBD

Plans:
- [ ] 32-01: TBD
- [ ] 32-02: TBD

### Phase 33: LLM Batch Synthesis
**Goal**: LLM вызывается один раз на книгу (вместо per-chapter) через DeepSeek V3.2, с cost monitoring и context caching, снижая стоимость до $0.02-0.05/книга
**Depends on**: Phase 30, Phase 31, Phase 32
**Requirements**: SYN-01, SYN-02, SYN-03, SYN-04
**Success Criteria** (what must be TRUE):
  1. Один batch synthesis вызов на книгу генерирует biography milestones, visual_summary и relationships для всех entities
  2. DeepSeek V3.2 используется как primary модель с fallback на Gemini 3.1 Flash Lite, оба через OpenRouter
  3. Context caching снижает стоимость повторяющихся системных промптов (~88% экономия на system prompt)
  4. Cost monitoring логирует input/output tokens и стоимость обработки каждой книги, доступен для анализа
**Plans**: TBD

Plans:
- [ ] 33-01: TBD
- [ ] 33-02: TBD

### Phase 34: Rollout и интеграция
**Goal**: Hybrid pipeline проверен E2E тестами и поэтапно раскатан на production через feature flags с возможностью мгновенного rollback
**Depends on**: Phase 33
**Requirements**: ROLL-01, ROLL-02
**Success Criteria** (what must be TRUE):
  1. E2E integration tests покрывают полный путь: EPUB -> NER -> classifier -> embeddings -> synthesis -> DB, тесты зелёные
  2. Поэтапный rollout работает: 5 книг A/B -> 10% -> 50% -> 100%, с мониторингом quality/cost на каждом этапе
  3. Rollback на LLM pipeline через один SQL UPDATE feature flags занимает < 1 минуты
**Plans**: TBD

Plans:
- [ ] 34-01: TBD
- [ ] 34-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 29 -> 30 -> 31 -> 32 -> 33 -> 34
Note: Phases 30, 31, 32 зависят только от Phase 29 и могут разрабатываться параллельно. Phase 33 ждёт все три.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-8 | v1.0 | 23/23 | Complete | 2026-03-07 |
| 9-14 | v1.1 | 13/13 | Complete | 2026-03-09 |
| 16-20 | v1.2 | 21/21 | Complete | 2026-03-13 |
| 21-28.2 | v1.3 | 14/14 | Complete | 2026-03-23 |
| 29. Docker и DB инфраструктура | v1.4 | 2/2 | Complete | 2026-03-24 |
| 30. GLiNER2 NER Service | v1.4 | 0/? | Not started | - |
| 31. Description Classifier | v1.4 | 0/? | Not started | - |
| 32. pgvector Embeddings | v1.4 | 0/? | Not started | - |
| 33. LLM Batch Synthesis | v1.4 | 0/? | Not started | - |
| 34. Rollout и интеграция | v1.4 | 0/? | Not started | - |
