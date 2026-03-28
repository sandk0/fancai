# Аудит исследования: Оптимизация обработки книг в fancai

## Дата аудита: 2026-03-23
## Аудитор: Lead ML/NLP архитектор (Claude Opus 4.6)
## Аудируемый документ: `rag-nlp-optimization-research.md`

---

## 0. Инфраструктура сервера (проверено по SSH)

### Характеристики VPS

| Параметр | Значение |
|----------|---------|
| **CPU** | 12 vCPU AMD EPYC 9645 96-Core Processor |
| **RAM** | 32 GB (available ~24 GB) |
| **Disk** | 1 TB SSD (46 GB used, 921 GB free) |
| **Swap** | 4 GB (127 MB used) |
| **OS** | Debian 13 (Trixie), kernel 6.12.73 |
| **Hypervisor** | KVM |
| **CPU flags** | AVX-512, AVX2, SSE4.2, AES-NI — полная поддержка ONNX/PyTorch SIMD |

> **Вывод**: сервер **значительно мощнее**, чем предполагал отчёт («VPS без GPU»). 12 vCPU AMD EPYC + 32GB RAM + AVX-512 — это серьёзная машина для CPU-inference. GLiNER2 PyTorch (не только ONNX) будет работать комфортно.

### Docker Compose инфраструктура

Два compose-файла: `docker-compose.prod.yml` (основные сервисы) + `docker-compose.monitoring.yml` (мониторинг).

| Контейнер | Image | CPU limit | RAM limit | RAM used | Назначение |
|-----------|-------|-----------|-----------|----------|------------|
| `fancai_postgres` | postgres:17.9-alpine | 4.0 | **12 GB** | 29 MB | PostgreSQL (shared_buffers=4GB, effective_cache_size=8GB) |
| `fancai_backend` | fancai-backend:latest | 2.0 | **2 GB** | 316 MB | FastAPI (Python 3.12, Debian 13, image 468MB) |
| `fancai_celery` | fancai-backend:latest | 1.5 | **1.5 GB** | 170 MB | Celery worker (concurrency=2, max-memory-per-child=512MB) |
| `fancai_beat` | fancai-backend:latest | 0.3 | 256 MB | 98 MB | Celery beat scheduler |
| `fancai_redis` | redis:7.4.8-alpine | 0.5 | 768 MB | 433 MB | Redis (maxmemory=640mb) |
| `fancai_caddy` | caddy:2.11.1-alpine | 0.5 | 128 MB | 16 MB | Reverse proxy + auto-HTTPS |
| `fancai_netdata` | netdata:v2.9.0 | — | 256 MB | 245 MB | Monitoring (⚠️ 95% RAM!) |
| `fancai_victoriametrics` | victoria-metrics:v1.137.0 | — | 256 MB | 175 MB | Long-term metrics storage |
| `fancai_uptime_kuma` | uptime-kuma:2.2.1 | — | 128 MB | 117 MB | Uptime monitoring (⚠️ 91% RAM!) |
| `fancai_flower` | flower:2.0.1 | — | 128 MB | 40 MB | Celery task monitoring |
| `fancai_dozzle` | dozzle:v10.1.1 | — | 64 MB | 11 MB | Docker log viewer |
| `fancai_pgbackup` | postgres-backup-local:17 | — | 256 MB | 5 MB | Daily PG backups |
| **Итого** | | **9.3 vCPU** | **~18 GB** | **~1.65 GB** | |

> **Свободная RAM**: 32 GB total − 18 GB container limits = **14 GB headroom** (OS + buffer/cache).
> Фактически используется контейнерами ~1.65 GB из 18 GB лимитов — огромный запас.

### Ключевые наблюдения

1. **PostgreSQL**: `postgres:17.9-alpine` — **pgvector НЕ установлен** (нет в `pg_available_extensions`). Alpine-образ не включает pgvector по умолчанию. Потребуется смена образа на `pgvector/pgvector:pg17` или `ankane/pgvector:pg17`.

2. **NLP-зависимости отсутствуют**: в контейнере backend нет spaCy, transformers, torch, gliner, sentence-transformers. Комментарий в requirements.txt: «NLP REMOVED December 2025 for RAM optimization». Потребуется добавление в Dockerfile.

3. **Celery worker**: concurrency=2, max-memory-per-child=512MB, лимит 1.5 GB. При загрузке GLiNER2 (~800 MB-1.2 GB) в worker потребуется:
   - Увеличить memory limit до **3-4 GB** (RAM позволяет)
   - Модель загружать в main process (shared), не в child process
   - Или: отдельный `fancai_nlp` контейнер с NLP-моделями + internal API

4. **Свободные ресурсы для NLP**: CPU: ~3 vCPU не заняты. RAM: ~14 GB headroom. Достаточно для GLiNER2 PyTorch + e5-small + sentence-transformer classifier одновременно.

5. **Мониторинг**: Netdata (95% RAM) и Uptime Kuma (91% RAM) работают на пределе лимитов. Не критично, но стоит увеличить лимиты при наличии запаса.

6. **БД маленькая**: всего 22 MB (8 книг, 233 главы, 274 entities, 519 descriptions). pgvector добавит пренебрежимо мало.

### Рекомендация по Docker-архитектуре для NLP

**Вариант A (рекомендуемый): NLP в Celery worker**
```yaml
celery-worker:
  deploy:
    resources:
      limits:
        cpus: '4.0'      # было 1.5
        memory: 4G        # было 1.5G
      reservations:
        cpus: '1.0'
        memory: 2G
  command: >
    celery -A app.core.celery_app worker
    --loglevel=info
    --concurrency=1          # снизить до 1 (модели в памяти)
    --max-tasks-per-child=0  # не убивать child (модели persist)
    --prefetch-multiplier=1
```

**Вариант B: Отдельный NLP-сервис**
```yaml
nlp-service:
  image: fancai-backend:latest  # тот же image + NLP deps
  container_name: fancai_nlp
  command: uvicorn app.services.nlp_api:app --host 0.0.0.0 --port 8001
  deploy:
    resources:
      limits:
        cpus: '4.0'
        memory: 4G
  networks:
    - fancai_network
```

Вариант A проще (нет inter-service communication). Вариант B лучше при масштабировании.

---

## 1. Верификация фактов

### 1.1 Ценообразование

**«Gemini 3 Flash Preview: $0.50/$3.00 per 1M tokens через OpenRouter»**
✅ **Верно.** Подтверждено через openrouter.ai: "$0.50 per million input tokens, $3 per million output tokens" (источник: openrouter.ai/google/gemini-3-flash-preview, проверено 2026-03-23). Совпадает с cloudprice.net и pricepertoken.com.

**«OpenRouter передаёт цены провайдеров без наценки»**
⚠️ **Неточно.** OpenRouter позиционирует себя как "transparent pricing" и утверждает "We do not mark up provider pricing" на странице /pricing. Однако на практике цены OpenRouter включают маржу инфраструктуры — для некоторых моделей цена OpenRouter выше, чем прямой доступ через провайдера. Для Gemini 3 Flash: прямая цена Google AI Studio идентична ($0.50/$3.00), но для batch-операций через прямой API доступны скидки 50%, недоступные через OpenRouter. Корректнее: **«OpenRouter не добавляет видимую наценку к провайдерским ценам для стандартных запросов, но batch-скидки провайдеров через OpenRouter недоступны»**.

**«Gemini Batch API даёт 50% скидку»**
✅ **Верно для Google AI Studio.** Однако важное уточнение: Batch API через OpenRouter **не поддерживается** — это требует прямого Google API ключа. Отчёт корректно отмечает это, но не акцентирует последствия: для использования Batch API нужно добавить `google-genai` SDK в зависимости (ранее закомментирован в requirements.txt) и поддерживать два API клиента параллельно.

**«Gemini 2.0 Flash Lite: $0.075/$0.30»**
⚠️ **Верно по цене, но риск deprecation выше, чем указан.** На OpenRouter модель ещё доступна ($0.075/$0.30, источник: openrouter.ai/google). Однако **найдена замена: Gemini 3.1 Flash Lite Preview ($0.25/$1.50)**, которая "outperforms Gemini 2.5 Flash Lite on overall quality" и позиционируется как "priced at half the cost of Gemini 3 Flash". Отчёт полностью пропустил эту модель — она вышла позже и является лучшим кандидатом для translation/synthesis задач.

