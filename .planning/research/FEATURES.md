# Feature Research: Гибридный NLP-пайплайн обработки книг

**Domain:** ML/NLP pipeline для AI-ридера художественной литературы
**Researched:** 2026-03-24
**Confidence:** MEDIUM-HIGH

## Executive Summary

Текущий пайплайн fancai обрабатывает каждую книгу целиком через LLM (Gemini 3 Flash), что стоит ~$1.50/книга и занимает 5-15 минут. Гибридная архитектура заменяет LLM на локальные модели для NER и классификации описаний, оставляя LLM только для synthesis (биографии, отношения). Итоговая стоимость: $0.02-0.05/книга (экономия 97-99%).

Исследование верифицировало существующий документ `rag-nlp-optimization-research.md` и аудит. Основные выводы подтверждены, ключевые уточнения внесены ниже.

Пять целевых фич имеют чёткую иерархию зависимостей: GLiNER2 NER и Description Classifier работают независимо, pgvector обогащает контекст для LLM synthesis, а feature flags обеспечивают безопасный rollout каждого компонента.

---

## Feature Landscape

### Table Stakes (Без этого пайплайн не имеет смысла)

Фичи, без которых гибридный пайплайн не может заменить текущий LLM-only подход.

| Feature | Почему обязательно | Сложность | Заметки |
|---------|-------------------|-----------|---------|
| **GLiNER2 NER extraction** | Основа экономии: заменяет TSA extraction ($1.31/книга) на бесплатный локальный NER | HIGH | 205M params, ~800MB-1.2GB RAM, ~100-200ms/sentence на EPYC 9645. DeBERTa: max 512 tokens, нужен chunking. Literature domain F1=0.564 (> GPT-4o 0.561 по EMNLP 2025). Zero-shot с русскими лейблами ["персонаж", "локация", "артефакт", "организация"] |
| **Chunking для длинных глав** | Главы 10-50K символов, GLiNER2 принимает max ~2000 символов (512 tokens) | MEDIUM | Sentence/paragraph chunking с overlap 1-2 предложения. GLiNER2 API имеет встроенный windowing через `model.extract()`, но нужен контроль над chunk boundaries для сохранения entity spans. Оптимальный chunk_size: 100-250 tokens (не 512 — quality degradation на длинных чанках по данным исследований) |
| **Маппинг NEREntity на ExtractedEntity** | Backward compatibility с текущим pipeline (ConsistencyManager, book_tasks.py) | MEDIUM | NEREntity (text, label, start, end, score) должен конвертироваться в существующий ChapterAnalysisResult. Текущий pipeline ожидает: entities[], descriptions[], relationships[], tagged_text. GLiNER2 не производит tagged_text — нужен adapter |
| **Feature flag USE_GLINER_NER** | Безопасный rollback на LLM при проблемах с качеством | LOW | FeatureFlagManager уже в продакшене (6 flags, NLP category). Добавить flag + env var GLINER_CONFIDENCE_THRESHOLD=0.4 |
| **Docker: NLP-зависимости** | GLiNER2 + PyTorch CPU в Celery worker, увеличение RAM до 4GB | MEDIUM | Текущий image 468MB, станет ~1.5-2GB. NLP убрали в декабре 2025 ("NLP REMOVED for RAM optimization"). Celery concurrency=1, max-tasks-per-child=0 (модели persist в памяти) |
| **Description classifier (baseline)** | Заменяет LLM extraction описаний (текущий TSA парсит описания из tagged_text) | HIGH | В БД 519 размеченных описаний — готовый training set. TF-IDF + LogisticRegression как baseline (<1ms/sentence, ~5MB). Upgrade: sentence-transformer + linear head если TF-IDF F1 < 0.75 |
| **LLM synthesis (batch)** | Единственное, для чего LLM ещё нужен: биографии, milestones, relationships | MEDIUM | Один batch-вызов на книгу вместо per-chapter. DeepSeek V3.2 ($0.26/$0.38) — output в 8x дешевле Gemini 3 Flash ($3.00). Context: entities + mention counts + top context chunks |

