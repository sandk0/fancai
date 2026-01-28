# Промпт для исследования отложенных задач Backend fancai

**Дата создания:** 26 января 2026  
**Версия:** 1.0

## Контекст проекта

**fancai** — PWA для чтения книг с AI-генерацией иллюстраций по описаниям из текста.

### Технический стек (январь 2026)
- **Backend:** FastAPI 0.125, SQLAlchemy 2.0.45, Pydantic 2.x, Celery 5.6.2
- **LLM:** Google Gemini 3 Flash (google-genai 1.59)
- **Database:** PostgreSQL 15 + Redis 7.4
- **Frontend:** React 19, TypeScript 5.7, epub.js
- **Инфраструктура:** Docker, Production на https://fancai.ru

### Статус проекта
- Активный рефакторинг, пользователей нет (только тестировщики)
- Можно делать breaking changes в схеме БД
- Приоритет — долгосрочная архитектура, а не быстрые патчи

---

## Задачи для исследования

### 1. TD-P2-5: mention_cfi заполнение

**Проблема:**
При создании `EntityMention` в `consistency_manager.py` поле `mention_cfi` остаётся пустым:
```python
mention = EntityMention(
    chapter_id=chapter_id,
    entity_id=resolved_entity.id,
    mention_text=raw_entity.name,
    start_index=raw_entity.first_mention_offset,
    # mention_cfi=??? — НЕ ЗАПОЛНЯЕТСЯ
)
```

**Сложность:**
- `start_index` — character offset в plain text
- `mention_cfi` — EPUB Canonical Fragment Identifier (DOM-based position)
- Преобразование требует парсинга XHTML структуры главы

**Исследовать:**
1. Как epub.js вычисляет CFI на фронтенде? Можно ли переиспользовать?
2. Есть ли Python библиотеки для работы с EPUB CFI?
3. Как хранить соответствие character offset ↔ CFI?
4. Нужно ли вообще заполнять CFI на бэкенде или лучше делать это на фронтенде?
5. Альтернативы CFI для навигации в EPUB

**Контекст:**
- `backend/app/models/entity_mention.py` — модель EntityMention
- `backend/app/models/description_entity.py` — модель DescriptionEntity
- `backend/app/services/consistency_manager.py` — создание EntityMention
- `frontend/src/hooks/epub/` — работа с epub.js и CFI

---

### 2. TD-P2-9: Eager loading audit

**Проблема:**
В роутерах 21+ запросов к моделям (Book, Chapter, Description, Entity) без явного eager loading, что может вызывать N+1 queries.

**Текущее состояние:**
- Только 3 места используют `selectinload`:
  - `admin/entities.py` — `selectinload(Entity.book)`
  - `chapters.py` — `selectinload(Book.chapters)`
  - `admin/users.py` — `selectinload(User.subscription)`

**Исследовать:**
1. Современные паттерны eager loading в SQLAlchemy 2.0 (2025-2026)
2. Автоматическое определение N+1 queries (инструменты, профилировщики)
3. Lazy vs Eager loading — когда что использовать?
4. `selectinload` vs `joinedload` vs `subqueryload` — сравнение для разных случаев
5. Стратегии загрузки для GraphQL-подобных API

**Контекст:**
- `backend/app/routers/` — все роутеры (books/, images.py, descriptions.py, etc.)
- `backend/app/models/` — все модели и их relationships
- `backend/app/core/database.py` — конфигурация SQLAlchemy

---

### 3. TD-P2-4: LLM response caching

**Проблема:**
Каждый вызов `gemini_extractor.analyze_chapter(text)` делает API call, даже для уже обработанных глав.

**Текущая архитектура:**
```python
@dataclass
class ChapterAnalysisResult:
    descriptions: List[ExtractedDescription]  # dataclass
    entities: List[ExtractedEntity]           # dataclass
    relationships: List[ExtractedRelationship] # dataclass
```

**Сложность:**
- Dataclass объекты не сериализуются в JSON напрямую
- Нужен механизм инвалидации кэша при изменении промпта/модели
- Hash текста главы может быть дорогим для длинных глав

**Исследовать:**
1. Паттерны кэширования LLM ответов (2025-2026 best practices)
2. Semantic caching vs literal caching
3. Библиотеки для сериализации dataclass → JSON и обратно
4. Стратегии инвалидации кэша для LLM (версионирование промптов)
5. Redis data structures для кэширования (Hash, String, JSON)
6. Альтернативы: SQLite для LLM кэша, LangChain caching

