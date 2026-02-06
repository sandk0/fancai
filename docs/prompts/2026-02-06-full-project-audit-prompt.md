# Промпт: Полный аудит проекта fancai + оптимизация конфигурации Claude Code

**Модель:** Claude Opus 4.6
**Цель:** Глубокий анализ всего проекта (код + конфигурация Claude Code) → выявление несоответствий → улучшение конфигурации на основе реального кода
**Формат:** Скопировать текст ниже (от --- до ---) и вставить в Claude Code

---

Проведи полный аудит проекта fancai в трёх направлениях:

1. **Анализ кодовой базы** — полная ревизия всех модулей, особенно LLM-пайплайнов обработки книг
2. **Анализ конфигурации Claude Code** — насколько конфигурация отражает реальный код
3. **Веб-исследование** — лучшие практики Claude Code 2026 + применимость к fancai

Результат — подробный отчёт в `docs/reports/2026-02-06-full-project-audit.md`. Никаких изменений в код или конфигурацию на этом этапе — только анализ и рекомендации.

## Контекст проекта

**fancai** — full-stack PWA для чтения художественной литературы с двумя ключевыми AI-функциями обработки книг:

### AI-функция 1: Извлечение описаний → Генерация изображений

Полный пайплайн:
1. Пользователь загружает EPUB-книгу
2. Система парсит главы
3. **Gemini 3.0 Flash** анализирует текст главы и извлекает визуальные описания (локации, персонажи, атмосфера, объекты, действия)
4. Два режима извлечения: **TSA** (Tagged Span Annotation — XML-теги для точного позиционирования) и **Legacy** (структурированный JSON)
5. Описания хранятся в БД с привязкой к главе и позиции в тексте
6. **Imagen 4** генерирует иллюстрации по описаниям (с предварительным переводом RU→EN через Gemini 2.0 Flash Lite)
7. Стилевые шаблоны: разные промпты для location/character/atmosphere
8. Описания подсвечиваются в epub-ридере с помощью 9 стратегий поиска (useDescriptionHighlighting.ts)

Ключевые файлы пайплайна описаний:
- `backend/app/services/gemini_extractor.py` — основная LLM-логика извлечения (TSA_EXTRACTION_PROMPT, EXTRACTION_PROMPT, чанкинг по 100K символов, параллельная обработка, дедупликация)
- `backend/app/services/description_extraction_service.py` — бизнес-логика (Redis-кеширование, distributed lock, batch-загрузка)
- `backend/app/services/llm_description_enricher.py` — обогащение описаний
- `backend/app/services/imagen_generator.py` — Imagen 4 API (перевод, стилевые шаблоны, retry)
- `backend/app/services/image_generator.py` — оркестратор генерации (batch + single)
- `backend/app/services/image_crud_service.py` — CRUD для изображений
- `backend/app/models/description.py` — модель Description (type enum: LOCATION/CHARACTER/ATMOSPHERE/OBJECT/ACTION)
- `backend/app/models/image.py` — модель GeneratedImage (status, prompt_used, quality_score)
- `backend/app/routers/descriptions.py` — API описаний (GET/POST endpoints)
- `backend/app/routers/images.py` — API изображений (sync + async через Celery)
- `backend/app/tasks/image_tasks.py` — Celery-таски для async-генерации
- `frontend/src/api/descriptions.ts` + `frontend/src/api/images.ts` — API-клиент
- `frontend/src/hooks/epub/useDescriptionHighlighting.ts` — 9 стратегий подсветки в epub.js
- `frontend/src/hooks/api/useDescriptions.ts` + `frontend/src/hooks/reader/useDescriptionManagement.ts`
- `frontend/src/components/Images/` — ImageViewer, ImageGallery, ImageGrid, ImageModal, ImageControls, ImageFilters
- `frontend/src/components/Reader/ImageGenerationStatus.tsx`

### AI-функция 2: Глоссарий/Вики книги (основная продающая функция)

Полный пайплайн:
1. В том же вызове Gemini, что и описания, извлекаются сущности: персонажи, локации, объекты
2. Для каждой сущности: имя, тип, визуальное описание (мин. 100 символов), все алиасы, важность (1-10), позиция первого упоминания
3. **Дедупликация** происходит в два этапа: автоматическая (fuzzy matching, SequenceMatcher > 0.85) + LLM-based (semantic merge через отдельный промпт)
4. **Граф связей** между сущностями (NetworkX: PageRank, Louvain communities)
5. **Spoiler-free** механизм: CFI-based блокировка — сущности видны только до текущей главы чтения, алиасы раскрываются по мере продвижения
6. Frontend: карточки сущностей, профили, drawer в ридере, админ-панель для мержа

