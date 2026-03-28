# Исследование: Оптимизация обработки книг в fancai — миграция с LLM-only на гибридную архитектуру

## Дата: 2026-03-23
## Обновлено: 2026-03-23 (по результатам аудита v2)

---

## Executive Summary

Текущая архитектура fancai обрабатывает каждую книгу целиком через OpenRouter LLM API (Gemini 3 Flash Preview), что создаёт три проблемы: **высокая стоимость** (~$1.50 за книгу), **низкая скорость** (5-15 минут на книгу), и **нестабильное качество** (галлюцинации, неточные позиции, пропуск дубликатов).

**Рекомендуемая стратегия:** поэтапная миграция к гибридной архитектуре, которая разделяет бесплатные локальные задачи и платные LLM-вызовы:

| Этап | Что делаем | Экономия | Сложность | Срок |
|------|-----------|----------|-----------|------|
| **Phase 1** | GLiNER2 для NER → базовый Entity Wiki без LLM | ~70% вызовов | Средняя | 16-20 ч |
| **Phase 2** | Rule-based + TF-IDF classifier для описаний → LLM только для top-K | ~85% вызовов для описаний | Средняя | 14-18 ч |
| **Phase 3** | LLM только для synthesis (biography/milestones) — 1 вызов на книгу | ~90% общая экономия | Низкая | 10-14 ч |
| **Phase 4** | pgvector embeddings для контекста synthesis | Качество ↑ | Низкая | 8-10 ч |
| **Phase 5** | Оптимизация LLM: Gemini 3.1 Flash Lite, context caching | Ещё ~50% | Низкая | 6-8 ч |

**Итоговая оценка:** стоимость обработки книги снижается с **~$1.50 до ~$0.02-0.05** (экономия 97-99%), скорость возрастает в 3-5 раз, качество NER повышается за счёт детерминированных моделей. GLiNER2 на Literature domain **превосходит GPT-4o** (F1 0.564 vs 0.561) при нулевой стоимости. При 100 книгах/месяц экономия **~$145-148/месяц ($1,740-1,776/год)**.

---

## 0. Инфраструктура сервера

> Все данные проверены по SSH на production-сервере 2026-03-23.

### Характеристики VPS

| Параметр | Значение |
|----------|---------|
| **CPU** | 12 vCPU AMD EPYC 9645 96-Core Processor |
| **RAM** | 32 GB (available ~24 GB) |
| **Disk** | 1 TB NVMe SSD (46 GB used, 921 GB free) |
| **Swap** | 4 GB (127 MB used) |
| **OS** | Debian 13 (Trixie), kernel 6.12.73 |
| **CPU flags** | AVX-512, AVX2, SSE4.2, AES-NI — полная поддержка SIMD для PyTorch/ONNX |

### Docker-инфраструктура

Два compose-файла: `docker-compose.prod.yml` + `docker-compose.monitoring.yml`.

| Контейнер | CPU limit | RAM limit | RAM used | Назначение |
|-----------|-----------|-----------|----------|------------|
| `fancai_postgres` (PG 17.9-alpine) | 4.0 | **12 GB** | 29 MB | shared_buffers=4GB, effective_cache_size=8GB |
| `fancai_backend` (Python 3.12) | 2.0 | **2 GB** | 316 MB | FastAPI (image 468 MB) |
| `fancai_celery` (Python 3.12) | 1.5 | **1.5 GB** | 170 MB | Celery worker (concurrency=2) |
| `fancai_beat` | 0.3 | 256 MB | 98 MB | Celery beat scheduler |
| `fancai_redis` (7.4.8) | 0.5 | 768 MB | 433 MB | maxmemory=640mb |
| `fancai_caddy` | 0.5 | 128 MB | 16 MB | Reverse proxy + auto-HTTPS |
| Monitoring (5 containers) | — | ~832 MB | ~587 MB | Netdata, VictoriaMetrics, Uptime Kuma, Dozzle, Flower |
| **Итого** | **~9.3 vCPU** | **~18 GB** | **~1.65 GB** | |

**Свободные ресурсы:** ~3 vCPU + ~14 GB RAM + 921 GB disk. Более чем достаточно для NLP-моделей в PyTorch.

### Ключевые ограничения для миграции

1. **pgvector НЕ установлен** — `postgres:17.9-alpine` не включает расширение. Потребуется смена образа на `pgvector/pgvector:pg17`.
2. **NLP-зависимости отсутствуют** — в контейнере нет PyTorch, spaCy, transformers. Комментарий в requirements.txt: «NLP REMOVED December 2025 for RAM optimization».
3. **Celery worker** ограничен 1.5 GB RAM — недостаточно для NLP-моделей. Нужно увеличить до 4 GB.
4. **БД маленькая** — 22 MB (8 книг, 233 главы, 274 entities, 519 descriptions). Миграции безопасны.

---

## 1. Текущее состояние и проблемы

### 1.1 Архитектура

Пайплайн обработки книги в fancai:

```
EPUB → Celery task → Для КАЖДОЙ главы:
  → Recursive chunking (max 100k chars, 15% overlap)
  → Для КАЖДОГО чанка → OpenRouter API (Gemini 3 Flash):
      TSA prompt (~2000 токенов) + текст главы
      Structured Output → tagged_text + entities[] + relationships[]
  → TSA Parser → описания с позициями
  → Consistency Manager → entity resolution
  → Сохранение в PostgreSQL
→ Entity Deduplication (LLM)
→ Entity Synthesis (LLM, batch 50 entities)
```

### 1.2 Стоимостная модель (текущая)

Текущие модели через OpenRouter (цены проверены 23 марта 2026):

