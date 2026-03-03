# Исследование стека: Инструментарий для продакшен-готовности

**Область:** Продакшен-укрепление ИИ-читалки (React 19 + FastAPI + Celery + PostgreSQL + Redis)
**Исследовано:** 2026-02-27
**Уверенность:** ВЫСОКАЯ (большинство рекомендаций проверены через официальные документы/PyPI/npm)

## Контекст: Что уже есть

Прежде чем рекомендовать дополнения, вот что уже есть в кодовой базе:

| Категория | Уже на месте | Статус |
|-----------|-------------|--------|
| Отслеживание ошибок (бэкенд) | `sentry-sdk[fastapi]==2.51.0` в requirements.txt | Установлен, но НЕ инициализирован в main.py |
| Отслеживание ошибок (фронтенд) | Компонент ErrorBoundary существует | Sentry SDK не установлен |
| Метрики | `prometheus-fastapi-instrumentator==7.1.0` + `prometheus-client==0.24.1` | Установлены, стек Prometheus/Grafana в docker-compose.monitoring.yml |
| Логирование | `loguru==0.7.3` с JSON-режимом для продакшена | Настроен, работает |
| Заголовки безопасности | SecurityHeadersMiddleware (HSTS, CSP, X-Frame-Options и т.д.) | Реализовано, CSP nonces -- TODO |
| Rate limiting | Кастомный Redis-based RateLimiter со скользящим окном | Реализовано, преднастройки для каждого эндпоинта |
| Валидация секретов | SecretsValidator с проверкой при старте | Реализовано, принудительно в продакшене |
| Health-проверки | Docker Compose healthcheck на всех сервисах | Работают, но эндпоинт приложения /health -- фейковый |
| Бэкапы | Бэкап хранилища (ретенция 7 дней) | Работает, но НЕТ бэкапа базы данных |
| Стек мониторинга | Grafana + Prometheus + Loki + Promtail + Node Exporter + cAdvisor | Определён в docker-compose.monitoring.yml |
| JWT-авторизация | `python-jose==3.5.0` | УЯЗВИМОСТЬ: не поддерживается, известные проблемы безопасности |

**Ключевой вывод:** Инфраструктура мониторинга уже обширна. Основные пробелы: (1) фактическая инициализация Sentry, (2) добавление Sentry на фронтенд, (3) замена python-jose, (4) бэкапы базы данных, (5) исправление health-проверки и (6) Gunicorn для продакшена.

---

## Рекомендуемые дополнения стека

### 1. Мониторинг ошибок -- Бэкенд (инициализация Sentry)

| Технология | Версия | Назначение | Почему рекомендуется | Уверенность |
|------------|--------|------------|----------------------|-------------|
| sentry-sdk[fastapi] | 2.53.0 | Отслеживание ошибок + мониторинг производительности | Уже установлен (2.51.0), нужна только инициализация и обновление версии. Автоинтеграция с FastAPI, Celery, SQLAlchemy, Redis. Индустриальный стандарт. | ВЫСОКАЯ |

**Действие:** Обновить с 2.51.0 до 2.53.0. Инициализировать в lifespan main.py:

```python
import sentry_sdk

sentry_sdk.init(
    dsn=settings.SENTRY_DSN,
    traces_sample_rate=0.2,          # 20% в продакшене (контроль затрат)
    profiles_sample_rate=0.1,        # 10% профилирование
    send_default_pii=False,          # GDPR: без PII пользователей
    environment="production",
    release=VERSION,
    integrations=[],                  # FastAPI/Celery автодетектируются
    before_send=filter_sensitive_data, # Убираем API-ключи из breadcrumbs
)
```

**Почему эти значения:** traces_sample_rate 0.2 балансирует видимость и затраты при развёртывании на одном сервере. `send_default_pii=False`, потому что приложение обрабатывает данные чтения пользователей (потенциально чувствительные).