Ключевые файлы пайплайна глоссария:
- `backend/app/services/gemini_extractor.py` — извлечение сущностей (GeminiEntitySchema: name, type, visual_summary, aliases, confidence, importance, first_mention_offset)
- `backend/app/services/entity_service.py` — управление сетью сущностей, spoiler-free фильтрация (get_book_entity_network, _filter_aliases_by_chapter, _get_earliest_cfi)
- `backend/app/services/entity_deduplication_service.py` — LLM-based дедупликация (DEDUPLICATION_PROMPT, MergeGroup, confidence/reason)
- `backend/app/services/graph_service.py` — граф (NetworkX, PageRank, Louvain, экспорт для React Force Graph)
- `backend/app/models/entity.py` — Entity (aliases_with_reveal, first_mention_chapter/cfi, entity_metadata JSON)
- `backend/app/models/entity_mention.py` — упоминания с CFI и offset
- `backend/app/models/entity_relationship.py` — рёбра графа (type, weight, context)
- `backend/app/models/description_entity.py` — связь описаний и сущностей (M2M)
- `backend/app/routers/books/entities.py` — API (GET /books/{id}/entities с spoiler protection)
- `backend/app/routers/admin/entities.py` — admin endpoints для мержа
- `backend/app/tasks/book_tasks.py` — process_book_task (валидация + entity extraction, soft time limit 3h)
- `frontend/src/components/Entities/EntityCard.tsx` — карточка сущности (locked if not met)
- `frontend/src/components/Entities/EntityList.tsx`, `EntityProfile.tsx`, `EntityDrawer.tsx`
- `frontend/src/components/Admin/AdminEntityMerge.tsx`
- `frontend/src/hooks/useEntityNetwork.ts`, `frontend/src/hooks/epub/useEntityCFIPopulation.ts`

### Общая инфраструктура AI

- **Единый вызов Gemini:** `analyze_chapter()` извлекает описания И сущности одновременно → возвращает `ChapterAnalysisResult`
- **Модели Gemini:** `gemini-3-flash-preview` (основное извлечение), `gemini-2.0-flash-lite` (перевод — экономия)
- **Retry/Resilience:** `backend/app/core/retry.py` (tenacity: @retry_llm_extraction, @retry_image_generation, custom exceptions)
- **Мониторинг:** `backend/app/monitoring/metrics.py` (Prometheus: llm_request, llm_error, llm_rate_limit, description_count, llm_cache_hit/miss)
- **Кеширование:** Redis для LLM-ответов (TTL 24h), entity network (TTL 1h), chapter descriptions
- **Очереди:** Celery для async image generation, book processing (distributed lock, soft time limit)

### Стек (полный)

- **Frontend:** React 19 + TypeScript 5.7 + Vite 6 + epub.js 0.3.93 + TanStack Query 5 + Zustand 5 + Tailwind CSS + shadcn/ui
- **Backend:** FastAPI + Python 3.11 + PostgreSQL 15 + Redis 7.4 + Celery 5.4 + SQLAlchemy 2.0
- **AI:** Gemini 3.0 Flash + Gemini 2.0 Flash Lite + Imagen 4
- **Infra:** Docker Compose на VPS (fancai.ru), SSH-деплой
- **Продакшен:** https://fancai.ru
- **Один разработчик** (соло-проект)

### Текущее состояние конфигурации Claude Code (после аудита 2026-02-05)

- `CLAUDE.md` — 48 строк (сокращён с 174)
- `.claude/settings.json` — 98 строк (6 hooks, 8 deny rules, 15 allow permissions)
- `.claude/settings.local.json` — 25 строк (13 permissions, 2 plugins)
- **3 агента:** fancai-orchestrator, epub-reader (Sonnet 4.5), gemini-imagen
- **5 skills:** tech-stack, task-router, research-and-analysis, deploy, db-migrate
- **3 commands:** /go, /test, /build
- **2 rules:** auto-routing.md, frontend.md
- **4 hook-скрипта:** protect-files.sh, block-dangerous.sh, save-progress.sh, format/format_hook.sh
- **2 плагина:** context7, superpowers
- **1 MCP:** chrome-devtools (через плагин)
- **MEMORY.md:** 48 строк (Core Architecture, Hot Files, Known Issues, Entity/Glossary, Patterns)

### Статистика использования Claude Code (за 5.5 месяцев)

