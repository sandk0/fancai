# Промпт для глубокого аудита инфраструктуры fancai (v3) + миграция на OpenRouter

## Контекст для Claude Opus 4.6

Ты — senior DevOps/infrastructure архитектор. Тебе предстоит провести глубокий аудит двух отчётов по инфраструктуре проекта fancai (fiction reader с AI-иллюстрациями и интерактивным глоссарием персонажей), а также исследовать и спроектировать миграцию с прямого Gemini/Imagen API на OpenRouter как единый AI gateway.

---

## О проекте fancai

**Стек:** React 19 + TypeScript + Vite 7 | FastAPI + Python 3.12 + PostgreSQL 17 + Redis 7.4 + Celery 5.6
**Текущий AI стек:** Gemini 3.0 Flash (экстракция описаний + глоссарий сущностей) | Imagen 4 (генерация иллюстраций)
**Production:** https://fancai.ru | Single-server deployment (Docker Compose)
**Планируемый сервер:** 12 ядер AMD EPYC 9755 4 GHz, 32 ГБ DDR5 RAM, 100 ГБ NVMe (vdsina.com)

### Два ключевых AI-пайплайна:

**1. Обработка книги (process_book task, до 3 часов):**

- Парсинг EPUB/FB2 → разбивка на главы
- Для каждой главы: Gemini извлекает описания сцен + сущности (персонажи, локации, предметы) в structured JSON
- Entity deduplication: fuzzy matching + LLM-based semantic merge
- Entity synthesis: LLM генерирует биографии, роли, milestone-ы
- Graph analysis: PageRank для определения важности персонажей
- ~170-220 LLM API calls на книгу (100 глав)
- asyncio.Semaphore(10) — до 10 параллельных глав

**2. Генерация изображений (generate_image task, 10-20 сек):**

- Описание сцены на русском → перевод на английский через LLM (кэшируется)
- Английский промпт → image generation API
- Сохранение в storage + push-уведомление
- Rate: до 30 images/min (Celery), реальный лимит — API

### Текущие проблемы с Gemini/Imagen API:

- Gemini 2.0 Flash **удалён 3 марта 2026** — требуется миграция модели
- Free tier: 10 RPM, 250 RPD — **максимум 1.5 книги/день**
- Paid Tier 1: 300 RPM, 1,500 RPD — **максимум 9 книг/день**
- Imagen Free: 2 IPM, 100 RPD
- Imagen Paid: $0.02/image — при 100 premium-пользователях = **$1,000/мес**
- Vendor lock-in на Google — нет fallback если API упадёт

---

## Задачи (выполнить по порядку)

### Задача 1: Глубокий аудит отчётов v1 и v2

Прочитай оба отчёта:

- `docs/reports/2026-03-01-infrastructure-migration-analysis.md` (v1)
- `docs/reports/2026-03-01-infrastructure-audit-v2.md` (v2)

Проведи критический аудит по следующим критериям:

**1.1 Фактические ошибки:**

- Проверь все числа (RPS, RAM, pricing) через актуальные веб-источники
- Проверь версии зависимостей — актуальны ли они на март 2026?
- Проверь бенчмарки — не устарели ли они?

**1.2 Логические пробелы:**

- Какие компоненты инфраструктуры не рассмотрены?
- Какие risk-и не учтены?
- Где рекомендации противоречат друг другу?

**1.3 Capacity model:**

- Верна ли модель нагрузки? Пересчитай с учётом реальных паттернов использования
- Учтены ли пиковые нагрузки? (например, вечер пятницы, выход популярной книги)
- Верны ли расчёты себестоимости на пользователя?

**1.4 Пересмотр решений:**

- Granian vs Uvicorn — подтверждается ли преимущество актуальными бенчмарками?
- Podman vs Docker — есть ли реальные production case studies для Python/FastAPI проектов?
- Valkey vs Redis — подтверждается ли 100% совместимость с Celery/Python redis клиентом?
- Taskiq — достаточно ли зрелый для production? Есть ли production case studies?
- Caddy — какие фичи nginx теряются? Критичны ли они?

### Задача 2: Исследование OpenRouter как AI gateway

**2.1 Веб-исследование OpenRouter:**

Проведи глубокое исследование через WebSearch/WebFetch:

- Актуальные модели на OpenRouter (март 2026): полный список с ценами
- Rate limits на разных тарифах OpenRouter
- Structured output поддержка: какие модели поддерживают JSON Schema?
- Image generation модели: какие доступны, цены, качество
- Reliability: uptime, SLA, fallback routing
- Python SDK/клиент: совместимость с OpenAI SDK
- Billing: prepaid credits, enterprise plans

**2.2 Выбор моделей для обработки книг (экстракция + entity analysis):**

Критерии выбора:

- **Structured JSON output** — обязательно, модель должна надёжно генерировать valid JSON по schema
- **Длинный контекст** — главы могут быть до 100K символов (после chunking с 15% overlap)
- **Русский язык** — книги на русском, entity names на русском
- **Скорость** — чем быстрее, тем лучше (обработка 100+ глав)
- **Стоимость** — ключевой фактор при масштабировании (170+ calls на книгу)
- **Качество экстракции** — не терять сущности, правильно парсить художественный текст