### Differentiators (Конкурентное преимущество)

Фичи, повышающие качество или снижающие стоимость сверх базовой замены.

| Feature | Value Proposition | Сложность | Заметки |
|---------|-------------------|-----------|---------|
| **pgvector embeddings для контекста** | Вместо передачи всего текста в LLM — vector search релевантных чанков. Повышает quality synthesis при снижении input tokens | MEDIUM | multilingual-e5-small (118M, 384 dims) для старта. pgvector/pgvector:pg17 Docker image. HNSW index (не IVFFlat — лучше для малых датасетов без tuning). ~7.5MB на 100 книг. Alembic migration + CREATE EXTENSION vector |
| **Active learning для classifier** | Со временем classifier становится лучше: low-confidence predictions (0.4-0.6) проверяются LLM, результат добавляется в training set | LOW | Паттерн: classifier predict -> threshold check -> LLM verify -> retrain. Экономия растёт экспоненциально с количеством книг. Переобучение: ежемесячный batch retrain |
| **Embedding-based alias detection** | Дополняет SequenceMatcher для entity dedup. Cosine similarity между entity embeddings выявляет candidates для LLM dedup | LOW | Не заменяет LLM dedup полностью ("Геральт" vs "Ведьмак" семантически далеки). Работает для: "Гарри Поттер" vs "мистер Поттер". ~5-10 alias pairs на книгу -> 1 LLM вызов |
| **Co-occurrence графы (NetworkX)** | Базовые relationships (кто с кем взаимодействует) без LLM. GLiNER entities per chapter -> co-occurrence matrix -> graph | LOW | Типизацию (ALLY/ENEMY/FRIEND) оставить на LLM synthesis. Бесплатный компонент Phase 1 |
| **Context caching (Gemini)** | Системный промпт TSA (~2000 токенов) одинаков для всех глав. Cache read = 10% от base price | LOW | Экономия ~$0.044/книга (88% на системном промпте). OpenRouter поддерживает automatic context caching для Gemini. Незначительно в абсолюте, но принцип важен |
| **DeepSeek V3.2 для synthesis** | Output tokens $0.38/1M vs $3.00 (Gemini 3 Flash) — 8x экономия. "GPT-5 class" quality по OpenRouter | LOW | Ограничение: 164K context window (vs 1M Gemini). Для synthesis ~35K input — достаточно. Data privacy: серверы в Китае, но для fiction это приемлемо. Цена проверена 2026-03-24: $0.26/$0.38 |
| **Incremental processing (per-chapter UI updates)** | NER + embed per chapter -> WebSocket progress updates. Пользователь видит entities по мере обработки | MEDIUM | `useBookProgressWS.ts` уже существует. Phase 1 (NER) — incremental-friendly. Phase 2 (synthesis) — batch after all chapters |
| **Cross-validation по книгам** | Правильная стратегия split для classifier: 80/10/10 по книгам, не по предложениям | LOW | Без этого — data leakage через стиль автора. Stratify по жанру (если доступен). Критически важно для quality classifier |

### Anti-Features (Не реализовывать)

Фичи, которые кажутся полезными, но создают проблемы в контексте fancai.

