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
| Очереди             | Celery 5.6.2 worker + beat; logical queues heavy/normal/light, но текущий worker обслуживает только normal                            | `docker-compose.prod.yml`, `backend/app/core/celery_app.py` |
| БД                  | PostgreSQL 17 + pgvector 0.8.2 (`pgvector/pgvector:0.8.2-pg17`)                                                                                              | `docker-compose.prod.yml`                                   |
| Кэш/брокер          | Redis 7.4.8                                                                                                                                                  | `docker-compose.prod.yml`                                   |
| Бэкап БД            | контейнер `pgbackup` — ежедневный дамп, retention 7 дней, zstd                                                                                               | `docker-compose.prod.yml`                                   |
| Frontend            | React 19 / Vite 8 build, статика отдаётся Caddy                                                                                                              | `frontend/Dockerfile.prod`                                  |

## AI и внешние сервисы

Production env использует Gemini Direct через Vertex AI global (`gemini-3.5-flash` для
extraction, `gemini-3.1-flash-image` для images). Consistency reduce пока напрямую вызывает
OpenRouter; legacy Modal flags выключены. Это mixed route, а не автоматический fallback.
Подробно — [`../architecture/ai-pipeline.md`](../architecture/ai-pipeline.md).
Ошибки — Hawk Tracker; email/password reset — Yandex Cloud Postbox.

> **Critical known issue 2026-07-18:** `inspect active_queues` показывает только `normal`.
> `process_book_task` направляется в `heavy`, а beat housekeeping — в `light`; consumers
> для них нет. В `light` накопилось 7212 stale periodic messages. Не запускать глобальный
> purge: recovery должен остановить beat, проверить состав очереди, удалить только `light`
> и поднять явных workers для `heavy/normal/light`.

## Мониторинг (отдельный стек)

`docker-compose.monitoring.yml`: **Netdata** 2.9 + **VictoriaMetrics** 1.137 (retention 90д) +
**Uptime-Kuma** 2.2 + **Dozzle** 10.1. Backend отдаёт `/metrics`
(`prometheus-fastapi-instrumentator`), Netdata его скрапит. Доступ — через
`monitor.fancai.ru` / `uptime.fancai.ru` (basicauth). _(Prometheus/Grafana/Loki из старых
доков НЕ используются.)_

> **Known issue 2026-07-18:** Netdata exporter и Prometheus collector настроены на
> `localhost:8428`/`localhost:8000` внутри bridge-контейнера. VictoriaMetrics жив, но
> Netdata data path не работает. До исправления monitoring dashboard нельзя считать
> доказательством полноты метрик.

## Деплой

```bash
bash scripts/deploy-production.sh   # alembic upgrade head → ordered up → healthchecks → rollback при сбое
```

Порядок поднятия: postgres → redis → backend/celery → frontend/caddy. Лог:
`/var/log/fancai-deploy.log`. Канонический runtime env на сервере —
`/opt/fancai/app/.env` (не `.env.production`). SSH: `deploy@fancai`, port `2222`.

> Локальные fixes deploy scripts для canonical `.env` на 2026-07-18 ещё не закоммичены и
> не доставлены на сервер. Следующий deploy выполнять только после `bash -n`,
> `docker compose --env-file .env ... config --quiet` и backup checkpoint.

См. также `/deploy` skill в репозитории.

## Бэкапы и аварийное восстановление

- Регулярный дамп БД — контейнером `pgbackup` (см. выше).
- **Полный пакет аварийной готовности / миграции сервера** — [`../operations/migration/`](../operations/migration/)
  (recon, план, runbook, RTO ≤ 4ч). Это страховка; на момент 2026-05-10 миграция не исполнялась.
- Процедуры BackUp/Restore БД — [`../operations/BACKUP_AND_RESTORE.md`](../operations/BACKUP_AND_RESTORE.md).

## Окружение

Переменные — в `.env` (шаблон `.env.production.example`): `DB_*`, `REDIS_PASSWORD`,
`SECRET_KEY`, `AI_PROVIDER`, `GEMINI_BACKEND`, `GEMINI_*`, `GCP_PROJECT`, `GCP_LOCATION`,
`GOOGLE_APPLICATION_CREDENTIALS`, `OPENROUTER_API_KEY`, `YANDEX_POSTBOX_*`, `VAPID_*`,
`HAWK_TOKEN`, `METRICS_*`, `DOMAIN_*`, `CORS_ORIGINS`, `MONITOR_*`.

---

_Последнее обновление: 2026-07-18. Сверено с live production, `docker-compose.prod.yml`, `docker-compose.monitoring.yml`, `Caddyfile`, deploy scripts и AI routing code._
