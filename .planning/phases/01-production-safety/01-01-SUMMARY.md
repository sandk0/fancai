---
phase: 01-production-safety
plan: 01
subsystem: backend-config
tags: [security, config, celery, docker, gunicorn, health-check]
depends_on: []
requires: [SEC-01, SEC-02, SEC-03, DEPLOY-01, DEPLOY-05, DEPLOY-06, DEPLOY-07, DEPLOY-08, UX-01]
provides: [backend-secure-config, gunicorn-setup, health-check-real, celery-fixed-timeouts]
affects: [backend/app/core/config.py, backend/app/core/celery_app.py, backend/app/main.py, docker-compose.lite.yml, docker-compose.lite.prod.yml, docker-compose.staging.yml]
tech-stack:
  added: [gunicorn, uvicorn.workers.UvicornWorker]
  patterns: [fail-fast-validation, graceful-import-guard, real-health-check]
key-files:
  created:
    - backend/gunicorn.conf.py
    - backend/tests/test_config_security.py
  modified:
    - backend/app/core/config.py
    - backend/app/core/celery_app.py
    - backend/app/core/secrets.py
    - backend/app/core/hawk.py
    - backend/app/main.py
    - docker-compose.lite.yml
    - docker-compose.lite.prod.yml
    - docker-compose.staging.yml
    - .env.example
decisions:
  - "DEBUG=False по умолчанию — без .env файла приложение безопасно в продакшене"
  - "extra='ignore' в Settings.Config и fallback '../.env' для совместимости тестов"
  - "HAWK_TOKEN заменяет SENTRY_DSN в рекомендуемых секретах"
  - "Celery concurrency 4 -> 2 по умолчанию (решение пользователя для 32GB сервера)"
metrics:
  duration: "~9 минут"
  completed: "2026-03-01T13:22:00Z"
  tasks: 3
  files: 9
---

# Фаза 1, План 1: Безопасность конфигурации и инфраструктурные исправления

**Одна строка:** Исправлена продакшн-небезопасная конфигурация (DEBUG=True), заглушка health check заменена реальными проверками PostgreSQL/Redis/Celery, бэкенд переведён на Gunicorn, исправлены критические баги Celery (visibility_timeout, memory limits), синхронизирован LANGEXTRACT_MODEL и обновлён PostgreSQL до 17.9-alpine.

## Обзор

Выполнены все задачи плана 01-01 согласно требованиям SEC-01, SEC-02, DEPLOY-01, DEPLOY-05, DEPLOY-06, DEPLOY-07, DEPLOY-08, UX-01.

## Выполненные задачи

### Задача 1: Исправление безопасности конфигурации и тесты (TDD)

**Коммиты:**
- `bc0b073` — test(01-01): RED-фаза, 8 тестов (все падают при старом DEBUG=True)
- `072102d` — fix(01-01): GREEN-фаза, все исправления сделаны
- `aa65ff5` — chore(01-01): обновление .env.example

**Изменения:**
- `backend/app/core/config.py` — `DEBUG: bool = True` → `DEBUG: bool = False`
- Удалены NLP-поля: `SPACY_MODEL`, `NLTK_DATA_PATH`, `MULTI_NLP_MODE`, `CONSENSUS_THRESHOLD`, `SPACY_WEIGHT`, `NATASHA_WEIGHT`, `STANZA_WEIGHT`
- Удалён валидатор `validate_nlp_weights` (мёртвый код)
- Добавлены `extra="ignore"` и `"../.env"` fallback в `Settings.Config`
- `backend/app/core/secrets.py` — `SENTRY_DSN` → `HAWK_TOKEN` в рекомендуемых секретах
- `backend/app/core/hawk.py` — graceful import guard (try/except для `hawk_python_sdk`)
- `.env.example` — удалена NLP-секция, добавлен HAWK_TOKEN, исправлен DEBUG default

**Тесты (SEC-01, SEC-02):** 8/8 PASS

### Задача 2: Gunicorn, health check и исправление docker-compose

**Коммит:** `634a740` — fix(01-01): gunicorn, health check, docker-compose

**Изменения:**
- `backend/gunicorn.conf.py` — создан: UvicornWorker, 2 воркера, timeout=300, max_requests=1000
- `docker-compose.lite.yml` — `uvicorn --reload` → `gunicorn --config gunicorn.conf.py` (DEPLOY-01)
- `backend/app/main.py` — `/health` заглушка заменена реальными проверками:
  - `SELECT 1` к PostgreSQL через AsyncSessionLocal
  - Celery ping через `celery_app.control.inspect(timeout=2).ping()`
  - Rate limit повышен 20/мин → 60/мин (Docker healthcheck каждые 30 сек)
  - Статус: `healthy` / `degraded` / `unhealthy`, HTTP 503 если критические сервисы недоступны
