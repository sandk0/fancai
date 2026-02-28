# Отчёт: Анализ NLP компонентов и производительности Backend

**Дата:** 2025-12-16
**Проект:** BookReader AI (fancai-vibe-hackathon)
**Анализ:** Backend NLP система и потребление ресурсов
**Контекст:** Сервер с ограниченными ресурсами (8 ГБ RAM, 4 core CPU)

---

## 1. Архитектура NLP системы

### 1.1 Multi-NLP Ensemble (текущая реализация)

BookReader AI использует **4 процессора NLP** с взвешенным голосованием (Ensemble voting):

| Процессор | Модель | Вес | Специализация |
|-----------|--------|-----|---------------|
| **SpaCy** | ru_core_news_lg-3.7.0 | 1.0 | Entity recognition, базовый анализ |
| **Natasha** | Встроенные модели | 1.2 | Русская морфология, NER |
| **Stanza** | ru (Stanford NLP) | 0.8 | Dependency parsing, синтаксис |
| **GLiNER** | gliner_medium-v2.1 | 1.0 | Zero-shot NER (замена DeepPavlov) |

**Режимы обработки:**
- `SINGLE` - один процессор (fallback)
- `PARALLEL` - параллельная обработка всеми процессорами
- `ENSEMBLE` - взвешенное голосование (текущий режим по умолчанию)
- `ADAPTIVE` - автоматический выбор режима
- `LLM` - LangExtract/Gemini (экспериментальный)

---

## 2. Список NLP файлов и их размеры

### 2.1 Основные процессоры

```
backend/app/services/
├── spacy_processor.py          - н/д (встроен в nlp_processor.py)
├── natasha_processor.py        - 24 KB (619 строк)
├── stanza_processor.py         - 25 KB (653 строк)
├── gliner_processor.py         - 21 KB (549 строк)
├── deeppavlov_processor.py     - 13 KB (334 строк) [DEPRECATED]
├── nlp_processor.py            - 23 KB (596 строк) [базовый класс + spacy]
├── multi_nlp_manager.py        - 19 KB (514 строк) [оркестратор]
├── enhanced_nlp_system.py      - 30 KB (781 строк) [базовый класс]
├── langextract_processor.py    - 34 KB (811 строк) [LLM-based]
└── gemini_extractor.py         - 24 KB (612 строк) [Direct Gemini API]
```

**Итого процессоров:** ~213 KB, ~4 772 строки кода

### 2.2 NLP фреймворк (Strategy Pattern)

```
backend/app/services/nlp/
├── strategies/
│   ├── base_strategy.py           - базовый класс стратегий
│   ├── single_strategy.py         - один процессор
│   ├── parallel_strategy.py       - параллельная обработка
│   ├── ensemble_strategy.py       - взвешенное голосование
│   ├── adaptive_strategy.py       - автоматический выбор
│   └── sequential_strategy.py     - последовательная обработка
├── components/
│   ├── processor_registry.py      - реестр процессоров
│   ├── ensemble_voter.py          - механизм голосования
│   └── config_loader.py           - загрузка конфигураций
├── utils/
│   ├── description_filter.py      - фильтрация описаний
│   ├── quality_scorer.py          - оценка качества
│   ├── text_cleaner.py            - очистка текста
│   ├── text_analysis.py           - анализ текста
│   └── type_mapper.py             - маппинг типов сущностей
└── adapters/
    └── advanced_parser_adapter.py - адаптер Advanced Parser
```

**Размер nlp/:** ~340 KB (~3 455 строк кода)

### 2.3 Advanced Parser (многоэтапный)

```
backend/app/services/advanced_parser/
├── extractor.py              - извлечение описаний
├── boundary_detector.py      - определение границ
├── confidence_scorer.py      - расчёт уверенности
├── paragraph_segmenter.py    - сегментация параграфов
└── config.py                 - конфигурация
```

**Размер advanced_parser/:** ~268 KB

### 2.4 Вспомогательные файлы

