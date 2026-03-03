# Верификационный аудит инфраструктурных исследований v5

**Дата:** 2026-03-01
**Scope:** 9 исследовательских отчётов в `docs/research/2026-03-01-audit-v4/`
**Методология:** Тройная верификация (веб-исследование + код + зависимости)
**Автор:** Claude Code

---

## Executive Summary

Проведён глубокий верификационный аудит 9 исследовательских отчётов (audit v4) по трём осям: актуальность данных из веб-источников (март 2026), точность ссылок на кодовую базу и состояние зависимостей.

**Главные находки:**

1. **3 критических бага подтверждены кодом**: visibility_timeout < time_limit (celery_app.py:42 vs book_tasks.py:61), мёртвый код celery_config.py, inconsistent memory limits (3 файла — 3 значения)
2. **2 фактических ошибки в отчётах**: tmpfs для pg_stat_tmp не нужен в PG17 (удалён в PG15), nginx конфиг — 748 строк, не ~500
3. **Imagen 4 отсутствует на OpenRouter** — критический блокер для Phase 3 миграции
4. **Gemini 3 Flash — preview, не GA** — учесть риски стабильности API
5. **LANGEXTRACT_MODEL расхождение**: docker-compose → `gemini-2.0-flash`, config.py → `gemini-3-flash-preview`
6. **Legacy NLP код** в config.py (строки 79-90) и celery_config.py — подтверждено, нужна очистка
7. **Зависимости**: react 19.0→19.2.4, typescript 5.7→5.9.3, nginx 1.27→1.28, Uptime Kuma :1→:2 — значимые обновления доступны

**Вердикт:** Отчёты в целом точны и полезны. Выявлены 2 фактические ошибки и 4 дополнительные находки, не покрытые исходными отчётами.

---

## Секция 1: OpenRouter Migration (Отчёт 01)

### 1.1 Веб-верификация

| Утверждение                           | Статус           | Детали                                                                             |
| ------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| OpenRouter поддерживает `json_schema` | **ПОДТВЕРЖДЕНО** | `response_format: { type: "json_schema" }` — стандартный OpenAI-совместимый формат |
| BYOK (Bring Your Own Key) 5% наценка  | **ПОДТВЕРЖДЕНО** | Первые 1M запросов/мес бесплатно, далее 5%                                         |
| Prompt caching 75% экономия           | **ПОДТВЕРЖДЕНО** | Gemini 2.5+ implicit caching: cached tokens стоят 25% от обычных                   |
| Gemini 3 Flash доступен на OpenRouter | **ПОДТВЕРЖДЕНО** | `google/gemini-3-flash-preview` — доступен как PREVIEW модель                      |

### 1.2 Верификация по коду

**5 сервисов используют google-genai SDK** — подтверждено:

| Сервис              | Файл                                               | Structured Output                                              | Сложность миграции                 |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| gemini_extractor    | `services/gemini_extractor.py`                     | `response_schema=GeminiResponseSchema` (Pydantic)              | **HIGH** — Pydantic schema         |
| entity_dedup        | `services/entity_deduplication_service.py:194-198` | `response_schema=DeduplicationResponse` + `response_mime_type` | **HIGH** — вложенные Optional поля |
| entity_synthesis    | `services/entity_synthesis_service.py:162`         | Только `response_mime_type="application/json"`                 | MEDIUM — ручной JSON парсинг       |
| consistency_manager | `services/consistency_manager.py:658`              | Только `response_mime_type="application/json"`                 | MEDIUM — ручной JSON парсинг       |
| imagen_generator    | `services/imagen_generator.py:671`                 | `client.models.generate_images()`                              | **HIGH** — другой API (не chat)    |

**Ключевое наблюдение:** Отчёт правильно оценивает сложность. Сервисы с `response_schema` (extractor, dedup) требуют конвертации Pydantic → JSON Schema с учётом `$defs` inlining и nullable.

### 1.3 Коррекции

- **Gemini 3 Flash — PREVIEW, не GA.** Отчёт не акцентирует этот риск. Preview модели могут измениться без предупреждения.
- **BYOK бесплатный порог**: первые 1M requests/month — уточнение, не упомянутое в отчёте.

### 1.4 Вердикт: ✅ ТОЧЕН (с уточнениями)

---

## Секция 2: LLM Models (Отчёт 02)

### 2.1 Веб-верификация

| Утверждение                                       | Статус                | Детали                                      |
| ------------------------------------------------- | --------------------- | ------------------------------------------- |
| Gemini 3 Flash: $0.10/1M input, $0.40/1M output   | **ТРЕБУЕТ УТОЧНЕНИЯ** | Цены preview модели могут измениться при GA |
| Gemini 2.5 Flash Lite: $0.02/1M input             | **ПОДТВЕРЖДЕНО**      | Бюджетная модель для free tier              |
| Claude Haiku 4.5: $0.80/1M input, $4.00/1M output | **ПОДТВЕРЖДЕНО**      | Актуальные цены через OpenRouter            |
| Fallback chain: 3 Flash → Haiku → 2.5 Flash Lite  | **ЛОГИЧНО**           | Цена ↓, качество ↓ — корректная стратегия   |

### 2.2 Верификация по коду

- `config.py:60` — `GEMINI_MODEL="gemini-3-flash-preview"` — подтверждает текущую модель
- `docker-compose.lite.prod.yml:125` — `LANGEXTRACT_MODEL` default `gemini-2.0-flash` — **РАСХОЖДЕНИЕ** с кодом
- `docker-compose.staging.yml:118` — то же расхождение

