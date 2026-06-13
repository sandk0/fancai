# Deployment — fancai

Как fancai развёрнут в проде. Это обзор; **источник истины** — сами файлы инфраструктуры (ссылки ниже), а не этот документ.

> Прежний набор подробных deployment-доков (октябрь 2025) описывал аспирационную
> инфру (Nginx + AWS/Kubernetes + Prometheus/Grafana) под старым именем «BookReader AI»,
> которая **не была построена**. Он перенесён в
> [`../_archive/2026-06-13-stale-infra/deployment/`](../_archive/2026-06-13-stale-infra/deployment/)
> и оставлен только как историческая справка.

## Реальная топология

Один VPS (Debian 13, ~12 vCPU / 31 GiB), всё в Docker Compose. Домен **fancai.ru**.

| Слой                | Что                                                                                                                                                          | Где (истина)                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Reverse-proxy / TLS | **Caddy 2.11.1** — `fancai.ru`, `www`→301, `monitor.fancai.ru`, `uptime.fancai.ru`; Let's Encrypt; `/api`+`/ws`→backend:8000, `/storage`→файлы, SPA-fallback | `Caddyfile`                                                 |
| Backend             | FastAPI 0.135 (gunicorn+uvicorn), Python 3.12                                                                                                                | `docker-compose.prod.yml`, `backend/Dockerfile.prod`        |
| Очереди             | Celery 5.6.2 worker + beat (очереди heavy/normal/light)                                                                                                      | `docker-compose.prod.yml`, `backend/app/core/celery_app.py` |
| БД                  | PostgreSQL 17 + pgvector 0.8.2 (`pgvector/pgvector:0.8.2-pg17`)                                                                                              | `docker-compose.prod.yml`                                   |
| Кэш/брокер          | Redis 7.4.8                                                                                                                                                  | `docker-compose.prod.yml`                                   |
| Бэкап БД            | контейнер `pgbackup` — ежедневный дамп, retention 7 дней, zstd                                                                                               | `docker-compose.prod.yml`                                   |
| Frontend            | React 19 / Vite 8 build, статика отдаётся Caddy                                                                                                              | `frontend/Dockerfile.prod`                                  |

## AI и внешние сервисы

Весь AI-пайплайн идёт через **OpenRouter** (LLM `google/gemini-2.5-flash`+`-lite`, изображения
`black-forest-labs/flux.2-klein-4b`; ключ `OPENROUTER_API_KEY`). Подробно —
[`../architecture/ai-pipeline.md`](../architecture/ai-pipeline.md). Ошибки — Hawk Tracker.

## Мониторинг (отдельный стек)

`docker-compose.monitoring.yml`: **Netdata** 2.9 + **VictoriaMetrics** 1.137 (retention 90д) +
**Uptime-Kuma** 2.2 + **Dozzle** 10.1 + **Flower** 2.0. Backend отдаёт `/metrics`
(`prometheus-fastapi-instrumentator`), Netdata его скрапит. Доступ — через
`monitor.fancai.ru` / `uptime.fancai.ru` (basicauth). _(Prometheus/Grafana/Loki из старых
доков НЕ используются.)_

## Деплой

```bash
bash scripts/deploy-production.sh   # alembic upgrade head → ordered up → healthchecks → rollback при сбое
```

Порядок поднятия: postgres → redis → backend/celery → frontend/caddy. Лог: `/var/log/fancai-deploy.log`.
См. также `/deploy` skill в репозитории.

## Бэкапы и аварийное восстановление

- Регулярный дамп БД — контейнером `pgbackup` (см. выше).
- **Полный пакет аварийной готовности / миграции сервера** — [`../operations/migration/`](../operations/migration/)
  (recon, план, runbook, RTO ≤ 4ч). Это страховка; на момент 2026-05-10 миграция не исполнялась.
- Процедуры BackUp/Restore БД — [`../operations/BACKUP_AND_RESTORE.md`](../operations/BACKUP_AND_RESTORE.md).

## Окружение

Переменные — в `.env` (шаблон `.env.production.example`): `DB_*`, `REDIS_PASSWORD`, `SECRET_KEY`,
`OPENROUTER_API_KEY`, `VAPID_*` (web-push), `HAWK_TOKEN`, `DOMAIN_*`, `CORS_ORIGINS`, `MONITOR_*`.

---

_Последнее обновление: 2026-06-13. Сверено с: `docker-compose.prod.yml`, `docker-compose.monitoring.yml`, `Caddyfile`, `scripts/deploy-production.sh`, `docs/operations/migration/00-RECON-REPORT.md`._
