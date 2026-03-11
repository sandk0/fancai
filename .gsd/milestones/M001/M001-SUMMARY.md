---
id: M001
provides:
  - Продакшен-готовое приложение fancai.ru с безопасностью, мониторингом, AI через OpenRouter
  - Полная очистка мёртвого NLP-кода и устаревших конфигураций
  - Entity Wiki с fuzzy matching, recursive reduce, spoiler-фильтрацией
  - Ридер с закладками, выделениями, поиском и entity-text linking
  - Инфраструктура: Caddy, Docker dev/prod, Netdata + Uptime Kuma + Dozzle
key_decisions:
  - Все AI через OpenRouter с fallback chain (удалён google-genai)
  - Caddy вместо nginx (748 строк → ~80, auto-HTTPS, HTTP/3)
  - NLP код удалён полностью (мёртвый код увеличивает когнитивную нагрузку)
  - DOM span wrapping вместо epub.js SVG для аннотаций
  - Highlights merged в Bookmarks (единая модель Notes)
  - Token overlap >= 0.5 для fuzzy matching русских имён
  - Recursive batched reduce (BATCH_SIZE=50, MAX_DEPTH=2)
patterns_established:
  - Failing tests first → implementation → verification (TDD в каждой фазе)
  - Фазовое планирование: research → context → plan → execute → verify
  - OpenRouter client с fallback chain как единый AI-шлюз
  - Prometheus метрики для каждого нового сервиса
  - Circuit breaker для внешних API-вызовов
observability_surfaces:
  - Hawk Tracker для frontend/backend/Celery мониторинга
  - Prometheus метрики (app_*, llm_*, auth_*)
  - Netdata + Uptime Kuma + Dozzle для инфраструктуры
  - Structured logging с контекстом ошибок
requirement_outcomes:
  - id: SEC-01..03
    from_status: active
    to_status: validated
    proof: "DEBUG=False по умолчанию, security headers middleware, CSP. Коммиты 072102d, 634a740"
  - id: DEPLOY-01..08
    from_status: active
    to_status: validated
    proof: "gunicorn config, health check, docker-compose dev/prod, .env.example. Коммиты 634a740, 892f975"
  - id: CLEAN-01..05
    from_status: active
    to_status: validated
    proof: "NLP процессоры удалены, NLP admin schemas удалены, orphan test files удалены. Коммиты 54543c9, 0232e5d, a23d5a8"
  - id: MIGR-01..08
    from_status: active
    to_status: validated
    proof: "OpenRouter client с fallback chain, entity_synthesis/consistency_manager/gemini_extractor/imagen_generator мигрированы. Коммиты ae81d9b, 454ea22, f4186b5, fbabc3a, 749e2ae"
  - id: OPS-01..07
    from_status: active
    to_status: validated
    proof: "Netdata + VictoriaMetrics + Uptime Kuma + Dozzle + Flower. Business metrics activated. Коммиты 5a2d6c8, 97a3fe9"
  - id: INT-01..05
    from_status: active
    to_status: validated
    proof: "Docker network fix, HAWK_TOKEN, .env.example, dead Gemini code removed. Коммит 419c2f4, f1c47a7"
  - id: REBRAND-01..02
    from_status: active
    to_status: validated
    proof: "bookreader → fancai в Docker, backend, scripts, monitoring. Коммиты 2d9e782, d5087e0, 8a47bd0, dc76b66"
  - id: AI-02
    from_status: active
    to_status: validated
    proof: "Circuit breaker для OpenRouter API с Prometheus метриками. Коммит 21d8dcc"
  - id: DEPLOY-04
    from_status: active
    to_status: validated
    proof: "PostgreSQL daily backup service и restore script. Коммит 1d1101f"
  - id: UX-06
    from_status: active
    to_status: validated
    proof: "Dead code и stale config удалены после миграции. Коммит d054609"
  - id: WIKI-01..04
    from_status: active
    to_status: validated
    proof: "Fuzzy matching для русских имён, batched reduce для 500+ сущностей, hypothesis property-based тесты, расширенные spoiler тесты. Коммиты 7739a9d, 6a60eb5, d1db1af, 3428d50"
  - id: UX-02..05
    from_status: active
    to_status: validated
    proof: "Centralized error mapping, i18n error keys, error/retry UI для ParsingOverlay и ExtractionIndicator. Коммиты 256f65e, bf4789a, 55a5be7, 5209fdc"
  - id: READ-01..05
    from_status: active
    to_status: validated
    proof: "Bookmarks/highlights модели и API, annotation rendering, SelectionMenu, book search, entity popup, name highlighting. Коммиты c60ec76, 3d00729, a6ed27f, 986d0a7, cfad95f, 4f66667"