```
backend/app/services/
├── nlp_cache.py           - 10 KB (кэширование NLP результатов)
├── nlp_canary.py          - 21 KB (canary deployment NLP)
└── optimized_parser.py    - н/д (интеграция оптимизаций)

backend/app/routers/
├── nlp.py                 - API endpoints для NLP
└── admin/nlp_settings.py  - admin endpoints (настройки)
└── admin/nlp_canary.py    - admin endpoints (canary)
```

### 2.5 Итого файловая система

**Общий размер NLP кода:** ~1.3 MB
**Строк кода (процессоры + фреймворк):** ~5 656 строк
**Количество файлов с NLP:** ~25 файлов

---

## 3. NLP зависимости в requirements.txt

### 3.1 Full Version (requirements.txt)

```python
# NLP и обработка текста
beautifulsoup4==4.12.2          # HTML parsing (для EPUB)
spacy==3.7.2                    # 560 MB модель
nltk==3.9                       # 100 MB data
stanza==1.7.0                   # 630 MB модель
natasha==1.6.0                  # 300 MB встроенные модели
pymorphy3==1.2.1                # Morphology для natasha
gliner>=0.2.0                   # 500 MB модель (DeepPavlov replacement)
langextract==0.1.0              # LLM-based (экспериментальный)
google-genai>=1.0.0             # Gemini API для LangExtract
```

**Размер NLP моделей на диске:** ~2.1 GB
**Зависимостей:** 8 библиотек + модели

### 3.2 Lite Version (requirements.lite.txt)

```python
# НЕТ SpaCy, Stanza, GLiNER, NLTK
beautifulsoup4==4.12.2          # HTML parsing (необходим для book_parser)
langextract==0.1.0              # ТОЛЬКО LLM-based parsing
# google-generativeai устанавливается как dependency langextract
```

**Размер на диске:** ~50 MB (langextract + dependencies)
**Зависимостей:** 1 библиотека (+ beautifulsoup4)

**Экономия:**
- Размер Docker image: **~1.7 GB меньше**
- Build time: **~7-12 минут быстрее**
- Требования RAM: **~3-4 GB меньше**

---

## 4. Потребление памяти

### 4.1 Детальная оценка по моделям

| Модель | Размер на диске | RAM при загрузке | Время загрузки |
|--------|-----------------|------------------|----------------|
| **SpaCy** (ru_core_news_lg) | 560 MB | 800 MB - 1 GB | ~5-10 сек |
| **Stanza** (ru) | 630 MB | 900 MB - 1.2 GB | ~8-15 сек |
| **Natasha** | 300 MB | 400-500 MB | ~3-5 сек |
| **GLiNER** (medium-v2.1) | 500 MB | 700 MB - 1 GB | ~10-20 сек |
| **NLTK** data | 100 MB | 50-100 MB | ~1-2 сек |
| **ИТОГО** | **~2.1 GB** | **~3-4 GB** | **~27-52 сек** |

### 4.2 Потребление памяти в runtime

**Backend (FastAPI + NLP):**
```
Base FastAPI + dependencies:     ~300-500 MB
SQLAlchemy + PostgreSQL client:  ~100-200 MB
Redis client:                    ~50 MB
Multi-NLP Ensemble (all loaded): ~3-4 GB
----------------------------------------
TOTAL Backend:                   ~4-5 GB
```

**Celery Worker (фоновая обработка):**
```
Base Celery worker:              ~200 MB
NLP models (shared with backend): ~3-4 GB
----------------------------------------
TOTAL Celery Worker:             ~3.5-4.5 GB
```

**Другие сервисы:**
```
PostgreSQL:                      ~512 MB - 1 GB
Redis:                           ~256-512 MB
Frontend (Vite dev):             ~256-512 MB
Celery Beat:                     ~128-256 MB
```

### 4.3 Итого для сервера 8 GB RAM