| Модель | Input ($/1M tokens) | Output ($/1M tokens) | Использование |
|--------|---------------------|----------------------|---------------|
| Gemini 3 Flash Preview | $0.50 | $3.00 | Extraction, TSA, Dedup (текущая) |
| **Gemini 3.1 Flash Lite Preview** | **$0.25** | **$1.50** | **Рекомендация для synthesis** |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | Альтернатива для лёгких задач |
| **DeepSeek V3.2** | **$0.26** | **$0.38** | **Потенциально лучший для synthesis (output в 8× дешевле Gemini 3 Flash)** |
| Gemini 2.0 Flash Lite | $0.075 | $0.30 | Translation (⚠️ deprecation risk) |
| Claude Haiku 4.5 | $1.00 | $5.00 | Fallback |

> **Новая находка (аудит v2):** DeepSeek V3.2 через OpenRouter стоит $0.26/$0.38 — output tokens **в 8 раз дешевле** Gemini 3 Flash ($3.00), **в 4 раза дешевле** Gemini 3.1 Flash Lite ($1.50). При доминировании output в стоимости (TSA, synthesis) — это может быть оптимальный выбор для synthesis-задач. Качество: «performance in the GPT-5 class» по данным OpenRouter. Ограничение: 164k context window (vs 1M у Gemini), data privacy concerns (серверы в Китае — при обработке fiction это приемлемо).

**Расчёт для типичной книги (50 глав, ~1.5M символов ≈ 375k токенов):**

> ⚠️ **Критическое уточнение:** TSA-режим возвращает `tagged_text` — это ВЕСЬ текст главы с XML-тегами. Output tokens для extraction ≈ input size (375k), а не 100k как было указано ранее.

| Компонент | Input tokens | Output tokens | Input cost | Output cost | Итого |
|-----------|-------------|---------------|------------|-------------|-------|
| Extraction (TSA) | 375k | **375k** (tagged_text) | $0.19 | **$1.13** | **$1.31** |
| Entity Dedup | 50k | 10k | $0.03 | $0.03 | $0.06 |
| Entity Synthesis | 80k | 30k | $0.04 | $0.09 | $0.13 |
| **Итого** | | | | | **$1.50** |

При fallback на Claude Haiku 4.5: **$3.50+** за книгу.

OpenRouter не добавляет видимую наценку к провайдерским ценам для стандартных запросов, но batch-скидки провайдеров (Gemini Batch API -50%, Claude Batch API -50%) через OpenRouter недоступны — требуется прямой API ключ.

### 1.3 Проблемы качества

1. **Галлюцинации описаний:** LLM «придумывает» фрагменты, которых нет в тексте
2. **Неточные позиции:** text_offset и first_mention_offset от LLM часто не совпадают с реальным текстом
3. **Entity deduplication:** LLM пропускает очевидные дубликаты ("Геральт" ↔ "Ведьмак") и создаёт ложные слияния
4. **TSA искажения:** LLM модифицирует текст внутри XML-тегов, ломая fuzzy matching
5. **Visual summary качество:** часто < 80 символов или generic описания

---

## 2. NER и Entity Extraction

### 2.1 Классические NER модели для русского языка

#### Natasha / Slovnet

Slovnet — компактная NER-модель из проекта Natasha, обученная на серебряном стандарте Nerus (~1M предложений из новостей).

| Характеристика | Значение |
|---------------|---------|
| Размер модели | ~30 MB |
| F1 (Nerus silver standard) | 93-95% |
| F1 (ручные бенчмарки: factru, gareev) | **88-90% (PER), 82-85% (LOC), 75-80% (ORG)** |
| Скорость (CPU) | ~25 статей/сек |
| Зависимости | Только NumPy |
| Entity types | PER, LOC, ORG |
| Обучена на | Nerus (news-based silver standard) |
| Последний release | ~2021 (проект малоактивен) |

Navec embeddings обучены на **Taiga корпусе** (~12B токенов) — смесь новостей, социальных сетей, субтитров и литературы (не «на художественных текстах» эксклюзивно). Модель на 1-2% уступает DeepPavlov BERT по PER, на 5-7% по ORG.

**Для fancai:** legacy-вариант. Не поддерживает custom types (OBJECT), проект малоактивен с 2021. **Не рекомендуется для новой разработки** — GLiNER2 предпочтительнее по всем параметрам.

#### spaCy (ru_core_news)

spaCy предлагает русскоязычные модели `ru_core_news_sm/md/lg`. По данным исследования NER для русских текстов (arxiv:2506.02589), spaCy Russian Pipeline достигает F1=0.83 на новостном домене с recall 0.81. Однако заметно уступает в различении типов сущностей (LOC vs ORG) по сравнению с английскими моделями.

**Для fancai:** полезен для dependency parsing (извлечение описательных конструкций) и sentence boundary detection. Как NER для fiction уступает GLiNER2.

#### Stanza (Stanford NLP)

Stanza поддерживает русский: модель `ru_syntagrus`. NER через BiLSTM-CRF, F1 ~87-89% (news), CPU inference ~200ms/sentence. Модель ~400MB.

**Для fancai:** уступает GLiNER2 по гибкости (фиксированные entity types), не поддерживает zero-shot. Может быть интересен для dependency parsing (по некоторым бенчмаркам лучше spaCy для русского).

#### DeepPavlov

DeepPavlov (ner_ontonotes_bert_mult) показывает F1=0.81 на русских текстах. Мультиязычная модель на OntoNotes поддерживает расширенный набор типов: PERSON, GPE, WORK_OF_ART, ORG, DATE. Требует BERT (~2GB RAM).

**Для fancai:** не рекомендуется — GLiNER2 легче, гибче и быстрее.

### 2.2 Transformer-based NER: GLiNER2

