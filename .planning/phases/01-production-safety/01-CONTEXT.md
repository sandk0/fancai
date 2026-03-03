# Фаза 1: Безопасность продакшена — Контекст

**Собран:** 2026-02-27
**Статус:** Готов к планированию

<domain>
## Границы фазы

Исправить уязвимости безопасности (миграция JWT на PyJWT, отклонение alg=none, отклонение дефолтного SECRET_KEY), перейти на продакшен-режим деплоя (Gunicorn + UvicornWorker, DEBUG=False), реализовать реальные health check-и (подключение к PostgreSQL, Redis, Celery), добавить мониторинг Sentry (бэкенд + фронтенд + Celery) и настроить резервное копирование базы данных. Никаких новых пользовательских функций.

</domain>

<decisions>
## Решения по реализации

### Мониторинг ошибок: Hawk Tracker (обновлено 2026-03-01)
- **Hawk Tracker SaaS** (https://hawk-tracker.ru/) вместо Sentry (российские серверы, бесплатный, open source)
- Backend: `hawk-python-sdk[fastapi]` — HawkFastapi integration с FastAPI app instance
- Frontend: `@hawk.so/javascript` — React support, source maps из коробки
- Два отдельных проекта: Python-бэкенд и React-фронтенд
- Интеграция с Celery — отслеживание сбоев AI-пайплайна
- Только внутренний health check эндпоинт (без внешнего мониторинга аптайма)
- Логи в stdout через Docker (без структурированного JSON-логирования в файлы)

### Конфигурация деплоя (обновлено 2026-03-01)
- nginx в качестве реверс-прокси уже настроен с Let's Encrypt SSL
- Gunicorn: уже в Dockerfile.lite.prod (2 воркера с UvicornWorker)
- Celery: memory limit 512MB для всех окружений (было 150/300/400)
- **Сервер: 32GB RAM, 12 vCPU, NVMe SSD** (апгрейд уже выполнен)
- Лимиты памяти Docker на контейнер (предотвращение OOM)
- Политика restart: unless-stopped для всех контейнеров
- Кратковременный даунтайм при деплоях допустим (zero-downtime не требуется)
- Единый docker-compose.lite.yml для продакшена (без отдельного prod-файла)
- Без rate limiting в этой фазе

### Управление секретами
- Файл .env на сервере (не в git), Docker Compose читает env_file
- SECRET_KEY уже читается из окружения (есть дефолтный fallback — нужно удалить)
- Ручная генерация SECRET_KEY (надёжный ключ, без ротации)
- Создать шаблон .env.example в репозитории с placeholder-значениями
- Проверить, что .env в .gitignore
- Fail-fast при запуске: приложение отказывается запускаться, если отсутствуют обязательные переменные окружения (SECRET_KEY, DATABASE_URL)

### На усмотрение Claude
- Точная версия Sentry и конфигурация Docker Compose для self-hosted
- Улучшения процесса деплоя в docker-compose.lite.yml
- Полный список обязательных переменных окружения для валидации при запуске (Claude проверяет код)
- Значения лимитов памяти на контейнер (распределение 16 ГБ между сервисами)
- Формат ответа health check и значения таймаутов
- Конфигурация таймаута и keep-alive для Gunicorn

</decisions>

<specifics>
## Конкретные идеи

- Сервер уже 32GB RAM / 12 vCPU — Hawk Tracker SaaS не требует серверных ресурсов
- Текущий деплой: ssh root@server -> docker compose

</specifics>

<deferred>
## Отложенные идеи

Нет — обсуждение не выходило за рамки фазы

</deferred>

---

*Фаза: 01-production-safety*
*Контекст собран: 2026-02-27*