**Контекст:**
- `backend/app/services/gemini_extractor.py` — текущая реализация
- `backend/app/core/cache.py` — CacheManager с Redis
- Стоимость API ~$0.15/книга, экономия при повторных вызовах

---

### 4. TD-P2-1: DescriptionExtractionService

**Проблема:**
`descriptions.py` — 903 строки с бизнес-логикой прямо в роутерах:
- Дублирование кода (строки 155-229 и 711-824)
- SQL запросы в endpoint'ах
- Сложность тестирования

**Исследовать:**
1. Service Layer паттерн в FastAPI (2025-2026 best practices)
2. Repository Pattern vs Active Record для SQLAlchemy 2.0
3. Dependency Injection в FastAPI — лучшие практики
4. Структура проекта для enterprise FastAPI приложений
5. Как разделять business logic, data access, и presentation
6. Примеры больших open-source FastAPI проектов

**Контекст:**
- `backend/app/routers/descriptions.py` — текущий код
- `backend/app/services/` — существующие сервисы
- `backend/app/services/book/` — пример структуры сервисов

---

### 5. TD-P2-2: ImageService

**Проблема:**
`images.py` — 1189 строк, самый большой роутер:
- ~600 строк SQL и бизнес-логики в endpoint'ах
- Сложная логика генерации изображений
- Интеграция с Imagen API

**Исследовать:**
1. Те же вопросы что для DescriptionExtractionService
2. Паттерны для работы с внешними AI API (Imagen, DALL-E)
3. Background job patterns для долгих операций (Celery best practices 2026)
4. Как организовать retry логику для image generation
5. Event-driven architecture для асинхронной генерации

**Контекст:**
- `backend/app/routers/images.py` — текущий код
- `backend/app/services/imagen_generator.py` — генератор изображений
- `backend/app/tasks/` — Celery tasks

---

## Требования к исследованию

### Источники информации
1. **Context7** — официальная документация библиотек
2. **Web Search** — блоги, статьи, конференции 2025-2026
3. **GitHub** — примеры из production проектов
4. **Codebase** — анализ текущей архитектуры fancai

### Формат результата
Для каждой задачи предоставить:

1. **Анализ проблемы** — почему текущее решение неоптимально
2. **Исследование альтернатив** — 2-3 варианта решения с pros/cons
3. **Рекомендуемое решение** — долгосрочное, архитектурно правильное
4. **План реализации** — пошаговый с оценкой времени
5. **Код-примеры** — конкретные сниппеты для fancai
6. **Риски и mitigation** — что может пойти не так

### Приоритеты
- **Долгосрочность** > Быстрота реализации
- **Maintainability** > Производительность (если не критично)
- **Type safety** > Динамичность
- **Explicit** > Implicit

---

## Дополнительный контекст для анализа

### Backend структура (проанализировать целиком)
```
backend/
├── app/
│   ├── core/           # Config, DB, Cache, Retry, CSRF
│   ├── models/         # SQLAlchemy models (9 файлов)
│   ├── routers/        # FastAPI endpoints (15+ файлов)
│   ├── services/       # Business logic (17+ файлов)
│   ├── tasks/          # Celery tasks
│   ├── schemas/        # Pydantic schemas
│   └── monitoring/     # Prometheus metrics
├── alembic/            # DB migrations
└── tests/              # pytest tests
```

### Ключевые flows
1. **Book Upload** → Parse EPUB → Extract Chapters → Store in DB
2. **Description Extraction** → Gemini API → Store Descriptions → Link to Entities
3. **Image Generation** → Build Prompt → Imagen API → Store Image → Notify User
4. **Reading Progress** → Track CFI Position → Sync Offline → Analytics

### Текущие проблемы архитектуры
- Бизнес-логика в роутерах (images.py, descriptions.py)
- Отсутствие четкого Service Layer
- Смешение sync/async кода
- Недостаточное покрытие тестами

---

## Ожидаемый результат

После исследования обновить `docs/reports/unified-backend-analysis-2026-01-26.md`:

1. Добавить секцию "Часть 10: Глубокий анализ отложенных задач"
2. Для каждой задачи — детальный план реализации
3. Обновить оценки времени с учётом исследования
4. Добавить архитектурные диаграммы (если применимо)
5. Приоритизировать задачи по влиянию на архитектуру

---

**Дата:** 26 января 2026  
**Автор промпта:** Claude (Sisyphus)
