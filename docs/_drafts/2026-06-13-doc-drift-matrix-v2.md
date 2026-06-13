# Drift Matrix v2: документация vs код (2026-06-13)

Артефакт Фаз 1–2 прохода v2. Ground-truth собран 5 параллельными Explore-агентами + верифицирован прямыми `ls`/`grep` (5 межагентских конфликтов разрешены).

**Источник истины:** код `backend/`/`frontend/`, манифесты, compose, Caddyfile. НЕ доки.

---

## 1. КАНОНИЧЕСКИЕ ФАКТЫ (проверено)

### 1.1. AI-пайплайн — РАЗРЕШЕНИЕ ГЛАВНОГО ПРОТИВОРЕЧИЯ

**Канон (вставлять в README/CLAUDE/architecture единообразно):**

> На 2026-06-13 весь AI-пайплайн идёт через **OpenRouter**. LLM-извлечение сущностей/описаний: `google/gemini-2.5-flash` (primary) → `google/gemini-2.5-flash-lite` (fallback). Генерация изображений: `black-forest-labs/flux.2-klein-4b`. Единственный обязательный ключ — `OPENROUTER_API_KEY`.

| Факт                                            | Значение                                                                                  | Источник                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| LLM primary/fallback                            | gemini-2.5-flash / -flash-lite                                                            | `backend/app/core/openrouter_client.py:58-59` |
| Image model                                     | flux.2-klein-4b                                                                           | `backend/app/core/config.py:60`               |
| Обязательный env                                | OPENROUTER_API_KEY                                                                        | `config.py:59`                                |
| `google-genai>=1.69.0`                          | **МЁРТВЫЙ КОД** — 0 импортов в проде, остаток неисполненного майского плана Gemini-Direct | `requirements.txt:30`                         |
| `GOOGLE_API_KEY`/`GEMINI_API_KEY`               | **НЕ используются**                                                                       | —                                             |
| Modal                                           | отключён `USE_MODAL_PIPELINE=False`                                                       | `feature_flag.py:170`                         |
| Batch API                                       | отключён `USE_BATCH_MODE=False`                                                           | `feature_flag.py:177`                         |
| Context/Prompt caching (Google)                 | **НЕ реализовано** (только в плане v2)                                                    | —                                             |
| LLM cache                                       | Redis literal cache                                                                       | `llm_cache_service.py`                        |
| Подтверждение: последняя миграция БД 2026-03-28 | Gemini-Direct/Modal в схему НЕ вошли                                                      | `alembic/versions/`                           |

⚠️ `requirements.txt:22,29-30` комментарии («Gemini 3.0 Flash», «Gemini direct API») вводят в заблуждение — но это правки **кода/комментариев**, вне scope docs-задачи (зафиксировать как рекомендацию).
✅ Корневой `CLAUDE.md:9` про модели **КОРРЕКТЕН** (gemini-2.5-flash) — правки не требует.

### 1.2. Стек (версии v1 всё ещё актуальны — перепроверено)

Python 3.12 · FastAPI 0.135.1 · PostgreSQL 17.9 (pgvector 0.8.2) · Redis 7.4.8 · Celery 5.6.2 · Node 22 · React 19 · TS 5.7 · Vite 8 · Tailwind 4.2 · Caddy 2.11.1. Источники: `requirements.txt`, `frontend/package.json`, `docker-compose.prod.yml`, `backend/Dockerfile.prod`.

### 1.3. Инфраструктура

- Домены: **fancai.ru** (+ www→301, monitor.fancai.ru, uptime.fancai.ru) — `Caddyfile`
- **Сервер НЕ мигрировал:** recon 2026-05-10 read-only; прод на старой инфре. `operations/migration/` = пакет аварийной готовности (НЕ исполненная миграция) ⇒ deployment-доки текущей инфры валидны.
- **Мониторинг (СМЕНА):** Netdata 2.9 + VictoriaMetrics 1.137 + Uptime-Kuma 2.2 + Dozzle 10.1 + Flower 2.0 + Hawk SDK 3.5.2 + prometheus-fastapi-instrumentator (`/metrics`). **НЕ Prometheus-server/Grafana/Loki** (`docker-compose.monitoring.yml`).
- Redis: один `REDIS_URL` (DB0) для cache+broker+results по дефолту кода (`config.py:39`, `celery_app.py:13-14`); prod может разделять через `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND` env.

### 1.4. Backend API

~25 роутеров (auth, books/, chapters, descriptions, images, push, reading_progress, reading_sessions, sync, websocket, health, admin/×10). 18 моделей. Celery очереди **heavy/normal/light** (`celery_app.py:46-52`). WebSocket прогресс через Redis PubSub. **admin/ — REST API, не web-панель** (план «Gemini Admin Panel» НЕ реализован). JWT (HS256, header+cookie), token blacklist (Redis), **CSRF disabled** (`main.py`, frontend не шлёт X-CSRF-Token). 54 миграции, последняя 2026-03-28 (error_type). Subscription: модель `SubscriptionPlan` FREE/PREMIUM/ULTIMATE есть, но **монетизация отложена** (`PROJECT.md:74`).

### 1.5. Frontend