Исследуй и сравни минимум 5-7 моделей:

- Gemini 2.5 Flash / Gemini 3 Flash (через OpenRouter)
- DeepSeek V3 / V3.2
- Qwen 3 (разные размеры)
- Claude 3.5 Haiku / Claude 4.5 Haiku
- Mistral Medium / Large
- Llama 4 Scout / Maverick
- GPT-4o mini

Для каждой модели укажи:

- Цена input/output за 1M tokens на OpenRouter
- Max context window
- Structured output support (да/нет/частично)
- Качество работы с русским языком (если есть данные)
- Скорость генерации (tokens/sec если доступно)
- Рекомендация: primary / fallback / не подходит

**2.3 Выбор моделей для генерации изображений:**

Критерии выбора:

- **Качество иллюстраций** — художественный стиль, подходящий для книжных иллюстраций
- **Стоимость** — текущий Imagen 4 стоит $0.02/image, нужно дешевле или сравнимо
- **Скорость** — текущий Imagen: 5-15 сек/image
- **API reliability** — стабильность, uptime
- **Стиль** — возможность задавать стиль (книжная иллюстрация, не фотореализм)
- **Цензура** — минимальная (книжные сцены, не порно, но бои/драмы должны проходить)

Исследуй и сравни:

- Gemini native image generation (через OpenRouter)
- Flux Pro / Flux 1.1 Pro
- DALL-E 3 / GPT-Image
- Stable Diffusion 3.5 / SDXL
- Ideogram v3
- Seedream 4.5
- Recraft v3
- Playground v3
- Любые другие модели, доступные на OpenRouter для image generation

Для каждой модели укажи:

- Цена за изображение на OpenRouter
- Доступные разрешения
- Время генерации
- Качество для книжных иллюстраций (если есть примеры/обзоры)
- Рекомендация: primary / fallback / не подходит

**2.4 Архитектура multi-model routing:**

Спроектируй систему, где:

- Primary модель для экстракции (дешёвая, быстрая, хороший русский)
- Fallback модель (если primary недоступна или ошибается)
- Primary модель для изображений
- Fallback модель для изображений
- Автоматический routing между моделями при ошибках
- Budget alerts (не тратить больше X$/день)

### Задача 3: TCO (Total Cost of Ownership) сравнение

Посчитай месячную стоимость для 3 сценариев:

**Сценарий A: Текущий (прямой Gemini + Imagen API)**

- 50 активных пользователей, 20 книг/мес, 3,000 images/мес

**Сценарий B: OpenRouter (выбранные модели)**

- Те же 50 пользователей, 20 книг, 3,000 images

**Сценарий C: OpenRouter optimized (с caching, dedup, дешёвыми моделями)**

- Те же объёмы, но с оптимизациями

Для каждого сценария:

- Стоимость LLM calls (экстракция + synthesis + dedup)
- Стоимость image generation
- Стоимость сервера (VPS)
- Итого TCO/месяц
- Себестоимость на пользователя

### Задача 4: Итоговый отчёт

Сохрани результат в `docs/reports/2026-03-01-infrastructure-audit-v3-openrouter.md`

Структура:

```markdown
# Инфраструктурный аудит v3 + OpenRouter миграция

## Executive Summary (3-5 предложений)

## Часть 1: Аудит v1/v2 — найденные ошибки и пробелы

## Часть 2: OpenRouter — исследование платформы

## Часть 3: Модели для экстракции текста — сравнительная таблица

## Часть 4: Модели для генерации изображений — сравнительная таблица

## Часть 5: Архитектура multi-model routing

## Часть 6: TCO сравнение (3 сценария)

## Часть 7: Пересмотренные рекомендации (итоговая таблица)

## Часть 8: План миграции на OpenRouter (пошаговый)

## Источники (все ссылки)
```

---

## Важные ограничения

1. **Все данные подтверждай веб-поиском** — не полагайся на training data, ищи актуальные цены и версии
2. **Пиши на русском языке** (кроме технических терминов, имён моделей, кода)
3. **Будь критичен** — ищи ошибки, не подтверждай решения без проверки
4. **Приоритет — стоимость** — проект на ранней стадии, budget matters
5. **Приоритет — vendor independence** — OpenRouter как gateway = легко менять модели
6. **Не забывай про русский язык** — модели должны хорошо работать с русским текстом, это критично для экстракции сущностей из русскоязычных книг

---

## Файлы для чтения

```
docs/reports/2026-03-01-infrastructure-migration-analysis.md  (отчёт v1)
docs/reports/2026-03-01-infrastructure-audit-v2.md            (отчёт v2)
backend/app/core/config.py                                     (настройки backend)
backend/app/core/celery_config.py                              (настройки Celery)
backend/app/services/gemini_extractor.py                       (текущий LLM экстрактор)
backend/app/services/imagen_generator.py                       (текущий image generator)
backend/app/tasks/book_tasks.py                                (pipeline обработки книг)
backend/app/tasks/image_tasks.py                               (pipeline генерации изображений)
docker-compose.lite.prod.yml                                   (production compose)
```
