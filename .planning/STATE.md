---
state_version: 2
status: production-operational-needs-hardening
last_updated: "2026-07-18T01:28:00Z"
last_activity: 2026-07-18
deployed_commit: a1f899001b8ff23efd89dd68248ffd9cd36080b8
active_milestone: null
---

# Состояние проекта

## Коротко

fancai работает в production на <https://fancai.ru>. Последняя продуктовая поставка —
миграция AI с OpenRouter-primary на прямой Gemini API через Vertex AI, завершённая
2026-06-16 вне формального GSD-milestone. Новые feature-milestone не открыты.

Текущий приоритет — не admin panel и не новый AI pivot, а восстановление инженерных
гейтов: CI, зависимости, тестовый baseline, PWA-сборка и monitoring data path.

## Production snapshot — 2026-07-18

| Область | Фактическое состояние |
| --- | --- |
| Доступность | `https://fancai.ru/` → HTTP 200; `/api/v1/health/deep` → `healthy` |
| SSH | `deploy@fancai:2222` доступен; outage 2026-07-17 восстановлен soft reboot через Netcup console |
| Приложение | backend, Caddy, Postgres, Redis и Celery worker/beat containers запущены; worker подписан только на `normal` |
| Celery queues | `heavy=0`, `normal=0`, `light=7212`; `light` не имеет consumer, а `heavy` получит upload-задачи, но также не имеет consumer |
| Данные | Alembic `a1e2f3b4c5d6 (head)` и production `alembic_version` совпадают |
| Бэкапы | ежедневный custom-format PostgreSQL dump создаётся; dump за 2026-07-18 читается `pg_restore --list` |
| Код | production critical-file hashes совпадают с `main` на `a1f89900`; локальный worktree содержит незакоммиченные operational/progress правки |
| AI | `AI_PROVIDER=gemini`, Vertex global; live `USE_MODAL_PIPELINE=false`; extraction/synthesis/images идут через Gemini branches, consistency reduce всё ещё вызывает OpenRouter напрямую |
| Email | Yandex Cloud Postbox включён; реальная отправка password-reset подтверждена 2026-07-18 |

### Важный drift AI routing

June cutover мигрировал основной extraction/synthesis path на Gemini Direct, но provider
abstraction пока охватывает не весь pipeline:

- `GeminiDescriptionExtractor` и `EntitySynthesisService` используют `get_ai_provider()`.
- `ConsistencyManager._single_reduce_pass()` обходит factory: при выключенном Modal
  напрямую вызывает `get_openrouter_client()`.
- `image_tasks._generate_image_async()` при выключенном Modal доходит до
  `ImagenService`/`NanoBananaGenerator`, который напрямую использует `GeminiClient`.
- Live-проверка в Celery 2026-07-18 вернула `is_modal_enabled=False`; `USE_BATCH_MODE=false`.
  Modal SDK/credentials присутствуют, но production routing ими сейчас не активирован.

Следовательно, фактический production pipeline смешанный: Gemini для extraction,
synthesis и images, OpenRouter для consistency reduce. `AI_PROVIDER=openrouter` даёт
ручной text switch, но не полный text+image rollback. Последний image record —
`service_used=imagen`, 2026-06-22; свежего end-to-end canary нет.

## Проверенный quality baseline

### Frontend

- `npm run lint` — проходит.
- Vitest — **564 passed, 1 skipped** в 38 файлах.
- `npm run build` — завершается, но Workbox выдаёт
  `(0, brace_expansion_1.expand) is not a function`; precache содержит только 2 entries.
  Причина: глобальный npm override `brace-expansion@^2.0.2` несовместим с `glob@11`,
  который использует Workbox.
- `npm audit --omit=dev` — **10 production vulnerabilities: 7 high, 3 moderate**.

### Backend

- Gemini migration suite — **71 passed**, 1 warning об unawaited usage-log coroutine.
- Широкий локальный прогон — **672 passed, 16 skipped, 72 failed, 387 errors** из 1147.
  Большинство 387 errors вызваны отсутствующей test DB (`postgres` не резолвится вне
  Compose), но 72 failures и отдельный unit-прогон показывают реальный drift тестов.
- Изолированный unit-прогон provider/schema/consistency — **118 passed, 8 failed**:
  старые response expectations и OpenRouter mocks не соответствуют Gemini/Modal коду.
- Ruff — 3 unused imports. Black — 71 файл требует форматирования.
- `pip-audit` локального venv — 84 advisory matches в 20 пакетах; перед обновлением нужен
  повторный аудит воспроизводимого Python 3.12 lock/requirements окружения.

### CI

