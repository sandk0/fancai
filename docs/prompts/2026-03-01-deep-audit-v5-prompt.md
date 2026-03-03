# Промпт: Глубокий аудит инфраструктурных исследований v5

**Для:** Claude Opus 4.6
**Дата:** 2026-03-01
**Ожидаемый результат:** `docs/reports/2026-03-01-infrastructure-audit-v5-verified.md`

---

## Задача

Ты — старший DevOps/SRE-инженер и архитектор, специализирующийся на Python/FastAPI/React production-стеках. Проведи глубокий верификационный аудит 9 исследовательских отчётов в `docs/research/2026-03-01-audit-v4/`. Каждый отчёт должен быть проверен по трём осям: **веб-исследование**, **верификация по кодовой базе** и **проверка зависимостей**.

## Контекст проекта

**fancai** — fiction reader с AI-иллюстрациями и интерактивным глоссарием/энциклопедией по книгам.

### Стек (на 1 марта 2026)

**Frontend:**

- React 19, TypeScript 5.7, Vite 7.3, TanStack Query 5.90
- epub.js 0.3.93 (CFI-навигация)
- Tailwind CSS 4.1, Radix UI, Zustand 5
- Zod 4.3, React Hook Form 7.54, React Router 7.1
- Vitest 4.0, Playwright 1.49
- PWA: workbox 7.4, vite-plugin-pwa 1.2

**Backend:**

- Python 3.11, FastAPI 0.128, Pydantic 2.12, Pydantic Settings 2.12
- SQLAlchemy 2.0.46, Alembic 1.18, asyncpg 0.31
- Celery 5.6.2, Kombu 5.6.2, Redis 7.1 (py)
- google-genai 1.61 (Gemini 3.0 Flash + Imagen 4)
- Gunicorn 25.0, Uvicorn 0.40
- Sentry SDK 2.51, Prometheus client 0.24
- httpx 0.28, aiohttp 3.13, beautifulsoup4 4.14
- bcrypt 5.0, cryptography 46.0, PyJWT 2.10

**Infrastructure:**

- Docker: postgres:17-alpine, redis:7.4-alpine, nginx:1.27-alpine
- Сервер: 4 CPU / 8GB RAM (текущий) → 12 vCPU / 32GB RAM (новый)
- Production: fancai.ru, deploy через SSH + docker compose

### Ключевые сервисы (backend/app/services/)

| Сервис              | Файл                              | AI SDK       | Structured Output                         |
| ------------------- | --------------------------------- | ------------ | ----------------------------------------- |
| Gemini Extractor    | `gemini_extractor.py`             | google-genai | `response_schema=PydanticModel` (2 схемы) |
| Entity Dedup        | `entity_deduplication_service.py` | google-genai | `response_schema=DeduplicationResponse`   |
| Entity Synthesis    | `entity_synthesis_service.py`     | google-genai | `response_mime_type` (без schema)         |
| Consistency Manager | `consistency_manager.py`          | google-genai | `response_mime_type` (без schema)         |
| Imagen Generator    | `imagen_generator.py`             | google-genai | `client.models.generate_images()`         |

### Celery конфигурация (КРИТИЧНО — два конфликтующих файла)

**`backend/app/core/celery_app.py`** (ИСПОЛЬЗУЕТСЯ):

- `visibility_timeout=3600` (1 час)
- `worker_max_memory_per_child=150000` (150MB default)
- `task_soft_time_limit=1500` (25 мин), `task_time_limit=1800` (30 мин)

**`backend/app/core/celery_config.py`** (МЁРТВЫЙ КОД, не импортируется):

- `ResourceAwareCelery`, `NLP_CACHE_CONFIG` (1GB model cache)
- `worker_max_memory_per_child=5000000` (5GB)

**`backend/app/tasks/book_tasks.py`:**

- `time_limit=10800` (3 часа), `soft_time_limit=10500` (2ч 55мин)

**`docker-compose.lite.prod.yml`:**

- Celery worker: `--max-memory-per-child=400000` (400MB), `--concurrency=4`
- Memory limit: 1536M

### Docker Compose (текущий `docker-compose.lite.prod.yml`)

- **nginx** (proxy) + **frontend** (nginx static) = 2 контейнера nginx
- **backend** (FastAPI): 2G limit
- **celery-worker**: 1536M limit, concurrency=4
- **celery-beat**: 256M limit
- **postgres**: 17-alpine, `shared_buffers=512MB`, 2G limit
- **redis**: 7.4-alpine, `maxmemory=640mb`, 768M limit
- БЕЗ бэкапов PostgreSQL, БЕЗ мониторинга

### Legacy в config.py (мёртвый код)

- NLP настройки: `SPACY_MODEL`, `NLTK_DATA_PATH`, `MULTI_NLP_MODE`, `CONSENSUS_THRESHOLD`, `SPACY_WEIGHT`, `NATASHA_WEIGHT`, `STANZA_WEIGHT`, `validate_nlp_weights()`
- Модель в env: `LANGEXTRACT_MODEL=gemini-2.0-flash` (устаревшая, в config.py = `gemini-3-flash-preview`)