`EpubReader.tsx` ~**910 строк** (НЕ 286!), декомпозирован; `hooks/epub/` 31 файл (25+ хуков). 3 стора Zustand (auth/reader/ui). API: axios `apiClient` + TanStack Query; прямой `fetch()` есть, но только в SW/PWA/offline (оправдано). PWA: `vite-plugin-pwa` injectManifest, `src/sw.ts` ~877 строк (Workbox), Dexie/IndexedDB кэш глав. Entity UI: `EntityBottomSheet` + `EntityDrawer`; **`EntityPopup.tsx` НЕ существует** (память устарела). Тесты: 38 unit (vitest, cov≥40%), 8 e2e (`frontend/tests/*.spec.ts`, Playwright).

### 1.6. Тесты/качество (реальные числа vs «35+/60+»)

| Тип                      | Реально                          | Команда                         | Cov                       |
| ------------------------ | -------------------------------- | ------------------------------- | ------------------------- |
| Backend unit/integration | **76 файлов** (`backend/tests/`) | `uv run python -m pytest`       | ≥70% (`pytest.ini`)       |
| Frontend unit            | **38**                           | `npm test` (vitest)             | ≥40% (`vitest.config.ts`) |
| Frontend e2e             | **8 spec**                       | `npm run test:e2e` (Playwright) | —                         |
| Property-based           | 1-2 (hypothesis, spoiler)        | в pytest                        | —                         |

pre-commit: Black 23.11/ruff 0.1.6/mypy 1.7.1 (`backend/.pre-commit-config.yaml`) — устарели vs прод. mypy `ignore_errors=True` (permissive). CI: `.github/workflows/ci.yml` 8 джобов.

---

## 2. ДРЕЙФ ПО ЖИВЫМ ДОКАМ (классификация)

| Док                                                                  | Статус                     | Дрейф / действие                                                                                                                                          |
| -------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` / `README-ru.md`                                         | ДРЕЙФ (мелкий)             | test counts (76/38/8), уточнить AI-пайплайн (google-genai=dead), мониторинг-стек. Версии стека ОК.                                                        |
| `CLAUDE.md` (root)                                                   | АКТУАЛЕН (AI-строка верна) | мелочь: «Known CC Bugs» v2.1.68 — проверить                                                                                                               |
| `CHANGELOG.md`                                                       | ДРЕЙФ                      | добавить Unreleased: GSD removed, migration-readiness package, Gemini-Direct evaluated+deferred. Чистить упоминания Grafana/Loki/Imagen если как активные |
| `backend/CLAUDE.md`, `frontend/CLAUDE.md`                            | ДРЕЙФ                      | LOC/counts/Vite-версия (frontend CLAUDE говорит Vite 7), test-цифры                                                                                       |
| `AGENTS.md`, `GEMINI.md`                                             | ПРОВЕРИТЬ                  | dead GSD/Modal/NLP-ссылки (попали в stale-грепы)                                                                                                          |
| `docs/README.md`                                                     | ДРЕЙФ (крупный)            | `/gsd:plan-phase` мёртв; **ложь про «пустые placeholder» guides/reference/explanations**; дата 2026-04-30; ссылка на v1 \_drafts                          |
| `docs/deployment/MONITORING_SETUP.md`, `LOGGING_SETUP.md`            | ДРЕЙФ (вероятно)           | старый стек Prometheus/Grafana/Loki → Netdata/VictoriaMetrics                                                                                             |
| `docs/deployment/PRODUCTION_INFRASTRUCTURE.md`                       | ПРОВЕРИТЬ                  | секция мониторинга, домены                                                                                                                                |
| `docs/operations/nlp-canary-deployment-runbook.md`                   | УСТАРЕЛ→archive            | NLP удалён дек.2025                                                                                                                                       |
| `docs/operations/VLESS_*`                                            | держим (proxy)             | актуальность proxy-доков                                                                                                                                  |
| `docs/{guides,reference,explanations}/` вложенное (133 файла 2025)   | УСТАРЕЛ→archive            | главный долг — см. §3 плана                                                                                                                               |
| `docs/development/<nested>` (changelog/planning/status/...)          | УСТАРЕЛ→archive            | историческое 2025                                                                                                                                         |
| `docs/ru/<deep tree>`                                                | УСТАРЕЛ→archive/слить      | двойная бухгалтерия                                                                                                                                       |
| `docs/security/README.md`, `docs/SECURITY.md`, `backend/SECURITY.md` | свериться                  | дублирование политик; grafana-упоминания                                                                                                                  |

## 3. Untracked → триаж

migration/ (держим+индекс в operations/README), gemini research-кластер (канонический +archive остальных), status-recap (reports/), gemini-prompts (prompts/).

## 4. Рекомендации вне scope docs (в финальный отчёт)

- `requirements.txt:22,29-30` комментарии + удаление `google-genai` (мёртвый код)
- `.pre-commit-config.yaml` устарел
- settings.json SubagentStart hook утверждает «Redis DB0/1/2» — код по дефолту один DB
- отсутствует `backend/pyproject.toml` (установка через requirements.txt)

_Артефакт Фаз 1-2. Ground-truth со ссылками file:line._