GitHub Actions для репозитория выключены (`actions/permissions.enabled=false`). Последний
run на `main` — 2025-11-13 и failed. После включения текущий workflow также потребует
исправления DB contract: CI создаёт `fancai_test`, а `tests/conftest.py` при пустом
`TEST_DATABASE_URL` выводит имя из `DATABASE_URL` и для `fancai_test` получает
`fancai_test_test`.

## Production gaps

1. **Celery queue orchestration сломан.** Единственный worker подписан только на `normal`,
   хотя `process_book_task` маршрутизируется в `heavy`, а beat-задачи — в `light`.
   На 2026-07-18 в `light` накопилось **7212** сообщений: 6532
   `close_abandoned_sessions`, 544 `cleanup_stuck_books`, 136
   `cleanup_expired_reset_tokens`. `heavy` сейчас пуст, но следующий upload зависнет.
2. **AI routing не единообразен.** Production Modal flag выключен, но
   `ConsistencyManager` всё равно обходит `AI_PROVIDER` и вызывает OpenRouter напрямую,
   тогда как extraction/synthesis/images используют Gemini branches.
3. **Monitoring data path сломан.** Netdata exporter пишет в `localhost:8428`, а
   VictoriaMetrics работает в другом контейнере. Ошибка повторяется каждые 10 секунд.
   Prometheus collector аналогично смотрит на `localhost:8000`, хотя Netdata не в host
   network. VictoriaMetrics health сам по себе отвечает `OK`, но данные Netdata туда не
   поступают.
4. **Следующий deploy небезопасен без фикса скриптов.** Сервер использует `/opt/fancai/app/.env`,
   а tracked scripts ожидали `.env.production`. Локальная правка на канонический `.env`
   сделана, но ещё не закоммичена и не доставлена на сервер.
5. **PWA precache нельзя выпускать в текущем виде.** Build не падает, поэтому дефект легко
   пропустить без отдельной проверки generated manifest.
6. **Security gate отсутствует.** Actions выключены, Dependabot/weekly scans фактически не
   исполняются, а production dependency audit уже красный.
7. **Документация отставала от June cutover.** Progress и AI architecture обновлены этим
   аудитом; README и часть inline docstrings/UI всё ещё содержат OpenRouter/Modal legacy.
8. **Инцидент VPS не имеет доказанной root cause.** Soft reboot восстановил сеть, но kernel
   продолжает логировать `ICMPv6: RA: ndisc_router_discovery failed to add default route`.
   Это отдельный infrastructure investigation, не причина, подтверждённая текущими данными.

## Приоритеты следующего цикла

### P0 — вернуть защитные гейты

1. Ротировать опубликованные Postbox credentials.
2. Восстановить Celery queue consumers: остановить beat, инвентаризировать и удалить только
   подтверждённый stale `light` backlog, затем назначить workers на `heavy/normal/light`.
3. Согласовать provider contract и убрать прямой OpenRouter reduce/legacy Modal selectors;
   до миграции держать подтверждённый `USE_MODAL_PIPELINE=false`.
4. Исправить CI DB contract и тестовый bootstrap; затем включить GitHub Actions.
5. Обновить уязвимые frontend/backend зависимости без forced major-upgrade EPUB renderer.
6. Получить воспроизводимый зелёный baseline: backend lint/format/tests + frontend lint/test/build.

### P1 — восстановить operational correctness

1. Исправить Netdata → VictoriaMetrics и Netdata → backend metrics networking/auth.
2. Исправить Workbox/`brace-expansion` override; требовать ненулевой полноценный precache.
3. Закоммитить и доставить canonical `.env` deploy-script fixes; выполнить dry-run/smoke.
4. Добавить runbook повторного VPS outage: Netcup console, soft reboot, SSH 2222,
   проверки route/DNS/firewall/Docker после восстановления.

### P2 — подтвердить продуктовый pipeline

1. После выравнивания routing прогнать один контролируемый EPUB end-to-end в production:
   upload → extraction → Entity Wiki → image → WebSocket/status, с cost/latency из
   `llm_usage_log`.
2. Только после стабильного baseline решить, нужен ли Gemini admin panel как следующий
   feature-milestone.

## История и источники

- Исторические milestones: [`.planning/MILESTONES.md`](MILESTONES.md)
- Дорожная карта: [`.planning/ROADMAP.md`](ROADMAP.md)
- AI architecture: [`docs/architecture/ai-pipeline.md`](../docs/architecture/ai-pipeline.md)
- Deployment: [`docs/deployment/README.md`](../docs/deployment/README.md)
- Детальный план baseline: [`docs/superpowers/plans/2026-07-18-production-reliability-baseline.md`](../docs/superpowers/plans/2026-07-18-production-reliability-baseline.md)