### 2.3 Коррекции

- **Расхождение LANGEXTRACT_MODEL**: docker-compose файлы дефолтят на `gemini-2.0-flash`, но config.py использует `gemini-3-flash-preview`. Нужна синхронизация.
- **Implicit caching**: Gemini 2.5+ автоматически кэширует повторяющиеся промпты (75% экономия). Для Gemini 3 Flash это тоже должно работать — отчёт правильно рекомендует.

### 2.4 Вердикт: ✅ ТОЧЕН (найдено расхождение env vars)

---

## Секция 3: Image Models (Отчёт 03)

### 3.1 Веб-верификация

| Утверждение                         | Статус               | Детали                                                                                        |
| ----------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| Imagen 4 доступен на OpenRouter     | **❌ НЕВЕРНО**       | Imagen 4 **НЕ доступен** на OpenRouter (март 2026). Только через Google AI Studio / Vertex AI |
| FLUX.2 Pro: $0.03/img на OpenRouter | **ПОДТВЕРЖДЕНО**     | black-forest-labs/flux-2-pro                                                                  |
| FLUX.2 Klein: $0.014/img            | **ПОДТВЕРЖДЕНО**     | Бюджетная альтернатива                                                                        |
| FLUX.2 Nano Banana: $0.005/img      | **ТРЕБУЕТ ПРОВЕРКИ** | Banana.dev pricing может меняться                                                             |

### 3.2 Верификация по коду

- `services/imagen_generator.py:671` — `client.models.generate_images()` вызов через google-genai SDK
- `config.py:63` — `IMAGEN_MODEL="imagen-4.0-generate-001"`
- `config.py:66` — `IMAGEN_SAFETY_LEVEL="block_low_and_above"`
- Imagen использует `GenerateImagesConfig` с `person_generation`, `safety_filter_level`
- Seed support закомментирован в коде

### 3.3 Коррекции

- **КРИТИЧНО: Imagen 4 не на OpenRouter.** Phase 3 миграции (images) невозможна с Imagen 4 через OpenRouter. Альтернативы: FLUX.2 Pro/Klein или оставить прямой Google API для изображений.
- **Safety filter**: При миграции на FLUX.2 нужен отдельный safety-фильтр (NSFW detection) — Imagen 4 имеет встроенный.

### 3.4 Вердикт: ⚠️ ЧАСТИЧНО НЕВЕРЕН (Imagen 4 недоступен на OpenRouter)

---

## Секция 4: Monitoring (Отчёт 04)

### 4.1 Веб-верификация

| Утверждение               | Статус           | Детали                    |
| ------------------------- | ---------------- | ------------------------- |
| Netdata ~80-100MB RAM     | **ПОДТВЕРЖДЕНО** | v2.8.5 актуальная версия  |
| Uptime Kuma ~50-80MB RAM  | **ПОДТВЕРЖДЕНО** | Но :1 → :2 major version! |
| Dozzle ~30-50MB RAM       | **ПОДТВЕРЖДЕНО** | v9.0 актуальная версия    |
| Стек: ~310MB RAM суммарно | **ПОДТВЕРЖДЕНО** | Корректная оценка         |

### 4.2 Коррекции

- **Uptime Kuma :1 → :2**: Отчёт рекомендует `:1` тег, но Uptime Kuma 2.0 уже доступен. Major version — может иметь breaking changes в конфиге. Рекомендация: использовать `:2` сразу.
- **Dozzle v9.0**: Существенно обновлённый интерфейс, поддержка Docker Swarm. Отчёт не уточняет версию.
- **Netdata v2.8.5**: Текущая. Отчёт корректен.

### 4.3 Вердикт: ✅ ТОЧЕН (рекомендуется обновить версии тегов)

---

## Секция 5: PostgreSQL (Отчёт 05)

### 5.1 Веб-верификация

| Утверждение                        | Статус           | Детали                                                          |
| ---------------------------------- | ---------------- | --------------------------------------------------------------- |
| shared_buffers = 8GB (25% от 32GB) | **ПОДТВЕРЖДЕНО** | PGTune стандартная формула                                      |
| effective_cache_size = 24GB        | **ПОДТВЕРЖДЕНО** | 75% от RAM                                                      |
| work_mem = 26MB                    | **ПОДТВЕРЖДЕНО** | (32-8)GB / (80×3) / 4 ≈ 26MB                                    |
| random_page_cost = 1.1 для NVMe    | **ПОДТВЕРЖДЕНО** | Стандарт для SSD                                                |
| tmpfs для pg_stat_tmp              | **❌ НЕВЕРНО**   | `stats_temp_directory` **удалён в PG15**. В PG17 не нужен tmpfs |
| pgbackup контейнер                 | **ПОДТВЕРЖДЕНО** | prodrigestivill/postgres-backup-local — рабочее решение         |

### 5.2 Верификация по коду

- `config.py:31-32` — `DB_POOL_SIZE=20`, `DB_MAX_OVERFLOW=40` → pool может занять до 60 соединений
- `docker-compose.lite.prod.yml:261` — `shared_buffers=512MB`, `max_connections=100`
- Текущие 512MB shared_buffers — сильно занижено для 32GB RAM (должно быть 8GB)

### 5.3 Коррекции

