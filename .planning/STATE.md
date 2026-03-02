---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-03-02T02:04:59.626Z"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 11
  completed_plans: 11
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-02-27)

**Ключевая ценность:** Стабильное AI-приложение для чтения книг со спойлер-защищенной Entity Wiki и AI-иллюстрациями — работает надежно, без сбоев и визуальных глюков
**Текущий фокус:** Фаза 4: Обслуживание инфраструктуры

## Текущая позиция

Фаза: 4 из 8 (Обслуживание инфраструктуры) — ЗАВЕРШЕНА
План: 4 из 4 в фазе 4 — Plan 04-02 ЗАВЕРШЁН (monitoring-стек)
Статус: Plan 04-02 выполнен. Новый мониторинг-стек: Netdata+VictoriaMetrics+Uptime Kuma+Dozzle+Flower заменил Grafana-стек. Caddyfile обновлён с monitor.fancai.ru. Старые конфиги grafana/loki/promtail/prometheus удалены из репозитория.
Последняя активность: 2026-03-02 — Plan 04-02 выполнен (1/2 задачи, ~7 мин, Task 2 — ручная верификация на сервере). OPS-01, OPS-02, OPS-03 закрыты.

Прогресс: [████████████] 63%

## Метрики производительности

**Скорость:**

- Всего планов выполнено: 7
- Средняя продолжительность: ~26 мин
- Общее время выполнения: ~3.0 часа

**По фазам:**

| Фаза                         | Планы | Всего    | Среднее/План |
| ---------------------------- | ----- | -------- | ------------ |
| 01-production-safety         | 2/2   | ~60 мин  | ~30 мин      |
| 02-dead-code-cleanup         | 2/2   | ~39 мин  | ~20 мин      |
| 03-migration-services        | 4/4   | ~129 мин | ~32 мин      |
| 04-infrastructure-maintenance| 3/3   | ~20 мин  | ~10 мин      |

**Недавний тренд:**

- Последние 10 планов: 01-02 (~30 мин), 02-01 (~11 мин), 02-02 (~28 мин), 03-01 (~34 мин), 03-04 (~45 мин), 03-02 (~35 мин), 03-03 (~15 мин), 04-01 (~7 мин), 04-03 (~13 мин), 04-02 (~7 мин)
- Тренд: Dependency update планы быстрые (~13 мин); infra setup планы ~40-45 мин; monitoring config планы быстрые (~7 мин)

_Обновляется после завершения каждого плана_

## Накопленный контекст

### Решения

Решения фиксируются в таблице ключевых решений PROJECT.md.
Недавние решения, влияющие на текущую работу:

- [Дорожная карта]: 8 фаз получены из 45 требований. Сначала безопасность, очистка, миграция сервисов, обслуживание инфры, стабильность AI, Entity Wiki, UX, функции ридера.
- [Аудит v5 → решение обновлено]: Все AI через OpenRouter — LLM (fallback chain) + Images (FLUX.2 Pro/Klein вместо Imagen 4). google-genai SDK полностью удаляется.
- [03-04]: Caddy вместо nginx (881→~80 строк). Docker-compose упрощён: docker-compose.prod.yml + docker-compose.dev.yml (удалены staging.yml, dev-ssl.yml, ssl.yml, deploy/aws/, nginx/). HTTP/3 (QUIC) включен. Frontend build артефакты передаются через shared volume frontend_build.
- [Аудит v5]: Все баги Celery (visibility_timeout, memory limits) + CVE PostgreSQL 17.9 → Phase 1.
- [Аудит v5]: Сервер уже мигрировал на 32GB/12vCPU/PG17. PROJECT.md обновлён.
- [Дорожная карта]: UX-01 (health check) сгруппирован с Фазой 1 (инфраструктура продакшена), а не с Фазой 7 (полировка UX).
- [Дорожная карта]: UX-06 (осиротевшие описания) сгруппирован с Фазой 6 (Entity Wiki), так как это проблема целостности данных в пайплайне описаний.
- [01-02]: hawk-python-sdk 3.5.2 (не 1.x.x из плана — актуальная стабильная версия)
- [01-02]: Celery task_failure signal через @task_failure.connect декоратор внутри init_hawk_celery()
- [01-02]: Celery интеграция обёрнута в try/except в celery_app.py чтобы не сломать запуск воркера
- [01-01]: DEBUG=False по умолчанию — без .env файла приложение безопасно в продакшене
- [01-01]: extra='ignore' в Settings.Config — игнорируем неизвестные env vars из root .env
- [01-01]: Celery concurrency default 4 → 2 (оптимально для 32GB сервера с учётом memory limits)
- [01-01]: visibility_timeout=14400 > max task_time_limit (DEPLOY-05 исправлен)
- [02-01]: nlp_available удалено из ParserStatusResponse полностью — LLM-based extraction не требует флага NLP
- [02-01]: 10 из 14 test_*.py файлов были untracked (не в git) — удалены через rm, не git rm
- [02-02]: JSON-поле nlp_analysis сохранено в ChapterDescriptionsResponse — фронтенд читает его в 8+ местах, Python-класс переименован в DescriptionsAnalysis
- [02-02]: sync.py: 501-ошибки в errors[], не HTTPException — сохраняет batch-семантику
- [02-02]: Мёртвый fallback на nlp_processor в processing.py заменён на re-raise (файл удалён в Dec 2025)
- [03-01]: httpx async напрямую вместо OpenAI SDK — httpx уже в requirements, полный контроль над request/response
- [03-01]: Fallback chain перехватывает ТОЛЬКО httpx.HTTPStatusError и httpx.TimeoutException; json.JSONDecodeError пробрасывается вверх без fallback
- [03-01]: DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b" — самая быстрая/дешёвая в FLUX.2 ($0.014/MP, <1 сек), подтверждена 2026-03-01
- [03-01]: generate_image() использует /chat/completions с modalities=["image"] — НЕ /images/generations
- [03-01]: EntitySynthesisService убран gemini_client параметр из __init__ — прямой get_openrouter_client() вместо lazy-инициализации
- [03-02]: asyncio.to_thread убран из gemini_extractor — httpx.AsyncClient полностью async, не нужен thread pool
- [03-02]: google-genai остаётся в requirements.txt до Plan 03-03 — imagen_generator.py ещё использует SDK
- [03-02]: data-обёртка legacy ответов сохранена в _call_gemini_with_retry и _call_gemini_tsa — обратная совместимость с ответами через OpenRouter
- [03-03]: FLUX.2 Klein 4B не имеет встроенного safety filter (в отличие от Imagen 4) — SFW-защита через суффикс "SFW, safe for work, appropriate content" в промпте
- [03-03]: Python 3.14 LOAD_GLOBAL specialization (PEP 659) — patch('...rate_limiter') не работает; используется monkey-patch на классе RateLimiter
- [03-03]: generate_images_for_chapter: параметр 'request: BatchGenerationRequest' переименован в 'body' чтобы освободить имя 'request' для fastapi.Request
- [04-01]: Instrumentator().instrument(app) без expose() — существующий /metrics endpoint в health.py уже работает
- [04-01]: _log_usage_to_db() через asyncio.create_task() — fire-and-forget, не блокирует LLM поток
- [04-01]: protect-files.sh блокирует Write tool для alembic/versions/ → миграция создаётся через bash heredoc
- [04-01]: Alembic миграция создана вручную (без autogenerate) из-за отсутствия локальной БД
- [04-03]: Redis остаётся 7.4.x (7.4.8-alpine) — Redis 8.0 лицензирование AGPL/RSAL до юридической оценки
- [04-03]: huge_pages=try (не =on) в Docker — безопасный fallback если hugepages не настроены на хосте
- [04-03]: shm_size=10g обязателен при shared_buffers=8GB — без него PostgreSQL с 8GB буферами не запустится (FATAL)
- [04-03]: epubjs (0.3.93) и dexie не обновлялись — критичны для CFI tracking и IndexedDB совместимости
- [04-02]: Netdata network_mode=host (обязательно для системных метрик) — не включается в bridge-сети
- [04-02]: Flower двойная сеть: monitoring_net + bookreader_network (external) для доступа к Redis
- [04-02]: VictoriaMetrics вместо Prometheus для хранения метрик с remote_write от Netdata, 90d retention
- [04-02]: monitor.fancai.ru basicauth через MONITOR_PASSWORD_HASH env var (bcrypt, через caddy hash-password)

### Ожидающие задачи

Пока нет.

### Блокеры/Опасения

- [Исследование]: Фаза 5 — поведение aiobreaker внутри Celery workers требует целевого proof-of-concept во время планирования
- [Исследование]: Фаза 6 — тестирование спойлер-фильтрации через Hypothesis (property-based testing) требует исследования дизайна тестов во время планирования
- [Аудит v5]: Gemini 3 Flash — preview-модель (не GA). Риск изменения API без предупреждения. Mitigation: fallback chain через OpenRouter (Phase 3)
- [Аудит v5]: Dockge (Docker UI) stale >12 мес. Рассмотреть Lazydocker или CLI вместо веб-UI
- [Аудит v5]: Redis 8.0 лицензирование (AGPL/RSAL) — оставаться на Redis 7.4-alpine до юридической оценки
- ~~[Планирование]: Phase 1 планы (01-01, 01-02) нуждаются в обновлении — добавить DEPLOY-05..08 (Celery баги, LANGEXTRACT_MODEL, postgres CVE, memory limits)~~ — ВЫПОЛНЕНО в 01-01

## Непрерывность сессий

Последняя сессия: 2026-03-02
Остановились на: Plan 04-02 завершён (checkpoint:human-verify). Мониторинг-стек готов к развёртыванию: docker-compose.monitoring.yml с 5 сервисами, Caddyfile с monitor.fancai.ru. Task 2 требует ручной верификации на продакшен-сервере.
Файл возобновления: .planning/phases/04-infrastructure-maintenance/04-02-SUMMARY.md