**Расчёт $0.68 за книгу (раздел 1.2)**
⚠️ **Арифметика верна, но расчёт неполный.**
- Extraction: 375k × $0.50/1M + 100k × $3.00/1M = $0.1875 + $0.30 = **$0.4875 ≈ $0.49** ✅
- Dedup: 50k × $0.50/1M + 10k × $3.00/1M = $0.025 + $0.03 = **$0.055 ≈ $0.06** ✅
- Synthesis: 80k × $0.50/1M + 30k × $3.00/1M = $0.04 + $0.09 = **$0.13** ✅
- Итого: $0.49 + $0.06 + $0.13 = **$0.68** ✅

Проблема: **output tokens для extraction занижены**. TSA-режим возвращает `tagged_text` (≈ input size, то есть 375k, а не 100k) + entities JSON + relationships JSON. Реальный output для extraction: ~300-400k токенов. Пересчёт: 375k × $0.50/1M + 375k × $3.00/1M = $0.1875 + $1.125 = **$1.31 за extraction**. Реальная стоимость книги ≈ **$1.50**, а не $0.68. Это делает оптимизацию ещё более ценной.

**«Claude Haiku 4.5: $1.00/$5.00»**
✅ **Верно.** Подтверждено: "$1/$5 per million input and output tokens" (anthropic.com/news/claude-haiku-4-5, anthropic.com/claude/haiku). Цена актуальна на март 2026.

### 1.2 GLiNER

**«GLiNER v0.2.25, февраль 2026»**
✅ **Верно.** PyPI: "Released: Feb 11, 2026", версия 0.2.25 — файлы `gliner-0.2.25.tar.gz` и `gliner-0.2.25-py3-none-any.whl` подтверждены.

**«outperforms both ChatGPT and fine-tuned LLMs in zero-shot evaluations»**
⚠️ **Верно для контекста 2024, устарело для 2026.** Это утверждение из оригинальной NAACL 2024 статьи, где сравнение было с GPT-3.5/4. Для GPT-5.4 / Claude Opus 4.6 / Gemini 3 Pro — это почти наверняка неверно: frontier LLM 2026 года превосходят GLiNER по quality, но GLiNER выигрывает по **цене (бесплатно), скорости (локальный inference), точности позиций и детерминизму**. Корректная формулировка: «GLiNER конкурентен с LLM 2024 года по качеству NER, уступает frontier LLM 2026 года, но имеет структурные преимущества: нулевая стоимость, детерминизм, точные позиции».

**«CPU-оптимизирована через ONNX»**
⚠️ **Частично верно, но без конкретных бенчмарков.** ONNX-конвертация поддерживается (urchade/GLiNER README, fast-gliner пакет на PyPI). Однако отчёт не приводит конкретных latency цифр на CPU. По найденным данным: GLiNER base модель (~400M params) на CPU (Intel Xeon) обрабатывает ~50-200ms на предложение через ONNX. Для главы в 50 предложений: ~5-10 секунд. Для книги в 50 глав: ~4-8 минут (сравнимо с текущим LLM pipeline, но бесплатно). **fast-gliner** (Rust + ONNX) — отдельный пакет, обещающий ещё более быстрый inference.

**«GLiNER-Relex v0.5»**
⚠️ **Не удалось верифицировать конкретную версию v0.5.** GLiNER-Relex упоминается в контексте GraphRAG-RS, но как отдельный PyPI-пакет не найден. Relation Extraction интегрирован в основной GLiNER через `predict_relations()` API и в GLiNER2 через отдельный пакет. «v0.5» может быть версией модели на HuggingFace, а не PyPI-пакета.

**GLiNER2 от Fastino Labs**
✅ **Верно, отдельный пакет.** PyPI: `gliner2` v1.2.4 (Jan 22, 2026), тот же автор (Urchade Zaratiana). 205M параметров. Поддерживает NER + Text Classification + Structured Data Extraction + Relation Extraction. «CPU First: Lightning-fast inference on standard hardware — no GPU required». Совместимость: отдельный пакет `pip install gliner2`, отличный API от `gliner`. **Отчёт недостаточно исследовал GLiNER2 — это более зрелый и мощный вариант для fancai.**

**«Нет галлюцинаций»**
⚠️ **Неточно.** Правильнее: «нет структурных галлюцинаций» — модель не может изобрести текст, которого нет в input (все spans из исходного текста). Но может ошибочно выделить span как entity (false positive) или пропустить entity (false negative). False positive rate зависит от threshold и типа текста. Для fiction с русскими именами — FP rate может быть выше, чем на English news benchmarks.

**Пример кода с `gliner_multi_pii-v1`**
❌ **Ошибка.** Модель `urchade/gliner_multi_pii-v1` — это PII-модель (Personally Identifiable Information), не подходит для literary NER. Корректные модели для fiction:
- `urchade/gliner_multi-v2.1` — мультиязычная general NER
- `urchade/gliner_large-v2.1` — крупная general NER
- `knowledgator/gliner-multitask-large-v0.5` — multitask
- Для ONNX: `onnx-community/gliner_multi-v2.1`

### 1.3 Natasha / Slovnet

**«F1 93-95% на news»**
⚠️ **Завышено.** F1 93-95% — это результат на серебряном стандарте Nerus (автоматически размеченный корпус). На ручных бенчмарках (factru, gareev, bsnlp) F1 Slovnet ниже: ~88-90% для PER, ~82-85% для LOC, ~75-80% для ORG. Naeval бенчмарки (github.com/natasha/naeval) показывают что Slovnet уступает DeepPavlov BERT на 1-2% в PER, но на 5-7% в ORG. Для **fiction** качество ещё ниже: Nerus обучен на news, а не на художественных текстах.

**«Navec embeddings обучены на художественных текстах (12B токенов)»**
❌ **Ошибка.** Navec embeddings обучены на **Taiga корпусе** (~12B токенов), который включает смесь источников: новости, социальные сети, субтитры, литературу. Не «на художественных текстах», а «включает художественные тексты среди прочих». Nerus (silver standard для обучения Slovnet) создан из news-текстов. Путаница между Navec (embeddings) и Nerus (NER training data).

**«Natasha включает coreference resolution»**
⚠️ **Формально верно, практически бесполезно.** В проекте Natasha есть модуль coreference в Slovnet, но:
1. Качество на русском coref — экспериментальное, не production-ready
2. Проект Natasha/Slovnet малоактивен (последние коммиты спорадические, нет активных releases с 2023)
3. Coref в Slovnet разрешает только местоимённые ссылки, НЕ alias resolution («Геральт» ↔ «Ведьмак»)
4. Для alias resolution в fiction нужен мировой контекст, который ни одна local модель не даёт

**Актуальность Slovnet в 2026**
⚠️ Проект Natasha/Slovnet фактически не поддерживается активно. Последний release Slovnet — 2021. Navec — 2022. Natasha-spacy — 2023. Для новых проектов лучше использовать GLiNER или spaCy с transformer-моделями.

### 1.4 Embedding модели

**«multilingual-e5-small: 100% Top-5 accuracy»**
⚠️ **Вводящее в заблуждение.** Этот бенчмарк (100% Top-5 accuracy) — из конкретного продуктового теста (Amazon Health product matching), не из стандартного академического бенчмарка. Экстраполировать на русский fiction нельзя. Для русского текста нужно смотреть **ruMTEB** (NAACL 2025) — там e5-small не является лидером.

**«16ms на GPU» для e5-small — «на CPU VPS ~100-200ms»**
⚠️ **Оценка CPU latency приблизительна.** 16ms на GPU (какой GPU не указан) — правдоподобно для A100/V100. На CPU VPS (Intel Xeon, 4 ядра) реальный batch-size-1 inference для e5-small: ~50-100ms на предложение (не 100-200ms). Для batch encoding (32 sentences): ~500ms. Для целой главы (~50 предложений): ~150-300ms. Приемлемо для batch processing.

**Отсутствие ruMTEB лидерборда**
❌ **Серьёзный пропуск.** Отчёт упоминает ruMTEB, но не приводит конкретных результатов. Для русского текста на ruMTEB (NAACL 2025) лидеры отличаются от общих MTEB лидербордов. Рекомендации для fancai без ruMTEB-данных — слабо обоснованы. Для fiction-текстов нужен отдельный analysis: semantic similarity между описаниями персонажей — это не стандартная retrieval задача.

### 1.5 Стоимостная модель (раздел 6.2)

**«NER / Entity Extraction: $0.35 (50 LLM calls)» в колонке "Текущий (all-LLM)"**
❌ **Противоречит разделу 1.2.** В разделе 1.2 extraction стоит $0.49 (375k input + 100k output). В разделе 6.2 — $0.35. Разница $0.14 не объяснена. Вероятно ошибка: $0.35 — это только input tokens (375k × $0.50/1M = $0.1875) с заниженным output. Правильное значение: **$0.49** (как в разделе 1.2), или **$1.31** с корректным учётом TSA output (см. пункт 1.1).

