# ЗАДАЧА: Комплексный аудит Backend приложения fancai

## Контекст проекта (актуально на 26 января 2026)

**fancai** — PWA-приложение для чтения художественных книг с автоматической AI-генерацией иллюстраций на основе описаний из текста. Production: https://fancai.ru

### Технологический стек (АКТУАЛЬНЫЕ ВЕРСИИ)
```
# Backend
FastAPI==0.125.0        # December 2025
SQLAlchemy==2.0.45      # December 2025 (async, Mapped[], mapped_column)
Celery==5.6.2           # January 2026 (Soft shutdown, Pydantic support)
Pydantic==2.12.5        # November 2025 (Rust core)
pydantic-settings==2.8.0

# AI сервисы
google-genai==1.59.0    # January 2026 (Model lifecycle, 100MB file limit)
# Модели: gemini-3-flash-preview, imagen-4.0-generate-001

# Инфраструктура
PostgreSQL 15-alpine    # Инициализирован с v15, миграция невозможна
Redis 7.4-alpine        # maxmemory=640mb, allkeys-lru
asyncpg==0.30.0
tenacity==9.0.0         # Retry с exponential backoff
networkx==3.4.2         # Graph analysis

# DevOps
Docker Compose, Gunicorn+Uvicorn, Alembic 1.14
```

### Структура Backend (20 сервисов, ~15,000 строк)

**Сервисы** (backend/app/services/ — 20 файлов):
| Файл | Строк | Назначение |
|------|-------|------------|
| `imagen_generator.py` | 950 | Генерация изображений через Imagen 4.0 |
| `book_parser.py` | 930 | Парсинг EPUB/FB2 |
| `user_statistics_service.py` | 863 | Аналитика чтения пользователя |
| `langextract_processor.py` | 815 | **УСТАРЕВШИЙ** альтернативный LLM процессор |
| `gemini_extractor.py` | 787 | Извлечение описаний через Gemini 3.0 Flash |
| `push_notification_service.py` | 476 | Web Push (VAPID) |
| `image_generator.py` | 454 | Legacy генератор (Pollinations) |
| `reading_session_cache.py` | 454 | Кэш сессий чтения в Redis |
| `reading_session_service.py` | 449 | Бизнес-логика сессий |
| `consistency_manager.py` | 439 | **КРИТИЧНО**: Управление сущностями |
| `settings_manager.py` | 422 | Feature flags |
| `llm_description_enricher.py` | 413 | Обогащение описаний |
| `entity_service.py` | 331 | Граф сущностей для фронтенда |
| `auth_service.py` | 402 | JWT аутентификация |

**Роутеры** (backend/app/routers/ — ОГРОМНЫЕ ФАЙЛЫ):
| Файл | Строк | Проблема |
|------|-------|----------|
| `images.py` | 1189 | Слишком большой, бизнес-логика в роутере |
| `descriptions.py` | 902 | Смешение API и логики |
| `reading_sessions.py` | 872 | Много логики |
| `health.py` | 543 | Не только health checks |
| `users.py` | 440 | Приемлемо |

**Модели** (backend/app/models/ — 14 файлов):
- `Book`, `Chapter`, `Description` — книги и контент
- `Entity`, `EntityMention`, `EntityRelationship`, `DescriptionEntity` — система сущностей
- `GeneratedImage` — сгенерированные изображения
- `User`, `Subscription` — пользователи
- `ReadingSession`, `ReadingGoal` — статистика чтения
- `PushSubscription`, `FeatureFlag` — вспомогательные

---

## ИЗВЕСТНЫЕ КРИТИЧЕСКИЕ ПРОБЛЕМЫ

### 1. DescriptionEntity связи НЕ создаются (P0 — БЛОКЕР)

**Симптомы:**
- `notes = []` для всех сущностей на фронтенде
- Спойлер-защита для описаний не работает
- Таблица `description_entities` пустая после парсинга

**Корневая причина:**
В `book_tasks.py` строки 368-385 сохраняются Description, но связь с Entity через DescriptionEntity НЕ создаётся:

```python
# book_tasks.py:368-385
for i, d in enumerate(descriptions_data):
    new_desc = DescriptionModel(
        chapter_id=local_chapter.id,
        type=d_type,
        content=d_dict.get("content", ""),
        ...
    )
    session.add(new_desc)
    # ОТСУТСТВУЕТ: Создание DescriptionEntity для связи с Entity!
```

`ConsistencyManager.process_chapter_analysis()` создаёт только `EntityMention`, но НЕ `DescriptionEntity`.

### 2. mention_cfi НЕ заполняется (P1)

**Проблема:** Поле `EntityMention.mention_cfi` всегда NULL:
```python
# consistency_manager.py:61-67
mention = EntityMention(
    chapter_id=chapter_id,
    entity_id=resolved_entity.id,
    mention_text=raw_entity.name,
    start_index=raw_entity.first_mention_offset,
    # ОТСУТСТВУЕТ: mention_cfi=...
)
```

Это ломает точную спойлер-защиту по CFI (EPUB Canonical Fragment Identifier).

### 3. Дублирование: langextract_processor.py vs gemini_extractor.py

**Факт:** Два файла с похожим функционалом:
- `langextract_processor.py` — 815 строк
- `gemini_extractor.py` — 787 строк

Оба извлекают описания через Gemini API. `langextract_processor.py` помечен как "v2 - December 2025" но фактически не используется в `book_tasks.py`.

---

## ТРЕБОВАНИЯ К АУДИТУ

### 1. Архитектурный анализ

**Проверь соответствие современным паттернам FastAPI 2026:**

a) **Service Layer Architecture**
- Роутеры должны только: валидация → вызов сервиса → форматирование ответа
- Бизнес-логика должна быть в сервисах
- Оцени: где нарушается это правило? (особенно `images.py`, `descriptions.py`)

b) **Repository Pattern**
- Используется ли Repository для доступа к данным?
- Или прямые SQL запросы в сервисах?

c) **Dependency Injection**
- Правильно ли используется `Depends()` в FastAPI?
- Есть ли сервисы-синглтоны vs per-request сервисы?

d) **Async everywhere**
- Все ли DB операции async?
- Есть ли blocking I/O в async функциях?

**Конкретно проанализируй:**
- Почему `images.py` 1189 строк? Что можно вынести?
- `descriptions.py` — где бизнес-логика, где API?
- Дублирование между `gemini_extractor.py` и `langextract_processor.py`

### 2. Система парсинга описаний (ГЛУБОКИЙ АНАЛИЗ)

Это ядро приложения. Полный pipeline:

```
1. book_tasks.py::process_chapters_parallel()
   ↓
2. gemini_extractor.py::analyze_chapter()
   → ChapterAnalysisResult(descriptions, entities, relationships)
   ↓
3. consistency_manager.py::process_chapter_analysis()
   → Создаёт Entity, EntityMention (НЕ создаёт DescriptionEntity!)
   ↓
4. book_tasks.py сохраняет Description в БД
   (НЕ связывает с Entity через DescriptionEntity!)
   ↓
5. entity_service.py::get_book_entity_network()
   → Загружает description_entities (пустые!) → notes=[] на фронтенде
```

**Анализируй:**
- Где должно создаваться DescriptionEntity?
- Как Gemini возвращает связь Description↔Entity? (поле `entities` в `GeminiDescriptionSchema`)
- Почему это не используется для создания DescriptionEntity?

### 3. Схема БД и модели

**Проверь модели на:**

a) **Индексы**
```python
# Есть ли индекс для частых запросов?
# Например: SELECT FROM descriptions WHERE chapter_id = ? ORDER BY position_in_chapter
```

b) **Отсутствующие связи**
- `Description` не имеет FK на `Entity` напрямую — это через `DescriptionEntity`
- Корректно ли это архитектурно?

c) **nullable поля**
```python
# entity.py:46
master_portrait_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
# Это OK или должен быть дефолт?
```

d) **JSONB поля**
```python
# entity.py:52
entity_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, default={}, nullable=False)
# Типизация dict[str, Any] — слишком general?
```

### 4. Celery Tasks

**Проверь:**
- Идемпотентность задач (можно ли безопасно retry?)
- Distributed locks (используется Redis lock в `book_tasks.py`)
- Soft time limits (есть: 10500s soft, 10800s hard)
- Graceful shutdown (Celery 5.6 features)