| Feature | Почему хочется | Почему проблема | Альтернатива |
|---------|---------------|-----------------|-------------|
| **Self-hosted LLM (llama.cpp)** | Нулевая стоимость inference | На 12 vCPU без GPU: ~2-5 tokens/sec для 7B модели — неприемлемо для обработки книг (часы вместо минут) | DeepSeek V3.2 через OpenRouter ($0.02/книга) |
| **ONNX-конвертация GLiNER2 сразу** | Ускорение inference 2-3x | Premature optimization. PyTorch на EPYC 9645 с AVX-512: ~100-200ms/sentence — достаточно для batch processing. ONNX добавляет complexity | PyTorch для Phase 1, ONNX как опция Phase 5 если нужно |
| **Полноценный coreference resolution (русский)** | Разрешение "он" -> "Геральт" повысило бы quality | Русский coref SOTA: F1 ~65-70% (RuCoCo). Нет production-ready CPU решений в 2026. Наташа coref — экспериментальная, малоактивная с 2021 | Оставить alias resolution на LLM dedup для нерешённых пар |
| **GigaEmbeddings (Sber, 3B)** | SOTA на ruMTEB (69.1 avg) | 6GB RAM — конфликтует с GLiNER2 в одном worker. Избыточно для entity context retrieval | multilingual-e5-small (118M) для старта, ru-en-RoSBERTa (~400M) как upgrade |
| **GraphRAG / LightRAG для Knowledge Graph** | Красивая визуализация отношений | Зависит от LLM для extraction — не экономит. pgvector + embeddings проще и дешевле для entity context | Co-occurrence графы (бесплатно) + LLM synthesis для типизации |
| **Zero-shot classification (BART-large-mnli)** | "Is this a visual description?" без обучения | ~800M params, ~500ms/sentence. 2500 предложений x 500ms = 20+ минут на CPU. TF-IDF classifier: <1ms/sentence, 5MB | TF-IDF + LogReg baseline, sentence-transformer upgrade если F1 < 0.75 |
| **Prompt compression (LLMLingua)** | Сжатие промптов 2-5x без потери quality | Для fiction каждое слово может быть частью описания/имени. Сжатие удаляет ключевые детали | Уменьшить объём input через NER + vector search (передавать только релевантные чанки) |
| **Fine-tuning GLiNER2 сразу** | Повысить quality для русской fiction | Нужно 500+ книг для meaningful fine-tune. Сейчас 8 книг. Zero-shot quality достаточен для MVP | Накапливать данные, fine-tune после 500+ книг. Built-in GLiNER2Trainer готов |
| **Gemini Batch API (50% скидка)** | Снижение стоимости synthesis вдвое | Требует прямого Google API ключа, google-genai SDK (убран из deps). Два API клиента параллельно — complexity | OpenRouter с DeepSeek V3.2 ($0.02/книга) дешевле без дополнительной сложности |
| **Multi-class description classifier** | location/character/atmosphere/object | Усложняет обучение при 519 примерах. Binary проще обучить и валидировать | Binary first (описание/не описание), type classification через rule-based: entity PER -> character, LOC -> location |

---

## Feature Dependencies

```
GLiNER2 NER (extraction)
    |
    +-- Chunking (длинные главы)
    |       |
    |       +-- NEREntity -> ExtractedEntity маппинг
    |               |
    |               +-- Feature flag USE_GLINER_NER
    |                       |
    |                       +-- A/B test на 5 книгах (Go/No-Go)
    |
    +-- Co-occurrence графы (NetworkX)
            |
            +-- Embedding-based alias detection
                    |
                    +-- pgvector embeddings
                            |
                            +-- LLM batch synthesis (контекст из vector search)

Description Classifier (параллельно с NER)
    |
    +-- Training data export (519 descriptions)
    |       |
    |       +-- TF-IDF + LogReg baseline
    |       |       |
    |       |       +-- [if F1 < 0.75] Sentence-transformer upgrade
    |       |
    |       +-- Cross-validation по книгам (не по предложениям!)
    |
    +-- Feature flag USE_DESCRIPTION_CLASSIFIER
            |
            +-- Active learning (LLM проверяет low-confidence)

Docker Infrastructure (параллельно)
    |
    +-- pgvector/pgvector:pg17 image (для embeddings)
    |       |
    |       +-- Alembic migration (vector extension + chapter_embeddings table)
    |
    +-- Celery worker: 4GB RAM, concurrency=1, max-tasks-per-child=0
            |
            +-- NLP dependencies (gliner2, torch-cpu, sentence-transformers, scikit-learn)

Feature Flags (сквозная фича)
    |
    +-- USE_GLINER_NER
    +-- USE_DESCRIPTION_CLASSIFIER
    +-- USE_HYBRID_PIPELINE (мастер-флаг)
    +-- USE_PGVECTOR_EMBEDDINGS
```