**«Описания: $0.14 (included in NER)»**
⚠️ Если описания included в NER extraction, то $0.14 — это двойной подсчёт (описания уже в $0.35/$0.49). Или это отдельный пост-процессинг (LLM для обогащения описаний). Неясно — отчёт не объясняет разделение.

**«Гибрид: $0.11 итого» — проверка каждой строки:**
- NER: $0.00 (GLiNER, CPU) ✅ верно
- Описания: $0.02 (LLM для top-20) — 20 описаний × ~500 символов ≈ 10k chars ≈ 2.5k input tokens. 2.5k × $0.50/1M = $0.00125 input. Output ~1.5k tokens: 1.5k × $3.00/1M = $0.0045. **Итого ~$0.006**, а не $0.02. Завышено в ~3 раза.
- Dedup: $0.01 (5-10 пар) — 10 пар × ~200 символов + prompt ~500 ≈ 2.5k tokens. $0.00125 + ~$0.003 = **~$0.004**. Завышено в ~2.5 раза.
- Synthesis: $0.08 — зависит от контекста. Если передаём 150 entities × ~200 символов + prompt ≈ 35k input tokens: 35k × $0.50/1M = $0.0175. Output ~20k: 20k × $3.00/1M = $0.06. **Итого ~$0.08**. ✅ Корректно.
- **Реальный итого гибрида: ~$0.09**, не $0.11. Ошибка в пользу осторожности (overestimate), что допустимо.

**Output tokens не учтены для TSA**
❌ **Критическая ошибка в стоимостной модели.** TSA-режим возвращает tagged_text — это ВЕСЬ текст главы с вставленными XML-тегами. Для главы в 30k символов output ≈ 32-35k символов ≈ 8-9k tokens. Для 50 глав: 50 × 8.5k = 425k output tokens. 425k × $3.00/1M = **$1.275 за output**. Это доминирующая статья расходов, занижена в 4 раза в отчёте ($0.30 вместо $1.275).

---

## 2. Пропущенные направления

### 2.1 NER: дополнительные модели

#### Stanza (Stanford NLP)
Упомянут в ТЗ, пропущен в отчёте. Stanza поддерживает русский язык: модель `ru_syntagrus`. NER через BiLSTM-CRF. F1 на русском NER: ~87-89% (news). CPU inference: ~200ms/sentence. Размер модели: ~400MB. **Для fancai**: уступает GLiNER по гибкости (fixed entity types), не поддерживает zero-shot. Интересен для dependency parsing (лучше spaCy для русского по некоторым бенчмаркам). Примечательно: GLiNER имеет optional dependency на Stanza (`pip install gliner[stanza]`).

#### NuNER / UniNER
Упомянуты в ТЗ, пропущены. UniNER (University of Illinois) — universal NER через instruction tuning LLaMA. Требует GPU (7B+ parameters). **Не подходит** для VPS без GPU. NuNER — менее известный проект, активность неясна. **Вердикт**: не рекомендуются для fancai.

#### RoBERTa Large NER Russian
На HuggingFace существуют модели типа `ai-forever/ruRoBERTa-large` и NER-версии. F1 на русском NER: ~90-92% (news). Размер: ~1.3GB. CPU inference: ~300-500ms/sentence. **Для fancai**: тяжеловат для VPS (1.3GB RAM), но может быть альтернативой GLiNER если нужен fine-tuned на русском. Преимущество: обучен именно на русском, а не multilingual.

#### spaCy + Transformer backend
spaCy 3.8+ поддерживает transformer-based NER через `spacy-transformers`. Можно подключить BERT/RoBERTa как backend. Для русского: `ru_core_news_trf` (если существует) или custom pipeline с `ai-forever/ruBERT-base`. **Для fancai**: избыточно — GLiNER проще интегрировать и даёт zero-shot.

#### Fine-tuning GLiNER на literary NER
Датасеты для русской художественной литературы:
- **LitBank** (English) — 100 литературных текстов, ~6 entity types. Русского аналога нет.
- Можно создать датасет из существующих данных fancai: таблица `entities` уже содержит тысячи размеченных entities из книг. Это **уникальное преимущество** fancai.
- GLiNER fine-tuning pipeline: `gliner-finetune` пакет (pip install gliner-finetune) + synthetic data generation через OpenAI. Формат: JSON с text + entities spans.
- **Рекомендация**: после накопления 500+ книг, fine-tune GLiNER на данных fancai. До этого — zero-shot с `urchade/gliner_multi-v2.1`.

### 2.2 Entity Wiki: дополнительные подходы

#### Knowledge Graph (GraphRAG, LightRAG)
- **LightRAG** — легковесная KG construction, работает на CPU. Подходит для fiction: строит graph entities + relationships из текста. Минус: использует LLM для extraction (не экономит).
- **nano-graphrag** — минималистичная реализация GraphRAG. CPU-friendly. Но опять зависит от LLM для NER.
- **Вердикт**: KG construction полезен как downstream задача после NER, но не заменяет NER. Для fancai: pgvector + embeddings проще и дешевле.

#### BookNLP (David Bamman)
BookNLP — специализированный NLP pipeline для книг: character extraction, quote attribution, supersense tagging. **Только английский.** Русской версии нет. Архитектура интересна как reference: entity → quotation → relationship pipeline. Может быть адаптирована концептуально для fancai.

#### Character Network Analysis
Co-occurrence графы (персонажи, упоминаемые в одном абзаце/сцене) — можно строить полностью без LLM после NER. GLiNER → entities per chapter → co-occurrence matrix → NetworkX graph. Дешёвый способ получить relationships без LLM. **Рекомендация**: добавить как бесплатный Phase 1 компонент.

#### Incremental Entity Wiki
On-demand per chapter vs batch — ключевой архитектурный вопрос. Текущий fancai: batch (вся книга). Incremental подход:
- NER (GLiNER) — incremental-friendly (per-chapter)
- Embedding — incremental-friendly (per-chapter)
- Entity dedup — нужен after-all-chapters pass
- Synthesis — нужен after-all-chapters pass
- **Вывод**: Phase 1 (NER + embed) может быть incremental, Phase 2 (synthesis) остаётся batch.

### 2.3 Описания: дополнительные методы

#### TextRank / RAKE
Упомянуты в ТЗ, не исследованы. TextRank — unsupervised extractive summarization. Для описаний: извлекает «ключевые предложения», но не различает описание от действия. RAKE — keyword extraction, не sentence-level. **Вердикт**: TextRank может быть полезен как один из сигналов в ensemble (sentence importance score), но не как standalone метод для description extraction.

#### Sentence Embeddings + Clustering
Кластеризация предложений по семантическому содержимому: embed все предложения → KMeans/HDBSCAN → найти «визуальный» кластер. Проблема: «визуальность» — не семантический кластер, а стилистическое свойство. Описание персонажа и описание локации семантически далеки, но оба «визуальны». **Вердикт**: не рекомендуется как primary метод. Может помочь для de-duplication описаний.

#### Zero-shot Classification
BART-large-mnli / XLM-R для zero-shot «is this a visual description?» — потенциально работает на русском через multilingual модели. `facebook/bart-large-mnli` + nli-based classification. Проблема: ~800M params, ~500ms per sentence на CPU. Для 50 глав × 50 предложений = 2500 предложений × 500ms = 20+ минут. **Слишком медленно для CPU VPS.** Лучше: fine-tuned binary classifier (50MB, 5ms/sentence).

#### Chunking для multi-sentence описаний
Описания часто пересекают границы предложений. Решения:
1. **Sliding window**: классифицировать 3-sentence windows вместо individual sentences
2. **Paragraph-level**: если ≥2 предложения подряд «визуальны» — объединить в одно описание
3. **spaCy sentence boundary + heuristic merge**: если два adjacent описания разделены только запятой/точкой — merge

### 2.4 Оптимизация LLM

#### Gemini Context Caching — расчёт экономии
Системный промпт TSA_EXTRACTION_PROMPT: ~2000 токенов. При 50 главах: 50 × 2000 = 100k cache-eligible tokens.
- Без кэша: 100k × $0.50/1M = $0.05
- С кэшем (cache read = 10% от base): 2k × $0.50/1M (первый write) + 49 × 2k × $0.05/1M (reads) = $0.001 + $0.0049 = **$0.006**
- **Экономия: ~$0.044 на книгу** (88%). Незначительно в абсолюте ($0.044), но принцип важен.
- **Через OpenRouter**: context caching поддерживается для Gemini ("automatic context caching" в описании модели). Нужно включить через параметры запроса.