### 5. Обработка ошибок

**Проверь:**
- Retry логика для Gemini API (tenacity с exponential backoff)
- Что происходит при quota exhausted?
- Транзакционность: rollback при ошибках

### 6. Кэширование

**Redis используется для:**
- Entity network cache (`book:{id}:entity_network_v3`)
- Chapter descriptions cache
- Reading session cache

**Проверь:**
- TTL политики
- Инвалидация кэша при изменениях
- Memory limits (640MB с LRU eviction)

### 7. Security

**Проверь:**
- JWT токены (ACCESS 7 дней, REFRESH 30 дней — адекватно для reading app?)
- File upload validation
- SQL injection защита (SQLAlchemy ORM)
- CORS настройки

---

## ФОРМАТ ОТЧЁТА

### Часть 1: Executive Summary
- Общая оценка зрелости backend (1-10)
- 3 главных сильных стороны
- 3 критических проблемы

### Часть 2: Детальный анализ по категориям

Для каждой категории:
```
## [Название категории]

### Текущее состояние
[Описание как сейчас]

### Выявленные проблемы
1. **[Проблема]** (Severity: P0/P1/P2)
   - Файл: `path/to/file.py:123`
   - Код: ```python...```
   - Влияние: [на что влияет]
   
### Рекомендации
1. [Конкретное действие]
   - Пример кода исправления
```

### Часть 3: Технический долг

| ID | Описание | Файл(ы) | Сложность | Приоритет |
|----|----------|---------|-----------|-----------|
| TD-001 | DescriptionEntity не создаются | book_tasks.py, consistency_manager.py | M | P0 |
| TD-002 | Дублирование extractors | langextract_processor.py | L | P2 |

### Часть 4: План доработок с приоритетами

**P0 — Критично (исправить в течение 24 часов)**
- Блокеры production
- Data loss риски

**P1 — Высокий (текущий спринт)**
- Серьёзные баги
- Производительность

**P2 — Средний (бэклог)**
- Рефакторинг
- Code quality

**P3 — Низкий (nice-to-have)**
- Оптимизации
- Новые фичи

Для каждой задачи:
```
### [ID] Название задачи
- **Приоритет**: P0/P1/P2/P3
- **Сложность**: S (1-2h) / M (2-8h) / L (1-3d) / XL (3-7d)
- **Проблема**: [описание]
- **Решение**: [конкретные шаги]
- **Зависимости**: [от каких задач зависит]
- **Риски**: [что может пойти не так]
```

---

## КОНТЕКСТ ДЛЯ ИССЛЕДОВАНИЯ

### Best Practices 2026

1. **FastAPI 0.125+**
   - Annotated dependencies
   - Lifespan events вместо on_startup/on_shutdown
   - Custom exception handlers

2. **SQLAlchemy 2.0.45**
   - Mapped[] и mapped_column() для type hints
   - selectinload() для eager loading
   - Async sessions с AsyncSession

3. **Celery 5.6**
   - Soft shutdown (SIGTERM handling)
   - Memory leak fixes
   - Native Pydantic support

4. **google-genai 1.59**
   - Structured Output с JSON Schema
   - Pydantic интеграция (GeminiResponseSchema)
   - Rate limiting handling

### Паттерны для сравнения

Используй web-search и Context7 для поиска:
- "FastAPI service layer architecture 2026"
- "SQLAlchemy 2.0 async patterns"
- "Celery 5.6 best practices"
- "google-genai structured output Pydantic"

---

## ИНСТРУКЦИИ

1. **Глубина анализа**: Читай код, не поверхностно смотри
2. **Конкретика**: Указывай файлы, строки, примеры кода
3. **Практичность**: Предлагай конкретные решения, не абстрактные рекомендации
4. **Приоритизация**: P0 > P1 > P2 > P3
5. **Язык**: Отчёт на русском языке
6. **Фокус**: Начни с системы парсинга (gemini_extractor → consistency_manager → book_tasks)

Начни анализ с критической проблемы #1: почему DescriptionEntity не создаются и как это исправить.