### Dependency Notes

- **GLiNER2 NER и Description Classifier — независимы:** могут разрабатываться параллельно. Оба работают per-chapter на тексте. NER не зависит от classifier и наоборот.
- **pgvector embeddings зависит от Docker infrastructure:** нужен pgvector/pgvector:pg17 image + Alembic migration перед использованием embeddings.
- **LLM batch synthesis зависит от pgvector:** использует vector search для выбора релевантных чанков контекста. Без pgvector fallback — передача полного текста (дороже, но работает).
- **Active learning зависит от Description Classifier:** сначала baseline classifier, потом цикл улучшения.
- **Co-occurrence графы зависят от GLiNER2 NER:** строятся из entities, извлечённых NER.
- **A/B test критичен для Go/No-Go:** Entity recall >= 80% vs LLM baseline -> продолжаем. Recall < 70% -> исследовать fine-tuning.

---

## MVP Definition

### Phase 1: Core Pipeline (Must Have)

- [x] **GLiNER2 NERService** — singleton, lazy load, chunking для длинных глав
- [x] **NEREntity -> ExtractedEntity маппинг** — backward compat с ConsistencyManager
- [x] **Feature flag USE_GLINER_NER** — toggle между GLiNER2 и LLM extraction
- [x] **Docker: Celery worker 4GB RAM** — NLP-зависимости, concurrency=1
- [x] **A/B test на 5 книгах** — Go/No-Go gate: recall >= 80%

### Phase 2: Description Classifier (Must Have)

- [x] **Export training data** — 519 descriptions + negative samples из БД
- [x] **TF-IDF + LogReg baseline** — F1 >= 0.70 (per-book cross-validation)
- [x] **Feature flag USE_DESCRIPTION_CLASSIFIER** — toggle

### Phase 3: LLM Synthesis Optimization (Must Have)

- [x] **Batch synthesis** — один вызов на книгу (DeepSeek V3.2)
- [x] **Fallback chain** — DeepSeek V3.2 -> Gemini 3.1 Flash Lite -> Claude Haiku 4.5
- [x] **EntityResolutionService** — рефакторинг ConsistencyManager

### Phase 4: Embeddings (Add After Validation)

- [ ] **pgvector/pgvector:pg17** — Docker image swap
- [ ] **Alembic migration** — vector extension + chapter_embeddings table
- [ ] **EmbeddingService** — multilingual-e5-small, batch encode
- [ ] **Vector search для entity context** — обогащение synthesis input

### Phase 5: Optimization (Future)

- [ ] **Active learning** — classifier improvement cycle
- [ ] **Context caching** — Gemini system prompt cache
- [ ] **ONNX conversion** — если нужно ускорение
- [ ] **Cost monitoring** — per-book cost dashboard
- [ ] **Gradual rollout** — 10% -> 50% -> 100%

---

## Feature Prioritization Matrix

| Feature | Экономия / Качество | Сложность | Приоритет | Зависимости |
|---------|---------------------|-----------|-----------|-------------|
| GLiNER2 NER | ~70% LLM вызовов | HIGH | **P0** | Docker, feature flags |
| NER chunking (512 token limit) | Без этого NER не работает на главах | MEDIUM | **P0** | GLiNER2 |
| Feature flags (4 новых) | Безопасный rollout + rollback | LOW | **P0** | Существующий FeatureFlagManager |
| Docker NLP setup | Инфраструктура для всех NLP фич | MEDIUM | **P0** | — |
| Description classifier (TF-IDF) | ~85% LLM вызовов для описаний | MEDIUM | **P1** | Training data export |
| LLM batch synthesis | ~90% общая экономия | MEDIUM | **P1** | GLiNER2, ConsistencyManager refactor |
| DeepSeek V3.2 integration | Output 8x дешевле Gemini 3 Flash | LOW | **P1** | OpenRouter client (уже поддерживает) |
| pgvector embeddings | Quality synthesis (лучший контекст) | MEDIUM | **P2** | Docker image swap, Alembic |
| EmbeddingService (e5-small) | Vector search для synthesis | MEDIUM | **P2** | pgvector |
| Active learning | Classifier улучшается со временем | LOW | **P3** | Description classifier |
| Co-occurrence графы | Бесплатные базовые relationships | LOW | **P3** | GLiNER2 NER |
| Context caching | ~$0.044/книга экономия | LOW | **P3** | — |
| Incremental processing (WS) | UX: entities по мере обработки | MEDIUM | **P3** | GLiNER2, WebSocket (есть) |