#### GLiNER2 — основная рекомендация

**GLiNER2** (от Fastino Labs, тот же автор что и оригинальный GLiNER) — единая multi-task модель для NER, Text Classification, Structured Data Extraction и Relation Extraction. Опубликована как EMNLP 2025 System Demo (Zaratiana et al., 2025). Последняя версия на PyPI: `gliner2` v1.2.4 (январь 2026).

| Характеристика | GLiNER2 (рекомендуемый) | GLiNER1 (fallback) |
|---------------|------------------------|-------------------|
| PyPI пакет | `gliner2` v1.2.4 | `gliner` v0.2.26 **(Mar 19, 2026 — обновлён!)** |
| Параметры | **205M** | 400M (multi-v2.1) |
| Задачи | NER + Classification + Structured + RE | NER + RE |
| NER F1 (CrossNER) | **0.590** (closely matches GPT-4o at 0.599) | 0.610 (GLiNER-M, dedicated NER) |
| NER F1 (Literature domain) | **0.564** (превосходит GPT-4o: 0.561) | — |
| Inference (CPU, 12 vCPU EPYC) | **~100-200ms/sentence** | ~200-400ms/sentence |
| RAM (PyTorch) | **~800 MB-1.2 GB** | ~1.5-2 GB |
| Fine-tuning | Built-in `GLiNER2Trainer` (JSONL format) | Отдельный пакет `gliner-finetune` |
| Validation | Regex validators в schema API | Нет |
| ONNX | Поддерживается | Поддерживается (+ Rust `fast-gliner`) |
| Python | >=3.8 (совместим с 3.12) | >=3.8 |

> **NER quality (EMNLP 2025, arxiv:2507.18546):** «GLiNER2 closely matches GPT-4o in overall F1 score (0.590 vs. 0.599) and achieves higher scores in AI and **Literature**» — GLiNER2 на Literature domain **превосходит** GPT-4o. Это при 205M params vs ~1.8T у GPT-4o, бесплатно vs ~$5/1M tokens.

> **GLiNER1 update (Mar 2026):** v0.2.26 (Released Mar 19, 2026) + новая paper «The Million-Label NER: Breaking Scale Barriers with GLiNER bi-encoder» (arxiv:2602.18487).

Ключевые характеристики GLiNER2:
- **Zero-shot NER:** произвольные entity labels (["персонаж", "локация", "артефакт"]) без дообучения
- **CPU-first:** «Lightning-fast inference on standard hardware — no GPU required» (PyPI description)
- **Нет структурных галлюцинаций:** модель возвращает только spans из исходного текста (deterministic). Может ошибочно выделить span (false positive) или пропустить entity (false negative), но не изобретёт текст.
- **Точные позиции:** character offsets, не нужен TSA-парсинг
- **Параллельная экстракция:** все spans за один forward pass
- **Structured extraction:** schema API с валидаторами

```python
from gliner2 import GLiNER2

model = GLiNER2.from_pretrained("fastino/gliner2-base-v1")

# Zero-shot NER для художественной литературы
text = "Геральт из Ривии достал серебряный меч и вошёл в трактир «Старый Лис»."
entities = model.extract(
    text,
    labels=["персонаж", "локация", "артефакт"],
    threshold=0.5
)
# → [("Геральт из Ривии", "персонаж", 0..18), 
#    ("серебряный меч", "артефакт", 28..43),
#    ("Старый Лис", "локация", 58..69)]
```

> **Примечание к benchmarks:** GLiNER (NAACL 2024) «outperforms both ChatGPT and fine-tuned LLMs in zero-shot evaluations on various NER benchmarks». Это сравнение с GPT-3.5/4 (2024). Frontier LLM 2026 (GPT-5.4, Claude Opus 4.6) превосходят GLiNER по quality, но GLiNER2 выигрывает по **цене (бесплатно), скорости (локальный), точности позиций и детерминизму**.

#### Maximum Input Length

GLiNER2 основан на DeBERTa: max 512 tokens (~2000 символов для русского). Для глав в 30k символов нужен chunking:
- Sentence/paragraph chunking ≤ 2000 символов
- Overlap: 1-2 предложения для entity spans на границах
- GLiNER2 API: автоматическое windowing через `model.extract()`
- Альтернатива: `gliner-spacy` пакет с `chunk_size=250` tokens

#### Модели на HuggingFace

| Модель | Размер | Языки | Для fancai |
|--------|--------|-------|------------|
| `fastino/gliner2-base-v1` | 205M | multilingual | **✅ Основная рекомендация** |
| `urchade/gliner_multi-v2.1` | 400M | 100+ | Fallback (GLiNER1) |
| `urchade/gliner_large-v2.1` | 600M | EN only | ❌ Не подходит |
| `onnx-community/gliner_multi-v2.1` | 400M | 100+ | ONNX-версия для GLiNER1 |
| `urchade/gliner_multi_pii-v1` | 400M | 100+ | ❌ PII-модель, не для fiction |
| `nvidia/gliner-PII` | 600M | EN+ | ❌ PII, не для fiction |

#### Fine-tuning на данных fancai

После накопления 500+ книг: fine-tune GLiNER2 на реальных данных fancai (таблица `entities` — уникальное преимущество). Инструменты:
- Built-in `GLiNER2Trainer` (формат: JSON с text + entities)
- `gliner-finetune` пакет + synthetic data generation через LLM
- Active learning: low-confidence predictions → LLM verification → training set

### 2.3 Relation Extraction

Качество RE на русском языке не верифицировано в публикациях. Для fancai RE (KINSHIP, ALLY, ENEMY, FRIEND, ROMANCE) требует domain-specific контекст. **Рекомендация:** оставить RE на LLM (synthesis phase).

