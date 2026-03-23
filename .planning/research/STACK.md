# Stack Research: Гибридный NLP pipeline

**Домен:** Hybrid NLP pipeline (GLiNER2 + classifier + pgvector + LLM synthesis)
**Исследовано:** 2026-03-24
**Уверенность:** HIGH

Исследование верифицирует и дополняет существующий документ `docs/research/rag-nlp-optimization-research.md` (2026-03-23). Все версии и цены проверены по первоисточникам на 24 марта 2026.

---

## Рекомендуемый стек

### Основные технологии (новые зависимости)

| Технология | Версия | Назначение | Почему |
|------------|--------|---------|--------|
| **gliner2** | 1.2.4 (Jan 2026) | Zero-shot NER для fiction | F1 0.564 на Literature > GPT-4o (0.561); 205M params; CPU-first; детерминированные span offsets; бесплатно |
| **torch** (CPU-only) | 2.11.0+cpu | Runtime для GLiNER2 | Обязательная зависимость gliner2. **ТОЛЬКО CPU-версия** через `--index-url https://download.pytorch.org/whl/cpu` |
| **sentence-transformers** | 5.3.0 (Mar 2026) | Embedding модели для pgvector | Python >=3.10, PyTorch >=1.11. Единый API для e5-small и ru-en-RoSBERTa |
| **scikit-learn** | 1.8.0 (Dec 2025) | TF-IDF + LogisticRegression classifier | Python 3.12 compatible. ~5 MB модель, <1ms/sentence inference |
| **pgvector** (extension) | 0.8.2 (Feb 2026) | Vector similarity search в PostgreSQL | Нативная интеграция с PG17. Iterative index scans, CVE-2026-3172 fix |
| **pgvector/pgvector:pg17** | 0.8.2-pg17 | Docker image для PostgreSQL + pgvector | Замена `postgres:17.9-alpine`. Debian Bookworm/Trixie (не Alpine!) |

### Embedding модели

| Модель | Размер | Dims | Max tokens | RAM | Назначение |
|--------|--------|------|------------|-----|-----------|
| **intfloat/multilingual-e5-small** | 118M | 384 | 512 | ~500 MB | **Стартовая модель** — минимальный RAM, достаточен для базового retrieval |
| **ai-forever/ru-en-RoSBERTa** | 400M | 1024 | 512 | ~1.6 GB | **Upgrade** — SOTA на ruMTEB для RU+EN, CLS pooling, prompt-based encoding |

**Рекомендация:** начать с e5-small (фаза pgvector), перейти на ru-en-RoSBERTa после валидации pipeline.
Причина: e5-small занимает ~500 MB RAM, оставляя headroom в 4 GB бюджете Celery worker. ru-en-RoSBERTa требует ~1.6 GB — конфликтует с GLiNER2 (800 MB-1.2 GB) при одновременной загрузке.

### LLM модели (через OpenRouter, synthesis only)

| Модель | Input $/1M | Output $/1M | Context | Назначение |
|--------|-----------|-------------|---------|-----------|
| **deepseek/deepseek-v3.2** | $0.26 | $0.38 | 164K | **Primary synthesis** — output в 8x дешевле Gemini 3 Flash. GPT-5 class quality |
| **google/gemini-3.1-flash-lite-preview** | $0.25 | $1.50 | 1M | **Fallback synthesis** — 1M context window, thinking levels |
| **google/gemini-3-flash-preview** | $0.50 | $3.00 | 1M | **Текущая основная** (extraction) — сохраняется для legacy pipeline |
| **anthropic/claude-haiku-4.5** | $1.00 | $5.00 | 200K | **Last resort fallback** |

**Цены верифицированы:** OpenRouter, 24 марта 2026.

**Обновлённый fallback chain для synthesis:**
```python
SYNTHESIS_MODELS = [
    "deepseek/deepseek-v3.2",               # $0.02/книга — primary
    "google/gemini-3.1-flash-lite-preview",  # $0.05/книга — fallback
    "anthropic/claude-haiku-4.5",            # $0.25/книга — last resort
]
```

### Вспомогательные библиотеки