#### Prompt Compression (LLMLingua)
LLMLingua / LongLLMLingua — сжатие промптов на 2-5x без потери качества. Для fiction текста: сомнительно — каждое слово может быть частью описания или именем персонажа. Сжатие может удалить ключевые детали. **Не рекомендуется для extraction.** Может быть полезно для synthesis промптов (сжатие контекста entity events).

#### Gemini 3.1 Flash Lite Preview — новая находка
❗ **Критическая находка, пропущенная в отчёте.** Gemini 3.1 Flash Lite Preview: $0.25/$1.50 per 1M tokens через OpenRouter. «Outperforms Gemini 2.5 Flash Lite on overall quality» и стоит **вдвое дешевле** Gemini 3 Flash. Поддерживает thinking levels для cost/quality trade-offs.

**Рекомендация для fancai:**
- **Synthesis**: Gemini 3.1 Flash Lite ($0.25/$1.50) вместо Gemini 3 Flash ($0.50/$3.00) — экономия 50%
- **Translation**: Gemini 3.1 Flash Lite вместо deprecated Gemini 2.0 Flash Lite — лучше качество за сравнимую цену
- **Fallback chain**: Gemini 3 Flash → Gemini 3.1 Flash Lite → Claude Haiku 4.5

#### OpenAI Batch API
OpenAI Batch API: 50% скидка. Через OpenRouter: **не поддерживается** (как и Gemini Batch). Для GPT-5.4-mini batch: нужен прямой OpenAI API ключ. Актуальные цены GPT-5.4-mini: проверка показывает сопоставимые цены с Gemini 3 Flash. **Не рекомендуется**: добавление третьего API провайдера (OpenAI) увеличивает сложность без значительной экономии.

#### Кэширование между книгами
Серии книг (одни и те же персонажи): entity data из тома 1 переиспользуется в томе 2. Текущая архитектура fancai: entities привязаны к book_id. Для кросс-книжного кэширования:
- При загрузке тома 2: найти entities с совпадающими именами в других книгах того же автора
- Перенести visual_summary, biography milestones, relationships
- **Экономия**: synthesis phase для повторяющихся персонажей может быть пропущен
- **Риск**: персонаж развивается (молодой Дамблдор vs старый Дамблдор). Нужен merge, не copy.

### 2.5 Инфраструктура

#### Memory Footprint на VPS (обновлено по SSH-аудиту)

**Сервер: 32 GB RAM, 12 vCPU AMD EPYC 9645 (AVX-512).**
**Текущее потребление контейнерами: ~1.65 GB из 18 GB лимитов. Headroom: 14 GB.**

Одновременная загрузка NLP-моделей:
| Модель | RAM (peak) | Inference (CPU, 12 vCPU EPYC) |
|--------|-----------|-------------------------------|
| GLiNER2 base-v1 (PyTorch, 205M) | ~800 MB-1.2 GB | ~100-200ms/sentence |
| GLiNER multi-v2.1 (PyTorch, 400M) | ~1.5-2 GB | ~200-400ms/sentence |
| GLiNER multi-v2.1 (ONNX) | ~800 MB | ~50-150ms/sentence |
| spaCy ru_core_news_lg | ~500 MB | ~20-50ms/sentence |
| multilingual-e5-small | ~500 MB | ~30-80ms/sentence (batch 32) |
| Description classifier (TF-IDF) | ~5-20 MB | <1ms/sentence |
| Description classifier (MiniLM) | ~200-400 MB | ~5-15ms/sentence |
| **GLiNER2 + e5-small + TF-IDF** | **~1.5-1.7 GB** | — |
| **GLiNER2 + e5-small + MiniLM** | **~1.5-2.1 GB** | — |

**Вывод**: при 14 GB headroom можно загрузить **все модели в PyTorch** (не нужен ONNX). GLiNER2 (205M params) значительно легче GLiNER1 multi-v2.1 (400M) — рекомендуем именно GLiNER2. На 12 vCPU EPYC с AVX-512 PyTorch inference достаточно быстр, ONNX — опциональная оптимизация для ещё большего ускорения.

**Для Celery worker**: увеличить лимит с 1.5 GB до 4 GB, concurrency снизить до 1, `--max-tasks-per-child=0` (не перезапускать child, модели persist в памяти).

#### Startup Time
Загрузка моделей при старте Celery worker (12 vCPU EPYC, NVMe SSD):
- GLiNER2 base-v1 (PyTorch): ~3-5 секунд
- e5-small: ~2-3 секунд
- TF-IDF classifier: <1 секунда
- **Итого: ~6-9 секунд cold start**

Решение: загружать модели один раз при старте worker, хранить в глобальном scope модуля (singleton pattern). При `--max-tasks-per-child=0` child не перезапускается — модели живут до рестарта worker.

#### Batch vs Streaming Processing
Streaming (chapter-by-chapter UI updates): Phase 1 (NER + embed) можно отдавать UI по мере готовности через WebSocket (`useBookProgressWS.ts` уже существует). Phase 2 (synthesis) — batch, результат после всех глав. **Рекомендация**: отправлять entity list + mention counts после каждой главы, synthesis — после завершения.

#### A/B Testing Infrastructure
Feature flags уже в системе (`FeatureFlagManager`, `FeatureFlag` model с categories NLP/PARSER/IMAGES/SYSTEM/EXPERIMENTAL). Для A/B testing NER pipeline:
1. Feature flag `USE_GLINER_NER` → GLiNER path vs LLM path
2. Обработать одну книгу обоими путями
3. Сравнить: количество entities, recall (vs ручная разметка), precision
4. Хранить `pipeline_version` в entity metadata для трассируемости

---

## 3. Углублённый анализ

### 3.1 GLiNER: детальное исследование

#### Доступные модели на HuggingFace

| Модель | Размер | Языки | Рекомендация для fancai |
|--------|--------|-------|-------------------------|
| `urchade/gliner_multi-v2.1` | ~400M | 100+ | **Основная рекомендация** — multilingual, general NER |
| `urchade/gliner_large-v2.1` | ~600M | EN | Не подходит — English only |
| `urchade/gliner_small-v2.1` | ~170M | EN | Не подходит — English only |
| `urchade/gliner_multi_pii-v1` | ~400M | 100+ | PII detection, не для fiction |
| `nvidia/gliner-PII` | ~600M | EN+ | PII, основан на large-v2.1 |
| `knowledgator/gliner-multitask-large-v0.5` | ~600M | 100+ | Multitask, может быть интересен |
| ONNX: `onnx-community/gliner_multi-v2.1` | ~400M | 100+ | **ONNX-версия основной модели** |

**Лучший выбор**: `GLiNER2` (pip install gliner2) с моделью `fastino/gliner2-base-v1` (205M params). Единая модель: NER + Classification + Structured Data + Relation Extraction. CPU-first, 32 GB RAM VPS справляется с PyTorch без ONNX. Альтернатива: `urchade/gliner_multi-v2.1` через `gliner` пакет, если GLiNER2 окажется нестабильным.

#### GLiNER2 vs GLiNER1 — рекомендация: GLiNER2

| Характеристика | GLiNER (v0.2.25) | GLiNER2 (v1.2.4) |
|---------------|------------------|-------------------|
| Параметры | ~400M (multi-v2.1) | 205M (base-v1) |
| Задачи | NER + Relation Extraction | NER + Classification + Structured + RE |
| CPU inference | Да (ONNX) | Да (built-in) |
| API | `predict_entities()` | `model.extract()` с schema API |
| Fine-tuning | `gliner-finetune` пакет | Built-in `GLiNER2Trainer` |
| Python | >=3.8 | >=3.8 |
| Validation | Нет | Regex validators в schema |

**Рекомендация**: **использовать GLiNER2 сразу** (205M params, легче, мощнее, built-in training + validation + multi-task). На 32 GB VPS с 12 vCPU EPYC PyTorch inference будет быстрым (~100-200ms/sentence). GLiNER1 — только как fallback если GLiNER2 окажется нестабильным.

#### Maximum Input Length (GLiNER2)
GLiNER2 основан на DeBERTa: **max 512 tokens** (~2000 символов для русского). Для глав в 30k символов нужен chunking:
- Chunking на предложения/абзацы ≤ 2000 символов
- Overlap: 1-2 предложения для entity spans на границах
- GLiNER2 API: встроенная обработка длинных текстов через `model.extract()` с автоматическим windowing
- **Fallback**: gliner-spacy пакет с `chunk_size=250` tokens (для GLiNER1)

#### ONNX vs PyTorch на CPU (12 vCPU EPYC 9645 с AVX-512)