Альтернативный подход без LLM: **co-occurrence графы**. GLiNER2 → entities per chapter → co-occurrence matrix (персонажи в одном абзаце/сцене) → NetworkX graph. Дешёвый способ получить базовые relationships (кто с кем взаимодействует) без LLM. Типизацию (ALLY vs ENEMY) оставить на synthesis.

### 2.4 Coreference Resolution / Alias Resolution

Задача: "Геральт" = "Белый Волк" = "Ведьмак" = "он".

**SOTA для русского coref (2026):** SpanBERT-based модели достигают F1 ~65-70% на RuCoCo (Russian Coreference Corpus) — значительно хуже English CoNLL 2012 (~80%+). Никакого production-ready русского coref на CPU не существует.

**Natasha coref:** формально присутствует в Slovnet, но экспериментальное качество, не production-ready. Проект малоактивен с 2021. Разрешает только местоимённые ссылки, НЕ alias resolution («Геральт» ↔ «Ведьмак»).

**Alias resolution** («Белый Волк» → «Геральт») требует world knowledge — без LLM невозможен. Текущий `_deduplicate_entities()` (SequenceMatcher 0.75 + substring) ловит «Гарри» vs «Гарри Поттер», но не «Геральт» vs «Ведьмак».

**Рекомендация:** комбинация:
1. Текущий fuzzy matching (SequenceMatcher + substring) для подобных имён
2. Embedding similarity (cosine ≥ 0.85) для candidate detection
3. LLM deduplication **только** для нерешённых alias-пар (порядка 5-10 пар на книгу)

---

## 3. RAG-подход

### 3.1 Embedding модели для русского языка

| Модель | Размер | Dims | Languages | ruMTEB Avg | CPU viable (12 vCPU EPYC) |
|--------|--------|------|-----------|-----------|---------------------------|
| **GigaEmbeddings** (Sber, 3B) | ~6 GB | 1024 | RU+EN | **69.1** (SOTA) | ⚠️ Тяжёлая |
| **ru-en-RoSBERTa** | ~400M | 768 | RU+EN | ~59-61 | ✅ |
| BGE-M3 | 568M | 1024 | 100+ | ~57-59 | ✅ (2 GB RAM) |
| **multilingual-e5-small** | 118M | 384 | 100+ | ~45-50 | ✅ ~30-80ms/sentence |
| multilingual-e5-large | 560M | 1024 | 100+ | ~52-56 | ✅ |
| Nomic Embed V2 | 475M (305M active) | 768 | ~100 | — | ✅ |
| jina-embeddings-v3 | ~400M | variable | 100+ | — | ✅ |

> **ruMTEB benchmark** (NAACL 2025, Snegirev et al.): специализированный русский benchmark, 23 датасета, 7 категорий (STS, classification, retrieval, reranking, clustering). **GigaEmbeddings** (Sber) — текущий SOTA с 69.1 avg score, но модель 3B params (~6 GB RAM) — тяжеловата для нашего VPS рядом с GLiNER2. **ru-en-RoSBERTa** — «achieves results that are on par with state-of-the-art» при значительно меньшем размере.

**Рекомендация (обновлённая):**
1. **Для старта:** multilingual-e5-small (118M, 384 dims) — минимальный RAM, достаточен для базового retrieval
2. **Для улучшения:** ru-en-RoSBERTa (~400M, 768 dims) — специализирована на русском, значительно лучше на ruMTEB
3. **Если качество критично:** BGE-M3 (568M, 1024 dims) — dense + sparse + ColBERT hybrid search
4. **Не рекомендуется сейчас:** GigaEmbeddings (6 GB RAM — конфликт с GLiNER2 в одном worker)

> **Caveat про e5-small:** бенчмарк «100% Top-5 accuracy» — из конкретного продуктового теста (Amazon Health), не из ruMTEB. На ruMTEB e5-small значительно уступает русскоязычным моделям. Для production стоит перейти на ru-en-RoSBERTa после Phase 4 MVP.

### 3.2 Vector Stores (pgvector)

**pgvector** — очевидный выбор (PostgreSQL уже в стеке).

> ⚠️ **Текущий `postgres:17.9-alpine` НЕ включает pgvector.** Необходимо сменить Docker-образ на `pgvector/pgvector:pg17` (содержит pgvector extension). БД маленькая (22 MB) — миграция безопасна. Backup через pgbackup уже настроен.

```yaml
# docker-compose.prod.yml — изменение
postgres:
  image: pgvector/pgvector:pg17  # было: postgres:17.9-alpine
```

```sql
-- После смены образа
CREATE EXTENSION IF NOT EXISTS vector;

-- Отдельная таблица для embeddings (не ALTER chapters)
CREATE TABLE chapter_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    chunk_text TEXT NOT NULL,
    embedding vector(384) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(chapter_id, chunk_index)
);

CREATE INDEX ON chapter_embeddings 
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

**Стоимость хранения** (100 книг × 50 глав × 384-dim float32):
- 100 × 50 × 384 × 4 bytes = ~7.5 MB — пренебрежимо мало

### 3.3 RAG Pipeline для книг

```
1. При загрузке книги:
   - NER (GLiNER2) → все entities с позициями (бесплатно, локально)
   - Embed каждую главу → pgvector (бесплатно, локально)
   
2. При запросе Entity Wiki:
   - Для каждого entity → vector search → релевантные чанки
   - Агрегировать упоминания по главам
   
3. LLM Synthesis (один раз на книгу):
   - Собрать контекст из NER + vector search
   - Один LLM-вызов для biography milestones + relationships