| Библиотека | Версия | Назначение | Когда использовать |
|-----------|--------|---------|-------------------|
| **gliner-spacy** | latest | Chunking adapter для GLiNER2 | Если нужен spaCy-совместимый NER pipeline; `chunk_size=250` tokens |
| **networkx** | 3.6.1 (уже в проекте) | Co-occurrence графы для entity relationships | Entity relationship detection без LLM |
| **joblib** | (зависимость sklearn) | Сериализация TF-IDF моделей | Сохранение/загрузка обученного classifier |

### Инструменты разработки

| Инструмент | Назначение | Заметки |
|-----------|---------|--------|
| **pytest** (уже в проекте) | Тесты NER quality, classifier accuracy | Добавить fixtures с тестовыми текстами fiction |
| **alembic** (уже в проекте) | Миграция: vector extension + chapter_embeddings | `CREATE EXTENSION vector;` через migration |

---

## Установка

### requirements.txt (новые зависимости)

```txt
# === NLP Pipeline (v1.4) ===
# GLiNER2 NER — zero-shot entity extraction
gliner2==1.2.4

# Sentence embeddings — для pgvector
sentence-transformers==5.3.0

# TF-IDF classifier — описания
scikit-learn==1.8.0
```

### PyTorch CPU-only (КРИТИЧНО)

PyTorch **НЕ добавлять** в `requirements.txt` напрямую. Причина: default PyPI wheel = ~530 MB с CUDA-зависимостями. CPU-only wheel = ~200-250 MB.

**В Dockerfile.prod:**
```dockerfile
# Install PyTorch CPU-only BEFORE other requirements
RUN pip install --no-cache-dir torch==2.11.0+cpu \
    --index-url https://download.pytorch.org/whl/cpu

# Then install remaining requirements
RUN pip install --no-cache-dir -r requirements.txt
```

**Для локальной разработки (uv):**
```bash
# CPU-only PyTorch
uv pip install torch==2.11.0+cpu --index-url https://download.pytorch.org/whl/cpu

# Остальные зависимости
uv pip install -r requirements.txt
```

### Docker Compose изменения

```yaml
# docker-compose.prod.yml — ИЗМЕНЕНИЯ

# 1. PostgreSQL: смена образа для pgvector
postgres:
  image: pgvector/pgvector:0.8.2-pg17  # было: postgres:17.9-alpine
  # ВСЕ остальные настройки (command, volumes, environment) — БЕЗ ИЗМЕНЕНИЙ
  # pgvector image = Debian Bookworm (не Alpine), но PostgreSQL конфиг идентичен

# 2. Celery Worker: увеличить ресурсы для NLP-моделей
celery-worker:
  command: >
    celery -A app.core.celery_app worker
    --loglevel=${LOG_LEVEL:-info}
    --concurrency=1              # было ${CELERY_CONCURRENCY:-2}: NLP модели — один процесс
    --max-tasks-per-child=0      # было 100: модели persist в памяти, не перезапускать
    --prefetch-multiplier=1
  deploy:
    resources:
      limits:
        cpus: '4.0'             # было 1.5: GLiNER2 inference использует CPU parallelism
        memory: 4G              # было 1536M: бюджет для NLP моделей
      reservations:
        cpus: '1.0'
        memory: 2G              # было 512M
```

---

## Docker Image Size Impact

### Текущее состояние
| Компонент | Размер |
|-----------|--------|
| `fancai-backend:latest` | ~600 MB (Dockerfile.prod comment) |
| `postgres:17.9-alpine` | ~80 MB |

### После добавления NLP
| Компонент | Оценка | Дельта |
|-----------|--------|--------|
| `fancai-backend:latest` (с NLP) | ~1.5-1.8 GB | **+900 MB - 1.2 GB** |
| `pgvector/pgvector:0.8.2-pg17` | ~400 MB | **+320 MB** (Debian vs Alpine) |

### Breakdown размера backend image

| Зависимость | Compressed wheel | Installed | Заметки |
|-------------|-----------------|-----------|--------|
| torch (CPU-only) | ~200-250 MB | ~700-900 MB | Самая тяжёлая зависимость |
| sentence-transformers | ~5 MB | ~20 MB | Сам пакет лёгкий |
| transformers (HuggingFace) | ~10 MB | ~50 MB | Зависимость sentence-transformers |
| gliner2 | ~2 MB | ~10 MB | Лёгкий пакет |
| scikit-learn | ~12 MB | ~40 MB | NumPy/SciPy уже есть |
| **Итого дельта** | | **~800 MB - 1 GB** | |