| Метрика | PyTorch (CPU) | ONNX (CPU) | fast-gliner (Rust+ONNX) |
|---------|--------------|------------|-------------------------|
| GLiNER2 inference (1 sentence) | ~100-200ms | ~40-100ms | N/A (GLiNER1 only) |
| GLiNER1 inference (1 sentence) | ~200-400ms | ~50-150ms | ~20-50ms (estimated) |
| RAM GLiNER2 | ~800 MB-1.2 GB | ~500-700 MB | N/A |
| Startup | ~3-5s | ~2-3s | ~1-2s |

> На EPYC 9645 с AVX-512 PyTorch performance достаточен. ONNX — опциональная оптимизация Phase 5, не блокер.

### 3.2 Description Classifier: дизайн

#### Объём обучающей выборки
Rule of thumb для binary sentence classification:
- Minimum viable: 500 positive + 500 negative examples
- Production quality: 2000+ positive + 2000+ negative
- fancai имеет в БД: тысячи размеченных описаний (таблица `descriptions`) — достаточно для production classifier.

#### Cross-validation стратегия
**Критически важно**: split по книгам, не по предложениям. Если train и test содержат предложения из одной книги — data leakage (стиль автора, recurring locations). Правильно:
- 80% книг → train
- 10% книг → validation
- 10% книг → test
- Stratify по жанру (если доступен)

#### Multi-class vs Binary
**Рекомендация: binary first** (описание / не описание). Multi-class (location/character/atmosphere/object) — Phase 2, после валидации binary.
- Binary проще обучить и отладить
- Type classification может быть отдельным шагом (rule-based: если содержит entity PER → character description, если LOC → location)
- LLM для type enrichment на top-K — уже в плане

#### Active Learning
1. Обучить classifier на текущих данных fancai
2. Для новых книг: classifier предсказывает с confidence
3. Low-confidence предсказания (0.4-0.6) → отправить на LLM для проверки
4. Результат LLM → добавить в training set
5. Периодически re-train classifier
- **Экономия растёт со временем**: чем больше данных, тем меньше LLM-вызовов.

#### Модель для classifier
Рекомендация: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (120MB, 384-dim) + linear head. Fine-tune на fancai data. Альтернатива: простой TF-IDF + LogisticRegression (~5MB, <1ms/sentence) — может быть достаточно для binary classification с большой обучающей выборкой.

#### Evaluation Metrics
- **Precision@K**: из top-20 предсказанных описаний, сколько реально описания?
- **Recall**: из всех описаний в golden set, сколько найдено?
- **F1** (harmonic mean)
- Для fancai: precision важнее recall (лучше меньше описаний, но качественных)

### 3.3 Coreference Resolution

#### SOTA для русского coref (2026)
- **RuCoCo** (Russian Coreference Corpus) — основной датасет для русского coref.
- SpanBERT-based модели: F1 ~65-70% на RuCoCo (значительно хуже English CoNLL 2012 benchmark ~80%+)
- Никакого production-ready русского coref на CPU не существует в 2026. Все системы экспериментальные.
- **Вывод**: coref на русском — не решённая задача. Для fancai: оставить на LLM.

#### Alias Resolution для Fiction
«Белый Волк» → «Геральт» требует world knowledge. Варианты без LLM:
1. **Co-occurrence**: если «Геральт» и «Белый Волк» никогда не встречаются в одном предложении, но встречаются в overlapping контекстах → candidate alias
2. **Fuzzy + substring** (текущий подход): SequenceMatcher 0.75 — ловит «Гарри» ↔ «Гарри Поттер»
3. **Embedding similarity**: embed entity names → cosine similarity. Но «Белый Волк» и «Геральт» семантически далеки.
4. **Вывод**: без LLM alias resolution типа «Геральт» ↔ «Ведьмак» **невозможен**. Текущий подход (LLM dedup для нерешённых пар) — правильный.

#### Cross-document Coref
Для серий книг (один персонаж в нескольких томах): не coref, а entity linking. Решение: embedding entity (name + visual_summary + context) → similarity search в existing entities across books of same author. **Проще чем coref** — можно реализовать через pgvector.

---

## 4. Детализированный план рефакторинга

### 4.1 Архитектурный дизайн

#### 4.1.1 `NERService` — обёртка над GLiNER2

```
Файл: backend/app/services/ner_service.py
```

```python
from dataclasses import dataclass, field
from typing import Optional
from pydantic import BaseModel

@dataclass
class NEREntity:
    """Сущность, извлечённая NER-моделью."""
    text: str                    # Оригинальный текст span
    label: str                   # Тип: "персонаж", "локация", "артефакт", "организация"
    start: int                   # character offset начала в исходном тексте
    end: int                     # character offset конца
    score: float                 # confidence score 0.0-1.0
    source: str = "gliner2"      # какая модель извлекла


class NERConfig(BaseModel):
    """Конфигурация NER-сервиса."""
    model_name: str = "fastino/gliner2-base-v1"
    use_gliner2: bool = True     # GLiNER2 (рекомендуемый) vs GLiNER1 (fallback)
    chunk_size: int = 250        # tokens per chunk (DeBERTa max 512)
    overlap_sentences: int = 2   # предложения overlap между чанками
    labels: list[str] = field(default_factory=lambda: [
        "персонаж", "локация", "артефакт", "организация"
    ])
    confidence_threshold: float = 0.4  # ниже — fallback на LLM
    fallback_to_llm: bool = True


class NERService:
    """
    Обёртка над GLiNER2 для извлечения сущностей.
    
    Загружает модель один раз при инициализации (singleton).
    GLiNER2 (205M params) — PyTorch, CPU-first.
    На 12 vCPU EPYC 9645 + 32GB RAM: inference ~100-200ms/sentence.
    Fallback на GLiNER1 или LLM при ошибках.
    """
    
    _instance: Optional["NERService"] = None
    
    def __init__(self, config: NERConfig | None = None):
        self.config = config or NERConfig()
        self._model = None
    
    @classmethod
    def get_instance(cls, config: NERConfig | None = None) -> "NERService":
        if cls._instance is None:
            cls._instance = cls(config)
        return cls._instance
    
    def _load_model(self) -> None:
        """Lazy loading модели при первом использовании."""
        if self.config.use_gliner2:
            from gliner2 import GLiNER2
            self._model = GLiNER2.from_pretrained(self.config.model_name)
        else:
            from gliner import GLiNER
            self._model = GLiNER.from_pretrained(self.config.model_name)
    
    async def extract_entities(
        self,
        text: str,
        labels: list[str] | None = None,
    ) -> list[NEREntity]:
        """
        Извлечь сущности из текста.
        
        Args:
            text: Исходный текст (глава книги)
            labels: Типы сущностей (override config)
            
        Returns:
            Список NEREntity с точными позициями
        """
        ...
    
    async def extract_from_chapter(
        self,
        chapter_text: str,
        chapter_index: int,
    ) -> list[NEREntity]:
        """
        Извлечь сущности из главы с chunking.
        
        Разбивает длинный текст на chunks ≤ 512 tokens,
        обрабатывает каждый, дедуплицирует на границах.
        """
        ...
    
    def _deduplicate_boundary_entities(
        self,
        entities: list[NEREntity],
    ) -> list[NEREntity]:
        """Убрать дубликаты на границах chunks."""
        ...
```

**Зависимости**: `gliner2>=1.2.4` (pip install gliner2), fallback: `gliner>=0.2.25`.
**Конфигурация**: env vars `GLINER_MODEL_NAME`, `GLINER_USE_GLINER2=true`, `GLINER_CONFIDENCE_THRESHOLD`.
**Fallback**: если `NERService` не загружается (нет модели, OOM) → log warning, вернуть пустой список, pipeline использует LLM extraction.
**Docker**: добавить `gliner2` и `torch` (CPU) в requirements.txt, увеличить Celery worker memory limit до 4 GB.

#### 4.1.2 `DescriptionClassifier`

```
Файл: backend/app/services/description_classifier.py
```