```

**Экономия:** вместо N LLM-вызовов (по одному на главу), делаем 1-2 вызова на книгу. Вся «черновая работа» (NER, позиции, подсчёт упоминаний) выполняется локально.

---

## 4. Оптимизация парсинга описаний

### 4.1 Rule-based extraction

Визуальные описания имеют характерные лингвистические паттерны:

```python
def is_visual_description(sent: str) -> bool:
    """Heuristic: предложение содержит визуальные детали."""
    visual_adjectives = {"красный", "голубой", "тёмный", "светлый", "высокий", "широкий", ...}
    visual_nouns = {"лицо", "волосы", "глаза", "стена", "потолок", "дверь", ...}
    
    # Простой подсчёт без spaCy (быстрее)
    words = sent.lower().split()
    adj_count = sum(1 for w in words if w in visual_adjectives)
    noun_count = sum(1 for w in words if w in visual_nouns)
    
    return len(sent) >= 80 and adj_count >= 2 and noun_count >= 1
```

**Ограничения:** ловит ~40-60% описаний, пропуская атмосферные и метафорические. Используется как prefilter (высокий recall) перед ML-классификатором.

### 4.2 Classifier-based подход

В БД fancai уже есть **519 размеченных описаний** (таблица `descriptions`). Это готовая обучающая выборка.

**Рекомендуемый подход — двухуровневый:**

1. **Baseline: TF-IDF + LogisticRegression** (~5 MB, <1ms/sentence)
   - Может быть достаточным при F1 ≥ 0.75
   - Минимальные зависимости (`scikit-learn`)
   - Обучается за секунды

2. **Upgrade: sentence-transformer + linear head** (~200 MB, ~5-15ms/sentence)
   - `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
   - Только если TF-IDF baseline F1 < 0.75

**Критически важно:** split по книгам (не по предложениям) для cross-validation. Иначе data leakage через стиль автора.

**Active learning цикл:**
1. Classifier предсказывает с confidence
2. Low-confidence (0.4-0.6) → LLM проверяет
3. Результат → обучающая выборка
4. Периодический re-train → меньше LLM-вызовов со временем

### 4.3 LLM для обогащения

После rule-based + classifier отфильтрованы top-K кандидатов (~20-30 на книгу). LLM только для:
- Определения типа (location/character/atmosphere/object)
- Привязки к entities (entities_mentioned)
- Генерации visual summary

**Стоимость:** вместо обработки ~375k tokens → обрабатываем ~5k input + ~3k output = **~$0.006** (Gemini 3.1 Flash Lite).

### 4.4 Multi-sentence описания

Описания часто пересекают границы предложений. Решения:
1. **Sliding window**: классифицировать 3-sentence windows
2. **Merge heuristic**: если ≥2 adjacent предложения «визуальны» → объединить
3. **Paragraph-level fallback**: если абзац содержит ≥3 визуальных предложения → весь абзац

---

## 5. Инструменты и фреймворки

### 5.1 Orchestration

**Рекомендация: custom pipeline** (без фреймворка). Текущий пайплайн уже custom (`gemini_extractor.py` → `consistency_manager.py` → `book_tasks.py`). Добавление LangChain/LlamaIndex принесёт overhead без значительной пользы.

Использовать отдельные компоненты: GLiNER2 для NER, sentence-transformers для embeddings, pgvector для storage, scikit-learn для classifier.

### 5.2 Structured Output

Текущая реализация (`openrouter_client.generate_structured()`) использует JSON Schema mode — функционально эквивалентно Instructor. Миграция не требуется.

### 5.3 Self-hosted LLM

На 12 vCPU EPYC 9645 без GPU: даже 7B модели через llama.cpp дают ~2-5 tokens/sec — неприемлемо для обработки книг. Self-hosted LLM нецелесообразен.

### 5.4 Новая находка: Gemini 3.1 Flash Lite Preview

❗ **Gemini 3.1 Flash Lite Preview** — $0.25/$1.50 per 1M tokens через OpenRouter. «Outperforms Gemini 2.5 Flash Lite on overall quality», «priced at half the cost of Gemini 3 Flash». Поддерживает thinking levels для cost/quality trade-offs.

**Рекомендация для fancai:**
- **Synthesis:** DeepSeek V3.2 ($0.26/$0.38) — output в 8× дешевле Gemini 3 Flash, GPT-5 class quality
- **Fallback synthesis:** Gemini 3.1 Flash Lite ($0.25/$1.50) — если DeepSeek недоступен
- **Translation:** Gemini 3.1 Flash Lite вместо deprecated Gemini 2.0 Flash Lite
- **Обновлённый fallback chain:**
  ```python
  FALLBACK_MODELS = [
      "google/gemini-3-flash-preview",       # основная (extraction)
      "deepseek/deepseek-v3.2",              # дешёвый synthesis (NEW)
      "google/gemini-3.1-flash-lite-preview", # дешёвый fallback
      "anthropic/claude-haiku-4.5",           # последний fallback
  ]
  ```

### 5.5 Context Caching

Gemini через OpenRouter поддерживает automatic context caching. Системный промпт TSA (~2000 токенов) одинаков для всех глав.
- Без кэша: 50 глав × 2000 = 100k × $0.50/1M = $0.05
- С кэшем: первый write + 49 cache reads (10% от base) = **$0.006**
- **Экономия: ~$0.044 на книгу** (88% на системном промпте)

---

## 6. Рекомендуемая архитектура

### 6.1 Гибридный пайплайн