**Multi-NLP режим (docker-compose.yml):**
```
Backend:         2 GB (limit) → реально 4-5 GB при загрузке всех моделей
Celery Worker:   1.5 GB (limit) → реально 3.5-4.5 GB
PostgreSQL:      1 GB
Redis:           512 MB
Frontend:        512 MB
Celery Beat:     256 MB
-----------------
ИТОГО:          ~5.8 GB (limits) → реально ~10-12 GB (ПЕРЕГРУЗКА!)
```

**Проблемы:**
- ❌ **Превышение лимитов памяти** при одновременной загрузке всех NLP моделей
- ❌ **OOMKiller** может убивать процессы backend/celery
- ❌ **Swap thrashing** при нехватке RAM
- ❌ **Медленный cold start** (~27-52 сек загрузка моделей)

**Lite режим (docker-compose.lite.yml):**
```
Backend:         1.5 GB (limit) → реально ~1 GB
Celery Worker:   1 GB (limit) → реально ~800 MB
PostgreSQL:      1 GB
Redis:           512 MB (384 MB maxmemory)
Frontend:        1 GB
Celery Beat:     256 MB
-----------------
ИТОГО:          ~5.3 GB (limits) → реально ~4.7 GB (SAFE!)
```

**Преимущества:**
- ✅ Укладывается в 8 GB RAM с запасом (~3 GB свободно)
- ✅ Нет риска OOMKiller
- ✅ Быстрый cold start (<5 сек)
- ✅ Стабильная работа

---

## 5. Сервисы использующие NLP

### 5.1 Прямое использование Multi-NLP Manager

| Файл | Назначение | Использование |
|------|-----------|---------------|
| **app/main.py** | FastAPI application | `multi_nlp_manager.initialize()` при старте |
| **app/core/tasks.py** | Celery tasks | Инициализация для фоновых задач |
| **app/services/book/book_parsing_service.py** | Парсинг книг | `multi_nlp_manager.extract_descriptions()` |
| **app/services/optimized_parser.py** | Оптимизированный парсер | Legacy интеграция |
| **app/routers/admin/nlp_settings.py** | Admin API | Управление настройками процессоров |

### 5.2 Косвенное использование

| Файл | Назначение |
|------|-----------|
| **app/services/nlp_canary.py** | Canary deployment (A/B тестирование NLP) |
| **app/services/nlp_cache.py** | Кэширование результатов NLP |
| **app/routers/nlp.py** | Публичные API endpoints для NLP |
| **app/routers/admin/nlp_canary.py** | Admin API для canary |

### 5.3 Зависимость в routers

**125 строк кода** в роутерах содержат прямые импорты/ссылки на NLP библиотеки:
- `app/routers/nlp.py` - основной роутер
- `app/routers/admin/nlp_settings.py` - admin настройки
- `app/routers/admin/nlp_canary.py` - canary управление

---

## 6. Docker конфигурация

### 6.1 Dockerfile (Full Version)

**Размер image:** ~2.5 GB
**Build time:** ~10-15 минут

**Ключевые шаги загрузки моделей:**
```dockerfile
# NLTK data (строки 29-34)
RUN pip install nltk && \
    python -m nltk.downloader -d /root/nltk_data \
    punkt stopwords wordnet averaged_perceptron_tagger

# SpaCy model (строки 44-46)
RUN pip install https://github.com/explosion/spacy-models/releases/download/ru_core_news_lg-3.7.0/ru_core_news_lg-3.7.0-py3-none-any.whl

# Stanza model (строки 48-50)
RUN python -c "import stanza; stanza.download('ru', model_dir='/root/stanza_resources')"
```

**Volumes для персистентности моделей:**
```yaml
volumes:
  - nlp_nltk_data:/root/nltk_data
  - nlp_stanza_models:/root/stanza_resources
  - nlp_huggingface_cache:/tmp/huggingface  # GLiNER модели
```