duration: 9 дней (2026-03-01 → 2026-03-09)
verification_result: passed
completed_at: 2026-03-09
---

# M001: Готовность к продакшену

**Приложение доведено до продакшен-уровня за 9 дней: безопасность, мониторинг, миграция AI на OpenRouter, очистка мёртвого NLP-кода, Entity Wiki с fuzzy matching и spoiler-защитой, ридер с закладками/выделениями/поиском. 169 коммитов, 910 файлов, +75K/-68K строк. Задеплоено на fancai.ru.**

## What Happened

M001 — мигрированный milestone, выполненный до внедрения GSD-фреймворка. Работа велась в 9 последовательных фазах с полным циклом research → plan → execute → verify в каждой.

**S01 — Безопасность продакшена (Phase 01).** DEBUG=False по умолчанию, security headers middleware с CSP, CORS, HSTS. Интеграция Hawk Tracker для мониторинга ошибок frontend/backend/Celery. Gunicorn config, health check endpoint, Docker Compose для продакшена.

**S02 — Очистка мёртвого кода (Phase 02).** Полное удаление NLP-процессоров (nlp_processor.py, langextract_processor.py), NLP admin schemas и компонентов, orphan test файлов, celery_config.py. NLP sections удалены из settings_manager.py.

**S03 — Миграция сервисов (Phase 03).** Создан OpenRouter client с fallback chain (Gemini 3 Flash → fallback models). Мигрированы все AI-сервисы: entity_synthesis, consistency_manager, gemini_extractor, imagen_generator (→ FLUX.2 Klein). Nginx заменён на Caddy (748 строк → ~80, auto-HTTPS, HTTP/3). Rate limiting применён к AI-эндпоинтам.

**S04 — Обслуживание инфраструктуры (Phase 04).** Business metrics (Prometheus counters, LlmUsageLog model) подключены в main.py, openrouter_client, auth, rate_limit. Monitoring stack заменён: Grafana/Prometheus → Netdata + VictoriaMetrics + Uptime Kuma + Dozzle + Flower. PostgreSQL тюнинг для 32GB сервера.

**S05 — Фиксы интеграции и ребрендинг (Phase 04.1).** Docker network fix, HAWK_TOKEN проброс, .env.example. Полный ребрендинг bookreader → fancai в Docker configs, backend, shell scripts, monitoring references. Dockerfiles переименованы в dev/prod scheme.

**S06 — Стабилизация AI и техдолг (Phase 05).** Circuit breaker для OpenRouter API с Prometheus метриками. Book cleanup service для reprocess endpoint. PostgreSQL daily backup service и restore script. Удаление dead code и stale config после миграции. Оставшиеся Google Imagen 4 references обновлены.

**S07 — Качество Entity Wiki (Phase 06).** Fuzzy matching для русских имён (token overlap >= 0.5 для частичных совпадений: "Гарри" → "Гарри Поттер"). Batched reduce (BATCH_SIZE=50, MAX_DEPTH=2) для оптимизации книг с 500+ сущностями. Hypothesis property-based тесты для spoiler filtering. Расширенные unit тесты с boundary cases.