- `backend/app/core/celery_app.py`:
  - `visibility_timeout: 3600` → `14400` (DEPLOY-05: 4ч > max task_time_limit 3ч)
  - `worker_max_memory_per_child: 150000` → `512000` KB (DEPLOY-08: 512MB)
- `LANGEXTRACT_MODEL: gemini-2.0-flash` → `gemini-3-flash-preview` во всех 3 файлах (DEPLOY-06)
- `docker-compose.lite.prod.yml`: PostgreSQL `17-alpine` → `17.9-alpine` (DEPLOY-07)
- Celery `--max-memory-per-child`: `400000` → `512000` в prod, `300000` → `512000` в staging

### Задача 3: Интеграционная проверка

Все 8 тестов безопасности проходят. Тесты, требующие подключения к БД (DB не запущена локально), падают с `socket.gaierror` — это предсуществующее поведение, не связанное с нашими изменениями.

## Проверка критериев успеха

- [x] DEBUG=False по умолчанию в config.py
- [x] Приложение отказывается стартовать при дефолтном SECRET_KEY вне debug-режима (validate_production_settings работает)
- [x] SEC-03 подтверждён как выполненный (PyJWT уже был установлен в предыдущем коммите)
- [x] /health возвращает реальный статус БД, Redis, Celery (не заглушку)
- [x] docker-compose.lite.yml использует gunicorn (без --reload)
- [x] gunicorn.conf.py создан с UvicornWorker, 2 воркера, timeout 300
- [x] Celery visibility_timeout=14400, memory=512000 KB (512MB)
- [x] LANGEXTRACT_MODEL=gemini-3-flash-preview во всех docker-compose
- [x] PostgreSQL 17.9-alpine в prod конфигурации
- [x] Тесты безопасности 8/8 проходят

## Отклонения от плана

### Автоматически исправленные проблемы

**1. [Rule 3 - Блокер] Graceful import для hawk_python_sdk**
- **Обнаружено при:** Задача 1 (запуск тестов)
- **Проблема:** `app/core/hawk.py` выполняет `from hawk_python_sdk import ...` на уровне модуля. SDK не установлен локально (только в requirements.txt). Это блокировало загрузку conftest.py при тестах.
- **Исправление:** Добавлен `try/except ImportError` вокруг импорта SDK, `_hawk_sdk_available` флаг, guard-проверки в `init_hawk()` и `init_hawk_celery()`
- **Файлы:** `backend/app/core/hawk.py`
- **Коммит:** `072102d`

**2. [Rule 2 - Критическая функциональность] Добавлен extra="ignore" в Settings.Config**
- **Обнаружено при:** Задача 1 (запуск тестов с fallback на root .env)
- **Проблема:** Root `.env` содержит переменные `DB_NAME`, `DB_PASSWORD`, `REDIS_PASSWORD` и другие, не объявленные в `Settings`. Без `extra="ignore"` Settings падал с `ValidationError: Extra inputs are not permitted`.
- **Исправление:** Добавлен `extra = "ignore"` в `Settings.Config`, добавлен `"../.env"` как fallback env_file для запуска тестов из `backend/` директории.
- **Файлы:** `backend/app/core/config.py`
- **Коммит:** `072102d`

## Отложенные проблемы (deferred)

- `tests/services/test_gemini_extractor.py` — импортирует несуществующий `JSONResponseParser` (pre-existing, не связано с нашими изменениями)
- `tests/services/test_langextract_processor.py` — модуль `langextract_processor` не существует (pre-existing)
- `tests/test_book_parser.py` — тесты не используют `await` для async методов (pre-existing)
- Coverage 32% < 70% порога (pre-existing, связано с большим количеством не покрытого кода в роутерах)

## Коммиты

| Хэш | Тип | Описание |
|-----|-----|----------|
| `bc0b073` | test | RED-фаза TDD: failing tests для SEC-01, SEC-02 |
| `072102d` | fix | GREEN-фаза: DEBUG=False, NLP удалён, hawk graceful import |
| `aa65ff5` | chore | .env.example: NLP → HAWK_TOKEN, DEBUG default |
| `634a740` | fix | Gunicorn, health check, docker-compose fixes |

## Self-Check: PASSED

- backend/gunicorn.conf.py: FOUND
- backend/tests/test_config_security.py: FOUND
- .planning/phases/01-production-safety/01-01-SUMMARY.md: FOUND
- commit bc0b073: FOUND
- commit 072102d: FOUND
- commit aa65ff5: FOUND
- commit 634a740: FOUND
- visibility_timeout=14400 in celery_app.py: VERIFIED
- UvicornWorker in gunicorn.conf.py: VERIFIED
- "checking..." stub removed from main.py: VERIFIED (0 occurrences)
- gemini-3-flash-preview in all 3 compose files: VERIFIED
- postgres:17.9-alpine in prod compose: VERIFIED
- 8/8 security tests pass: VERIFIED