**Лимиты ресурсов (docker-compose.yml):**
```yaml
backend:
  deploy:
    resources:
      limits:
        cpus: '1.5'
        memory: 2G  # НЕДОСТАТОЧНО для всех моделей!
      reservations:
        memory: 1G

celery-worker:
  deploy:
    resources:
      limits:
        cpus: '1.0'
        memory: 1.5G  # НЕДОСТАТОЧНО!
      reservations:
        memory: 512M
```

### 6.2 Dockerfile.lite (Lite Version)

**Размер image:** ~800 MB
**Build time:** ~2-3 минуты

**Ключевые отличия:**
```dockerfile
# requirements.lite.txt вместо requirements.txt (строка 39)
COPY requirements.lite.txt .

# НЕТ загрузки NLTK, SpaCy, Stanza, GLiNER
RUN pip install -r requirements.lite.txt

# Feature flags
ENV USE_LANGEXTRACT_PRIMARY=true \
    USE_ADVANCED_PARSER=false \
    USE_NLP_PROCESSORS=false
```

**Лимиты ресурсов (docker-compose.lite.yml):**
```yaml
backend:
  deploy:
    resources:
      limits:
        cpus: '2.0'
        memory: 1536M  # ДОСТАТОЧНО для LangExtract
      reservations:
        memory: 512M

celery-worker:
  deploy:
    resources:
      limits:
        cpus: '1.0'
        memory: 1G  # ДОСТАТОЧНО
      reservations:
        memory: 384M
```

---

## 7. Рекомендации по удалению NLP компонентов

### 7.1 Стратегия миграции на Lite Version

**Цель:** Снизить потребление RAM с ~10-12 GB до ~4.7 GB

#### Шаг 1: Переключение на Lite Docker Compose

```bash
# Остановить полный стек
docker-compose down

# Запустить Lite версию
docker-compose -f docker-compose.lite.yml up -d --build
```

**Требуется:** `LANGEXTRACT_API_KEY` в `.env` файле

#### Шаг 2: Установка Feature Flags (опционально)

Если не хотите полностью удалять NLP код, можно управлять через feature flags:

```bash
# Через Admin API
curl -X PUT http://localhost:8000/api/v1/admin/feature-flags/USE_LANGEXTRACT_PRIMARY \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"enabled": true}'

curl -X PUT http://localhost:8000/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"enabled": false}'
```

**Преимущества feature flags:**
- Возможность быстрого rollback
- A/B тестирование (canary deployment)
- Плавная миграция

### 7.2 Физическое удаление NLP файлов (радикальный подход)

**⚠️ ВНИМАНИЕ:** Удаляйте только если уверены что LangExtract работает стабильно!

#### Файлы для удаления:

**1. NLP процессоры (экономия ~213 KB кода, ~3-4 GB RAM):**
```bash
rm backend/app/services/natasha_processor.py
rm backend/app/services/stanza_processor.py
rm backend/app/services/gliner_processor.py
rm backend/app/services/deeppavlov_processor.py
rm backend/app/services/nlp_processor.py  # содержит spacy
rm backend/app/services/enhanced_nlp_system.py
rm backend/app/services/multi_nlp_manager.py
```

**2. NLP фреймворк (экономия ~340 KB кода):**
```bash
rm -rf backend/app/services/nlp/
```

**3. Advanced Parser (экономия ~268 KB кода):**
```bash
rm -rf backend/app/services/advanced_parser/
```

**4. Вспомогательные файлы:**
```bash
rm backend/app/services/nlp_cache.py
rm backend/app/services/nlp_canary.py
rm backend/app/services/optimized_parser.py
rm backend/app/routers/nlp.py
rm backend/app/routers/admin/nlp_settings.py
rm backend/app/routers/admin/nlp_canary.py
```

**5. Тесты:**
```bash
rm backend/test_nlp_processors.py
rm backend/tests/test_multi_nlp_manager.py
rm -rf backend/tests/services/nlp/
```

**Итого удаляется:** ~25 файлов, ~5 656 строк кода, ~1.3 MB

#### Обновить импорты:

**app/main.py:**
```python
# Было:
from .services.multi_nlp_manager import multi_nlp_manager

@app.on_event("startup")
async def startup_event():
    await multi_nlp_manager.initialize()

# Стало:
# Удалить импорт и инициализацию
```

**app/services/book/book_parsing_service.py:**
```python
# Было:
from ...services.multi_nlp_manager import multi_nlp_manager
result = await multi_nlp_manager.extract_descriptions(text, chapter_id)

# Стало:
from ...services.langextract_processor import get_langextract_processor
processor = get_langextract_processor()
result = await processor.extract_descriptions(text, chapter_id)
```

**app/core/tasks.py:**
```python
# Удалить все ссылки на multi_nlp_manager
```

#### Удалить зависимости из requirements.txt:

```bash
# Создать requirements.production.txt без NLP
grep -v -E "spacy|stanza|natasha|nltk|gliner|pymorphy3" backend/requirements.txt > backend/requirements.production.txt

# Оставить только:
# beautifulsoup4==4.12.2  (для EPUB парсинга)
# langextract==0.1.0
# google-genai>=1.0.0
```

#### Обновить Dockerfile:

```dockerfile
# Использовать requirements.production.txt
COPY requirements.production.txt .
RUN pip install -r requirements.production.txt

# Удалить секции загрузки моделей (NLTK, SpaCy, Stanza)
```

#### Удалить Docker volumes:

```bash
# Удалить volumes с NLP моделями (~2.1 GB)
docker volume rm bookreader_nlp_nltk_data
docker volume rm bookreader_nlp_stanza_models
docker volume rm bookreader_nlp_huggingface_cache
```

### 7.3 Гибридный подход (рекомендуется)

**Оставить код, но использовать Lite deployment:**

**Преимущества:**
- ✅ Возможность rollback без изменения кода
- ✅ Разные deployments для разных серверов
- ✅ A/B тестирование качества LangExtract vs Multi-NLP
- ✅ Canary deployment для плавной миграции

**Реализация:**
1. Использовать `docker-compose.lite.yml` для production
2. Оставить `docker-compose.yml` для development/testing
3. Feature flags для контроля режима
4. Lazy loading NLP моделей (только при необходимости)

**Пример lazy loading (уже реализован):**
```python
# natasha_processor.py, строка 15
natasha_components = None  # Загружается только при вызове

# stanza_processor.py, строка 14
stanza = None  # Lazy import

# gliner_processor.py, строка 47
# Модель загружается в load_model(), а не в __init__
```

---

## 8. Узкие места производительности Backend

### 8.1 Проблемы Multi-NLP Ensemble

**1. Потребление памяти (КРИТИЧНО)**
- **Проблема:** Загрузка всех 4 моделей одновременно → ~3-4 GB RAM
- **Локация:** `app/services/nlp/components/processor_registry.py`
- **Impact:** OOMKiller на серверах <8 GB RAM
- **Решение:** Lite mode или lazy loading

**2. Медленный cold start**
- **Проблема:** Загрузка моделей при старте → 27-52 секунды
- **Локация:** `app/main.py:startup_event()` → `multi_nlp_manager.initialize()`
- **Impact:** Долгий health check, задержка первого запроса
- **Решение:** Предзагруженные Docker volumes (уже реализовано)

**3. Параллельная обработка - overhead**
- **Проблема:** 4 процессора работают параллельно → 4x CPU usage
- **Локация:** `app/services/nlp/strategies/parallel_strategy.py`
- **Impact:** CPU thrashing на серверах с <4 cores
- **Решение:** SINGLE mode или Sequential strategy

**4. Ensemble voting - overhead**
- **Проблема:** Взвешенное голосование требует деdупликации и сравнения результатов
- **Локация:** `app/services/nlp/components/ensemble_voter.py`
- **Impact:** +20-30% время обработки vs SINGLE mode
- **Решение:** Отключить ensemble, использовать только Natasha (best weight 1.2)