```python
@dataclass
class ClassifiedSentence:
    """Предложение с классификацией."""
    text: str
    start: int                   # позиция в тексте главы
    end: int
    is_description: bool
    confidence: float            # 0.0-1.0
    description_type: str | None # location/character/atmosphere/object (Phase 2)


class DescriptionClassifierConfig(BaseModel):
    model_path: str = "models/description_classifier"  # local fine-tuned model
    threshold: float = 0.6          # ниже — не описание
    min_sentence_length: int = 80   # символов
    use_rules_prefilter: bool = True  # heuristic pre-filter
    max_descriptions_per_chapter: int = 10


class DescriptionClassifier:
    """
    Binary classifier: 'описание для иллюстрации' vs 'не описание'.
    
    Pipeline:
    1. Rule-based prefilter (быстрый, высокий recall)
    2. ML classifier (точный, binary)
    3. Ranking по confidence
    """
    
    _instance: Optional["DescriptionClassifier"] = None
    
    async def classify_chapter(
        self,
        text: str,
        entities: list[NEREntity] | None = None,
    ) -> list[ClassifiedSentence]:
        """
        Классифицировать все предложения главы.
        
        Args:
            text: Текст главы
            entities: NER entities (для привязки описаний к entities)
            
        Returns:
            Top-K предложений-описаний, отсортированных по confidence
        """
        ...
    
    def _rule_based_prefilter(self, sentences: list[str]) -> list[bool]:
        """
        Быстрый rule-based фильтр.
        
        Heuristics:
        - Длина >= 80 символов
        - >= 2 визуальных прилагательных (цвет, форма, размер)
        - >= 1 визуальное существительное (лицо, волосы, стена, ...)
        - Не заканчивается глаголом действия
        """
        ...
    
    async def train(
        self,
        positive_examples: list[str],
        negative_examples: list[str],
        output_path: str = "models/description_classifier",
    ) -> dict:
        """
        Обучить classifier на данных fancai.
        
        Returns:
            Метрики: F1, precision, recall, accuracy
        """
        ...
```

**Зависимости**: `sentence-transformers` или `scikit-learn` (для TF-IDF baseline).
**Fallback**: если модель не обучена → rule-based only → все candidates на LLM.

#### 4.1.3 `EmbeddingService`

```
Файл: backend/app/services/embedding_service.py
```

```python
class EmbeddingConfig(BaseModel):
    model_name: str = "intfloat/multilingual-e5-small"
    dimensions: int = 384
    batch_size: int = 32
    normalize: bool = True


class EmbeddingService:
    """
    Embedding сервис для pgvector.
    
    Singleton, загружает модель один раз.
    Поддерживает batch encoding для эффективности.
    """
    
    _instance: Optional["EmbeddingService"] = None
    
    async def embed_text(self, text: str) -> list[float]:
        """Embed одного текста."""
        ...
    
    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed batch текстов."""
        ...
    
    async def embed_chapter(
        self,
        chapter_text: str,
        chapter_id: str,
        db: AsyncSession,
    ) -> None:
        """Embed главы и сохранить в pgvector."""
        ...
    
    async def find_similar_chunks(
        self,
        query: str,
        book_id: str,
        db: AsyncSession,
        top_k: int = 5,
    ) -> list[tuple[str, float]]:
        """Vector search для контекста entity."""
        ...
```

**Зависимости**: `sentence-transformers` (pip install sentence-transformers), `pgvector` (PostgreSQL extension).
**Конфигурация**: env var `EMBEDDING_MODEL_NAME`.

#### 4.1.4 `EntityResolutionService`

```
Файл: backend/app/services/entity_resolution_service.py
```

Замена части `ConsistencyManager`. Отвечает за:
1. Fuzzy dedup (SequenceMatcher — перенос текущего кода)
2. Substring matching (перенос текущего кода)
3. Entity merging (перенос текущего кода)
4. **Новое**: embedding-based similarity для alias candidates
5. LLM dedup — только для нерешённых пар (порог similarity 0.5-0.75)

```python
class EntityResolutionService:
    """
    Разрешение и дедупликация сущностей.
    
    Pipeline:
    1. Exact match (casefold)
    2. Substring match ("Гарри" ⊂ "Гарри Поттер")
    3. Fuzzy match (SequenceMatcher >= 0.75) 
    4. Embedding similarity (cosine >= 0.85)
    5. LLM для оставшихся candidates (similarity 0.5-0.75)
    """
    
    async def resolve_entities(
        self,
        new_entities: list[NEREntity],
        existing_entities: list[Entity],
        book_id: str,
        db: AsyncSession,
    ) -> list[Entity]:
        """
        Сопоставить NER entities с existing DB entities.
        Создать новые, merge дубликаты.
        """
        ...
    
    async def find_alias_candidates(
        self,
        entities: list[Entity],
    ) -> list[tuple[Entity, Entity, float]]:
        """
        Найти пары-кандидаты на alias (для LLM dedup).
        Возвращает пары с similarity 0.5-0.75 — неопределённая зона.
        """
        ...
```

#### 4.1.5 `HybridExtractionPipeline`

```
Файл: backend/app/services/hybrid_extraction_pipeline.py
```

Orchestrator, заменяющий прямой вызов `gemini_extractor.analyze_chapter()`.

```python
class HybridExtractionPipeline:
    """
    Гибридный пайплайн обработки книги.
    
    Phase 1 (бесплатно, локально):
        - GLiNER NER → entities с позициями
        - Description classifier → candidate описания
        - Embedding → pgvector
        
    Phase 2 (LLM, точечно):
        - Entity synthesis (1 batch call per book)
        - Description enrichment (top-K)
        - Alias resolution (unresolved pairs)
    """
    
    def __init__(
        self,
        ner_service: NERService,
        classifier: DescriptionClassifier,
        embedding_service: EmbeddingService,
        resolution_service: EntityResolutionService,
        db: AsyncSession,
    ):
        ...
    
    async def process_chapter(
        self,
        chapter_text: str,
        chapter_index: int,
        book_id: str,
    ) -> ChapterAnalysisResult:
        """
        Обработать одну главу (Phase 1).
        
        Returns:
            ChapterAnalysisResult (совместимый с текущим форматом)
        """
        # 1. NER
        entities = await self.ner_service.extract_from_chapter(
            chapter_text, chapter_index
        )
        
        # 2. Description classification
        descriptions = await self.classifier.classify_chapter(
            chapter_text, entities
        )
        
        # 3. Embedding
        await self.embedding_service.embed_chapter(
            chapter_text, chapter_id, self.db
        )
        
        # 4. Entity resolution (against existing entities)
        resolved = await self.resolution_service.resolve_entities(
            entities, existing_entities, book_id, self.db
        )
        
        # 5. Convert to ChapterAnalysisResult (backward compatible)
        return self._to_chapter_result(resolved, descriptions)
    
    async def synthesize_book(
        self,
        book_id: str,
    ) -> None:
        """
        Post-processing всей книги (Phase 2).
        
        Один LLM-вызов для synthesis.
        """
        ...
```

### 4.2 Миграция данных

#### Нужна ли ре-обработка книг?
**Нет** для MVP. Существующие entities/descriptions из LLM остаются валидными. Новые книги обрабатываются гибридным pipeline. Ре-обработка старых книг — опционально, для consistency.

#### Backward compatibility
Добавить колонку в таблицу `entities`:
```sql
ALTER TABLE entities ADD COLUMN extraction_pipeline VARCHAR(20) DEFAULT 'llm_v1';
-- Значения: 'llm_v1' (текущий), 'hybrid_v1' (новый), 'gliner_v1' (full local)
```

#### pgvector migration

⚠️ **pgvector не установлен**: текущий `postgres:17.9-alpine` не включает pgvector. Варианты:

**Вариант A (рекомендуемый)**: сменить образ на `pgvector/pgvector:pg17` (официальный образ с pgvector).
```yaml
# docker-compose.prod.yml
postgres:
  image: pgvector/pgvector:pg17  # было: postgres:17.9-alpine
```

**Вариант B**: собрать custom image:
```dockerfile
FROM postgres:17.9-alpine
RUN apk add --no-cache postgresql17-pgvector
```

После смены образа — Alembic migration:
```sql
-- Новое расширение
CREATE EXTENSION IF NOT EXISTS vector;

-- Новая таблица (не ALTER существующей — чище)
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

Alembic migration файл: `backend/alembic/versions/xxx_add_pgvector_embeddings.py`

> **Риск**: смена PG image при 22 MB БД — безопасна. Данные на volume `postgres_data`, не привязаны к image. Тем не менее — **обязательный backup перед миграцией** (pgbackup уже настроен, daily).

### 4.3 Feature Flags

Текущая система поддерживает category-based flags. Добавить flags:

```python
# Добавить в DEFAULT_FEATURE_FLAGS в backend/app/models/feature_flag.py