**Mitigation:**
- 921 GB free disk на сервере — размер image несущественен
- Multi-stage Docker build уже используется — финальный image без build tools
- Docker layer caching: torch слой кэшируется, rebuild быстрый

---

## Memory Budget (Celery Worker, 4 GB лимит)

### Бюджет при обработке книги

| Компонент | RAM | Заметки |
|-----------|-----|--------|
| Python + Celery + app code | ~300 MB | Базовый overhead |
| GLiNER2 (205M params, PyTorch) | ~800 MB - 1.2 GB | Загружается lazy при первом NER вызове |
| multilingual-e5-small (118M) | ~500 MB | Загружается lazy при первом embed вызове |
| TF-IDF classifier | ~20 MB | Минимальный |
| Input buffer (глава ~100K chars) | ~50 MB | Рабочие данные |
| PyTorch overhead (buffers, temp) | ~200 MB | Forward pass allocations |
| **Итого** | **~1.9 - 2.3 GB** | |
| **Headroom** | **~1.7 - 2.1 GB** | Безопасный запас |

### При upgrade на ru-en-RoSBERTa (400M, 1024 dims)

| Компонент | RAM | Заметки |
|-----------|-----|--------|
| Python + Celery + app code | ~300 MB | |
| GLiNER2 | ~800 MB - 1.2 GB | |
| **ru-en-RoSBERTa** | **~1.6 GB** | Вместо 500 MB у e5-small |
| TF-IDF + buffers | ~70 MB | |
| PyTorch overhead | ~300 MB | Больше из-за larger model |
| **Итого** | **~3.1 - 3.5 GB** | |
| **Headroom** | **~0.5 - 0.9 GB** | Тесно, но допустимо |

**Вывод:** 4 GB достаточно для e5-small с комфортным запасом. Для ru-en-RoSBERTa — на грани, но работоспособно. При проблемах: загружать модели последовательно (NER -> выгрузить -> embed), но это усложняет код.

### Критично: --max-tasks-per-child=0

Текущая настройка `--max-tasks-per-child=100` перезапускает worker после 100 задач, сбрасывая загруженные модели. GLiNER2 загрузка = ~5-10 секунд. При обработке книги (50+ глав) worker перезапустится в процессе.

**Решение:** `--max-tasks-per-child=0` (без перезапуска). Модели остаются в памяти как singletons. Celery 5.6.2 утечки памяти исправлены.

---

## Совместимость версий

| Пакет A | Совместим с | Заметки |
|---------|-------------|--------|
| gliner2==1.2.4 | Python >=3.8, torch >=1.9 | Python 3.12 OK |
| torch==2.11.0+cpu | Python >=3.10, <=3.14 | Python 3.12 OK. **Только CPU index** |
| sentence-transformers==5.3.0 | Python >=3.10, torch >=1.11 | Python 3.12 OK. Совместно с torch 2.11 |
| scikit-learn==1.8.0 | Python >=3.10 | Python 3.12 OK. NumPy >=1.19 |
| pgvector/pgvector:0.8.2-pg17 | PostgreSQL 17.x | Debian Bookworm base. `CREATE EXTENSION vector;` |
| asyncpg==0.31.0 (уже в проекте) | pgvector | Нативная поддержка vector type через `codec` |

### Конфликты зависимостей

| Потенциальный конфликт | Статус | Решение |
|----------------------|--------|---------|
| torch + numpy version | LOW RISK | sentence-transformers 5.3 и sklearn 1.8 используют совместимые NumPy |
| postgres Alpine -> Debian | NONE | Только base OS меняется, PG конфиг идентичен |
| gliner2 + sentence-transformers оба тянут transformers | LOW RISK | Оба совместимы с transformers >=4.34 |

---

## pgvector: миграция PostgreSQL image

### Текущий vs новый image

| Параметр | Текущий | Новый |
|----------|---------|-------|
| Image | `postgres:17.9-alpine` | `pgvector/pgvector:0.8.2-pg17` |
| Base OS | Alpine Linux | Debian Bookworm |
| Image size | ~80 MB | ~400 MB |
| pgvector | Нет | 0.8.2 (compiled) |
| PGDATA format | Совместим | Совместим |