- 685 коммитов (59% fix), 97 сжатий контекста, 0.7% test-коммитов
- 7 182 вызова инструментов, 63 сессии
- Hottest file: EpubReader.tsx (84 изменения)

---

## Фаза 1: Глубокий анализ кодовой базы

### 1.1 LLM-пайплайн обработки книг (ПРИОРИТЕТ)

Это самая важная часть аудита. Проанализируй:

**Архитектура извлечения:**
- Как устроен `analyze_chapter()` — единый вызов для описаний и сущностей. Оптимален ли этот подход? Не теряется ли качество?
- Два режима извлечения (TSA vs Legacy) — когда используется какой? Есть ли мёртвый код? Нужен ли Legacy?
- Промпты `TSA_EXTRACTION_PROMPT` и `EXTRACTION_PROMPT` — их качество, полнота, эффективность
- Чанкинг (100K символов) — адекватен ли? Как обрабатываются границы чанков? Не теряются ли сущности на стыках?
- Параллельная обработка чанков — как реализована? Есть ли race conditions?

**Качество извлечения сущностей:**
- Промпт для извлечения сущностей — полнота инструкций, обработка edge cases
- Автоматическая дедупликация (fuzzy matching) — порог 0.85 адекватен? Ложные срабатывания/пропуски?
- LLM-дедупликация (`DEDUPLICATION_PROMPT`) — качество промпта, формат ответа
- Spoiler-free механизм — корректность CFI-фильтрации, edge cases
- Алиасы сущностей — как обрабатываются? Нет ли потерь?

**Качество извлечения описаний:**
- Промпт для извлечения описаний — полнота, типы (LOCATION/CHARACTER/ATMOSPHERE/OBJECT/ACTION)
- Позиционирование описаний в тексте — точность TSA vs Legacy
- 9 стратегий подсветки (`useDescriptionHighlighting.ts`) — почему так много? Все ли нужны?

**Генерация изображений:**
- Pipeline: описание → перевод RU→EN → стилевой шаблон → Imagen 4
- Качество перевода (Gemini 2.0 Flash Lite — не слишком ли простая модель?)
- Стилевые шаблоны — адекватны ли для разных типов описаний?
- Error handling и retry — покрывают ли все сценарии Imagen API?

**Граф связей:**
- NetworkX для PageRank и Louvain — масштабируется ли на большие книги (1000+ сущностей)?
- Экспорт для React Force Graph — формат данных, производительность на фронтенде

### 1.2 Frontend-архитектура

Проанализируй:
- **EpubReader.tsx** (84 изменения) — текущее состояние, degree of decomposition, что ещё можно извлечь в хуки
- **Компонентная структура** — организация по директориям, переиспользуемость
- **Стейт-менеджмент** — Zustand stores: что в каком, нет ли размазывания
- **TanStack Query** — паттерны использования, стратегии кеширования, query keys
- **epub.js интеграция** — все хуки в hooks/epub/, их взаимодействие
- **Entity UI** — EntityCard, EntityList, EntityDrawer, EntityProfile — полнота UX, spoiler-free корректность
- **Image UI** — все компоненты в Images/, UX генерации
- **Маршрутизация** — структура, lazy loading
- **Типизация** — покрытие TypeScript, any/unknown usage, типы API-ответов

### 1.3 Backend-архитектура

Проанализируй:
- **Service layer** — все сервисы в services/, их ответственность, связность
- **Models** — все SQLAlchemy модели, связи, индексы, миграции
- **API layer** — все роутеры, структура endpoints, валидация
- **Celery tasks** — все таски, retry policy, error handling, мониторинг
- **Кеширование** — Redis patterns, TTL стратегия, инвалидация
- **Database** — схема, индексы, N+1 queries, connection pooling
- **Error handling** — паттерны обработки ошибок, логирование
- **Мониторинг** — Prometheus метрики, покрытие, алертинг

### 1.4 Тестирование

Проанализируй:
- **Backend тесты** — покрытие, паттерны, фикстуры, моки для Gemini/Imagen
- **Frontend тесты** — покрытие, что тестируется, что нет
- **LLM тесты** — есть ли тесты для промптов? Для парсинга ответов?
- **Entity pipeline тесты** — дедупликация, spoiler-free фильтрация, граф
- **Integration тесты** — есть ли? Что покрывают?

### 1.5 Зависимости и безопасность

Проанализируй:
- `package.json` — устаревшие пакеты, уязвимости, неиспользуемые
- `requirements.txt` / `pyproject.toml` — устаревшие пакеты, уязвимости
- Docker images — базовые образы, размеры, best practices

---

## Фаза 2: Анализ конфигурации Claude Code vs реальный код