**Источник:** [Документация Sentry FastAPI](https://docs.sentry.io/platforms/python/integrations/fastapi/), [PyPI sentry-sdk](https://pypi.org/project/sentry-sdk/) -- версия 2.53.0 подтверждена 2026-02-16

### 2. Мониторинг ошибок -- Фронтенд (Sentry SDK)

| Технология | Версия | Назначение | Почему рекомендуется | Уверенность |
|------------|--------|------------|----------------------|-------------|
| @sentry/react | ^10.40.0 | Отслеживание ошибок фронтенда | Поддержка React 19 (хуки onCaughtError/onUncaughtError). Единое отслеживание ошибок с бэкенд Sentry. | ВЫСОКАЯ |
| @sentry/vite-plugin | ^5.1.0 | Загрузка source map | Маппинг минифицированных продакшен-ошибок на исходный TypeScript-код. Необходим для осмысленных отчётов об ошибках фронтенда. | ВЫСОКАЯ |

**Действие:** Установить и инициализировать:

```bash
# Зависимости фронтенда
cd frontend && npm install @sentry/react
cd frontend && npm install -D @sentry/vite-plugin
```

**Паттерн инициализации для React 19:**

```typescript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_ENVIRONMENT,
  tracesSampleRate: 0.1,           // 10% для фронтенда
  replaysSessionSampleRate: 0.1,   // 10% session replay
  replaysOnErrorSampleRate: 1.0,   // 100% replay при ошибке
});

// В createRoot (хуки React 19):
const root = createRoot(document.getElementById("root")!, {
  onCaughtError: Sentry.reactErrorHandler(),
  onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
    console.warn("Uncaught error", error, errorInfo.componentStack);
  }),
});
```

**Дополнение конфигурации Vite:**

```typescript
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig({
  build: { sourcemap: true },
  plugins: [
    sentryVitePlugin({
      org: "fancai",
      project: "fancai-frontend",
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
});
```

**Источник:** [Документация Sentry React](https://docs.sentry.io/platforms/javascript/guides/react/), [@sentry/react npm](https://www.npmjs.com/package/@sentry/react) -- версия 10.40.0 подтверждена, [@sentry/vite-plugin npm](https://www.npmjs.com/package/@sentry/vite-plugin) -- версия 5.1.0 подтверждена

### 3. Замена JWT-библиотеки (КРИТИЧЕСКАЯ БЕЗОПАСНОСТЬ)

| Технология | Версия | Назначение | Почему рекомендуется | Уверенность |
|------------|--------|------------|----------------------|-------------|
| PyJWT | 2.11.0 | Кодирование/декодирование JWT | Заменяет заброшенный `python-jose`. Активно поддерживается, документация FastAPI официально рекомендует PyJWT. Почти прямая замена. | ВЫСОКАЯ |

**Действие:** Заменить python-jose на PyJWT:

```bash
# В requirements.txt:
# УДАЛИТЬ: python-jose[cryptography]==3.5.0
# ДОБАВИТЬ: PyJWT[crypto]==2.11.0
```

**Миграция (минимальные изменения кода):**

```python
# ДО (python-jose):
from jose import JWTError, jwt
token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

# ПОСЛЕ (PyJWT):
import jwt
from jwt.exceptions import InvalidTokenError  # заменяет JWTError
token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
```

**Почему критично:** python-jose не выпускал релизов более 3 лет, имеет известные уязвимости безопасности в зависимостях, и FastAPI официально перевёл свою документацию на PyJWT. JWT -- это слой авторизации -- он должен активно поддерживаться.

**Источник:** [Туториал FastAPI JWT](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/), [Обсуждение FastAPI #11345](https://github.com/fastapi/fastapi/discussions/11345), [PyPI PyJWT](https://pypi.org/project/PyJWT/) -- версия 2.11.0 подтверждена 2026-01-30

### 4. Реализация health-проверки

| Технология | Версия | Назначение | Почему рекомендуется | Уверенность |
|------------|--------|------------|----------------------|-------------|
| (встроенное в FastAPI) | -- | Реальный health-эндпоинт | Текущий /health возвращает фейковую строку "checking...". Docker healthcheck зависит от этого. Должен реально проверять подключение к PostgreSQL + Redis. | ВЫСОКАЯ |

**Действие:** Заменить фейковую health-проверку реальной:

```python
@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    checks = {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

    # Проверка базы данных
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "connected"
    except Exception:
        checks["database"] = "disconnected"
        checks["status"] = "unhealthy"

    # Проверка Redis
    try:
        await cache_manager.ping()
        checks["redis"] = "connected"
    except Exception:
        checks["redis"] = "disconnected"
        checks["status"] = "unhealthy"

    status_code = 200 if checks["status"] == "healthy" else 503
    return JSONResponse(content=checks, status_code=status_code)
```

**Почему важно:** Docker Compose healthcheck вызывает `curl -f http://localhost:8000/health`. Если он всегда возвращает 200, Docker никогда не перезапускает нездоровые контейнеры. Стек мониторинга (алерты Prometheus) тоже зависит от того, отражает ли этот эндпоинт реальность.

### 5. Бэкап базы данных

| Технология | Версия | Назначение | Почему рекомендуется | Уверенность |
|------------|--------|------------|----------------------|-------------|
| pg_dump (через cron-контейнер) | Встроенный в PostgreSQL 15 | Ежедневный бэкап базы данных | Текущий бэкап покрывает только загруженные файлы (volume хранилища). Бэкапа базы данных не существует. Потеря данных при сбое PostgreSQL -- полная. | ВЫСОКАЯ |

**Действие:** Добавить сервис бэкапа базы данных в docker-compose.lite.yml:

```yaml
db-backup:
  image: postgres:15-alpine
  container_name: bookreader_db_backup
  environment:
    - PGPASSWORD=${DB_PASSWORD}
    - TZ=Europe/Moscow
  volumes:
    - /root/backups/db:/backups
  entrypoint: /bin/sh
  command: |
    -c "
      while true; do
        BACKUP_FILE=/backups/db-$$(date +%Y%m%d-%H%M%S).sql.gz
        pg_dump -h postgres -U $${DB_USER:-postgres} $${DB_NAME:-bookreader_dev} | gzip > $$BACKUP_FILE
        echo \"[$$(/bin/date)] DB backup: $$(du -h $$BACKUP_FILE | cut -f1)\"
        find /backups -name 'db-*.sql.gz' -mtime +14 -delete
        sleep 86400
      done
    "
  depends_on:
    postgres:
      condition: service_healthy
  networks:
    - bookreader_network
  deploy:
    resources:
      limits:
        cpus: '0.2'
        memory: 256M
  restart: unless-stopped
```

**Ретенция:** 14 дней для бэкапов базы данных (vs 7 для хранилища). Базу данных сложнее воссоздать.

### 6. Gunicorn для продакшена

| Технология | Версия | Назначение | Почему рекомендуется | Уверенность |
|------------|--------|------------|----------------------|-------------|
| gunicorn | 25.0.1 | Продакшен ASGI-сервер | Уже в requirements.txt, но НЕ используется в docker-compose. Продакшен запускает голый uvicorn с флагом `--reload` (режим разработки). Gunicorn обеспечивает управление процессами, переработку воркеров, грациозные перезапуски. | ВЫСОКАЯ |

**Действие:** Изменить команду бэкенда в docker-compose.lite.yml:

```yaml
# ДО (режим разработки в продакшене!):
command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# ПОСЛЕ (продакшен-режим):
command: >
  gunicorn app.main:app
  --worker-class uvicorn.workers.UvicornWorker
  --workers ${WORKERS_COUNT:-4}
  --bind 0.0.0.0:8000
  --timeout ${WORKER_TIMEOUT:-300}
  --max-requests ${WORKER_MAX_REQUESTS:-1000}
  --max-requests-jitter ${WORKER_MAX_REQUESTS_JITTER:-100}
  --graceful-timeout 30
  --access-logfile -
```

**Почему критично:** `--reload` в продакшене означает, что сервер отслеживает все файлы на изменения и перезапускается при любом событии файловой системы. Это тратит ЦПУ, вызывает случайные перезапуски при изменении файлов бэкапа и не даёт никакой продакшен-пользы. Gunicorn добавляет изоляцию сбоев (падение воркера не убивает сервер), защиту от утечек памяти (max-requests) и утилизацию нескольких ядер.

**Источник:** [Документация FastAPI Server Workers](https://fastapi.tiangolo.com/deployment/server-workers/)

### 7. Мониторинг Celery (Flower)

| Технология | Версия | Назначение | Почему рекомендуется | Уверенность |
|------------|--------|------------|----------------------|-------------|
| flower | 2.0.1 | UI мониторинга задач Celery + метрики Prometheus | Задачи обработки книг выполняются минуты-часы. Без Flower диагностика застрявших/упавших задач требует просмотра логов. Flower экспортирует метрики Prometheus для алертов на глубину очереди и частоту сбоев. | СРЕДНЯЯ |

**Действие:** Добавить в docker-compose.monitoring.yml:

```yaml
flower:
  build:
    context: ./backend
    dockerfile: Dockerfile.lite
  container_name: bookreader_flower
  environment:
    - CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
    - FLOWER_BASIC_AUTH=${FLOWER_USER:-admin}:${FLOWER_PASSWORD:?FLOWER_PASSWORD required}
  command: celery -A app.core.celery_app flower --port=5555 --broker_api=redis://:${REDIS_PASSWORD}@redis:6379/0 --prometheus_metrics
  networks:
    - bookreader_network
  deploy:
    resources:
      limits:
        cpus: '0.3'
        memory: 256M
  restart: unless-stopped
```

**Почему СРЕДНЯЯ уверенность:** Flower 2.0.1 был выпущен в августе 2023 и не получал свежих обновлений. Он работает, но темп поддержки проекта медленный. По-прежнему стандартный инструмент для мониторинга Celery.

**Источник:** [Документация Flower](https://flower.readthedocs.io/en/latest/prometheus-integration.html), [PyPI flower](https://pypi.org/project/flower/) -- версия 2.0.1 подтверждена

---

## Существующий стек: Оставить как есть

Уже корректно настроены и не требуют изменений:

| Технология | Текущая версия | Назначение | Оценка |
|------------|---------------|------------|--------|
| loguru | 0.7.3 | Структурированное логирование | Корректно настроен: JSON в продакшене, цветное в dev. Изменения не нужны. |
| prometheus-fastapi-instrumentator | 7.1.0 | HTTP-метрики | Последняя версия. Уже собирает количество запросов, задержку, размеры ответов. |
| prometheus-client | 0.24.1 | Кастомные метрики | Стандартный Prometheus-клиент. |
| SecurityHeadersMiddleware | кастомный | Заголовки безопасности | HSTS, CSP, X-Frame-Options, X-Content-Type-Options -- всё на месте. Единственный пробел: CSP nonces (TODO). |
| Rate limiter | кастомный на Redis | Защита от злоупотребления API | Скользящее окно, per-user + per-IP, грациозная деградация. Хорошо реализовано. |
| SecretsValidator | кастомный | Проверка секретов при старте | Валидирует SECRET_KEY, DATABASE_URL, REDIS_URL в продакшене. |
| Docker Compose healthcheck | -- | Здоровье сервисов | Все сервисы имеют healthcheck с правильными интервалами, повторами, start_period. |
| Grafana + Prometheus + Loki | -- | Стек мониторинга | Полный стек наблюдаемости уже определён. |

---

## Существующий стек: Требуется обновление

| Технология | Текущая | Целевая | Зачем обновлять |
|------------|---------|---------|-----------------|
| sentry-sdk[fastapi] | 2.51.0 | 2.53.0 | Исправления багов, последние интеграции. Минорное обновление. |
| python-jose | 3.5.0 | УДАЛИТЬ | Заменить на PyJWT 2.11.0 (см. раздел 3). |

---

## Что НЕ использовать

| Избегать | Почему | Использовать вместо |
|----------|--------|---------------------|
| python-jose | Заброшен 3+ года, известные уязвимости, FastAPI снял официальную поддержку | PyJWT 2.11.0 |
| slowapi | Последний релиз февраль 2024 (v0.1.9), всё ещё 0.x, ограниченная поддержка | Оставить существующий кастомный Redis rate limiter (уже лучше: распределённый, скользящее окно, грациозная деградация) |
| uvicorn --reload в продакшене | Отслеживание файлов тратит ЦПУ, вызывает случайные перезапуски | gunicorn с UvicornWorker |
| Datadog / New Relic | Дорогой SaaS для односерверного проекта | Self-hosted Sentry + Prometheus/Grafana (уже настроено) |
| structlog | Добавляет сложность поверх loguru без выгоды для этого проекта | loguru (уже настроен с JSON + dev режимами) |
| celery-exporter | Отдельный контейнер для метрик Celery | Flower с --prometheus_metrics (также даёт UI) |
| passlib | Мягко deprecated, медленная разработка | Оставить пока (нет срочной проблемы безопасности, бэкенд bcrypt стабилен). Рассмотреть argon2-cffi в долгосрочной перспективе. |

---

## Укрепление конфигурации (без новых библиотек)

Эти изменения не требуют новых зависимостей, только исправления конфигурации:

### Дефолты безопасности

| Настройка | Текущее | Рекомендуемое | Почему |
|-----------|---------|---------------|--------|
| Дефолт `DEBUG` | `True` | `False` | Если переменная окружения не задана, продакшен работает в debug-режиме. Измените дефолт, чтобы отсутствие конфигурации = безопасно. |
| Дефолт `SECRET_KEY` | `"dev-secret-key..."` | Генерировать случайный при старте | Если переменная окружения отсутствует, приложение должно упасть или сгенерировать случайный ключ, а не использовать подделываемый дефолт. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 10080 (7 дней) | 1440 (1 день) | 7-дневные access-токены слишком долгие. Использовать 1-дневный access + 30-дневный refresh. UX читалки сохраняется через refresh-токен. |
| Дефолт `METRICS_PASSWORD` | `"metrics_secure_password"` | Добавить в продакшен-валидатор | Сейчас не проверяется. Любой с этим дефолтом может скрейпить все метрики Prometheus. |
| `PASSWORD_RESET_BASE_URL` | `"http://localhost:5173/..."` | `""` (требовать переопределение через env) | Продакшен-письма отправляют ссылки на localhost. Пустой дефолт требует явной конфигурации. |

### Укрепление CORS

| Настройка | Текущее | Рекомендуемое |
|-----------|---------|---------------|
| Дефолт `CORS_ORIGINS` | `"http://localhost:3000,http://localhost:5173,http://localhost:5174"` | Оставить только localhost:5173 для dev; требовать переопределение через env в продакшене |

### CSP Nonces (TODO в текущем коде)

CSP в настоящее время не имеет nonce-based script-src. Поскольку Vite производит внешние JS-файлы (без инлайн-скриптов), текущий `script-src 'self'` на самом деле корректен и достаточен. Задокументируйте это решение вместо реализации nonces.

---

## Сводка по установке

### Бэкенд (изменения requirements.txt)

```diff
# БЕЗОПАСНОСТЬ: Замена заброшенной JWT-библиотеки
- python-jose[cryptography]==3.5.0
+ PyJWT[crypto]==2.11.0

# МОНИТОРИНГ: Обновление Sentry
- sentry-sdk[fastapi]==2.51.0
+ sentry-sdk[fastapi]==2.53.0

# МОНИТОРИНГ: Добавление Flower (опционально, в requirements.monitoring.txt)
+ flower==2.0.1
```

### Фронтенд (изменения npm)

```bash
# Мониторинг ошибок
npm install @sentry/react

# Dev-зависимости (загрузка source map)
npm install -D @sentry/vite-plugin
```

### Переменные окружения для добавления

```bash
# Sentry (бэкенд + фронтенд)
SENTRY_DSN=https://xxx@sentry.io/xxx          # Бэкенд
VITE_SENTRY_DSN=https://xxx@sentry.io/xxx      # Фронтенд (другой проект)
SENTRY_AUTH_TOKEN=sntrys_xxx                    # Загрузка source map в CI/CD

# Flower (стек мониторинга)
FLOWER_USER=admin
FLOWER_PASSWORD=<strong-password>
```

---

## Матрица совместимости версий

| Пакет | Совместим с | Примечания |
|-------|-------------|------------|
| PyJWT 2.11.0 | Python >= 3.9, FastAPI 0.128.0 | Требует `PyJWT[crypto]` для RS256 (сейчас используется HS256, так что базовый PyJWT работает, но crypto extra безопаснее) |
| sentry-sdk 2.53.0 | FastAPI >= 0.79.0, Python >= 3.7 | Автодетектирует интеграции FastAPI, Celery, SQLAlchemy, Redis |
| @sentry/react 10.40.0 | React >= 17, Vite 7.x | Хуки React 19 onCaughtError/onUncaughtError поддерживаются |
| @sentry/vite-plugin 5.1.0 | Vite >= 4.x | Загрузка source map во время `vite build` |
| flower 2.0.1 | Celery >= 5.0 | Метрики Prometheus через флаг `--prometheus_metrics` |

---

## Приоритетный порядок реализации

На основе серьёзности и зависимостей:

1. **Заменить python-jose на PyJWT** -- КРИТИЧЕСКАЯ БЕЗОПАСНОСТЬ, нулевая зависимость от других изменений
2. **Исправить дефолт DEBUG на False** -- КРИТИЧЕСКАЯ БЕЗОПАСНОСТЬ, изменение одной строки
3. **Инициализировать Sentry (бэкенд)** -- ВЫСОКАЯ ЦЕННОСТЬ, библиотека уже установлена
4. **Переключить на Gunicorn в продакшене** -- ВЫСОКАЯ ЦЕННОСТЬ, библиотека уже установлена
5. **Реализовать реальный /health эндпоинт** -- ВЫСОКАЯ ЦЕННОСТЬ, без новых зависимостей
6. **Добавить бэкап базы данных** -- ВЫСОКАЯ ЦЕННОСТЬ, без новых зависимостей
7. **Добавить Sentry на фронтенд** -- СРЕДНЯЯ ЦЕННОСТЬ, новые npm-зависимости
8. **Исправить дефолты безопасности** (срок действия токена, пароль метрик, URL сброса пароля) -- СРЕДНЯЯ ЦЕННОСТЬ
9. **Добавить Flower в стек мониторинга** -- НИЗКАЯ ЦЕННОСТЬ, приятное дополнение

---

## Источники

- [Документация Sentry FastAPI](https://docs.sentry.io/platforms/python/integrations/fastapi/) -- паттерны интеграции, sample rates (ВЫСОКАЯ уверенность)
- [Документация Sentry React](https://docs.sentry.io/platforms/javascript/guides/react/) -- хуки React 19, инициализация (ВЫСОКАЯ уверенность)
- [PyPI sentry-sdk 2.53.0](https://pypi.org/project/sentry-sdk/) -- версия подтверждена 2026-02-16 (ВЫСОКАЯ уверенность)
- [npm @sentry/react 10.40.0](https://www.npmjs.com/package/@sentry/react) -- версия подтверждена (ВЫСОКАЯ уверенность)
- [npm @sentry/vite-plugin 5.1.0](https://www.npmjs.com/package/@sentry/vite-plugin) -- версия подтверждена (ВЫСОКАЯ уверенность)
- [Туториал FastAPI JWT (PyJWT)](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) -- официальная документация FastAPI теперь использует PyJWT (ВЫСОКАЯ уверенность)
- [Обсуждение FastAPI #11345](https://github.com/fastapi/fastapi/discussions/11345) -- deprecated python-jose (ВЫСОКАЯ уверенность)
- [PyPI PyJWT 2.11.0](https://pypi.org/project/PyJWT/) -- версия подтверждена 2026-01-30 (ВЫСОКАЯ уверенность)
- [Документация FastAPI Server Workers](https://fastapi.tiangolo.com/deployment/server-workers/) -- паттерн Gunicorn + Uvicorn (ВЫСОКАЯ уверенность)
- [PyPI flower 2.0.1](https://pypi.org/project/flower/) -- версия подтверждена, последний релиз август 2023 (СРЕДНЯЯ уверенность по поддержке)
- [Интеграция Flower Prometheus](https://flower.readthedocs.io/en/latest/prometheus-integration.html) -- конфигурация метрик (ВЫСОКАЯ уверенность)
- [PyPI slowapi 0.1.9](https://pypi.org/project/slowapi/) -- последний релиз февраль 2024, не рекомендуется (ВЫСОКАЯ уверенность)
- [Документация Sentry Vite source maps](https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/) -- интеграция сборки (ВЫСОКАЯ уверенность)

---
*Исследование стека для: продакшен-готовность fancai*
*Исследовано: 2026-02-27*