### Процедура миграции

1. **Backup** (pgbackup уже настроен): `docker compose exec postgres pg_dumpall -U $DB_USER > /tmp/backup.sql`
2. Сменить `image:` в docker-compose.prod.yml
3. `docker compose down && docker compose up -d postgres`
4. PostgreSQL подхватит существующий PGDATA volume без потери данных
5. `CREATE EXTENSION IF NOT EXISTS vector;` через Alembic migration
6. Verify: `SELECT * FROM pg_extension WHERE extname = 'vector';`

**Риск:** НИЗКИЙ. PGDATA volume монтируется as-is. Разница только в base OS image. Все PG настройки (shared_buffers, work_mem и т.д.) передаются через `command:` — не зависят от image.

### Alembic migration для vector

```python
# alembic/versions/xxxx_add_pgvector.py
def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "chapter_embeddings",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("chapter_id", sa.UUID(), sa.ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(384), nullable=False),  # 384 для e5-small
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("chapter_id", "chunk_index"),
    )
    op.create_index(
        "ix_chapter_embeddings_vector",
        "chapter_embeddings",
        ["embedding"],
        postgresql_using="ivfflat",
        postgresql_with={"lists": 100},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )

def downgrade():
    op.drop_table("chapter_embeddings")
    op.execute("DROP EXTENSION IF EXISTS vector")
```

**Зависимость:** `pgvector` Python package (для Vector type в SQLAlchemy). Добавить в requirements.txt:
```txt
pgvector==0.3.6  # SQLAlchemy integration для vector type
```

---

## Альтернативы рассмотренные

| Рекомендация | Альтернатива | Когда использовать альтернативу |
|-------------|-------------|-------------------------------|
| GLiNER2 (205M) | GLiNER1 gliner_multi-v2.1 (400M) | Если GLiNER2 показывает F1 < 0.70 на русской fiction; fallback модель |
| GLiNER2 (205M) | Natasha/Slovnet (30MB) | Никогда — фиксированные entity types, проект мёртв с 2021 |
| multilingual-e5-small | ru-en-RoSBERTa (400M) | После валидации pipeline, если retrieval quality недостаточен |
| multilingual-e5-small | BGE-M3 (568M) | Если нужен hybrid search (dense + sparse + ColBERT); ~2 GB RAM |
| TF-IDF + LogReg | sentence-transformer + linear head | Если TF-IDF F1 < 0.75 на per-book split |
| DeepSeek V3.2 | Gemini 3.1 Flash Lite | Если DeepSeek недоступен; output в 4x дороже, но 1M context window |
| pgvector (PostgreSQL) | Qdrant / Milvus | Никогда для этого проекта — PostgreSQL уже в стеке, ~5K vectors max |
| Custom pipeline | LangChain / LlamaIndex | Никогда — overhead framework, текущий pipeline уже custom |

---

## Что НЕ добавлять

| Избегать | Почему | Вместо этого |
|---------|-------|-------------|
| **torch с CUDA** (default PyPI) | +300 MB мёртвого кода, нет GPU на сервере | `torch==2.11.0+cpu` через `--index-url` |
| **spaCy** (полный) | ~500 MB+ для ru_core_news_lg, не нужен для NER | GLiNER2 для NER. spaCy только если нужен dep parse позже |
| **LangChain / LlamaIndex** | Абстракция без пользы при 3 LLM вызовах на книгу | Custom pipeline (уже есть gemini_extractor.py) |
| **Qdrant / Milvus / Pinecone** | Отдельный сервис для ~5K vectors — overkill | pgvector в существующем PostgreSQL |
| **GigaEmbeddings** (Sber, 3B) | 6 GB RAM — не влезет в worker рядом с GLiNER2 | e5-small -> ru-en-RoSBERTa |
| **Self-hosted LLM** (llama.cpp) | ~2-5 tok/sec на CPU без GPU — неприемлемо для книг | OpenRouter API |
| **ONNX Runtime** (для GLiNER2) | Premature optimization; PyTorch достаточно быстр (~100-200ms) | Рассмотреть позже если inference bottleneck |
| **torchvision / torchaudio** | Не нужны для NLP pipeline | Не устанавливать |