**Priority key:**
- **P0**: Блокирует весь пайплайн, без этого ничего не работает
- **P1**: Составляет основу экономии (97-99%), должен быть в MVP
- **P2**: Повышает качество, не критичен для запуска
- **P3**: Optimization, defer до валидации основного pipeline

---

## Детали реализации ключевых фич

### 1. GLiNER2 Zero-Shot NER

**Как работает с русской fiction:**
- Zero-shot: произвольные лейблы на русском (["персонаж", "локация", "артефакт", "организация"])
- Multilingual DeBERTa backbone — обучен на 100+ языках включая русский
- Literature domain F1=0.564 (EMNLP 2025) — превосходит GPT-4o (0.561) на этом домене
- Детерминизм: возвращает только spans из исходного текста, не галлюцинирует
- Точные character offsets — не нужен TSA-парсинг

**Entity types для fiction:**
- `"персонаж"` — character (PER). Основной тип, наибольший recall ожидается
- `"локация"` — location (LOC). Включает fictional places ("Хогвартс", "Ривия")
- `"артефакт"` — object (OBJ). Мечи, кольца, артефакты. Может иметь повышенный FP rate
- `"организация"` — organization (ORG). Ордена, школы, фракции

**Chunking стратегия (512 token limit):**
- **Optimal chunk_size: 100-250 tokens** (не 512). По исследованиям, quality degradation на полных 512-token chunks. При chunk_size=100 извлекается больше entities
- Overlap: 1-2 предложения между чанками для entity spans на границах
- Sentence-level chunking: spaCy `ru_core_news_sm` для sentence boundary detection (или razdel — lightweight русский tokenizer)
- Post-processing: дедупликация entities на границах (same text + overlapping offsets -> merge, keep highest score)
- GLiNER2 API: `model.extract(text, labels, threshold=0.4)` — встроенный windowing, но лучше контролировать chunking самостоятельно для precision

**Confidence threshold:**
- Default: 0.4 (по рекомендации GLiNER docs)
- Для fiction может понадобиться 0.3-0.5 — определяется A/B тестом
- Low-confidence entities (0.3-0.4) — fallback на LLM для проверки

### 2. Description Classifier

**TF-IDF vs Sentence-Transformer:**

| Подход | Размер | Latency | Ожидаемый F1 (519 examples) | Когда |
|--------|--------|---------|----------------------------|-------|
| TF-IDF + LogReg | ~5MB | <1ms/sent | 0.65-0.80 | Baseline, всегда |
| Sentence-transformer + linear head | ~200MB | ~5-15ms/sent | 0.75-0.90 | Если TF-IDF F1 < 0.75 |

**Training data (519 descriptions в БД):**
- Positive: 519 записей из таблицы `descriptions` (content field)
- Negative: нужно сгенерировать — неописательные предложения из тех же глав
  - Стратегия: для каждой главы, содержащей описания, случайные предложения НЕ помеченные как описания
  - Ratio: 1:1 или 1:2 (positive:negative)
- **Критично:** split по книгам (не по предложениям) — иначе data leakage через стиль автора