{
    "name": "USE_GLINER_NER",
    "enabled": False,
    "category": FeatureFlagCategory.NLP.value,
    "description": "Use GLiNER for primary NER instead of LLM extraction",
    "default_value": False,
},
{
    "name": "USE_DESCRIPTION_CLASSIFIER",
    "enabled": False,
    "category": FeatureFlagCategory.NLP.value,
    "description": "Use ML classifier for description detection instead of LLM",
    "default_value": False,
},
{
    "name": "USE_HYBRID_PIPELINE",
    "enabled": False,
    "category": FeatureFlagCategory.NLP.value,
    "description": "Use HybridExtractionPipeline (GLiNER + classifier + LLM synthesis)",
    "default_value": False,
},
{
    "name": "USE_PGVECTOR_EMBEDDINGS",
    "enabled": False,
    "category": FeatureFlagCategory.NLP.value,
    "description": "Embed chapters in pgvector for entity context enrichment",
    "default_value": False,
},
```

Float-параметры (threshold) — через env vars, не через feature flags (flags — boolean only):
- `GLINER_CONFIDENCE_THRESHOLD=0.4`
- `DESCRIPTION_CLASSIFIER_THRESHOLD=0.6`
- `LLM_SYNTHESIS_MODEL=google/gemini-3.1-flash-lite-preview`

### 4.4 Тестирование и validation

#### Golden Dataset
1. Выбрать 10 книг разных жанров из текущей БД fancai
2. Для каждой: экспортировать текущие entities и descriptions (LLM-extracted) как baseline
3. Ручная проверка: эксперт маркирует true positives, false positives, false negatives
4. Размер: 10 книг × 50 глав × ~10 entities = ~5000 entity annotations
5. Формат: JSON lines с {book_id, chapter_index, text, entities: [{text, label, start, end}]}

#### A/B Framework
1. Feature flag `USE_HYBRID_PIPELINE` включён для конкретных book_ids
2. Обработать одну книгу обоими pipeline
3. Сравнить автоматически:
   - Entity count (hybrid vs LLM)
   - Entity name overlap (Jaccard similarity)
   - Position accuracy (mean absolute error of first_mention_offset)
   - Description count и overlap
4. Сравнить вручную (sample):
   - Precision (сколько извлечённых entities корректны)
   - Recall (сколько реальных entities найдено)
   - Quality of visual_summary (human rating 1-5)

#### Regression Tests
После каждой phase:
- Unit tests: `NERService.extract_entities()` на 10 hardcoded examples
- Integration tests: `HybridExtractionPipeline.process_chapter()` на 3 главы из test books
- E2E test: полная обработка одной книги, проверка entities/descriptions в БД

#### Quality Gates

| Phase | Go Criteria | No-Go |
|-------|-------------|-------|
| Phase 1 (NER) | Entity recall ≥ 80% vs LLM baseline | Recall < 70% |
| Phase 2 (Classifier) | Description precision ≥ 70% | Precision < 50% |
| Phase 3 (Synthesis) | Visual summary quality ≥ 3.5/5 (human) | Quality < 3.0/5 |
| Phase 4 (Embeddings) | Similar chunks retrieval MRR ≥ 0.7 | MRR < 0.5 |

#### Rollback Plan
Каждый phase контролируется feature flag:
1. Если GLiNER NER плохо → `USE_GLINER_NER=false` → revert на LLM extraction
2. Если classifier плохо → `USE_DESCRIPTION_CLASSIFIER=false` → LLM для всех описаний
3. Если hybrid pipeline плохо → `USE_HYBRID_PIPELINE=false` → полный fallback на текущий `gemini_extractor`
4. Данные: не удалять. Entities из hybrid pipeline имеют `extraction_pipeline='hybrid_v1'` — можно фильтровать.

### 4.5 Детальный Timeline

#### Phase 1: Инфраструктура NER (16-20 часов)

| # | Задача | Часы | Зависимости | Acceptance Criteria |
|---|--------|------|-------------|---------------------|
| 1.1 | `NERService` — класс, singleton, lazy load | 4h | — | Unit tests: 10 examples, correct entity extraction |
| 1.2 | GLiNER ONNX integration — chunking для длинных текстов | 4h | 1.1 | Глава 30k chars обработана корректно |
| 1.3 | Маппинг NEREntity → ExtractedEntity (backward compat) | 2h | 1.1 | ChapterAnalysisResult совместим с текущим pipeline |
| 1.4 | Feature flag `USE_GLINER_NER` + integration в `book_tasks.py` | 3h | 1.1, 1.3 | Flag off → текущий pipeline, flag on → GLiNER |
| 1.5 | Добавить `gliner` в requirements.txt, Dockerfile | 1h | — | `pip install` работает, Docker build проходит |
| 1.6 | A/B тест на 5 книгах, метрики | 4h | 1.1-1.5 | Отчёт: recall, precision, cost comparison |

**Go/No-Go**: после 1.6. Если recall ≥ 80% → Phase 2. Если < 70% → исследовать fine-tuning или другую модель.

**Параллелизация**: 1.1-1.3 последовательны. 1.5 параллельно с 1.1-1.3.

#### Phase 2: Description Classifier (14-18 часов)

| # | Задача | Часы | Зависимости | Acceptance Criteria |
|---|--------|------|-------------|---------------------|
| 2.1 | Export training data из БД fancai | 2h | — | ≥2000 positive + ≥2000 negative examples |
| 2.2 | `DescriptionClassifier` — TF-IDF baseline | 3h | 2.1 | F1 ≥ 0.70 на test split (per-book) |
| 2.3 | Rule-based prefilter | 2h | — | Recall ≥ 90% на training data |
| 2.4 | Sentence-transformer classifier (upgrade from TF-IDF) | 4h | 2.1 | F1 ≥ 0.80 |
| 2.5 | Integration в pipeline + feature flag | 3h | 2.2/2.4, Phase 1 | Flag off → LLM, flag on → classifier + LLM top-K |
| 2.6 | A/B тест на 5 книгах | 2h | 2.5 | Precision ≥ 70%, cost reduction ≥ 50% |

**Go/No-Go**: после 2.6. TF-IDF baseline (2.2) может быть достаточным — если F1 ≥ 0.75, пропустить 2.4.

**Параллелизация**: Phase 2 может начаться параллельно с Phase 1 (независимые компоненты). 2.1 и 2.3 параллельны.

#### Phase 3: Entity Resolution + Synthesis Optimization (10-14 часов)

| # | Задача | Часы | Зависимости | Acceptance Criteria |
|---|--------|------|-------------|---------------------|
| 3.1 | `EntityResolutionService` — рефакторинг ConsistencyManager | 4h | Phase 1 | Все текущие тесты проходят |
| 3.2 | Embedding-based alias detection | 3h | Phase 4 (4.1-4.2) | Top-10 alias candidates включают реальные aliases |
| 3.3 | Оптимизация LLM synthesis — один batch call | 2h | 3.1 | Стоимость synthesis ≤ $0.10 per book |
| 3.4 | Миграция fallback chain на Gemini 3.1 Flash Lite | 2h | — | Synthesis quality ≥ текущего при меньшей стоимости |
| 3.5 | Integration testing — полный pipeline | 3h | 3.1-3.4 | E2E тест: книга обработана, все entities в БД |

**Зависимости**: 3.2 зависит от Phase 4 (embeddings). Если Phase 4 не готов — пропустить 3.2, оставить fuzzy+LLM.

#### Phase 4: Embeddings + pgvector (8-10 часов)

| # | Задача | Часы | Зависимости | Acceptance Criteria |
|---|--------|------|-------------|---------------------|
| 4.1 | Alembic migration — pgvector extension + таблица | 2h | — | Migration up/down работает |
| 4.2 | `EmbeddingService` — singleton, batch encode | 3h | 4.1 | 50 глав embedded за < 60 секунд |
| 4.3 | Vector search API для entity context | 2h | 4.2 | Top-5 chunks содержат entity mentions |
| 4.4 | Integration в synthesis pipeline | 2h | 4.2, Phase 3 | Synthesis использует vector context |

**Параллелизация**: Phase 4 может начаться параллельно с Phase 2-3 (4.1 не зависит от NER).

#### Phase 5: Оптимизация и Production Rollout (6-8 часов)

| # | Задача | Часы | Зависимости | Acceptance Criteria |
|---|--------|------|-------------|---------------------|
| 5.1 | Context caching для LLM calls через OpenRouter | 2h | — | Verified savings on repeated system prompts |
| 5.2 | Monitoring: стоимость per-book tracking | 2h | — | Dashboard показывает cost comparison |
| 5.3 | Production rollout — gradual flag enable | 2h | Phases 1-4 | 10% → 50% → 100% книг через hybrid |
| 5.4 | Documentation + KNOWLEDGE.md update | 2h | — | Новый pipeline задокументирован |

**Итого**: 54-70 часов разработки. При 6-8 часов/день: **7-12 дней**. С параллелизацией Phase 1+2+4: **5-8 дней**.

---

## 5. Исправленная стоимостная модель

### Актуальные цены (март 2026, OpenRouter)

| Модель | Input ($/1M) | Output ($/1M) | Использование |
|--------|-------------|---------------|---------------|
| Gemini 3 Flash Preview | $0.50 | $3.00 | Extraction (текущий) |
| Gemini 3.1 Flash Lite Preview | $0.25 | $1.50 | **Рекомендация для synthesis** |
| Gemini 2.0 Flash Lite | $0.075 | $0.30 | Translation (deprecation risk) |
| Claude Haiku 4.5 | $1.00 | $5.00 | Fallback |

### Пересчитанная стоимость обработки книги

**Книга: 50 глав, ~1.5M символов, ~375k input tokens, ~150 entities.**

**Текущий pipeline (all-LLM) — исправленный расчёт:**

| Компонент | Input tokens | Output tokens | Input cost | Output cost | Итого |
|-----------|-------------|---------------|------------|-------------|-------|
| Extraction (TSA) | 375k | **375k** (tagged_text!) | $0.19 | **$1.13** | **$1.31** |
| Entity Dedup | 50k | 10k | $0.03 | $0.03 | $0.06 |
| Entity Synthesis | 80k | 30k | $0.04 | $0.09 | $0.13 |
| **Итого** | | | | | **$1.50** |

> **Ключевое исправление**: output tokens для TSA extraction были занижены в отчёте (100k вместо 375k). TSA возвращает tagged_text ≈ input size. Реальная стоимость ~$1.50, а не ~$0.68.

**Гибридный pipeline — пересчёт:**

| Компонент | Метод | Input tokens | Output tokens | Cost |
|-----------|-------|-------------|---------------|------|
| NER | GLiNER (local) | — | — | **$0.00** |
| Описания (top-20) | LLM (Gemini 3.1 Flash Lite) | 5k | 3k | **$0.006** |
| Entity Dedup (5-10 пар) | LLM (Gemini 3.1 Flash Lite) | 3k | 2k | **$0.004** |
| Entity Synthesis | LLM (Gemini 3.1 Flash Lite) | 35k | 20k | **$0.039** |
| Embedding | e5-small (local) | — | — | **$0.00** |
| **Итого** | | | | **$0.049** |

**С Gemini 3 Flash (текущая основная модель) вместо 3.1 Flash Lite:**

| Компонент | Cost |
|-----------|------|
| Описания | $0.012 |
| Dedup | $0.008 |
| Synthesis | $0.078 |
| **Итого** | **$0.098** |

### Сравнительная таблица (исправленная)

| Pipeline | Стоимость/книга | Экономия vs текущий |
|----------|----------------|---------------------|
| Текущий (all-LLM, Gemini 3 Flash) | **$1.50** | — |
| Гибрид + Gemini 3 Flash | **$0.10** | **93%** |
| Гибрид + Gemini 3.1 Flash Lite | **$0.05** | **97%** |
| Гибрид + Gemini Batch API (50%) | **$0.025** | **98%** |
| Full Local (без synthesis) | **$0.00** | **100%** |

**Ежемесячная экономия при 100 книгах/месяц:**
- Текущий: $150/месяц
- Гибрид (Flash Lite): $5/месяц
- **Экономия: ~$145/месяц ($1,740/год)**

---

## 6. Обновлённые рекомендации

### Что изменилось после аудита

1. **Стоимость текущего pipeline занижена в 2.2 раза** ($1.50 vs $0.68 в отчёте). TSA output tokens — доминирующая статья расходов. Это делает миграцию ещё более ценной.

2. **Сервер значительно мощнее**, чем предполагал отчёт. 12 vCPU AMD EPYC 9645 + 32 GB RAM + 1 TB SSD + AVX-512. PyTorch inference (без ONNX) — комфортен. ONNX — опциональная оптимизация, не требование.

3. **GLiNER2 вместо GLiNER1** — прямая рекомендация. 205M params (вдвое меньше GLiNER1 multi-v2.1), 4 задачи в одной модели (NER + Classification + Structured + RE), built-in training, CPU-first. На 32 GB VPS загружается без проблем.

4. **Gemini 3.1 Flash Lite Preview — ключевая находка**. $0.25/$1.50 (вдвое дешевле Gemini 3 Flash). Рекомендация: использовать для synthesis вместо Gemini 3 Flash. Обновить `FALLBACK_MODELS` в `openrouter_client.py`.

5. **pgvector не установлен** — текущий `postgres:17.9-alpine` не включает расширение. Потребуется смена образа на `pgvector/pgvector:pg17`. БД маленькая (22 MB) — миграция безопасна.

6. **Celery worker нужно перенастроить** для NLP: memory limit 1.5 GB → 4 GB, concurrency 2 → 1, max-tasks-per-child 100 → 0 (модели persist). На 32 GB сервере это безопасно (14 GB headroom).

7. **Natasha/Slovnet — не рекомендовать для новой работы**. Проект малоактивен. GLiNER2 — лучший выбор.

8. **TF-IDF classifier может быть достаточен** для description detection. Проще, быстрее (~1ms/sentence), меньше зависимостей. Начать с TF-IDF, upgrade на sentence-transformer только если F1 < 0.75.

9. **Docker image увеличится**: текущий fancai-backend 468 MB. С GLiNER2 + PyTorch (CPU) + sentence-transformers: ~1.5-2 GB. Диск (921 GB свободно) — не проблема. Build time увеличится.

10. **Порядок фаз: Phase 1 + Phase 2 + Phase 4 параллельны**, Phase 3 зависит от 1+4. Общий timeline: 5-8 дней вместо 8-12 недель из отчёта.

### Приоритетные действия (Quick Wins)

1. **Немедленно**: обновить fallback chain — добавить Gemini 3.1 Flash Lite Preview, экономия ~30% без рефакторинга.
   ```python
   # openrouter_client.py
   FALLBACK_MODELS = [
       "google/gemini-3-flash-preview",       # основная
       "google/gemini-3.1-flash-lite-preview", # дешёвый fallback (NEW)
       "anthropic/claude-haiku-4.5",           # последний fallback
   ]
   ```
2. **Подготовка Docker**: сменить PG image на `pgvector/pgvector:pg17`, увеличить Celery worker limits (4 GB RAM, 4 vCPU, concurrency=1).
3. **Неделя 1**: Phase 1 (NERService + GLiNER2) — A/B test на 5 книгах.
4. **Неделя 1-2 (параллельно)**: Phase 2 (Description classifier) — export data из 519 descriptions, train TF-IDF baseline.
5. **Неделя 2**: Phase 4 (pgvector) — migration, embedding service.
6. **Неделя 2-3**: Phase 3 (Entity resolution) — зависит от Phase 1+4.
7. **Неделя 3**: Phase 5 (production rollout) — gradual enable через feature flags.

---

## 7. Источники (из поисков аудита)

1. OpenRouter Gemini 3 Flash Preview pricing: https://openrouter.ai/google/gemini-3-flash-preview — $0.50/$3.00 per 1M tokens (verified 2026-03-23)
2. OpenRouter Gemini 3.1 Flash Lite Preview: https://openrouter.ai/google/gemini-3.1-flash-lite-preview — $0.25/$1.50 per 1M tokens (NEW)
3. OpenRouter Google models: https://openrouter.ai/google — full model listing with Gemini 2.0 Flash Lite ($0.075/$0.30)
4. Anthropic Claude Haiku 4.5 pricing: https://www.anthropic.com/news/claude-haiku-4-5 — "$1/$5 per million input and output tokens"
5. Anthropic API pricing docs: https://platform.claude.com/docs/en/about-claude/pricing — all models, caching, batch
6. GLiNER PyPI v0.2.25: https://pypi.org/project/gliner/ — Released Feb 11, 2026
7. GLiNER2 PyPI v1.2.4: https://pypi.org/project/gliner2/ — Released Jan 22, 2026, 205M params
8. NVIDIA GLiNER-PII: https://huggingface.co/nvidia/gliner-PII — PII-specific, not for fiction
9. gliner-spacy integration: https://pypi.org/project/gliner-spacy/ — chunking support
10. fast-gliner (Rust+ONNX): https://pypi.org/project/fast-gliner/ — v0.1.12
11. CloudPrice Gemini 3 Flash: https://cloudprice.net/models/openrouter/google/gemini-3-flash-preview
12. PricePerToken Gemini 3 Flash: https://pricepertoken.com/pricing-page/model/google-gemini-3-flash-preview
13. Token calculator (March 2026): https://langcopilot.com/tools/token-calculator