Цель: выявить расхождения между тем, что описано в конфигурации Claude Code, и тем, что реально есть в коде.

### 2.1 CLAUDE.md vs реальность

- Все ли Architecture Gotchas актуальны?
- Отражает ли описание Entity system реальную сложность?
- Нет ли важных паттернов в коде, которых нет в CLAUDE.md?
- Корректны ли ссылки на файлы и hooks?

### 2.2 Agents vs реальность

- **gemini-imagen** — покрывает ли агент ВСЕ файлы LLM-пайплайна? Не пропущены ли:
  - `llm_description_enricher.py`
  - `description_extraction_service.py`
  - `image_crud_service.py`
  - Celery tasks (`image_tasks.py`, `book_tasks.py`)
  - Monitoring (`metrics.py`)
  - Retry logic (`retry.py`)
  - Pydantic schemas
- **epub-reader** — покрывает ли ВСЕ epub-related хуки и компоненты?
- **orchestrator** — отражает ли delegation matrix реальные зависимости?

### 2.3 Skills vs реальность

- **tech-stack** — актуальны ли версии и описания?
- **deploy** — соответствует ли реальному процессу деплоя?
- **db-migrate** — покрывает ли все edge cases миграций?

### 2.4 Hooks vs реальность

- **protect-files.sh** — все ли критичные файлы защищены? Не пропущены ли промпт-файлы Gemini?
- **block-dangerous.sh** — покрывает ли все опасные паттерны?
- **format_hook.sh** — все ли форматтеры корректно работают?
- **save-progress.sh** — надёжен ли? Работает ли async?

### 2.5 MEMORY.md vs реальность

- Актуальны ли "Known Issues"?
- Полон ли список "Hot Files"?
- Отражает ли "Entity/Glossary System" все файлы пайплайна?

### 2.6 Rules vs реальность

- **auto-routing.md** — все ли триггеры адекватны?
- **frontend.md** — нет ли устаревших правил?

---

## Фаза 3: Веб-исследование лучших практик

Для каждой темы: минимум 5 источников, конкретные примеры, оценка применимости к fancai.

### 3.1 Claude Code конфигурация (2025-2026)

- Новые фичи Claude Code, выпущенные в конце 2025 — начале 2026
- CLAUDE.md best practices (оптимальная длина, структура, @import)
- Hooks advanced patterns (agent hooks, prompt hooks, chaining)
- MEMORY.md patterns (что хранить, как структурировать, размер)
- Rules system — лучшие примеры `.claude/rules/*.md`
- Model selection для агентов: когда Opus, когда Sonnet, когда Haiku

### 3.2 LLM для обработки книг (специализированный поиск)

- Best practices для извлечения сущностей из художественного текста с помощью LLM
- Промпт-инженеринг для entity extraction: structured output, few-shot examples, chain-of-thought
- Дедупликация сущностей: алгоритмы, LLM-based подходы, гибридные методы
- Spoiler-free systems: как другие проекты решают задачу "информация до текущей позиции"
- Книжные графы знаний: существующие инструменты и подходы (BookNLP, LitBank, etc.)
- Chunking strategies для длинных текстов: семантическое vs фиксированное разбиение
- Gemini API best practices 2026: structured output, function calling, context caching

### 3.3 Плагины и MCP-серверы

- Новые плагины в маркетплейсе Claude Code (конец 2025 — 2026)
- PostgreSQL MCP — нужен ли прямой доступ к БД из Claude Code?
- Docker MCP — управление контейнерами
- GitHub MCP (расширенный)
- Есть ли MCP для мониторинга (Prometheus/Grafana)?
- Альтернативы superpowers — что появилось нового?

### 3.4 Workflow и автоматизация

- TDD workflow в Claude Code — автоматический запуск тестов
- CI/CD интеграция с Claude Code
- Git worktrees best practices
- Session management для соло-разработчика
- Anti-patterns: что НЕ делать с Claude Code

---

## Стратегия выполнения

Запусти **7 параллельных агентов** (Task tool):