**Active learning паттерн:**
1. Classifier предсказывает с confidence score
2. High-confidence (>0.7): принять без LLM
3. Low-confidence (0.4-0.6): отправить на LLM для проверки ($0.001 per sentence)
4. LLM verdict -> training set для retrain
5. Переобучение: ежемесячный batch retrain на накопленных данных
6. Со временем: всё меньше low-confidence -> всё меньше LLM вызовов

**Multi-sentence описания:**
- Sliding window: классифицировать 3-sentence windows
- Merge heuristic: >= 2 adjacent "визуальных" предложения -> объединить
- Paragraph-level fallback: >= 3 визуальных предложения в абзаце -> весь абзац

### 3. pgvector Embeddings

**Embedding стратегия для книг:**
- Embed каждую главу по чанкам (~500 символов, ~125 tokens per chunk)
- Модель: multilingual-e5-small (118M params, 384 dims, ~500MB RAM)
- Index: HNSW (vector_cosine_ops) — лучше IVFFlat для малых датасетов, не требует tuning
- Хранение: отдельная таблица `chapter_embeddings` (chapter_id, chunk_index, chunk_text, embedding)
- Стоимость хранения: ~7.5MB на 100 книг (пренебрежимо)

**Vector search для entity context:**
- Для каждого entity -> query: entity name + type -> top-5 relevant chunks
- Агрегировать: все чанки, содержащие entity mentions -> context для synthesis
- Преимущество vs full text: передаём ~5-10K tokens вместо 375K -> снижение стоимости synthesis

**Upgrade path:**
- Start: multilingual-e5-small (118M, 384 dims) — минимальный RAM
- Upgrade: ru-en-RoSBERTa (~400M, 768 dims) — значительно лучше на ruMTEB для русского
- Skip: GigaEmbeddings (6GB) — не влезает рядом с GLiNER2

### 4. LLM Synthesis Optimization

**Batch synthesis:**
- Один вызов на книгу вместо per-entity/per-chapter
- Input: все entities + mention counts + top context chunks из pgvector (~35K tokens)
- Output: biography milestones, visual_summary, relationships (~20K tokens)
- Модель: DeepSeek V3.2 ($0.26/$0.38) — output 8x дешевле Gemini 3 Flash

**Cost model (DeepSeek V3.2):**
- Synthesis: 35K input + 20K output = $0.009 + $0.008 = **$0.017**
- Description enrichment: 5K input + 3K output = **$0.002**
- Alias resolution: 3K input + 2K output = **$0.002**
- **Total LLM: ~$0.021/книга** (vs $1.50 текущий)

**Fallback chain:**
```
DeepSeek V3.2 ($0.26/$0.38)         — primary (output-cheap)
  -> Gemini 3.1 Flash Lite ($0.25/$1.50) — secondary (quality)
    -> Claude Haiku 4.5 ($1.00/$5.00)    — last resort
```

### 5. Feature Flag Rollout

**Паттерн: Canary Deployment для ML pipeline**

Новые feature flags (добавить в DEFAULT_FEATURE_FLAGS):
```
USE_GLINER_NER          -> NLP category, default: false
USE_DESCRIPTION_CLASSIFIER -> NLP category, default: false
USE_PGVECTOR_EMBEDDINGS -> NLP category, default: false
USE_HYBRID_PIPELINE     -> NLP category, default: false (мастер-флаг)
```

**Стратегия rollout:**
1. **Development (flag=false):** разработка и unit tests с flag on в тестах
2. **A/B test (flag=on для 5 книг):** обработать одну книгу обоими pipelines, сравнить
3. **Canary (10%):** включить flag, обработать следующие 2-3 книги новым pipeline
4. **Rollout (50%):** расширить на половину новых обработок
5. **GA (100%):** полный переход, старый pipeline остаётся как fallback

**Rollback:**
- Каждый flag контролирует отдельный компонент — granular rollback
- Entities маркируются `extraction_pipeline='hybrid_v1'` — можно фильтровать
- `USE_HYBRID_PIPELINE=false` — полный fallback на gemini_extractor

