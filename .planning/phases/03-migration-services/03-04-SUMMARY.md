---
phase: 03-migration-services
plan: 04
subsystem: infra
tags: [caddy, docker-compose, nginx-replacement, reverse-proxy, http3, spa-routing]

# Dependency graph
requires:
  - phase: 02-dead-code-cleanup
    provides: "Чистая кодовая база для миграции — удалены NLP-файлы и мертвые endpoints"
  - phase: 03-migration-services
    provides: "OpenRouter клиент с fallback chain, миграция LLM-сервисов (Phase 03-01)"
provides:
  - "Caddy вместо nginx (~80 строк вместо 881) с auto-HTTPS, HTTP/3, SPA routing"
  - "Упрощенная инфра: docker-compose.prod.yml + docker-compose.dev.yml (вместо 4 файлов)"
  - "Shared volume frontend_build для передачи build артефактов между контейнерами"
  - "Multi-stage frontend Dockerfile: builder stage собирает в /var/www/html"
affects: [Phase 4 (инфраструктура мониторится), Phase 5 (rate limiting в Caddy), deploy automation]

# Tech tracking
tech-stack:
  added:
    - "Caddy 2-alpine (reverse proxy, auto-HTTPS, HTTP/3)"
  removed:
    - "nginx 1.27-alpine (~881 строк конфигов)"
  patterns:
    - "Minimalist config: Caddy Caddyfile вместо nginx.conf + sh + volumes"
    - "Multi-stage Docker: builder -> output (shared volume вместо встроенного веб-сервера)"
    - "Named volumes: caddy_data (SSL persistence), frontend_build (shared build artifacts)"

key-files:
  created:
    - "Caddyfile — Production конфигурация (~80 строк)"
    - "Caddyfile.dev — Development конфигурация для localhost"
    - "docker-compose.prod.yml — Caddy-based production (вместо docker-compose.lite.prod.yml)"
    - "docker-compose.dev.yml — Development setup для MacBook Air M4"
  modified:
    - "docker-compose.lite.yml — Удалена (переименована в docker-compose.dev.yml)"
    - "frontend/Dockerfile.prod — Заменена stage 2 (nginx -> alpine output)"
    - "deploy/deploy.sh — Обновлены пути и логика запуска docker-compose"

key-decisions:
  - "Caddy вместо nginx — radically simpler config (80 vs 881 lines), auto-HTTPS from Let's Encrypt"
  - "Shared volume frontend_build — frontend контейнер пишет, caddy читает (no embedded nginx)"
  - "HTTP/3 (QUIC) enabled — UDP 443 портmapping обязателен для performance"
  - "dev vs prod только — удалены staging.yml, dev-ssl.yml, ssl.yml, aws/ (deployment complexity)"

patterns-established:
  - "Caddy configuration pattern: handle blocks for API/WebSocket/Storage/SPA, try_files for routing"
  - "Docker-compose service dependencies: container_name, service_completed_successfully waits"
  - "SSL certificate persistence: Caddy manages via caddy_data:/data named volume"

requirements-completed:
  - MIGR-06
  - MIGR-07

# Metrics
duration: 45min
completed: 2026-03-01
---

# Фаза 3.4: Замена nginx на Caddy с auto-HTTPS и HTTP/3

**Caddy заменил nginx (~80 строк вместо 881) с автоматическим HTTPS, HTTP/3 и SPA routing; docker-compose упрощён до dev + prod файлов; frontend build артефакты передаются через shared volume**

## Производительность

- **Продолжительность:** ~45 мин
- **Начало:** 2026-03-01 ~17:00 UTC
- **Завершение:** 2026-03-01 ~18:00 UTC
- **Задачи:** 2/2 завершены
- **Файлы изменены:** 12 (создано 4, отредактировано 3, удалено 5+)

## Достижения

- Создан Caddyfile (80 строк) с complete reverse proxy, SPA routing, security headers, 50MB upload limit
- Заменён nginx (881 строк) на Caddy (2-alpine) с auto-HTTPS через Let's Encrypt
- Активирован HTTP/3 (QUIC) через UDP 443
- Реализован shared volume frontend_build: frontend контейнер пишет build артефакты → caddy читает
- Обновлён frontend/Dockerfile.prod: Stage 1 (node builder) → Stage 2 (alpine output в shared volume)
- Упрощена инфра: docker-compose удалены staging.yml, dev-ssl.yml, ssl.yml, deploy/aws/; остались только prod + dev
- Обновлены deploy skill и tech-stack skill для новой структуры docker-compose файлов

## Коммиты задач

Каждая задача закоммичена атомарно:

1. **Task 1: Создать Caddyfile, обновить docker-compose и frontend Dockerfile** - `ad13975` (feat)
   - Caddyfile с auto-HTTPS, HTTP/3, reverse proxy, SPA routing, security headers
   - docker-compose.lite.prod.yml обновлён: nginx → caddy сервис
   - frontend/Dockerfile.prod обновлён: stage 2 использует alpine, копирует в shared volume
   - frontend_build volume mounted в обоих контейнерах для shared artifact transfer
   - caddy_data volume для SSL certificate persistence