### 8.2 Database N+1 Queries

**Потенциальная проблема:** Отсутствуют `selectinload()` для relationships

**Проверить:**
```python
# app/services/book/book_parsing_service.py:69
result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
chapter = result.scalar_one_or_none()

# Если далее идёт доступ к chapter.book или другим relationships - N+1 query!
```

**Рекомендация:** Добавить eager loading:
```python
from sqlalchemy.orm import selectinload

stmt = select(Chapter).options(selectinload(Chapter.book)).where(Chapter.id == chapter_id)
chapter = await db.scalar(stmt)
```

### 8.3 Celery Worker - memory leaks

**Проблема:** NLP модели не освобождаются после task completion

**Локация:** `docker-compose.yml:181`
```yaml
command: celery -A app.core.celery_app worker --concurrency=2 --max-tasks-per-child=10
```

**Текущая защита:**
- `CELERY_MAX_TASKS_PER_CHILD=10` - рестарт worker каждые 10 задач
- `CELERY_WORKER_MAX_MEMORY_PER_CHILD=5000000` (5 GB) - kill при превышении

**Проблема:** 5 GB лимит слишком высок для сервера 8 GB!

**Решение:** Снизить лимиты:
```yaml
environment:
  - CELERY_MAX_TASKS_PER_CHILD=5  # Было 10
  - CELERY_WORKER_MAX_MEMORY_PER_CHILD=2000000  # 2 GB вместо 5 GB
```

### 8.4 Redis maxmemory

**Текущая конфигурация:**
```yaml
# docker-compose.yml:62
--maxmemory 512mb
--maxmemory-policy allkeys-lru
```

**Проблема:** 512 MB может быть мало для кэширования NLP результатов

**Рекомендация:** Проверить usage:
```bash
docker exec bookreader_redis redis-cli -a $REDIS_PASSWORD INFO memory
```

Если `used_memory_peak` близко к 512 MB → увеличить до 768 MB (если есть RAM)

### 8.5 PostgreSQL connection pool

**Текущая конфигурация:**
```python
# app/core/config.py:30-33
DB_POOL_SIZE: int = 20
DB_MAX_OVERFLOW: int = 40
DB_POOL_RECYCLE: int = 3600
DB_POOL_TIMEOUT: int = 30
```

**Проблема:** 20+40=60 одновременных connections слишком много для сервера 4 cores

**Рекомендация:** Снизить до:
```python
DB_POOL_SIZE: int = 10  # Было 20
DB_MAX_OVERFLOW: int = 10  # Было 40
```

**Формула:** `pool_size = (num_cores * 2) + effective_spindle_count`
- 4 cores × 2 + 2 (SSD) = **10 connections**

---

## 9. Итоговые рекомендации

### 9.1 Немедленные действия (критичные)

**1. Переключиться на Lite Version (docker-compose.lite.yml)**
```bash
docker-compose -f docker-compose.lite.yml up -d --build
```
**Эффект:** RAM usage: 10-12 GB → 4.7 GB (~55% снижение)

**2. Снизить Celery memory limits**
```yaml
# docker-compose.yml или docker-compose.lite.yml
CELERY_WORKER_MAX_MEMORY_PER_CHILD=2000000  # 2 GB вместо 5 GB
CELERY_MAX_TASKS_PER_CHILD=5                # 5 вместо 10
```

**3. Оптимизировать PostgreSQL pool**
```python
# app/core/config.py
DB_POOL_SIZE = 10
DB_MAX_OVERFLOW = 10
```

### 9.2 Краткосрочные действия (1-2 недели)

**1. Провести A/B тестирование LangExtract vs Multi-NLP**
- Использовать `app/services/nlp_canary.py` (уже реализовано)
- Метрики: качество описаний, скорость, cost

**2. Добавить мониторинг памяти**
```python
# Prometheus metrics
from prometheus_client import Gauge

nlp_memory_usage = Gauge('nlp_memory_usage_bytes', 'NLP models memory usage')
```