```
┌─ Phase 1: LOCAL (бесплатно) ──────────────────────────────────────┐
│                                                                    │
│  EPUB загружен                                                     │
│    │                                                               │
│    ├→ Для каждой главы:                                           │
│    │   ├→ GLiNER2 NER → entities с точными позициями              │
│    │   ├→ Rule-based + TF-IDF classifier → candidate описания     │
│    │   └→ Embed (e5-small) → pgvector                             │
│    │                                                               │
│    ├→ Fuzzy dedup (SequenceMatcher + substring) → merge entities   │
│    └→ Embedding similarity → alias candidates                      │
│                                                                    │
│  Результат: базовый Entity Wiki (имена, типы, позиции, упоминания)│
│  + candidate описания с точными позициями                          │
└────────────────────────────────────────────────────────────────────┘

┌─ Phase 2: LLM (точечно, Gemini 3.1 Flash Lite) ──────────────────┐
│                                                                    │
│  Entity Synthesis (1 batch-вызов на книгу):                       │
│    Input: entities + контекст из pgvector (~35k tokens)           │
│    Output: biography milestones, visual_summary, relationships     │
│    Cost: ~$0.039                                                   │
│                                                                    │
│  Description Enrichment (1 вызов на top-K описаний):              │
│    Input: ~20-30 candidate описаний (~5k tokens)                  │
│    Output: тип, entities_mentioned, качество                       │
│    Cost: ~$0.006                                                   │
│                                                                    │
│  Alias Resolution (1 вызов, только нерешённые пары):              │
│    Input: ~5-10 пар с similarity 0.5-0.75 (~3k tokens)           │
│    Output: merge/keep решения                                      │
│    Cost: ~$0.004                                                   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 6.2 Стоимостная модель

Книга: 50 глав, ~1.5M символов, ~375k токенов, ~150 entities.

**Текущий pipeline (all-LLM, Gemini 3 Flash):**

| Компонент | Input tokens | Output tokens | Cost |
|-----------|-------------|---------------|------|
| Extraction (TSA) | 375k | 375k | **$1.31** |
| Entity Dedup | 50k | 10k | $0.06 |
| Entity Synthesis | 80k | 30k | $0.13 |
| **Итого** | | | **$1.50** |

**Гибридный pipeline (GLiNER2 + Gemini 3.1 Flash Lite):**

| Компонент | Метод | Cost |
|-----------|-------|------|
| NER | GLiNER2 (local) | **$0.00** |
| Описания (top-20) | LLM (Gemini 3.1 Flash Lite) | **$0.006** |
| Entity Dedup (5-10 пар) | LLM (Gemini 3.1 Flash Lite) | **$0.004** |
| Entity Synthesis | LLM (Gemini 3.1 Flash Lite) | **$0.039** |
| Embedding | e5-small (local) | **$0.00** |
| **Итого** | | **$0.049** |

**Гибридный pipeline (GLiNER2 + DeepSeek V3.2) — новый вариант:**

| Компонент | Метод | Cost |
|-----------|-------|------|
| NER | GLiNER2 (local) | **$0.00** |
| Описания (top-20) | LLM (DeepSeek V3.2, 5k in + 3k out) | **$0.002** |
| Entity Dedup (5-10 пар) | LLM (DeepSeek V3.2, 3k in + 2k out) | **$0.002** |
| Entity Synthesis | LLM (DeepSeek V3.2, 35k in + 20k out) | **$0.017** |
| Embedding | e5-small (local) | **$0.00** |
| **Итого** | | **$0.021** |

> DeepSeek V3.2 output tokens ($0.38/1M) в **8 раз дешевле** Gemini 3 Flash ($3.00) и в **4 раза дешевле** Gemini 3.1 Flash Lite ($1.50). Synthesis — output-heavy задача, поэтому экономия значительна. Качество «in the GPT-5 class» по OpenRouter benchmarks.

**Сравнительная таблица:**

| Pipeline | Стоимость/книга | Экономия |
|----------|----------------|----------|
| Текущий (all-LLM, Gemini 3 Flash) | **$1.50** | — |
| Гибрид + Gemini 3 Flash | **$0.10** | **93%** |
| Гибрид + Gemini 3.1 Flash Lite | **$0.05** | **97%** |
| **Гибрид + DeepSeek V3.2** | **$0.02** | **99%** |
| Гибрид + Gemini Batch API (50%) | **$0.025** | **98%** |
| Full Local (без synthesis) | **$0.00** | **100%** |

**При 100 книгах/месяц:** $150 → $2-5 = экономия **$145-148/месяц ($1,740-1,776/год)**.

### 6.3 План миграции (детальный)

#### Phase 1: GLiNER2 для NER (16-20 часов)

| # | Задача | Часы | Зависимости | Acceptance Criteria |
|---|--------|------|-------------|---------------------|
| 1.1 | `NERService` — класс, singleton, lazy load GLiNER2 | 4h | — | Unit tests: 10 examples, correct entity extraction |
| 1.2 | Chunking для длинных глав (>512 tokens) | 4h | 1.1 | Глава 30k chars обработана корректно |
| 1.3 | Маппинг NEREntity → ExtractedEntity (backward compat) | 2h | 1.1 | ChapterAnalysisResult совместим с текущим pipeline |
| 1.4 | Feature flag `USE_GLINER_NER` + integration в `book_tasks.py` | 3h | 1.1, 1.3 | Flag off → текущий pipeline, flag on → GLiNER2 |
| 1.5 | Docker: `gliner2` + `torch` (CPU) в requirements.txt, Celery limits 4GB/1 worker | 1h | — | Build проходит, worker стартует |
| 1.6 | A/B тест на 5 книгах, метрики | 4h | 1.1-1.5 | Отчёт: recall, precision, cost comparison |

**Go/No-Go после 1.6:** Entity recall ≥ 80% vs LLM baseline → Phase 2. Recall < 70% → исследовать fine-tuning.

#### Phase 2: Description Classifier (14-18 часов)

| # | Задача | Часы | Зависимости | Acceptance Criteria |
|---|--------|------|-------------|---------------------|
| 2.1 | Export training data из 519 descriptions в БД | 2h | — | ≥500 positive + ≥500 negative |
| 2.2 | TF-IDF + LogisticRegression baseline | 3h | 2.1 | F1 ≥ 0.70 (per-book split) |
| 2.3 | Rule-based prefilter (визуальные прилагательные/существительные) | 2h | — | Recall ≥ 90% на training data |
| 2.4 | Sentence-transformer classifier (если TF-IDF F1 < 0.75) | 4h | 2.1 | F1 ≥ 0.80 |
| 2.5 | Feature flag `USE_DESCRIPTION_CLASSIFIER` + integration | 3h | 2.2/2.4 | Flag off → LLM, flag on → classifier + LLM top-K |
| 2.6 | A/B тест на 5 книгах | 2h | 2.5 | Precision ≥ 70%, cost reduction ≥ 50% |

**Параллелизация:** Phase 2 может начаться параллельно с Phase 1 (независимые компоненты).

#### Phase 3: Entity Resolution + Synthesis (10-14 часов)

| # | Задача | Часы | Зависимости | Acceptance Criteria |
|---|--------|------|-------------|---------------------|
| 3.1 | `EntityResolutionService` — рефакторинг ConsistencyManager | 4h | Phase 1 | Все текущие тесты проходят |
| 3.2 | Embedding-based alias detection | 3h | Phase 4 | Top-10 alias candidates содержат реальные aliases |
| 3.3 | Один batch synthesis call вместо per-entity | 2h | 3.1 | Cost synthesis ≤ $0.10/book |
| 3.4 | Fallback chain → Gemini 3.1 Flash Lite | 2h | — | Quality ≥ текущего при меньшей цене |
| 3.5 | E2E integration testing | 3h | 3.1-3.4 | Книга обработана, все entities в БД |

#### Phase 4: Embeddings + pgvector (8-10 часов)

| # | Задача | Часы | Зависимости | Acceptance Criteria |
|---|--------|------|-------------|---------------------|
| 4.1 | Docker: сменить PG image на `pgvector/pgvector:pg17` | 1h | — | PostgreSQL стартует, данные целы |
| 4.2 | Alembic migration: vector extension + таблица | 2h | 4.1 | Migration up/down работает |
| 4.3 | `EmbeddingService` — singleton, batch encode | 3h | 4.2 | 50 глав embedded за < 60 секунд |
| 4.4 | Vector search для entity context | 2h | 4.3 | Top-5 chunks содержат entity mentions |

**Параллелизация:** Phase 4 может начаться параллельно с Phase 1-2 (4.1-4.2 не зависят от NER).

#### Phase 5: Оптимизация и Rollout (6-8 часов)

| # | Задача | Часы | Зависимости | Acceptance Criteria |
|---|--------|------|-------------|---------------------|
| 5.1 | Context caching для LLM calls | 2h | — | Verified savings |
| 5.2 | Cost monitoring per-book | 2h | — | Dashboard показывает стоимость |
| 5.3 | Gradual rollout: 10% → 50% → 100% | 2h | Phases 1-4 | Без регрессий |
| 5.4 | Documentation + KNOWLEDGE.md | 2h | — | Pipeline задокументирован |

**Итого: 54-70 часов.** При 6-8 ч/день: **7-12 дней.** С параллелизацией Phase 1+2+4: **5-8 дней.**

### 6.4 Docker-конфигурация для NLP

```yaml
# docker-compose.prod.yml — изменения для гибридного pipeline