---

## Паттерны стека по варианту

**Если GLiNER2 NER quality < 0.70 F1 на русской fiction:**
- Fine-tune GLiNER2 на данных fancai (274 entities в БД — маловато, но старт)
- Fallback: GLiNER1 `gliner_multi-v2.1` (400M, +200 MB RAM)
- Крайний случай: hybrid NER (GLiNER2 + LLM verification для low-confidence spans)

**Если TF-IDF classifier для описаний < 0.75 F1:**
- Upgrade: `paraphrase-multilingual-MiniLM-L12-v2` через sentence-transformers + linear head
- 519 описаний в БД — обучающая выборка. Split по книгам, не по предложениям

**Если Celery worker OOM при ru-en-RoSBERTa:**
- Вариант A: увеличить memory limit до 6 GB (14 GB свободно на сервере)
- Вариант B: sequential model loading (загрузить NER -> выгрузить -> загрузить embed)
- Вариант C: отдельный Celery worker для embedding tasks

---

## Суммарное изменение ресурсов сервера

### Текущее (v1.3)

| Ресурс | Аллоцировано | Использовано |
|--------|-------------|-------------|
| CPU | ~9.3 vCPU | ~2-3 vCPU (idle) |
| RAM | ~18 GB | ~1.65 GB |
| Disk | 1 TB | 46 GB |

### После v1.4 (NLP pipeline)

| Ресурс | Аллоцировано | Использовано (peak) | Дельта |
|--------|-------------|-------------------|--------|
| CPU | ~11.8 vCPU (+2.5) | ~5-7 vCPU (during NER) | +2.5 vCPU limit |
| RAM | ~20.5 GB (+2.5 GB) | ~4-5 GB (during processing) | +2.5 GB limit |
| Disk | 1 TB | ~48 GB (+2 GB images) | Пренебрежимо |

**Запас:** ~0.2 vCPU свободно в limits (12 total), ~11.5 GB RAM свободно. Достаточно.

---

## Источники

- [gliner2 v1.2.4 PyPI](https://pypi.org/project/gliner2/) — версия, Python requirements (HIGH confidence)
- [GLiNER2 EMNLP 2025 paper](https://arxiv.org/html/2507.18546v1) — F1 benchmarks, Literature domain (HIGH confidence)
- [torch PyPI](https://pypi.org/project/torch/) — v2.11.0, Python >=3.10, wheel sizes (HIGH confidence)
- [PyTorch CPU-only wheels](https://download.pytorch.org/whl/cpu/torch/) — CPU index, v2.11.0+cpu available (HIGH confidence)
- [sentence-transformers v5.3.0 PyPI](https://pypi.org/project/sentence-transformers/) — Python >=3.10, PyTorch >=1.11 (HIGH confidence)
- [scikit-learn v1.8.0 PyPI](https://pypi.org/project/scikit-learn/) — Python 3.12 compatible (HIGH confidence)
- [pgvector 0.8.2 release](https://www.postgresql.org/about/news/pgvector-082-released-3245/) — CVE fix, PG17 support (HIGH confidence)
- [pgvector/pgvector Docker Hub](https://hub.docker.com/r/pgvector/pgvector) — 0.8.2-pg17, Bookworm/Trixie tags (HIGH confidence)
- [DeepSeek V3.2 OpenRouter](https://openrouter.ai/deepseek/deepseek-v3.2) — $0.26/$0.38, 164K context (HIGH confidence)
- [Gemini 3.1 Flash Lite OpenRouter](https://openrouter.ai/google/gemini-3.1-flash-lite-preview) — $0.25/$1.50, 1M context (HIGH confidence)
- [ru-en-RoSBERTa HuggingFace](https://huggingface.co/ai-forever/ru-en-RoSBERTa) — 400M params, 1024 dims, sentence-transformers compatible (HIGH confidence)
- [ruMTEB NAACL 2025](https://aclanthology.org/2025.naacl-long.12/) — Russian embedding benchmarks (HIGH confidence)
- Существующее исследование: `docs/research/rag-nlp-optimization-research.md` (2026-03-23)

---
*Stack research для: v1.4 Hybrid NLP Pipeline*
*Исследовано: 2026-03-24*