| # | Агент | Тип | Модель | Что делает |
|---|-------|-----|--------|------------|
| 1 | LLM Pipeline Analyzer | Explore (very thorough) | — | Фаза 1.1: Глубокий анализ ВСЕХ файлов LLM-пайплайна (описания + сущности + изображения). Читает каждый файл, анализирует промпты, логику, edge cases |
| 2 | Frontend Analyzer | Explore (very thorough) | — | Фаза 1.2: Анализ frontend-архитектуры — компоненты, хуки, стейт, типизация |
| 3 | Backend Analyzer | Explore (very thorough) | — | Фаза 1.3: Анализ backend-архитектуры — сервисы, модели, API, Celery, Redis |
| 4 | Test & Deps Analyzer | Explore (medium) | — | Фазы 1.4 + 1.5: Тестирование, зависимости, безопасность |
| 5 | Config vs Code Auditor | Explore (thorough) | — | Фаза 2: Сравнение ВСЕХ конфигов с реальным кодом, поиск расхождений |
| 6 | Claude Code Research | general-purpose | — | Фаза 3.1 + 3.3 + 3.4: Веб-исследование конфигурации, плагинов, workflow |
| 7 | LLM Book Processing Research | general-purpose | — | Фаза 3.2: Специализированное исследование LLM для обработки книг, entity extraction, knowledge graphs |

После завершения всех агентов — синтезируй результаты в единый отчёт.

---

## Формат отчёта

Сохрани в `docs/reports/2026-02-06-full-project-audit.md`:

```markdown
# Полный аудит проекта fancai

**Дата:** 2026-02-06
**Scope:** Кодовая база + конфигурация Claude Code + исследование лучших практик

## Executive Summary
[5-7 предложений: главные находки, критичные проблемы, ключевые рекомендации]

## Часть 1: Анализ кодовой базы

### 1.1 LLM-пайплайн обработки книг

#### 1.1.1 Извлечение описаний и сущностей
[Архитектура analyze_chapter(), качество промптов, чанкинг, параллелизм]

#### 1.1.2 Дедупликация сущностей
[Fuzzy matching + LLM dedup, качество, edge cases]

#### 1.1.3 Spoiler-free система
[CFI-фильтрация, алиасы, корректность]

#### 1.1.4 Генерация изображений
[Pipeline, перевод, стили, error handling]

#### 1.1.5 Граф связей
[NetworkX, масштабируемость, визуализация]

#### 1.1.6 Промпты Gemini
[Анализ каждого промпта: TSA_EXTRACTION_PROMPT, EXTRACTION_PROMPT, DEDUPLICATION_PROMPT, TRANSLATION_PROMPT]

### 1.2 Frontend
[Компоненты, стейт, TanStack Query, epub.js, типизация]

### 1.3 Backend
[Сервисы, модели, API, Celery, Redis, мониторинг]

### 1.4 Тестирование
[Покрытие, пробелы, рекомендации]

### 1.5 Зависимости и безопасность
[Устаревшие пакеты, уязвимости, Docker]

## Часть 2: Конфигурация Claude Code vs реальный код

### 2.1 Расхождения
[Таблица: компонент → что написано → что в реальности → рекомендация]

### 2.2 Пробелы в покрытии
[Файлы/паттерны в коде, которых нет в конфигурации]

### 2.3 Устаревшая информация
[Конфиги, которые ссылаются на удалённый/изменённый код]

## Часть 3: Исследование лучших практик

### 3.1 Claude Code конфигурация 2026
[Новые фичи, best practices, примеры]

### 3.2 LLM для обработки книг
[Entity extraction, deduplication, knowledge graphs, chunking, промпты]

### 3.3 Плагины и MCP
[Рекомендуемые к установке/удалению]

### 3.4 Workflow и автоматизация
[TDD, CI/CD, session management]

## Часть 4: План действий

### Критичные (немедленно)
[Пронумерованный список — проблемы, влияющие на качество AI-обработки]

### Важные (эта неделя)
[Пронумерованный список — конфигурация, тесты, архитектура]

### Рекомендуемые (при возможности)
[Пронумерованный список — оптимизации, новые инструменты]

### Изменения в конфигурации Claude Code
[Конкретные дельты для каждого файла: что добавить, что изменить, что удалить]

## Источники
[Все URL с описанием]
```

## Ключевые требования

1. **Глубина анализа LLM:** Прочитай КАЖДЫЙ файл LLM-пайплайна целиком. Не ограничивайся структурой — анализируй логику, промпты, edge cases
2. **Конкретность:** Для каждой рекомендации — готовый код/конфигурация
3. **Привязка к коду:** Каждое утверждение подкрепляй ссылкой на конкретный файл и строку
4. **LLM промпты:** Проанализируй ВСЕ промпты, отправляемые в Gemini — их структуру, полноту инструкций, обработку edge cases, возможности улучшения
5. **Применимость:** Каждая находка из исследования — через призму fancai (соло-разработчик, EPUB-ридер, Entity glossary, Gemini+Imagen)
6. **Без изменений:** НИЧЕГО не меняй — только отчёт

---