---

## 9 отчётов для аудита

Прочитай каждый файл из `docs/research/2026-03-01-audit-v4/`:

1. `01-openrouter-migration.md` — миграция на OpenRouter + prompt caching
2. `02-llm-models.md` — LLM модели и fallback chain
3. `03-image-models.md` — Image модели и стратегия
4. `04-monitoring.md` — Netdata + Uptime Kuma + Dozzle
5. `05-postgresql.md` — бэкапы + тюнинг PG17
6. `06-caddy-static.md` — замена 2× nginx на Caddy
7. `07-docker-ui.md` — Dockge vs Portainer
8. `08-celery-memory.md` — memory limits + найденные баги
9. `09-tco-migration-plan.md` — TCO расчёт + план миграции

---

## Методология аудита

### Ось 1: Веб-исследование (для каждого отчёта)

Для каждого утверждения, цены, версии и рекомендации в отчёте:

1. **Проверь актуальность на 1 марта 2026 года:**
   - Цены OpenRouter — могли измениться с момента исследования
   - Версии ПО — вышли ли новые релизы? (Caddy 2.x → 3.x? Netdata? Uptime Kuma?)
   - Статус моделей — Gemini 3 Flash вышел из preview? Новые модели появились?
   - Документация — изменились ли API/конфигурация?

2. **Проверь лучшие практики 2026 года:**
   - PostgreSQL 17 tuning — сверь с PGTune, рекомендациями Cybertec/2ndQuadrant
   - Celery 5.6 — новые фичи? breaking changes? лучшие практики?
   - Docker Compose v2 — новые возможности для resource limits?
   - Caddy — актуальные плагины, рекомендации по production deploy
   - Backups — есть ли лучшие решения чем prodrigestivill/postgres-backup-local?

3. **Найди то, что могли пропустить:**
   - Есть ли альтернативы, не рассмотренные в отчётах?
   - Security implications — что упущено?
   - Performance gotchas — известные проблемы с рекомендуемыми решениями?

### Ось 2: Верификация по кодовой базе

Для каждого отчёта сверь заявления с реальным кодом:

1. **Отчёт 01 (OpenRouter):**
   - Прочитай `backend/app/services/gemini_extractor.py` — как именно используется `response_schema`? Какие Pydantic модели?
   - Прочитай `backend/app/services/entity_deduplication_service.py` — формат `DeduplicationResponse`
   - Прочитай `backend/app/services/entity_synthesis_service.py` — как используется `response_mime_type`?
   - Прочитай `backend/app/services/consistency_manager.py` — то же
   - Прочитай `backend/app/services/imagen_generator.py` — как вызывается Imagen API?
   - **Вопросы:** Верна ли оценка сложности миграции? Есть ли неучтённые зависимости от google-genai SDK?

2. **Отчёт 08 (Celery):**
   - Верифицируй баг с `visibility_timeout` — сравни значения в `celery_app.py` и `book_tasks.py`
   - Действительно ли `celery_config.py` мёртвый код? Проверь все import'ы
   - Сверь memory limits во всех docker-compose файлах
   - Проверь `config.py` на legacy NLP настройки

3. **Отчёт 05 (PostgreSQL):**
   - Текущие параметры PG в `docker-compose.lite.prod.yml` — `shared_buffers=512MB`, `max_connections=100`
   - Есть ли существующие индексы? Проверь миграции в `backend/alembic/versions/`
   - `DB_POOL_SIZE=20`, `DB_MAX_OVERFLOW=40` в `config.py` — согласуется ли с рекомендацией `max_connections=80`?

4. **Отчёт 06 (Caddy):**
   - Прочитай текущий nginx конфиг: `nginx/nginx.prod.conf.template`, `nginx/conf.d/`
   - Посчитай реальное количество строк конфига nginx
   - Проверь `frontend/Dockerfile.prod` — как собирается frontend?

5. **Отчёт 09 (TCO):**
   - Проверь текущую модель (`GEMINI_MODEL` и `IMAGEN_MODEL` в `config.py`)
   - Расхождение: в env `LANGEXTRACT_MODEL=gemini-2.0-flash`, в config.py `gemini-3-flash-preview`
   - Расчёт стоимости — учтена ли стоимость entity synthesis/dedup отдельно?

### Ось 3: Проверка зависимостей

**Backend (requirements.txt):** Для КАЖДОЙ зависимости проверь:

- Текущая версия в проекте
- Последняя доступная версия на PyPI (на 1 марта 2026)
- Breaking changes между версиями
- Есть ли security advisories
- Нужно ли обновление и какой приоритет

Ключевые пакеты для проверки:

```
fastapi==0.128.0          — проверить 0.129+
uvicorn==0.40.0           — проверить 0.41+
sqlalchemy==2.0.46        — проверить 2.1.x?
alembic==1.18.3           — проверить 1.19+
celery==5.6.2             — проверить 5.7+
google-genai==1.61.0      — проверить 1.62+
pydantic==2.12.5          — проверить 2.13+
pydantic-settings==2.12.0 — проверить 2.13+
redis==7.1.0              — проверить 7.2+
httpx==0.28.1             — проверить 0.29+
sentry-sdk==2.51.0        — проверить 2.52+
cryptography==46.0.5      — проверить 47+
gunicorn==25.0.1          — проверить 25.1+
lxml==6.0.2               — проверить 6.1+
beautifulsoup4==4.14.3    — проверить 4.15+
pytest==9.0.2             — проверить 9.1+
black==26.1.0             — проверить 26.2+
ruff==0.15.0              — проверить 0.16+
```

**Frontend (package.json):** Для КАЖДОЙ зависимости проверь:

- Текущая версия (semver range)
- Последняя доступная версия на npm
- Breaking changes
- Нужно ли обновление

Ключевые пакеты:

```
react: ^19.0.0            — проверить 19.1+
vite: ^7.3.1              — проверить 7.4+
typescript: ^5.7.2        — проверить 5.8+
@tanstack/react-query: ^5.90.12 — проверить 5.91+
tailwindcss: ^4.1.18      — проверить 4.2+
zod: ^4.3.6               — проверить 4.4+
zustand: ^5.0.10          — проверить 5.1+
vitest: ^4.0.18           — проверить 4.1+
react-router-dom: ^7.1.0  — проверить 7.2+
i18next: ^25.8.0          — проверить 25.9+
```

**Docker images:**

```
postgres:17-alpine        — проверить 17.x patch updates
redis:7.4-alpine          — проверить 7.4.x patches, 8.0?
nginx:1.27-alpine         — проверить 1.28+
node (в Dockerfile)       — проверить версию
python (в Dockerfile)     — проверить 3.12/3.13 readiness
```

---

## Формат выходного отчёта

Создай файл `docs/reports/2026-03-01-infrastructure-audit-v5-verified.md` со следующей структурой:

```markdown
# Верификационный аудит инфраструктуры v5

**Дата:** 2026-03-01
**Методология:** Тройная верификация (веб + кодовая база + зависимости)

## Executive Summary

[Краткие выводы: что подтвердилось, что опровергнуто, что дополнено, критические находки]

## 1. OpenRouter Migration — Верификация

### 1.1 Веб-верификация

[Что подтвердилось, что изменилось с момента исследования, новые данные]

### 1.2 Верификация по коду

[Конкретные ссылки на файлы и строки, подтверждения/опровержения]

### 1.3 Дополнения и корректировки

[Что упущено, что нужно изменить в рекомендациях]

### 1.4 Вердикт

✅ Подтверждено / ⚠️ Требует корректировки / ❌ Опровергнуто
[Конкретные действия]

## 2-9. [Аналогичная структура для каждого отчёта]

## 10. Обновление зависимостей

### 10.1 Backend (Python)

| Пакет | Текущая | Последняя | Приоритет | Breaking Changes | Действие |
| ----- | ------- | --------- | --------- | ---------------- | -------- |

### 10.2 Frontend (npm)

| Пакет | Текущая | Последняя | Приоритет | Breaking Changes | Действие |
| ----- | ------- | --------- | --------- | ---------------- | -------- |

### 10.3 Docker Images

| Image | Текущая | Последняя | Приоритет | Действие |
| ----- | ------- | --------- | --------- | -------- |

### 10.4 План обновления зависимостей

[Порядок обновления с учётом взаимозависимостей]

## 11. Сводная таблица верификации

| #   | Отчёт | Вердикт | Критические находки | Действия |
| --- | ----- | ------- | ------------------- | -------- |

## 12. Обновлённый план миграции

[Интегрированный план с учётом всех корректировок и обновления зависимостей]

## 13. Дополнительные находки

[Проблемы и возможности, не покрытые исходными отчётами]

## Источники

[Все использованные ссылки с датами доступа]
```

---

## Инструкции по работе

1. **Сначала** прочитай все 9 отчётов из `docs/research/2026-03-01-audit-v4/`
2. **Затем** прочитай ключевые файлы кодовой базы (перечислены выше)
3. **Параллельно** проводи веб-исследование по каждому пункту
4. **Для зависимостей** — ищи актуальные версии на PyPI/npm/Docker Hub
5. **Не пропускай ни одного пакета** — все зависимости из requirements.txt и package.json должны быть проверены
6. **Будь скептичен** — проверяй каждое утверждение, не принимай на веру
7. **Указывай конкретные файлы и строки** при верификации по коду
8. **Указывай источники** с URL для каждого утверждения из веб-исследования

## Особые указания

- **Язык отчёта:** русский
- **Не сокращай** — лучше длинный и полный отчёт, чем краткий и поверхностный
- **Отмечай расхождения** между отчётами и реальным кодом конкретно (файл:строка)
- **Legacy код** — отдельно отметь весь мёртвый/устаревший код, который нужно удалить
- **Security** — любые security-проблемы помечай как CRITICAL
- **Стоимость** — пересчитай TCO с учётом найденных корректировок