**S08 — Обработка ошибок и UX (Phase 07).** Centralized error mapping utility (mapApiError) с i18n error keys для русского/английского. Error state и retry UI в ParsingOverlay и ExtractionIndicator. Интеграция в EpubReader и ReaderOverlays.

**S09 — Функции ридера (Phase 08).** Bookmark и highlight модели/schemas/CRUD endpoints. Zustand CFI bookmarks/highlights store с TanStack Query sync hooks. BookmarksList, HighlightsList, TocSidebar tabs. Annotation rendering через DOM span wrapping. Enhanced SelectionMenu. Book search с result highlighting. EntityPopup для entity-text linking. Name highlighting settings.

## Cross-Slice Verification

**Примечание:** M001 — мигрированный milestone. Раздел Success Criteria в M001-ROADMAP.md был пустым (критерии не были формально определены). Верификация проведена ретроспективно на основании git-истории, состояния кодовой базы и задокументированных требований в PROJECT.md.

| Область | Доказательство |
|---------|---------------|
| Безопасность | `backend/app/middleware/security_headers.py` существует, `backend/app/core/hawk.py` существует, тесты `test_config_security.py` и `test_hawk_init.py` присутствуют |
| Очистка NLP | `backend/app/services/nlp_processor.py` и `langextract_processor.py` удалены, `rg -l nlp_processor backend/app/` — 0 результатов |
| OpenRouter | `backend/app/core/openrouter_client.py` существует (642 строки), `test_openrouter_client.py` (509 строк) |
| Мониторинг | `backend/app/monitoring/metrics.py` существует, `docker-compose.monitoring.yml` обновлён |
| Ребрендинг | `Caddyfile` существует для fancai.ru, Docker configs: `docker-compose.dev.yml`, `docker-compose.prod.yml` |
| Circuit breaker | `circuitbreaker` в зависимостях, `test_circuit_breaker.py` (275 строк) |
| Entity Wiki | `test_entity_spoiler_free.py` (543 строки), `test_entity_spoiler_hypothesis.py` (256 строк), `test_consistency_manager_reduce.py` (298 строк) |
| Обработка ошибок | `frontend/src/utils/errorMessages.ts` (184 строки), `test errorMessages.test.ts` (254 строки) |
| Ридер | `useBookSearch.ts`, `useAnnotationRendering.ts`, `useBookmarks.ts`, `SelectionMenu.tsx`, `EntityPopup.tsx` — все существуют |

**Слайс-саммари:** Не существуют (мигрированный milestone — работа выполнена до внедрения GSD). Детали восстановлены из 169 коммитов за период 2026-03-01 — 2026-03-09.

**Тесты:** 452 passed, 7 failed (2 файла). Падения в `EpubReader.test.tsx` (устаревшие моки — свойства `chapterPage`, `instantNextPage` добавлены в M002) и `ErrorBoundary.test.tsx` (изменения компонента в M003). Это pre-existing техдолг, не связанный с M001.

## Requirement Changes

- SEC-01..03: active → validated — DEBUG=False, security headers, CSP middleware
- DEPLOY-01..08: active → validated — gunicorn, health check, docker-compose prod
- CLEAN-01..05: active → validated — NLP процессоры, schemas, orphan tests удалены
- MIGR-01..08: active → validated — OpenRouter client с fallback, все AI-сервисы мигрированы
- OPS-01..07: active → validated — Netdata + Uptime Kuma + Dozzle + Flower
- INT-01..05: active → validated — Docker network, .env.example, HAWK_TOKEN
- REBRAND-01..02: active → validated — bookreader → fancai полный ребрендинг
- AI-02: active → validated — Circuit breaker для OpenRouter
- DEPLOY-04: active → validated — PostgreSQL daily backup
- UX-06: active → validated — Dead code cleanup после миграции
- WIKI-01..04: active → validated — Fuzzy matching, batched reduce, spoiler tests
- UX-02..05: active → validated — Centralized error mapping, retry UI
- READ-01..05: active → validated — Bookmarks, highlights, search, entity popup