# 1. PostgreSQL: сменить образ для pgvector
postgres:
  image: pgvector/pgvector:pg17  # было: postgres:17.9-alpine
  # Остальные настройки без изменений

# 2. Celery Worker: увеличить ресурсы для NLP-моделей
celery-worker:
  command: >
    celery -A app.core.celery_app worker
    --loglevel=info
    --concurrency=1              # было 2: модели в памяти, один процесс
    --max-tasks-per-child=0      # было 100: не перезапускать (модели persist)
    --prefetch-multiplier=1
  deploy:
    resources:
      limits:
        cpus: '4.0'             # было 1.5
        memory: 4G              # было 1.5G
      reservations:
        cpus: '1.0'
        memory: 2G
```

**Memory budget для Celery worker (4 GB):**
| Компонент | RAM |
|-----------|-----|
| Python + app | ~300 MB |
| GLiNER2 (PyTorch, 205M) | ~800 MB-1.2 GB |
| e5-small | ~500 MB |
| TF-IDF classifier | ~20 MB |
| Headroom | ~2 GB |

### 6.5 Feature Flags

Текущая система (`FeatureFlagManager`, category NLP/PARSER/IMAGES/SYSTEM/EXPERIMENTAL) поддерживает:

```python
# Новые flags (добавить в DEFAULT_FEATURE_FLAGS)
{
    "name": "USE_GLINER_NER",
    "enabled": False,
    "category": "nlp",
    "description": "Use GLiNER2 for primary NER instead of LLM extraction",
},
{
    "name": "USE_DESCRIPTION_CLASSIFIER",
    "enabled": False,
    "category": "nlp",
    "description": "Use ML classifier for description detection instead of LLM",
},
{
    "name": "USE_HYBRID_PIPELINE",
    "enabled": False,
    "category": "nlp",
    "description": "Use full HybridExtractionPipeline (GLiNER2 + classifier + LLM synthesis)",
},
{
    "name": "USE_PGVECTOR_EMBEDDINGS",
    "enabled": False,
    "category": "nlp",
    "description": "Embed chapters in pgvector for entity context enrichment",
},
```

Float-параметры — через env vars:
- `GLINER_CONFIDENCE_THRESHOLD=0.4`
- `DESCRIPTION_CLASSIFIER_THRESHOLD=0.6`
- `LLM_SYNTHESIS_MODEL=google/gemini-3.1-flash-lite-preview`

### 6.6 Rollback план

Каждый phase контролируется feature flag. При проблемах:
1. `USE_GLINER_NER=false` → revert на LLM extraction
2. `USE_DESCRIPTION_CLASSIFIER=false` → LLM для всех описаний
3. `USE_HYBRID_PIPELINE=false` → полный fallback на `gemini_extractor`
4. Entities из hybrid pipeline маркированы `extraction_pipeline='hybrid_v1'` → можно фильтровать

### 6.7 Риски и mitigation

| Риск | Вероятность | Влияние | Mitigation |
|------|-------------|---------|------------|
| GLiNER2 низкое качество на русской fiction | Средняя | Высокое | A/B тест, fallback на GLiNER1/LLM, fine-tune на данных fancai |
| TF-IDF classifier пропускает описания | Средняя | Среднее | Upgrade на sentence-transformer, LLM-fallback для low-confidence |
| Docker image увеличится (468MB → ~1.5-2GB) | Высокая | Низкое | NVMe SSD 921GB free, build cache |
| pgvector image incompatibility | Низкая | Высокое | Backup перед миграцией, тест на dev |
| Celery worker OOM с NLP-моделями | Низкая | Высокое | Memory limit 4GB, мониторинг через Netdata |
| Gemini 2.0 Flash Lite deprecation | Высокая | Среднее | Миграция на Gemini 3.1 Flash Lite (уже рекомендовано) |

---

## 7. Источники

1. **GLiNER (NAACL 2024):** Zaratiana et al. "GLiNER: Generalist Model for Named Entity Recognition using Bidirectional Transformer" — https://aclanthology.org/2024.naacl-long.300
2. **GLiNER2 (EMNLP 2025):** Zaratiana et al. "GLiNER2: Schema-Driven Multi-Task Learning for Structured Information Extraction" — https://aclanthology.org/2025.emnlp-demos.10/ — F1 0.590 на CrossNER, сопоставим с GPT-4o (0.599)
3. **GLiNER2 system paper (arxiv):** https://arxiv.org/html/2507.18546v1 — benchmarks, Literature domain F1=0.564 > GPT-4o (0.561)
4. **GLiNER2 PyPI v1.2.4:** https://pypi.org/project/gliner2/ (Jan 2026) — 205M params
5. **GLiNER PyPI v0.2.26:** https://pypi.org/project/gliner/ (Mar 19, 2026) — обновлённая версия
6. **GLiNER Million-Label NER (2026):** Stepanov et al. "The Million-Label NER: Breaking Scale Barriers with GLiNER bi-encoder" — https://arxiv.org/abs/2602.18487
7. **GLiNER-Relex для GraphRAG:** https://autognosi.medium.com/graphrag-rs-2026-kv-caching-structural-extraction-gliner-relex-to-improve-speed-d340c0e5d127
8. **Natasha / Slovnet NER:** https://github.com/natasha/slovnet — 30MB, CPU, F1 88-90% (PER, ручные бенчмарки)
9. **Russian NER benchmark (2025):** "Evaluating NER Models for Russian Cultural News Texts" — https://arxiv.org/html/2506.02589v1
10. **ruMTEB (NAACL 2025):** Snegirev et al. "The Russian-focused embedders' exploration" — https://aclanthology.org/2025.naacl-long.12/ — 23 датасета, 7 категорий
11. **GigaEmbeddings (Sber):** SOTA на ruMTEB (69.1 avg score) — упомянуто в ResearchGate discussion
12. **ru-en-RoSBERTa:** русскоязычная embedding модель, NAACL 2025 — https://arxiv.org/abs/2408.12503
13. **BGE-M3:** https://github.com/FlagOpen/FlagEmbedding
14. **OpenRouter Gemini 3 Flash pricing:** https://openrouter.ai/google/gemini-3-flash-preview — $0.50/$3.00 (verified 2026-03-23)
15. **OpenRouter Gemini 3.1 Flash Lite:** https://openrouter.ai/google/gemini-3.1-flash-lite-preview — $0.25/$1.50
16. **OpenRouter DeepSeek V3.2:** https://openrouter.ai/deepseek/deepseek-v3.2 — $0.26/$0.38 (GPT-5 class quality)
17. **OpenRouter Google models:** https://openrouter.ai/google — full listing incl. Gemini 2.5 Flash-Lite ($0.10/$0.40)
18. **Anthropic Claude Haiku 4.5:** https://www.anthropic.com/news/claude-haiku-4-5 — $1.00/$5.00
19. **Anthropic API pricing:** https://platform.claude.com/docs/en/about-claude/pricing
20. **Gemini Batch API 50% discount:** https://costgoat.com/pricing/gemini-api
21. **OpenRouter pricing policy:** https://openrouter.ai/pricing
22. **spaCy ru_core_news:** https://huggingface.co/spacy/ru_core_news_sm
23. **Naeval benchmarks (Russian NLP):** https://github.com/natasha/naeval
24. **gliner-spacy integration:** https://pypi.org/project/gliner-spacy/ — chunking support
25. **fast-gliner (Rust+ONNX):** https://pypi.org/project/fast-gliner/ — v0.1.12
26. **OpenRouter March 2026 models overview:** https://www.teamday.ai/blog/top-ai-models-openrouter-2026 — «DeepSeek V3.2 achieves ~90% of GPT-5.4's performance at 1/50th the cost»
27. **GLiNER2 GitHub:** https://github.com/fastino-ai/GLiNER2 — unified schema-based IE
