# Requirements: fancai v1.4

**Defined:** 2026-03-24
**Core Value:** Пользователь загружает книгу, читает её, получает AI-сгенерированный глоссарий персонажей без спойлеров, видит иллюстрации, делает заметки и выделения — и всё это работает стабильно на любом устройстве.

## v1.4 Requirements

Миграция с all-LLM pipeline на гибридную архитектуру. Стоимость обработки книги: $1.50 → $0.02-0.05 (97-99% экономия).

### Infrastructure

- [x] **INFRA-01**: PostgreSQL мигрирован на pgvector/pgvector:pg17 через pg_dump/restore (не image swap — Alpine/Debian несовместимы)
- [x] **INFRA-02**: Celery worker настроен на 4GB RAM, concurrency=1, max-tasks-per-child=0 для NLP моделей в памяти
- [ ] **INFRA-03**: Колонка pipeline_version добавлена в таблицы entities и descriptions для трекинга и rollback
- [ ] **INFRA-04**: Feature flags USE_GLINER_NER, USE_DESCRIPTION_CLASSIFIER, USE_HYBRID_PIPELINE, USE_PGVECTOR_EMBEDDINGS зарегистрированы в FeatureFlagManager
- [x] **INFRA-05**: Отдельный Dockerfile для Celery worker с PyTorch CPU-only (без раздувания API image)

### NER (Entity Extraction)

- [ ] **NER-01**: NERService извлекает entities (персонаж, локация, артефакт, организация) из текста главы через GLiNER2
- [ ] **NER-02**: Chunking разбивает главы >512 токенов с overlap на границах предложений для entity spans
- [ ] **NER-03**: Adapter маппит NEREntity → ExtractedEntity для backward compatibility с ConsistencyManager
- [ ] **NER-04**: A/B тест на 5 книгах показывает entity recall ≥80% vs текущий LLM baseline
- [ ] **NER-05**: Confidence threshold откалиброван для русской художественной литературы (диапазон 0.3-0.5)

### Description Classifier

- [ ] **DESC-01**: Training data экспортирована из таблицы descriptions (≥500 positive + ≥500 negative samples)
- [ ] **DESC-02**: TF-IDF + LogisticRegression baseline обучен с leave-one-book-out cross-validation (не random split)
- [ ] **DESC-03**: Rule-based prefilter (визуальные прилагательные/существительные) с recall ≥90% на training data
- [ ] **DESC-04**: Sentence-transformer classifier реализован как upgrade path (если TF-IDF F1 < 0.75)
- [ ] **DESC-05**: LLM обогащает только top-K candidate описаний (тип, entities_mentioned, visual_summary)

### Embeddings

- [ ] **EMB-01**: pgvector extension установлен, таблица chapter_embeddings создана через Alembic migration
- [ ] **EMB-02**: EmbeddingService кодирует главы через multilingual-e5-small (384 dims) как singleton
- [ ] **EMB-03**: HNSW индекс создан для vector_cosine_ops (лучше IVFFlat для малых датасетов)
- [ ] **EMB-04**: Vector search возвращает top-K релевантных chunks для enrichment entity context при synthesis

### LLM Synthesis

- [ ] **SYN-01**: Один batch synthesis вызов на книгу (biography milestones + visual_summary + relationships) вместо per-entity
- [ ] **SYN-02**: DeepSeek V3.2 ($0.26/$0.38) как основная модель synthesis, Gemini 3.1 Flash Lite как fallback
- [ ] **SYN-03**: Context caching для повторяющихся системных промптов (экономия ~88% на system prompt)
- [ ] **SYN-04**: Cost monitoring логирует стоимость обработки каждой книги (input/output tokens × price)

### Rollout

- [ ] **ROLL-01**: Поэтапный rollout через feature flags: 5 книг A/B → 10% → 50% → 100%
- [ ] **ROLL-02**: E2E integration tests покрывают полный hybrid pipeline (EPUB → NER → classifier → embeddings → synthesis → DB)

## v2 Requirements

Отложены на следующий milestone.

- **ONNX-01**: GLiNER2 конвертирован в ONNX для ускорения inference
- **AL-01**: Active learning pipeline: low-confidence predictions → LLM verification → re-train
- **EMBED-UPG-01**: Upgrade embedding модели на ru-en-RoSBERTa (768 dims) для улучшения русскоязычного retrieval
- **COREF-01**: Coreference resolution для местоимённых ссылок
- **BATCH-API-01**: Прямой Gemini Batch API (-50% скидка) вместо OpenRouter для synthesis

## Out of Scope

| Feature | Reason |
|---------|--------|
| Self-hosted LLM | 12 vCPU без GPU — 2-5 tokens/sec неприемлемо |
| GigaEmbeddings (Sber, 3B) | 6 GB RAM — конфликт с GLiNER2 в одном worker |
| Full coreference resolution | F1 ~65-70% на русском — не production-ready |
| LangChain/LlamaIndex | Overhead без пользы — текущий custom pipeline достаточен |
| GLiNER RE (Relation Extraction) | Качество на русском не верифицировано — RE остаётся на LLM |
| ONNX optimization | Отложено в v2 — сначала валидация pipeline |
| Active learning | Отложено в v2 — сначала baseline |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 29 | Complete |
| INFRA-02 | Phase 29 | Complete |
| INFRA-03 | Phase 29 | Pending |
| INFRA-04 | Phase 29 | Pending |
| INFRA-05 | Phase 29 | Complete |
| NER-01 | Phase 30 | Pending |
| NER-02 | Phase 30 | Pending |
| NER-03 | Phase 30 | Pending |
| NER-04 | Phase 30 | Pending |
| NER-05 | Phase 30 | Pending |
| DESC-01 | Phase 31 | Pending |
| DESC-02 | Phase 31 | Pending |
| DESC-03 | Phase 31 | Pending |
| DESC-04 | Phase 31 | Pending |
| DESC-05 | Phase 31 | Pending |
| EMB-01 | Phase 32 | Pending |
| EMB-02 | Phase 32 | Pending |
| EMB-03 | Phase 32 | Pending |
| EMB-04 | Phase 32 | Pending |
| SYN-01 | Phase 33 | Pending |
| SYN-02 | Phase 33 | Pending |
| SYN-03 | Phase 33 | Pending |
| SYN-04 | Phase 33 | Pending |
| ROLL-01 | Phase 34 | Pending |
| ROLL-02 | Phase 34 | Pending |

**Coverage:**
- v1.4 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-03-24*
*Last updated: 2026-03-24 after roadmap creation*