- **ОШИБКА: tmpfs для pg_stat_tmp не нужен в PG17.** Параметр `stats_temp_directory` удалён в PostgreSQL 15. Статистика теперь в shared memory. Отчёт рекомендует ненужную конфигурацию.
- **shm_size**: Для shared_buffers=8GB Docker контейнеру нужен `shm_size: '10g'` (8GB + overhead). Отчёт не упоминает это.
- **huge_pages = try**: Рекомендуется для shared_buffers ≥ 8GB. Отчёт не упоминает.
- **max_connections**: pool_size(20) + overflow(40) + Celery workers(6×?) + monitoring(5) = потенциально >80. Рекомендация: 100 с `superuser_reserved_connections=5`.
- **wal_compression = zstd**: PG17 feature, снижает WAL на 50-70%. Отчёт не упоминает.
- **PG 17.9-alpine**: Последняя версия (2026-02-26), патчит CVE-2025-8715 (CRITICAL), CVE-2025-1094 (HIGH).

### 5.4 Вердикт: ⚠️ ЧАСТИЧНО НЕВЕРЕН (tmpfs ошибка, пропущены shm_size/huge_pages/wal_compression)

---

## Секция 6: Caddy + Static (Отчёт 06)

### 6.1 Веб-верификация

| Утверждение                          | Статус           | Детали                                         |
| ------------------------------------ | ---------------- | ---------------------------------------------- |
| Caddy HTTP/3 из коробки              | **ПОДТВЕРЖДЕНО** | v2.11.1 актуальная                             |
| Auto HTTPS (Let's Encrypt + ZeroSSL) | **ПОДТВЕРЖДЕНО** | Встроено                                       |
| ~80 строк конфига vs ~500 nginx      | **ЧАСТИЧНО**     | Caddy ~80 верно, nginx **748** строк (не ~500) |
| caddy-ratelimit плагин               | **ПОДТВЕРЖДЕНО** | github.com/mholt/caddy-ratelimit               |

### 6.2 Верификация по коду

| Файл nginx                                              | Строк   |
| ------------------------------------------------------- | ------- |
| `nginx/nginx.prod.conf.template`                        | 245     |
| `nginx/nginx.prod.conf`                                 | 283     |
| `frontend/nginx.prod.conf` (внутри frontend Dockerfile) | 220     |
| **Итого**                                               | **748** |

- `frontend/Dockerfile.prod` — использует `nginx:1.27-alpine` для статики → будет заменён Caddy

### 6.3 Коррекции

- **nginx конфиг: 748 строк, не ~500.** Отчёт занижает — реальная экономия при переходе на Caddy ещё больше.
- **Caddy v3 не существует**: Caddy 2.11.1 — текущая stable. Не ожидать v3 в ближайшее время.
- **slowapi для rate limiting**: Рекомендация отчёта корректна — FastAPI slowapi лучше, чем Caddy-level, т.к. позволяет rate limit по user ID.

### 6.4 Вердикт: ✅ ТОЧЕН (nginx строки занижены, но направление верное)

---

## Секция 7: Docker UI (Отчёт 07)

### 7.1 Веб-верификация

| Утверждение                     | Статус           | Детали                |
| ------------------------------- | ---------------- | --------------------- |
| Dockge — compose файлы на диске | **ПОДТВЕРЖДЕНО** | git-trackable         |
| Louis Lam — автор Uptime Kuma   | **ПОДТВЕРЖДЕНО** | 83K+ GitHub stars     |
| Dockge ~15-25MB RAM             | **ПОДТВЕРЖДЕНО** | Минимальный footprint |

### 7.2 Коррекции

- **Dockge v1.5.0 — stale проект.** Последний релиз >12 месяцев назад. GitHub показывает минимальную активность. Риск: abandoned проект.
- **Альтернатива**: Lazydocker (terminal UI) + docker compose CLI — могут быть надёжнее для long-term.

### 7.3 Вердикт: ⚠️ ТОЧЕН, НО РИСК (Dockge может быть abandoned)

---

## Секция 8: Celery Memory & Bugs (Отчёт 08)

### 8.1 Верификация по коду

**БАГ 1: visibility_timeout < process_book timeout — ПОДТВЕРЖДЁН ✅**

```
celery_app.py:42 → visibility_timeout: 3600 (1 час)
book_tasks.py:61 → time_limit: 10800 (3 часа)
```

Если обработка книги длится >1 часа, Redis redelivers задачу → **дублирование обработки**. Фикс: `visibility_timeout: 14400` (4 часа).

**БАГ 2: celery_config.py — мёртвый код — ПОДТВЕРЖДЁН ✅**

Grep по всей кодовой базе: **0 Python-импортов** `celery_config`. Файл содержит:

- `ResourceAwareCelery` — не используется
- `NLP_CACHE_CONFIG` с 1GB model cache — NLP удалён в Dec 2025
- `worker_max_memory_per_child=5000000` (5GB) — нигде не применяется

**БАГ 3: Inconsistent memory limits — ПОДТВЕРЖДЁН ✅**

| Файл                                     | max-memory-per-child | concurrency |
| ---------------------------------------- | -------------------- | ----------- |
| `celery_app.py:29-31` (код)              | 150MB (default)      | не задано   |
| `docker-compose.lite.prod.yml:172` (CLI) | 400MB                | 4           |
| `docker-compose.staging.yml:169` (CLI)   | 300MB                | 1           |

CLI `--max-memory-per-child` переопределяет код. Три файла — три разных значения.

### 8.2 Коррекции

- Все 3 бага подтверждены **дословно** — отчёт точен.
- **Дополнение**: `celery_app.py:35-36` задаёт `task_soft_time_limit=1500` (25 мин) и `task_time_limit=1800` (30 мин) как **глобальные** дефолты. Но `book_tasks.py:61-62` переопределяет их на 10800/10500. Это корректно — task-level override работает.

### 8.3 Вердикт: ✅ ПОЛНОСТЬЮ ПОДТВЕРЖДЁН

---

## Секция 9: TCO & Migration Plan (Отчёт 09)

### 9.1 Веб-верификация

| Утверждение                     | Статус                    | Детали                             |
| ------------------------------- | ------------------------- | ---------------------------------- |
| Gemini 3 Flash OR +5.5% наценка | **ПОДТВЕРЖДЕНО**          | 5% BYOK + маржа                    |
| FLUX.2 Pro $0.03/img            | **ПОДТВЕРЖДЕНО**          | OpenRouter актуальная цена         |
| TCO текущий ~$121/мес AI        | **ПРАВДОПОДОБНО**         | Расчёт на 37.5 книг/мес × 50 users |
| VPS $35/мес                     | **ЗАВИСИТ ОТ ПРОВАЙДЕРА** | Для 12 vCPU / 32GB — реалистично   |

### 9.2 Верификация по коду

- `config.py:60` — `GEMINI_MODEL="gemini-3-flash-preview"` ✅
- `config.py:63` — `IMAGEN_MODEL="imagen-4.0-generate-001"` ✅
- **LANGEXTRACT_MODEL discrepancy**: docker-compose дефолтит на `gemini-2.0-flash`, но код использует `gemini-3-flash-preview`

### 9.3 Коррекции

- **Phase 3 (Images) ЗАБЛОКИРОВАНА**: Imagen 4 не на OpenRouter → нужен альтернативный план (FLUX.2 Pro/Klein или гибридный подход: LLM через OpenRouter, images через Google API напрямую).
- **Phase 0 фиксы все подтверждены**: visibility_timeout, celery_config.py cleanup, legacy NLP cleanup.
- **Legacy NLP в config.py**: строки 79-90 содержат SPACY_MODEL, NLTK_DATA_PATH, MULTI_NLP_MODE, CONSENSUS_THRESHOLD, SPACY_WEIGHT, NATASHA_WEIGHT, STANZA_WEIGHT + валидатор validate_nlp_weights (строки ~193-214). NLP удалён в Dec 2025 — этот код мёртвый.

### 9.4 Вердикт: ⚠️ ЧАСТИЧНО НЕВЕРЕН (Phase 3 заблокирована из-за Imagen 4)

---

## Секция 10: Обновления зависимостей

### 10.1 Python (requirements.txt)

| Пакет             | Текущая | Последняя  | Приоритет | Примечание                   |
| ----------------- | ------- | ---------- | --------- | ---------------------------- |
| fastapi           | 0.128.0 | 0.128.0    | —         | Актуально                    |
| uvicorn           | 0.40.0  | 0.40.0     | —         | Актуально                    |
| gunicorn          | 25.0.1  | 25.0.1     | —         | Актуально                    |
| sqlalchemy        | 2.0.46  | 2.0.46     | —         | Актуально                    |
| alembic           | 1.18.3  | 1.18.3     | —         | Актуально                    |
| celery            | 5.6.2   | 5.6.2      | —         | Актуально. **5.7 НЕ вышел**  |
| google-genai      | 1.61.0  | ~1.62-1.63 | LOW       | Минорные обновления          |
| pydantic          | 2.12.5  | 2.12.5     | —         | Актуально                    |
| pydantic-settings | 2.12.0  | 2.12.0     | —         | Актуально                    |
| cryptography      | 46.0.5  | 46.0.5     | —         | Актуально                    |
| sentry-sdk        | 2.51.0  | ~2.52+     | LOW       | Минорное                     |
| redis             | 7.1.0   | 7.1.0      | —         | Актуально                    |
| pillow            | 12.1.1  | 12.1.1     | —         | Актуально                    |
| tenacity          | 9.1.2   | 9.1.2      | —         | Актуально                    |
| bcrypt            | 5.0.0   | 5.0.0      | —         | Актуально (недавно обновлён) |
| pytest            | 9.0.2   | 9.0.2      | —         | Актуально                    |
| black             | 26.1.0  | 26.1.0     | —         | Актуально                    |
| ruff              | 0.15.0  | 0.15.0     | —         | Актуально                    |
| networkx          | 3.6.1   | 3.6.1      | —         | Актуально                    |

**Вывод:** Python зависимости хорошо обновлены. Критических обновлений нет.

### 10.2 npm (package.json)

| Пакет                 | Текущая (semver) | Resolved | Последняя  | Приоритет | Примечание                              |
| --------------------- | ---------------- | -------- | ---------- | --------- | --------------------------------------- |
| react                 | ^19.0.0          | 19.0.0   | **19.2.4** | **HIGH**  | Suspense/transitions fixes, performance |
| react-dom             | ^19.0.0          | 19.0.0   | **19.2.4** | **HIGH**  | Должен совпадать с react                |
| typescript            | ^5.7.2           | 5.7.2    | **5.9.3**  | **HIGH**  | Новый `satisfies`, import attributes    |
| tailwindcss           | ^4.1.18          | 4.1.18   | **4.2.1**  | MEDIUM    | Новые утилиты                           |
| react-router-dom      | ^7.1.0           | 7.1.0    | **7.13.1** | MEDIUM    | Bug fixes, typegen improvements         |
| @playwright/test      | ^1.49.1          | 1.49.1   | **1.58.2** | MEDIUM    | Новые features, browser updates         |
| @tanstack/react-query | ^5.90.12         | 5.90.12  | ~5.92+     | LOW       | Минорное                                |
| vite                  | ^7.3.1           | 7.3.1    | 7.3.1      | —         | Актуально                               |
| vitest                | ^4.0.18          | 4.0.18   | 4.0.18     | —         | Актуально                               |
| zod                   | ^4.3.6           | 4.3.6    | 4.3.6      | —         | Актуально                               |
| motion                | ^12.31.0         | 12.31.0  | 12.31.0    | —         | Актуально                               |
| zustand               | ^5.0.10          | 5.0.10   | 5.0.10     | —         | Актуально                               |
| i18next               | ^25.8.0          | 25.8.0   | 25.8.0     | —         | Актуально                               |
| lucide-react          | ^0.563.0         | 0.563.0  | ~0.570+    | LOW       | Иконки                                  |
| epubjs                | ^0.3.93          | 0.3.93   | 0.3.93     | —         | Не обновляется (abandoned)              |

**Рекомендуемые действия:**

1. `npm update react react-dom` → 19.2.4 (semver ^19.0.0 подхватит)
2. `npm update typescript` → 5.9.3 (semver ^5.7.2 подхватит)
3. `npm update react-router-dom` → 7.13.1
4. `npm update @playwright/test && npx playwright install` → 1.58.2
5. `npm update tailwindcss @tailwindcss/vite` → 4.2.1

### 10.3 Docker Images

| Образ    | Текущий     | Последний                 | Приоритет | Примечание                                                           |
| -------- | ----------- | ------------------------- | --------- | -------------------------------------------------------------------- |
| python   | 3.12-slim   | **3.13-slim** / 3.14-slim | MEDIUM    | 3.13 stable (free-threading opt-in), 3.14 RC                         |
| nginx    | 1.27-alpine | **1.28-alpine**           | **HIGH**  | 1.28 stable (Dec 2025). Security fixes                               |
| postgres | 17-alpine   | **17.9-alpine**           | **HIGH**  | CVE-2025-8715 (CRITICAL), CVE-2025-1094 (HIGH)                       |
| redis    | 7-alpine    | 7.4-alpine / **8.0**      | MEDIUM    | Redis 8.0: новое лицензирование (AGPL/RSAL). Проверить совместимость |
| node     | 22-alpine   | 22-alpine                 | —         | Актуально (LTS)                                                      |

**Критические обновления:**

- **postgres:17.9-alpine** — патчит CVE-2025-8715 (CRITICAL: pg_dump arbitrary code execution)
- **nginx:1.28-alpine** — security fixes. Или мигрировать на Caddy (рекомендация отчёта 06)

---

## Секция 11: Сводная таблица верификации

| #   | Отчёт                | Вердикт                  | Критические коррекции                                                |
| --- | -------------------- | ------------------------ | -------------------------------------------------------------------- |
| 01  | OpenRouter Migration | ✅ Точен                 | Gemini 3 Flash — preview, не GA                                      |
| 02  | LLM Models           | ✅ Точен                 | LANGEXTRACT_MODEL расхождение в docker-compose                       |
| 03  | Image Models         | ⚠️ Частично неверен      | **Imagen 4 НЕ на OpenRouter** — блокер Phase 3                       |
| 04  | Monitoring           | ✅ Точен                 | Uptime Kuma :1 → :2, обновить теги                                   |
| 05  | PostgreSQL           | ⚠️ Частично неверен      | **tmpfs pg_stat_tmp не нужен в PG17**, пропущены shm_size/huge_pages |
| 06  | Caddy + Static       | ✅ Точен                 | nginx 748 строк (не ~500) — экономия больше                          |
| 07  | Docker UI            | ✅ Точен (с риском)      | Dockge stale (>12 мес без релизов)                                   |
| 08  | Celery Memory & Bugs | ✅ Полностью подтверждён | Все 3 бага верифицированы по коду                                    |
| 09  | TCO & Migration      | ⚠️ Частично неверен      | Phase 3 заблокирована (Imagen 4 не на OR)                            |

**Итого:** 5/9 полностью точных, 1/9 с рисками, 3/9 с фактическими ошибками.

---

## Секция 12: Обновлённый план миграции

### Phase 0: Аварийные фиксы (НЕМЕДЛЕННО) — без изменений ✅

1. **ФИКС БАГ:** `visibility_timeout: 3600 → 14400` в `celery_app.py:42`
2. Удалить `celery_config.py` (мёртвый NLP код)
3. Удалить legacy NLP настройки из `config.py` (строки 79-90, ~193-214)
4. Обновить `postgres:17-alpine` → `postgres:17.9-alpine` (CVE fix)
5. Синхронизировать LANGEXTRACT_MODEL в docker-compose файлах
6. Добавить бэкап PostgreSQL

### Phase 1: Подготовка нового сервера (1-2 дня) — уточнения

1. Docker Compose с обновлёнными лимитами RAM/CPU
2. **PostgreSQL 17.9** (не просто 17): `shared_buffers=8GB`, `shm_size=10g`, `huge_pages=try`, `wal_compression=zstd`
3. **Убрать tmpfs для pg_stat_tmp** (ошибка отчёта 05)
4. Redis 7.4-alpine (не 8.0 — AGPL-лицензия требует оценки)
5. Caddy вместо 2× nginx (~80 vs 748 строк конфига)
6. Netdata v2.8.5 + **Uptime Kuma :2** (не :1) + Dozzle v9.0
7. ~~Dockge~~ → Оценить Lazydocker (Dockge stale). Или установить с учётом рисков
8. pg_dump автобэкап + offsite (B2/R2)

### Phase 2: Миграция на OpenRouter — LLM (10-14 дней) — без изменений ✅

Порядок миграции по возрастанию сложности:

1. `entity_synthesis` (только response_mime_type)
2. `consistency_manager` (только response_mime_type)
3. `entity_dedup` (response_schema с вложенными типами)
4. `gemini_extractor` (response_schema с Pydantic моделями)

### Phase 3: Images — **ПЕРЕСМОТРЕНА**

**Исходный план**: Миграция Imagen 4 на OpenRouter → **НЕВОЗМОЖЕН** (Imagen 4 не на OpenRouter).

**Обновлённые варианты:**

| Вариант                                   | Плюсы                   | Минусы                                    |
| ----------------------------------------- | ----------------------- | ----------------------------------------- |
| A: Оставить Imagen 4 через Google API     | Качество, safety filter | Vendor lock, отдельный key                |
| B: Мигрировать на FLUX.2 Pro (OpenRouter) | Единый API, $0.03/img   | Нужен отдельный NSFW filter, другой стиль |
| C: Гибрид (LLM→OR, Images→Google)         | Лучшее из обоих         | Два API, два ключа                        |

**Рекомендация: Вариант C** — миграция LLM на OpenRouter, изображения остаются на Google API. Это даёт fallback chain для LLM и сохраняет качество Imagen 4.

### Phase 4: Оптимизации — уточнения

1. Image dedup (hash-based, Redis Set) — без изменений
2. Мониторинг расходов через OpenRouter Analytics API — без изменений
3. Prompt caching: implicit caching работает автоматически на Gemini 2.5+ через OpenRouter BYOK
4. Rate limiting: FastAPI slowapi (по user ID, не только по IP) — без изменений

---

## Секция 13: Дополнительные находки

### 13.1 Legacy NLP код в config.py

**Файл:** `backend/app/core/config.py`
**Строки:** 79-90 (настройки), ~193-214 (валидатор)

```
SPACY_MODEL, NLTK_DATA_PATH, MULTI_NLP_MODE, CONSENSUS_THRESHOLD,
SPACY_WEIGHT, NATASHA_WEIGHT, STANZA_WEIGHT, validate_nlp_weights
```

NLP система удалена в Dec 2025. Этот код мёртвый и должен быть удалён.

### 13.2 LANGEXTRACT_MODEL env discrepancy

**Файлы:** `docker-compose.lite.prod.yml:125`, `docker-compose.staging.yml:118`

Обе compose файлы дефолтят `LANGEXTRACT_MODEL` на `gemini-2.0-flash`, но `config.py:60` использует `gemini-3-flash-preview`. Если env var не переопределён при деплое, будет использоваться config.py дефолт. Нужна синхронизация.

### 13.3 Docker image pinning

Текущие Dockerfile используют плавающие теги:

- `python:3.12-slim` (не pinned к patch)
- `nginx:1.27-alpine` (не pinned к patch)
- `node:22-alpine` (не pinned к patch)

Рекомендация: pin к конкретным patch-версиям для reproducible builds:

- `python:3.12.10-slim`
- `nginx:1.28.0-alpine`
- `node:22.15.0-alpine`

### 13.4 PostgreSQL CVE awareness

| CVE            | Severity     | Патчится в |
| -------------- | ------------ | ---------- |
| CVE-2025-8715  | **CRITICAL** | 17.7+      |
| CVE-2025-1094  | HIGH         | 17.3+      |
| CVE-2025-12818 | HIGH         | 17.9+      |
| CVE-2025-12817 | MEDIUM       | 17.9+      |

**Действие:** Обновить до `postgres:17.9-alpine` немедленно.

### 13.5 Redis 8.0 лицензирование

Redis 8.0 перешёл на AGPL/RSAL (Redis Source Available License). Для коммерческого использования:

- AGPL требует open-source всего кода, использующего Redis
- RSAL запрещает конкурентные Redis-as-a-Service

**Для fancai:** AGPL не проблема если проект не open-source SaaS. Но рекомендуется оставаться на Redis 7.4-alpine до юридической оценки.

### 13.6 Celery 5.7 — не вышел

Отчёт 08 упоминает `worker_cancel_long_running_tasks_on_connection_loss=True` как "настройку Celery 5.6". Верификация: Celery 5.7 **НЕ выпущен** (март 2026). Текущая stable — 5.6.2. Этот параметр доступен в 5.6.x как подготовка к 6.0.

---

## Секция 14: Принятые решения (2026-03-01)

По итогам обсуждения аудит-отчёта приняты следующие решения:

### 14.1 Серверная инфраструктура

- **Сервер**: уже мигрирован на 32GB RAM / 12 vCPU / NVMe SSD
- **PostgreSQL**: уже на версии 17 (не 15, как указано в PROJECT.md). Обновить image до 17.9-alpine для закрытия CVE
- **Redis**: оставаться на 7.4-alpine (Redis 8.0 AGPL/RSAL — юридическая оценка не проведена)

### 14.2 AI-стратегия

- ~~**Гибридный подход**: LLM-сервисы мигрируют на OpenRouter, Images остаются на Google API~~ **ПЕРЕСМОТРЕНО в Секции 15**
- ~~**Imagen 4** не доступен на OpenRouter — остаётся на прямом Google API (отдельный ключ)~~ **ПЕРЕСМОТРЕНО: полная миграция на FLUX.2**
- **Fallback chain**: Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite (через OpenRouter)
- **Gemini 3 Flash preview** — принят риск, mitigation через fallback chain

### 14.3 Инфраструктурная миграция

- **Caddy вместо nginx** — подтверждено (748 → ~80 строк)
- **Мониторинг**: Netdata v2.8.5 + Uptime Kuma :2 + Dozzle v9.0
- **Dockge**: отложен (stale проект), рассмотреть Lazydocker или CLI
- **Зависимости**: React 19.2.4, TypeScript 5.9.3, Docker image pinning

### 14.4 Интеграция в roadmap

- Инфраструктурные работы интегрированы в текущий roadmap (не отдельный milestone)
- 2 новые фазы добавлены после Phase 2 (очистка): Phase 3 (миграция сервисов), Phase 4 (обслуживание инфры)
- Все баги Celery + CVE PostgreSQL добавлены в Phase 1 (DEPLOY-05..08)
- Итого: 8 фаз, 45 требований

### 14.5 Коррекции к отчёту

| #   | Коррекция                                                                 | Статус                                                                   |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | passlib уже удалён из requirements.txt (bcrypt 5.0.0 установлен напрямую) | Учтено                                                                   |
| 2   | Сервер уже 32GB/12vCPU (не 8GB/4CPU как в PROJECT.md)                     | PROJECT.md обновлён                                                      |
| 3   | PostgreSQL уже на 17 (не 15)                                              | PROJECT.md и STACK.md обновлены                                          |
| 4   | tmpfs для pg_stat_tmp — ошибка отчёта 05 (удалён в PG15)                  | Подтверждено, не применять                                               |
| 5   | Imagen 4 не на OpenRouter — блокер Phase 3 images                         | ~~Решено: гибридный подход~~ **Пересмотрено: полная миграция на FLUX.2** |

---

## Секция 15: Повторная верификация и обновлённые решения (2026-03-01)

Проведена повторная верификация всех находок отчёта по текущему состоянию кодовой базы. Выявлены значимые расхождения — часть проблем уже исправлена, часть решений пересмотрена.

### 15.1 Что уже исправлено (отчёт устарел)

| #   | Находка                    | Статус в отчёте  | Текущее состояние                                                                                                                                          | Файл                            |
| --- | -------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | python-jose → PyJWT        | "Нужна замена"   | **Уже выполнено.** `PyJWT[crypto]==2.10.1` в requirements.txt, python-jose полностью удалён                                                                | `requirements.txt:6`            |
| 2   | Сервер 8GB/4CPU            | "Нужен апгрейд"  | **Уже 32GB RAM / 12 vCPU / NVMe SSD**                                                                                                                      | Серверная конфигурация          |
| 3   | Gunicorn в production      | "Нужно добавить" | **Уже в Dockerfile.lite.prod** (строки 88-101) без --reload                                                                                                | `backend/Dockerfile.lite.prod`  |
| 4   | Health endpoint — заглушка | "Фейковый"       | **Реальная реализация** в `health.py` с 4 эндпоинтами (basic, reading-sessions, deep, metrics). Но заглушка в `main.py:313` ("checking...") ещё существует | `backend/app/routers/health.py` |

### 15.2 Пересмотренные решения

#### Мониторинг ошибок: Sentry → Hawk Tracker

**Решение:** Полный отказ от Sentry в пользу [Hawk Tracker](https://hawk-tracker.ru/) (hawk.so).

**Обоснование:**

- Российские серверы (совпадает с хостингом fancai.ru)
- Открытый исходный код, бесплатный SaaS
- Нативные SDK для FastAPI (`hawk-python-sdk[fastapi]`) и JavaScript/React (`@hawk.so/javascript`)
- Source maps поддерживаются из коробки
- Не требует self-hosted инфраструктуры (экономия ~10GB RAM на сервере)

**SDK:**

| Компонент         | Пакет                      | Установка                              |
| ----------------- | -------------------------- | -------------------------------------- |
| Backend (FastAPI) | `hawk-python-sdk[fastapi]` | `pip install hawk-python-sdk[fastapi]` |
| Frontend (React)  | `@hawk.so/javascript`      | `npm install @hawk.so/javascript`      |

**Инициализация FastAPI:**

```python
from hawk_python_sdk.modules.fastapi import HawkFastapi

hawk = HawkFastapi({
    'app_instance': app,
    'token': HAWK_TOKEN,
    'release': f"fancai@{APP_VERSION}",
})
```

**Затронутые требования:** DEPLOY-02, DEPLOY-03 обновлены (Sentry → Hawk).

#### AI-стратегия: Гибрид → Полная миграция на FLUX.2

**Решение:** Все AI-сервисы мигрируют на OpenRouter, включая генерацию изображений.

| Компонент        | Было (отчёт v5)       | Стало                             |
| ---------------- | --------------------- | --------------------------------- |
| LLM (4 сервиса)  | OpenRouter            | OpenRouter (без изменений)        |
| Изображения      | Google API (Imagen 4) | **OpenRouter (FLUX.2 Pro/Klein)** |
| google-genai SDK | Сохранить для images  | **Полностью удалить**             |

**Обоснование:** Единый API, единый ключ, проще обслуживание. FLUX.2 Pro ($0.03/img) обеспечивает приемлемое качество. Нужен отдельный NSFW filter (Imagen 4 имел встроенный).

#### Celery memory limits: Унификация на 512MB

| Было                                | Стало     |
| ----------------------------------- | --------- |
| celery_app.py: 150MB (default)      | **512MB** |
| docker-compose.staging.yml: 300MB   | **512MB** |
| docker-compose.lite.prod.yml: 400MB | **512MB** |

**Обоснование:** С 32GB RAM сервер может позволить более щедрые лимиты. AI-задачи (Gemini extraction) на больших книгах требуют значительной памяти.

### 15.3 Что остаётся актуальным

Все следующие находки **подтверждены** по текущему коду:

| #   | Проблема                                         | Файл:строка                              | Статус                           |
| --- | ------------------------------------------------ | ---------------------------------------- | -------------------------------- |
| 1   | visibility_timeout=3600 < time_limit=10800       | `celery_app.py:42` vs `book_tasks.py:61` | CRITICAL — дублирование задач    |
| 2   | Мёртвый celery_config.py (165 строк, 0 импортов) | `backend/app/core/celery_config.py`      | Подтверждён                      |
| 3   | Legacy NLP в config.py                           | `config.py:80-90`, `~194-214`            | Подтверждён                      |
| 4   | LANGEXTRACT_MODEL = `gemini-2.0-flash`           | docker-compose файлы                     | Подтверждён (не в config.py)     |
| 5   | DEBUG=True по умолчанию                          | `config.py:19-21`                        | HIGH — prod override через env   |
| 6   | PostgreSQL не pinned к 17.9                      | docker-compose.lite.prod.yml, staging    | HIGH (CVE)                       |
| 7   | Заглушка `/health` в main.py                     | `main.py:313` ("checking...")            | Параллельно с реальным health.py |
| 8   | Мониторинг ошибок не инициализирован             | Нигде нет init                           | Phase 1 задача                   |
| 9   | nginx:1.27-alpine в Dockerfile.prod              | `frontend/Dockerfile.prod:45`            | Phase 3 (замена на Caddy)        |

### 15.4 PostgreSQL dev/prod расхождение

Обнаружено: `docker-compose.lite.yml:29` использует `postgres:15-alpine` (комментарий: "Using v15 because server data was initialized with v15, and v17 is incompatible"), в то время как prod/staging используют `postgres:17-alpine`. Это **намеренное** расхождение, но требует плана миграции dev данных на v17.

### 15.5 Обновлённый план фазы 1

Планы Phase 1 (01-01-PLAN.md, 01-02-PLAN.md) признаны **устаревшими** и удалены. Причины:

- SEC-03 (JWT миграция) уже выполнена
- DEPLOY-01 (Gunicorn) уже в prod Dockerfile
- DEPLOY-02/03 (Sentry → Hawk) полностью пересмотрены
- DEPLOY-05..08 (Celery баги, CVE) не были включены в старые планы
- Серверные specs изменились (8GB → 32GB)

Планы будут перегенерированы через `/gsd:plan-phase 1` с учётом всех обновлений.

---

## Источники

### Веб-источники

- [OpenRouter Docs](https://openrouter.ai/docs)
- [OpenRouter BYOK](https://openrouter.ai/docs/use-cases/bring-your-own-key)
- [Google AI Gemini Pricing](https://ai.google.dev/pricing)
- [PGTune](https://pgtune.leopard.in.ua/)
- [PGTune Source](https://github.com/le0pard/pgtune)
- [PostgreSQL Security](https://www.postgresql.org/support/security/)
- [Percona: PG15 Stats Collector Removed](https://www.percona.com/blog/postgresql-15-stats-collector-gone-whats-new/)
- [Caddy Server](https://caddyserver.com/docs/)
- [Dockge GitHub](https://github.com/louislam/dockge)
- [Uptime Kuma v2](https://github.com/louislam/uptime-kuma)
- [Redis Licensing Changes](https://redis.io/blog/redis-adopts-dual-source-available-licensing/)

### Кодовая база (ключевые файлы)

- `backend/app/core/celery_app.py` — visibility_timeout:42, memory limits:29-31
- `backend/app/core/celery_config.py` — мёртвый код
- `backend/app/core/config.py` — модели:58-68, legacy NLP:79-90, pool:31-32
- `backend/app/tasks/book_tasks.py` — time_limit:61, soft_time_limit:62
- `backend/app/services/gemini_extractor.py` — response_schema usage
- `backend/app/services/entity_deduplication_service.py:194-198` — response_schema
- `backend/app/services/entity_synthesis_service.py:162` — response_mime_type only
- `backend/app/services/consistency_manager.py:658` — response_mime_type only
- `backend/app/services/imagen_generator.py:671` — generate_images()
- `backend/requirements.txt` — 80 pinned dependencies
- `frontend/package.json` — 30+ dependencies with semver
- `docker-compose.lite.prod.yml` — production config
- `docker-compose.staging.yml` — staging config
- `nginx/nginx.prod.conf.template` — 245 строк
- `nginx/nginx.prod.conf` — 283 строки
- `frontend/nginx.prod.conf` — 220 строк
- `frontend/Dockerfile.prod` — nginx:1.27-alpine
- `backend/Dockerfile.lite.prod` — python:3.12-slim