**Мониторинг:**
- Per-book cost tracking (LLM usage log уже есть: `llm_usage_log` model)
- Entity count comparison (hybrid vs LLM)
- Description precision/recall (сравнение с LLM baseline)
- Processing time (local NER + LLM synthesis vs full LLM)

---

## Верификация существующего исследования

Документ `rag-nlp-optimization-research.md` (обновлён 2026-03-23) и аудит `rag-nlp-optimization-audit.md` проверены. Ключевые выводы:

| Утверждение | Статус | Уточнение |
|-------------|--------|-----------|
| GLiNER2 F1=0.564 на Literature > GPT-4o (0.561) | VERIFIED (EMNLP 2025, arxiv:2507.18546) | Для 2024 LLMs. Frontier 2026 LLMs превосходят, но GLiNER выигрывает по стоимости/детерминизму |
| GLiNER2 205M params, CPU-first | VERIFIED (PyPI gliner2 v1.2.4) | "Lightning-fast inference on standard hardware" |
| DeepSeek V3.2: $0.26/$0.38 | VERIFIED (openrouter.ai, 2026-03-24) | 164K context window. Не $0.28/$0.42 — зависит от провайдера |
| Стоимость книги $1.50 (текущий) | VERIFIED (audit v2, пересчёт с TSA output) | Ранее занижено до $0.68 — аудит исправил |
| 519 descriptions в БД | VERIFIED (audit, SSH) | 8 книг, 233 главы, 274 entities, 519 descriptions |
| pgvector отсутствует | VERIFIED | postgres:17.9-alpine не включает pgvector |
| Celery 1.5GB RAM — недостаточно | VERIFIED | GLiNER2 ~800MB-1.2GB + app ~300MB = нужно >= 3GB |
| ruMTEB: e5-small уступает русским моделям | VERIFIED (NAACL 2025) | Для MVP достаточен, upgrade на ru-en-RoSBERTa позже |
| Русский coref SOTA F1 ~65-70% | MEDIUM confidence | Нет production-ready CPU решений |

---

## Источники

### Верифицированные (HIGH confidence)
- [GLiNER2 EMNLP 2025](https://arxiv.org/html/2507.18546v1) — F1 benchmarks, Literature domain
- [GLiNER2 PyPI](https://pypi.org/project/gliner2/) — v1.2.4, январь 2026
- [GLiNER2 GitHub](https://github.com/fastino-ai/GLiNER2) — API, examples
- [GLiNER token limit discussion](https://github.com/urchade/GLiNER/discussions/113) — 512 token max, chunking strategies
- [OpenRouter DeepSeek V3.2](https://openrouter.ai/deepseek/deepseek-v3.2) — $0.26/$0.38, проверено 2026-03-24
- [pgvector GitHub](https://github.com/pgvector/pgvector) — HNSW vs IVFFlat
- [ruMTEB NAACL 2025](https://aclanthology.org/2025.naacl-long.12/) — русские embedding benchmarks

### Из существующего исследования (MEDIUM confidence)
- [Natasha/Slovnet](https://github.com/natasha/slovnet) — legacy, не рекомендуется для новой разработки
- [ru-en-RoSBERTa](https://arxiv.org/abs/2408.00503) — русская embedding модель
- [OpenRouter Gemini 3.1 Flash Lite](https://openrouter.ai/google/gemini-3.1-flash-lite-preview) — $0.25/$1.50

### WebSearch only (LOW confidence — требует валидации)
- DeepSeek V3.2 "GPT-5 class quality" — маркетинговое утверждение OpenRouter
- GLiNER2 latency ~100-200ms на EPYC — оценка, нужен бенчмарк на production
- TF-IDF F1 0.65-0.80 на 519 examples — теоретическая оценка, зависит от данных

---
*Feature research for: Гибридный NLP-пайплайн обработки книг (fancai v1.4)*
*Researched: 2026-03-24*