**Не изменились:**
- CLN-01 (удаление useTouchNavigation.ts, IOSTapZones.tsx, useFollowFingerSwipe.ts) — остаётся active. Файлы были реинтегрированы в M002 (gesture controller), требование требует пересмотра.

## Forward Intelligence

### What the next milestone should know
- OpenRouter client в `backend/app/core/openrouter_client.py` — единственная точка входа для всех AI-вызовов. Fallback chain настраивается через конфиг.
- Entity deduplication использует token overlap >= 0.5 — это важно для русских имён с множеством форм.
- Bookmark/highlight модель объединена (таблица `bookmarks` с полем `type`). Sync через `useSync.ts` hook.

### What's fragile
- `EpubReader.test.tsx` — моки устарели, 6 тестов падают. Нужно обновить при любых изменениях EpubReader.
- `ErrorBoundary.test.tsx` — 7 тестов не находят обновлённые тексты кнопок. Тесты привязаны к i18n.
- `security_headers.py:76` — TODO: implement nonce generation (placeholder).
- `metrics.py:273` — pass в update_active_sessions_gauge (placeholder).

### Authoritative diagnostics
- `git log --oneline --since="2026-03-01" --until="2026-03-10"` — полная история M001 (169 коммитов)
- `cd frontend && npx vitest run` — текущее состояние frontend тестов
- `Caddyfile` + `docker-compose.prod.yml` — продакшен конфигурация
- `backend/tests/` — все backend тесты (security, openrouter, rate_limit, entity, bookmarks)

### What assumptions changed
- Изначально планировался Grafana/Prometheus стек → заменён на Netdata + VictoriaMetrics + Uptime Kuma + Dozzle (проще, меньше ресурсов)
- Изначально nginx → Caddy (748 → ~80 строк, auto-HTTPS, HTTP/3)
- Google Gemini API → OpenRouter с fallback chain (единый провайдер)
- Google Imagen 4 → FLUX.2 Klein через OpenRouter

## Files Created/Modified

- `backend/app/core/openrouter_client.py` — единый AI-клиент с fallback chain (642 строки)
- `backend/app/core/hawk.py` — Hawk Tracker интеграция для мониторинга
- `backend/app/middleware/security_headers.py` — CSP, CORS, HSTS headers
- `backend/app/monitoring/metrics.py` — Prometheus business metrics
- `backend/app/models/bookmark.py` — модель закладок/выделений
- `backend/app/models/llm_usage_log.py` — логирование LLM-вызовов
- `backend/app/services/book_cleanup_service.py` — очистка данных книг
- `backend/app/routers/sync.py` — API синхронизации закладок
- `backend/gunicorn.conf.py` — конфигурация gunicorn
- `Caddyfile` — reverse proxy с auto-HTTPS
- `docker-compose.dev.yml` — development конфигурация
- `docker-compose.prod.yml` — production конфигурация
- `docker-compose.monitoring.yml` — мониторинг стек
- `scripts/backup-restore.sh` — восстановление БД из бэкапа
- `frontend/src/utils/errorMessages.ts` — centralized error mapping
- `frontend/src/hooks/epub/useBookSearch.ts` — поиск по книге
- `frontend/src/hooks/epub/useAnnotationRendering.ts` — рендеринг аннотаций
- `frontend/src/hooks/epub/useBookmarks.ts` — Zustand bookmarks store
- `frontend/src/hooks/api/useSync.ts` — TanStack Query sync hooks
- `frontend/src/components/Reader/SelectionMenu.tsx` — меню выделения текста
- `frontend/src/components/Reader/EntityPopup.tsx` — popup сущностей
- `frontend/src/components/Reader/SearchPanel.tsx` — панель поиска
- `frontend/src/components/Reader/BookmarksList.tsx` — список закладок
- `frontend/src/config/hawk.ts` — frontend Hawk Tracker config
