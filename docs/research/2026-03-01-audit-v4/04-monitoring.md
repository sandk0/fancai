# Мониторинг

**Дата исследования:** 2026-03-01
**Источник:** Infrastructure Audit v4 — секция 5

---

## 1. Рекомендация: Netdata + Uptime Kuma + Dozzle

| Компонент       | Роль                                                                  | RAM        | Setup       |
| --------------- | --------------------------------------------------------------------- | ---------- | ----------- |
| **Netdata**     | Инфраструктура + приложение (PostgreSQL, Redis, Docker автодискавери) | ~200MB     | 10-15 мин   |
| **Uptime Kuma** | Uptime эндпоинтов, статус-страница, Telegram алерты                   | ~80MB      | 10 мин      |
| **Dozzle**      | Web UI для Docker логов (real-time, поиск)                            | ~30MB      | 5 мин       |
| **Итого**       |                                                                       | **~310MB** | **~30 мин** |

## 2. Почему не Prometheus + Grafana

- Prometheus + Grafana = 2GB+ RAM, 6-8 контейнеров, 2-4 часа setup
- Netdata покрывает 95% потребностей за ~200MB и 1 контейнер
- Если Netdata дашбордов не хватит — добавить VictoriaMetrics + Grafana позже

## 3. Что мониторится

- **Server:** CPU, RAM, disk, network (автодискавери Netdata)
- **Docker:** все контейнеры (автодискавери через Docker socket)
- **PostgreSQL:** 100+ метрик (native Netdata collector)
- **Redis:** автодискавери Netdata
- **Celery:** через celery-exporter или Flower `--prometheus_metrics`
- **FastAPI:** `prometheus-fastapi-instrumentator` (3 строки кода)
- **Uptime:** HTTP checks на `fancai.ru`, `/api/health`, TCP checks PostgreSQL/Redis
- **Алерты:** Telegram (native в Netdata и Uptime Kuma)

## 4. Docker Compose

```yaml
netdata:
  image: netdata/netdata:stable
  container_name: netdata
  hostname: fancai-server
  restart: unless-stopped
  cap_add: [SYS_PTRACE, SYS_ADMIN]
  security_opt: [apparmor:unconfined]
  ports: ["19999:19999"]
  volumes:
    - netdataconfig:/etc/netdata
    - netdatalib:/var/lib/netdata
    - netdatacache:/var/cache/netdata
    - /:/host/root:ro,rslave
    - /etc/passwd:/host/etc/passwd:ro
    - /etc/group:/host/etc/group:ro
    - /proc:/host/proc:ro
    - /sys:/host/sys:ro
    - /var/run/docker.sock:/var/run/docker.sock:ro

uptime-kuma:
  image: louislam/uptime-kuma:1
  container_name: uptime-kuma
  restart: unless-stopped
  ports: ["3001:3001"]
  volumes:
    - uptime-kuma-data:/app/data
    - /var/run/docker.sock:/var/run/docker.sock:ro

dozzle:
  image: amir20/dozzle:latest
  container_name: dozzle
  restart: unless-stopped
  ports: ["9999:8080"]
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
```

---

## Источники

- [Netdata GitHub](https://github.com/netdata/netdata) — 76.3K stars
- [Uptime Kuma GitHub](https://github.com/louislam/uptime-kuma) — 83.4K stars
- [Dozzle (Docker log viewer)](https://dozzle.dev/)