2. **Task 2: Визуальная проверка Caddy конфигурации** - `4d295e8` (refactor - checkpoint approved)
   - Пользователь утвердил конфигурацию с дополнительными изменениями
   - Consolidated docker-compose: docker-compose.lite.prod.yml → docker-compose.prod.yml
   - Создан docker-compose.dev.yml для локальной разработки (MacBook Air M4)
   - Удалены: ssl.yml, staging.yml, dev-ssl.yml, deploy/aws/, nginx/, docker/README.md, init-ssl.sh
   - Создан Caddyfile.dev для localhost development
   - Обновлены deploy skill, tech-stack skill, fancai-orchestrator для новой структуры

**Metadata комит:** (будет создан после SUMMARY.md)

## Созданные/Изменённые файлы

- `Caddyfile` — Production конфигурация Caddy (80 строк): auto-HTTPS, HTTP/3, reverse proxy, SPA routing
- `Caddyfile.dev` — Development конфигурация для localhost
- `docker-compose.prod.yml` — Production docker-compose (caddy вместо nginx, frontend_build shared volume)
- `docker-compose.dev.yml` — Development docker-compose для локальной разработки
- `frontend/Dockerfile.prod` — Updated: alpine output stage копирует в /var/www/html
- `deploy/deploy.sh` — Updated: пути для новой docker-compose структуры
- `.claude/skills/deploy/SKILL.md` — Updated: documentation for new docker-compose files
- `.claude/skills/tech-stack/SKILL.md` — Updated: Caddy added to tech stack reference

**Удалены:**
- `nginx/` — Entire directory (nginx.prod.conf.template, docker-entrypoint.sh, conf.d/, ssl/)
- `docker-compose.lite.yml` — Переименована в docker-compose.dev.yml
- `docker-compose.lite.prod.yml` — Переименована в docker-compose.prod.yml
- `docker-compose.staging.yml`
- `docker-compose.dev-ssl.yml`
- `docker-compose.ssl.yml`
- `deploy/aws/` — AWS deployment configs (deprecated)
- `docker/README.md`
- `init-ssl.sh`

## Решения, принятые

- **Caddy вместо nginx:** Кардинально упрощает конфигурацию — auto-HTTPS из коробки, HTTP/3 по умолчанию, SPA routing в одну строку try_files. 881 строк nginx → 80 строк Caddyfile
- **Shared volume для frontend artifacts:** Frontend контейнер только собирает и кладёт артефакты в volume; nginx/Caddy контейнер монтирует volume и раздаёт файлы. Это позволяет избежать встроенного веб-сервера в frontend образе и упрощает деплой
- **dev + prod только:** Удалены staging.yml, dev-ssl.yml, ssl.yml (больше не нужны для 2-файловой стратегии). Также удалены deploy/aws/ и nginx/ полностью
- **HTTP/3 enabled:** UDP 443 mapping добавлен для QUIC поддержки (современный браузеры, lower latency)
- **Caddy SSL persistence:** caddy_data:/data named volume гарантирует что Let's Encrypt сертификаты сохраняются между рестартами контейнера

## Отклонения от плана

### Пользовательские расширения (одобрены)

**1. [User Request] Docker-compose consolidation + cleanup**
- **Найдено во время:** Task 2 (checkpoint verification)
- **Запрос:** Пользователь одобрил конфигурацию с дополнительной просьбой упростить docker-compose структуру
- **Выполнено:**
  - Переименованы: docker-compose.lite.prod.yml → docker-compose.prod.yml
  - Переименованы: docker-compose.lite.yml → docker-compose.dev.yml
  - Удалены: ssl.yml, staging.yml, dev-ssl.yml (больше не нужны)
  - Удалены: deploy/aws/ (AWS deployment deprecated)
  - Удалены: nginx/ (заменена на Caddy)
  - Удалены: docker/README.md, init-ssl.sh
  - Создан: Caddyfile.dev для localhost development
- **Файлы изменены:** deploy/deploy.sh, .claude/skills/deploy/SKILL.md, .claude/skills/tech-stack/SKILL.md
- **Верификация:** docker compose config валиден для prod и dev файлов
- **Комит:** `4d295e8`

---

**Всего расширений:** 1 (пользовательское расширение, одобренное на checkpoint)
**Влияние на план:** Расширение упрощает инфраструктуру — вместо 6+ docker-compose файлов остаются только 2 (prod + dev). Никакого scope creep — это часть инфра-рационализации, запрошенной пользователем.

## Обнаруженные проблемы

Нет — план выполнен как запланировано. Все отклонения — это одобренные пользователем расширения на checkpoint.

## Требуемая настройка

Нет — конфигурация Caddy полностью автоматическая. Let's Encrypt интеграция работает из коробки (email: admin@fancai.ru указан в Caddyfile).

## Готовность к следующей фазе

- **Готово:** Phase 4 (инфра мониторится) может начаться сейчас — Caddy и docker-compose структура стабильны
- **Блокеры:** Нет
- **Рекомендации:**
  - Phase 04-01 должна развернуть мониторинг (Netdata, Uptime Kuma, Dozzle) поверх этой упрощенной инфры
  - Rate limiting в Phase 03-03 может быть добавлено в Caddy handle blocks (reverse_proxy → request_body limits)

---

*Фаза: 03-migration-services*
*План: 04*
*Завершено: 2026-03-01*