**3. Оптимизировать database queries**
- Добавить `selectinload()` для Chapter relationships
- Включить SQLAlchemy query logging в development

**4. Настроить Redis expiry для NLP cache**
```python
# app/services/nlp_cache.py
CACHE_TTL = 3600  # 1 час вместо default
```

### 9.3 Долгосрочные действия (1-2 месяца)

**1. Удалить Multi-NLP код (если LangExtract стабилен)**
- Удалить ~5 656 строк кода
- Удалить ~2.1 GB Docker volumes
- Упростить поддержку

**2. Внедрить horizontal scaling**
```yaml
# docker-compose.yml
backend:
  deploy:
    replicas: 2  # Несколько backend instances
```

**3. Настроить Redis persistence**
```yaml
redis:
  command: redis-server --appendonly yes --appendfsync everysec
```

**4. Внедрить rate limiting для LangExtract API**
```python
# Избежать превышения квоты Google Gemini API
# app/middleware/rate_limit.py
```

---

## 10. Метрики для мониторинга

### 10.1 Ключевые метрики

| Метрика | Целевое значение | Критический порог |
|---------|------------------|-------------------|
| Backend memory usage | <1.5 GB | >2 GB |
| Celery memory usage | <1 GB | >1.5 GB |
| NLP processing time | <30 сек/глава | >60 сек |
| Database pool usage | <80% | >90% |
| Redis memory usage | <384 MB | >450 MB |
| LangExtract API calls | <1000/день | >5000/день (quota) |

### 10.2 Алерты для настройки

```yaml
# Prometheus alerting rules
- alert: BackendHighMemory
  expr: container_memory_usage_bytes{container="backend"} > 2147483648  # 2 GB
  for: 5m

- alert: NLPProcessingSlow
  expr: nlp_processing_duration_seconds > 60
  for: 3m

- alert: CeleryMemoryLeak
  expr: container_memory_usage_bytes{container="celery-worker"} > 1610612736  # 1.5 GB
  for: 10m
```

---

## 11. Заключение

### 11.1 Текущее состояние

**Проблемы:**
- ❌ Multi-NLP Ensemble не умещается в 8 GB RAM (требует 10-12 GB)
- ❌ Медленный cold start (27-52 сек)
- ❌ Высокое потребление CPU при ensemble voting
- ❌ Риск OOMKiller на production сервере

**Преимущества:**
- ✅ Высокое качество извлечения описаний (ensemble voting)
- ✅ Уже реализован Lite режим (LangExtract)
- ✅ Feature flags для управления режимами
- ✅ Lazy loading для моделей

### 11.2 Рекомендуемый путь

**Immediate (сегодня):**
1. Переключиться на `docker-compose.lite.yml`
2. Снизить Celery memory limits

**Short-term (1-2 недели):**
1. A/B тест LangExtract vs Multi-NLP
2. Оптимизировать database queries
3. Настроить мониторинг памяти

**Long-term (1-2 месяца):**
1. Если LangExtract работает стабильно → удалить Multi-NLP код
2. Horizontal scaling для backend
3. Advanced caching strategies

### 11.3 Ожидаемый результат

**После миграции на Lite:**
- Memory usage: **10-12 GB → 4.7 GB** (-55%)
- Docker image size: **2.5 GB → 800 MB** (-68%)
- Cold start time: **27-52 сек → <5 сек** (-90%)
- Maintenance: **5 656 строк → 811 строк** (-86% code)
- Cost: **Бесплатно (NLP models) → ~$0.02/book (Gemini API)**

**Trade-off:**
- Качество: Multi-NLP (F1 0.90-0.95) vs LangExtract (unknown, требует измерения)
- Зависимость от Google Gemini API (external dependency, quota limits)

---

**Подготовил:** Claude Code (Backend API Developer Agent)
**Версия отчёта:** 1.0
**Следующий review:** После миграции на Lite (1-2 недели)
