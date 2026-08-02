# Changelog

Все значимые изменения проекта документируются здесь. Формат основан на
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), версионирование —
по milestone'ам (v1.0, v1.1, …) — см. также `.planning/MILESTONES.md`.

Источники: `.planning/MILESTONES.md`, `.planning/ROADMAP.md`, история коммитов.

## [Unreleased]

### Removed

- **GLiNER2 / локальный NER удалён целиком** (2026-08-03, решение S4): `ner_service.py`
  (497 строк), восемь точек в `book_tasks.py`, модель `ChapterEmbedding`,
  `scripts/export_ner_ab_data.py`, метрики `ner_*`, 958 строк тестов и extra `nlp`
  (`torch` + `gliner2`) из `pyproject.toml`/`uv.lock`. Миграция `d4a5b6c7e8f9`
  удаляет пустую таблицу `chapter_embeddings` и флаг `USE_GLINER_NER`; расширение
  `vector` и колонки `extraction_source`/`pipeline_version` остаются на месте.
  Celery-образ **1,52 GB → 475 MB**; вместе с `torch` ушла незакрываемая находка
  `setuptools 81.0.0` (PYSEC-2026-3447) — `pip-audit` теперь гейтит весь
  заблокированный набор и чист.
- **`aiohttp` из прямых зависимостей** (2026-08-03): ноль импортов в `app/`; пакет
  по-прежнему приезжает транзитивно через `pywebpush` и `aiobotocore`.

- **Modal-пайплайн удалён целиком** (2026-08-01): SDK, env, ветки в `book_tasks.py`,
  `image_tasks.py` и `ConsistencyManager`, feature-флаги `USE_MODAL_PIPELINE` и
  `USE_BATCH_MODE`. Миграция `c7d8e9f0a1b2` удаляет флаги из развёрнутых БД
  (`FeatureFlagManager.initialize()` умеет только добавлять) и переписывает
  `chapters.error_type='modal_error'` → `'provider_error'`.
- **Неиспользуемые зависимости** (2026-08-01): бэкенд — `pillow` (−26 advisory), `ecdsa`
  (−2), `python-decouple`, `python-dateutil`, `sentence-transformers`, `scikit-learn`,
  дубль `pgvector` в `Dockerfile.celery`; фронтенд — `dompurify`, `@types/dompurify`,
  `i18next-http-backend`; корневой блок `devDependencies` вместе с корневым
  `package-lock.json`. Celery-образ 2.36 GB → 2.06 GB.
- **Вредный `overrides.brace-expansion`** (2026-08-01): ломал API `glob@11`, из-за чего
  Workbox писал 2 пустых precache-entry вместо 45 реальных (2255 KiB).
- **Ключ `GEMINI_LITE_MODEL`** (2026-08-01): за всё время не получил ни одного
  потребителя в коде; удалён до отдельного решения по tiering'у.
- **Deprecated `temperature`** (2026-08-01): убран из протокола `AIProvider`, из
  `GeminiClient` и из всех вызовов. В Gemini 3.x параметр игнорируется, в следующих
  поколениях даёт HTTP 400. В `OpenRouterClient` знак остался опциональным
  (`None` — не передавать), поскольку клиент общий для произвольных моделей.

- **GSD toolchain полностью удалён из репозитория** (2026-06-13) — команды `/gsd:*`,
  субагенты, движок `get-shit-done/`, хуки и statusline вырезаны из `.claude/`,
  `.opencode/`, `.codex/` и user-level. `.planning/` сохранён как read-only архив.
- (v1, 2026-04-30) Упоминания `GOOGLE_API_KEY`, Imagen 4, Gemini 3.0 Flash, Subscription
  tiers, NLP-системы и React Native в публичной документации.

### Changed

- **TypeScript 5.9.3 → 6.0.3** (2026-08-03, решение S5): в диапазон
  `typescript-eslint` (`>=4.8.4 <6.1.0`) шестёрка входит, семёрка — нет, поэтому
  TS 7 остаётся HOLD. `baseUrl` объявлен deprecated в TS 6 и перестанет работать
  в 7 — убран из обоих tsconfig'ов, `paths` записаны от каталога конфига.
- **Прод-сборка фронта стала строгой** (2026-08-03, C2): в `tsconfig-build.json`
  включены `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`. Раньше всё было выключено, и `npm run build`
  пропускал ошибки, которые редакторский конфиг показывал. Правок кода
  не потребовалось: 22 ошибки `tsc` живут в `__tests__`, а те исключены из сборки.
- **`@xmldom/xmldom` 0.7.13 → 0.9.10 через `overrides`** (2026-08-03, решение S5):
  единственный путь — транзитивно через `epubjs`. `npm audit` 6 → 4 находки,
  high 5 → 3 (ушли `@xmldom/xmldom` и `epubjs`; остались `lodash` через тот же
  `epubjs` и пара `react-router`/`react-router-dom`). Чанк `ReaderPage` вырос
  на 9,7 КБ: в браузере epub.js берёт нативные `DOMParser`/`XMLSerializer`,
  и xmldom попадает в бандл, но не исполняется.
- **Обновление стека, Волны 1–5** (2026-08-01). Backend: fastapi 0.141.1 +
  prometheus-fastapi-instrumentator 8.1.0 (атомарная группа), пакеты безопасности, сервер,
  ORM, наблюдаемость, стабы; ruff 0.16 расширил набор правил по умолчанию — прежний набор
  E4/E7/E9/F зафиксирован явно в `backend/ruff.toml`. Frontend: миноры плюс мажоры
  eslint 10.8.0, i18next 26.3.6 + react-i18next 17.0.11, jsdom 30.0.1, jest-dom 7.0.0,
  `@types/node` 26.1.2, lucide-react 1.28.0. Образы: caddy 2.11.4, redis 7.4.10,
  pgvector 0.8.6-pg17, netdata v2.10.4, victoria-metrics v1.148.0, uptime-kuma 2.4.0,
  dozzle v10.6.14, Node 24 и alpine 3.23 во фронт-образах, OCI-метки во всех пяти
  Dockerfile и build-args во всех восьми build-блоках compose.
- `docs/architecture/ai-pipeline.md` приведён к коду после удаления Modal: развилки по
  feature-флагам, legacy image route и раздел «Modal» заменены фактическим маршрутом.
- **Волна 6 — переключение AI-моделей** (2026-08-01). Извлечение, synthesis,
  дедупликация и перевод переведены с `gemini-3.5-flash` на **`gemini-3.6-flash`**
  (2026-07-21 GA): тот же вход $1.50, выход $7.50 вместо $9.00 — около −15 % на книгу.
  `PRICING` в `gemini_pricing.py` дополнен `gemini-3.6-flash` и `gemini-3.5-flash-lite`
  тем же коммитом: без этого `compute_cost` вернул бы `0.0` и учёт расходов молча
  обнулился бы. `GeminiConfig` больше не хардкодит модель, а читает
  `settings.GEMINI_EXTRACTION_MODEL` — иначе имя старой модели осталось бы в ключе
  LLM-кэша и в метках метрик. Дефолты кода приведены к боевой конфигурации:
  `AI_PROVIDER="gemini"`, `GEMINI_BACKEND="vertex"`. `FALLBACK_MODELS` OpenRouter
  переведены с 2.5-семейства (выключается **2026-10-16**) на
  `google/gemini-3.6-flash` + `google/gemini-3.5-flash-lite`, а `OPENROUTER_IMAGE_MODEL`
  — с несуществующего в каталоге OpenRouter `black-forest-labs/flux.2-klein-4b` на
  `google/gemini-3.1-flash-image`. Проверено вживую на локальном стеке через Vertex
  (`GCP_LOCATION=global`): извлечение по реальной главе, генерация изображения
  и записи в `llm_usage_log` с ненулевым `cost_dollars`.

- **Production/code/documentation audit** (2026-07-18): progress state reconciled with
  deployed commit `a1f89900`; Gemini/Vertex architecture documented; CI disabled state,
  missing Celery `heavy`/`light` consumers with 7212-message backlog, mixed provider
  routing, Workbox precache failure, Netdata data-path failure and dependency/test debt
  recorded. Added executable Production Reliability Baseline plan.

- **Модернизация документации, проход v2** (2026-06-13): зафиксировала фактический на тот
  момент OpenRouter pipeline и monitoring topology. AI-раздел этого snapshot superseded
  2026-07-18 после Gemini/Vertex cutover; архивная ценность документационного прохода
  сохраняется.
- (v1, 2026-04-30) Документация под актуальный стек (Python 3.12, FastAPI 0.135.1, PG17,
  Vite 8, Tailwind 4, OpenRouter — gemini-2.5-flash + flux.2-klein-4b); README/-ru/CONTRIBUTING
  переписаны, Entity Wiki поднят как первая фича.

### Fixed

- **Откат non-critical пост-фазы ломал обработку книги тремя способами**
  (2026-08-03). `rollback()` экспайрит все ORM-объекты сессии, а пост-фазы
  `_process_book_async` объявлены необязательными: их отказ логируется
  и выполнение продолжается на той же сессии.
  1. **Финализация падала `MissingGreenlet`** — `graph_service.calculate_pagerank()`
     при исключении делает `await self.db.rollback()`, а он срабатывает на любой
     книге хотя бы с одной сущностью: `nx.pagerank` требует отсутствующий `scipy`.
     После этого обращение к `book.id` в `_finalize_book_status()` уходило
     в синхронный lazy-load. Книга оставалась с `is_processing=true`,
     celery-задача завершалась ошибкой. Теперь книга перечитывается
     через `db.get()` перед финализацией.
  2. **Synthesis молча пропускался** — он читал `book.genre`/`book.language`
     до этого перечитывания и после отката reduce-фазы падал тем же
     `MissingGreenlet`, не доходя даже до AI-вызова; в лог при этом попадало
     безобидное «synthesis phase failed (non-critical)». Скаляры снимаются
     один раз до пост-фаз.
  3. **Упавший auto-merge оставлял сессию в failed-состоянии** —
     `_merge_entities_internal` вызывается из таска мимо HTTP-обёртки
     `merge_entities` и своего отката не делает, поэтому ошибка БД внутри merge
     роняла все последующие фазы `InFailedSQLTransactionError`. Добавлен
     `rollback()` в обработчик.

  Дефекты воспроизведены и на коде до удаления GLiNER. Регрессию ловят три
  режима `scripts/smoke_llm_book_pipeline.py` (`stubbed`, `failing`,
  `merge_failure`); каждый проверен мутацией — откат соответствующей правки
  красит именно его.

- **Все иллюстрации генерировались не в том соотношении сторон** (2026-08-01):
  `GeminiClient.generate_image()` принимал `aspect_ratio` и `image_size`, но собирал
  `GenerateContentConfig` только с `response_modalities`, а `types.ImageConfig`
  не передавал. Продовый путь (`ImagenService` → `NanoBananaGenerator`) запрашивает
  `4:3`/`1K` — модель молча отдавала дефолтные 16:9. Дополнительно ломался учёт:
  `compute_image_cost(model, image_size)` берёт **запрошенный** размер, поэтому при
  любом не-дефолтном `image_size` в `llm_usage_log` попадала цена не того разрешения.
  Проверено вживую: `4:3` → 1200×896, `16:9` → 1376×768, `1:1` + `2K` → 2048×2048.

- **Потеря файла при перегенерации изображения** (2026-08-01):
  `ImageCRUDService.update_after_regeneration()` удалял старый файл **до** коммита.
  На cache hit `ImagenService` отдаёт `image_url` в виде `data:image/png;base64,…`
  и `local_path=None`, а колонка — `VARCHAR(2000)`: коммит падал, rollback возвращал
  прежний путь в БД, но файла по нему уже не было. Триггер не экзотический — ключ
  кэша не учитывает `custom_style`, поэтому «перегенерировать с другим стилем»
  гарантированно попадает в кэш. Удаление файла перенесено за успешный коммит;
  то же сделано в `delete_with_file()`.
- **Учёт расходов терялся в Celery-тасках** (2026-08-01): оба клиента писали
  `llm_usage_log` через `asyncio.create_task()`, а таски выполняются через
  `run_async()` → `asyncio.run()`, который на выходе отменяет незавершённые задачи.
  На коротких путях (генерация изображения) запись не успевала выполниться и
  пропадала. Заменено на `await` во всех пяти call sites обоих клиентов; ошибки
  по-прежнему проглатываются, поэтому учёт не может уронить основной вызов.

- **Метрики Prometheus исчезали молча** (2026-08-01): starlette ≥ 1.0 запрещает
  `add_middleware` после старта, а `Instrumentator().instrument(app)` жил в lifespan и падал
  с `RuntimeError` внутри `try/except`. Вызов перенесён на уровень модуля, глушитель убран.
- **`NameError` на продовом пути push-уведомлений** (2026-08-01): в `image_tasks.py`
  `Chapter` и `push_notification_service` импортировались только внутри Modal-ветки, а
  использовались вне её; ошибку проглатывал `except Exception` — push молча не отправлялся.
- **dev-Postgres не мог принять миграции** (2026-08-01): `CREATE EXTENSION vector` падал на
  голом образе, dev переведён на `pgvector/pgvector:0.8.6-pg17` (та же версия СУБД 17.10).
- **Healthcheck celery в dev был копией бэкендового** (`curl localhost:8000`) — HTTP-сервера
  в этих контейнерах нет, оба всегда висели unhealthy.

### Security

- **Обновление стека, Волна 0 и следствия Волн 1–2** (2026-08-01): `pip-audit` бэкенда
  80 advisory в 11 пакетах из 134 → **0 в 0 из 116**; `npm audit` фронтенда 24 (17 high) → 6
  (5 high); корневое дерево зависимостей удалено вместе с его 4 high. Группа
  fastapi + instrumentator подняла starlette 0.52.1 → 1.3.1 и закрыла 5 CVE. Плавающие ссылки
  экшенов `trivy-action@master` и `trufflehog@main` запинены на `v0.36.0` и `v3.96.0`,
  рантаймы `security.yml` выровнены с CI (Python 3.12, Node 22).

### Added

- **Пакет аварийной готовности / миграции сервера** (`docs/operations/migration/`, 2026-05-10):
  recon-отчёт, план, inventory, runbook (RTO ≤ 4ч). Страховка; миграция не исполнялась.
- `docs/architecture/` — `ai-pipeline.md` (каноническое описание AI) + `overview.md` (обзор системы).

### Archived

- **Проход v2** (2026-06-13): ~133 исторических документа 2025 года из nested Diataxis-секций
  (`guides/`, `reference/`, `explanations/`, `development/`, `ru/`) + 11 аспирационных
  infra-доков октября 2025 → `docs/_archive/`.
- (v1, 2026-04-30) 21 документ октябрь–ноябрь 2025 + три аудита марта 2026.

---

## [v1.6] Gemini Direct + Vertex AI — 2026-06-16

Прямой `google-genai` provider добавлен и включён в production через Vertex AI global.
Работа выполнена вне формальных GSD-фаз после документационного snapshot 2026-06-13.

### Added

- `AIProvider` protocol и factory `AI_PROVIDER=gemini|openrouter`
- Async `GeminiClient` для text, structured output и image generation
- Backend modes `GEMINI_BACKEND=developer|vertex`
- Vertex ADC config: `GCP_PROJECT`, `GCP_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`
- Gemini pricing/cost attribution в `llm_usage_log`
- Production models `gemini-3.5-flash` и `gemini-3.1-flash-image`

### Changed

- Production env переключён на `AI_PROVIDER=gemini`, `GEMINI_BACKEND=vertex`,
  `GCP_LOCATION=global`
- Extraction и factory-based synthesis переведены на Gemini Direct
- Image branch через `NanoBananaGenerator` переведена на Gemini image model

### Known gaps

- `ConsistencyManager` при live `USE_MODAL_PIPELINE=false` напрямую использует OpenRouter
  для reduce и обходит provider factory
- Image generator напрямую получает Gemini client; `AI_PROVIDER=openrouter` не является
  полным text+image rollback
- Legacy Modal code/credentials сохранены, но production flags `USE_MODAL_PIPELINE` и
  `USE_BATCH_MODE` выключены
- После cutover не зафиксирован свежий full EPUB end-to-end canary

---

## [v1.5] Modal Batch Processing & Production Stability — 2026-03-29 — CLOSED-PARTIAL

Стабилизация Modal pipeline (vLLM Qwen3.5-9B на L40S GPU). Phases 35–36 в
продакшне; Phase 37 (sub-batch) abandoned после провала staging — реальный
batch занял 40+ минут вместо ожидаемых 7–8. Phase 38 отменена. После закрытия
milestone — стратегический разворот на оптимизацию OpenRouter pipeline.

### Added

- Структурированные per-chapter логи (9 полей: `chapter_id`, `duration_ms`,
  `result_type`, `error_type`, `finish_reason`, метрики cold start / inference)
- `ErrorClassifier` с 5 типами ошибок (timeout, json_error, modal_error,
  truncated, cancelled) — основа для retry-стратегий
- VPS-side timeout (`VPS_TIMEOUT=960`) и time budget check для Celery-задач
- Reconciliation endpoint `POST /admin/reconcile-statuses` для книг с
  inconsistent статусами
- `Chapter.error_type` (Alembic-миграция `2026_03_28_0001_add_error_type_to_chapters`)
- max_length constraints на все строковые поля Modal Pydantic-схем
- Status `completed_with_errors` для книг с частично сбойными главами
- Modal compile cache volume в `/root/.inductor-cache`

### Changed

- `LLM_TIMEOUT` поднят до 900s (Phase 35) и до 1800s для batch (Phase 37)
- `num_gpu_blocks_override=512` для Qwen3.5 KV-cache
- `max_tokens=16384` в `reduce_entities` (8192 truncated JSON для длинных глав)
- Modal upgrade на L40S (48GB) для full 65K context
- `finish_reason` проверка ДО `json.loads()` — предотвращает JSONDecodeError
  на truncated output

### Fixed

- Push notification `send_book_ready_notification` больше не отправляется при
  `completed_with_errors`
- `logger.opt()` заменён на `exc_info=True` в stdlib-logging файлах
- Modal SDK 1.4.0 совместимость: `.env()` перед `.add_local_dir()`
- `image_prompt_en` персистится из Modal вместе с image

### Abandoned

- Phase 37 Plan 02 (VPS-side batch orchestration) — Modal staging failed
- Phase 38 (auto-fallback Modal → OpenRouter) — отменена вместе с pivot

### Pivot (2026-03-29..30, вне формальных фаз)

- Primary LLM переключён на Gemini 3.1 Flash Lite (`-75%` input cost vs Gemini 3.0 Flash)
- A/B-тест Qwen3.5-397B на русской extraction — Qwen откатан, победил
  Gemini 2.5 Flash tiered strategy
- `gemini-3-flash` убран из fallback chain
- Service Worker: проверка `preloadResponse.ok` перед использованием navigation preload
- CSP `font-src` расширен `blob:` и `data:` для epub.js book fonts

### Security

- Redacted OpenRouter API key из research-документа
- GSD toolchain обновлён до v1.38.3

---

## [v1.4] Оптимизация обработки книг — 2026-03-27 — ABANDONED

Strategic pivot: переход с self-hosted NLP-стека (GLiNER2 + classifier +
pgvector embeddings + LLM synthesis) на Modal (vLLM batch) + OpenRouter
fallback. Решение принято после серии аудитов.

### Added (что сохраняется)

- Phase 29: Docker и DB-инфраструктура для NLP — pgvector в БД,
  `Dockerfile.celery` (PyTorch CPU-only), Celery NLP worker (4GB),
  Alembic-миграция hybrid-pipeline схемы, `extraction_source` колонка
- Phase 30 Plan 01: `NERService` core (GLiNER2 lazy singleton, TextChunker
  через razdel, NERAdapter) + A/B comparison-тесты — код написан, но не
  rollout'ен. Может пригодиться как fallback

### Abandoned

- Phase 30 Plan 02, Phases 31–34 (Description Classifier, pgvector
  embeddings, LLM Batch Synthesis, Rollout)

---

## [v1.3] iOS Reader Navigation Fixes — 2026-03-23

10 фаз, 14 планов, 9 дней, 88 коммитов.

### Added

- Полноэкранный iOS overlay с FSM для всех жестов (edge/center taps,
  follow-finger свайпы, rubber-band, vertical cancel) — Phase 22
- Динамический overlay top через `isHeaderVisible`
- iOS Safari/Chrome/PWA UAT на iPhone 15 Pro: 8/8 проверок passed
- Раздельный circuit breaker для LLM и image generation
- `_generate_with_retry()` с retry внутри HTTP вместо frontend TQ retry
- Async image generation с TQ polling и iOS IndexedDB fallback в
  DescriptionDrawer
- Полный `GeneratedImage` из IndexedDB кеша с metadata, очистка кеша при
  delete, guard ref для 409 conflict

### Changed

- Дедупликация ~454 строк FSM-логики из `useGestureController.ts` в
  shared `gestureUtils.ts` через dependency injection (Phase 23)
- `useImageModal` рефакторирован с `setInterval` на TanStack Query
  `refetchInterval` для Celery polling (Phase 26)
- `ImageModal` переключён на `useRegenerateImage` mutation hook
- `imageCache.release()` убран из `closeModal` — blob URL остаётся валидным
  для DescriptionDrawer через TQ cache (Phase 28.1)
- Структурированные logs с timing на 10 точках image pipeline

### Removed

- 314 строк dead code: `useAsyncImageGeneration`, `useReaderImageModal`

---

## [v1.2] Reader Stability & Polish — 2026-03-13

8 фаз, 21 план, 4 дня. 350 файлов, +64 354/-5 565 строк.

### Added

- Двухфазная gesture pipeline 60fps (Apple Books-like): spring physics,
  follow-finger tracking, instant scroll по тапу
- Адаптивная шапка ридера 320px+ с overflow menu, ReaderFooter с прогресс-линией
- Vaul snap-panels полной высоты (settings, library)
- HighlightTooltip для создания/редактирования/удаления заметок без
  перехвата жестами
- DescriptionDrawer с генерацией изображений + EntityBottomSheet (Vaul) —
  кликабельны у краёв экрана

### Changed

- ResizeObserver cascade fix: pause observer → DOM-mutate → resume
- Координация трёх highlighting-систем (descriptions, entities,
  annotations) через TreeWalker skip-фильтры
- Suppression Chrome Touch to Search через `selectstart` listener

### Removed

- ~38KB dead code: `useTouchNavigation`, `IOSTapZones`, `useFollowFingerSwipe`
- `BookReaderPage` → `ReaderPage` (consolidate)

---

## [v1.1] Reader Mobile / PWA — 2026-03-09

6 фаз, 13 планов, 1 день. 74 файла, +9 674/-2 680 строк.

### Added

- Navigation lock с auto-recovery (ref-based mutex + serialized
  `directScroll`) — фикс race condition при быстрых свайпах
- Follow-finger свайпы: real-time touch tracking, spring physics
  (critically-damped), velocity flick, rubber-band на границах глав
- Единый FSM gesture controller (4-state) — заменил 3 параллельные
  системы
- Immersive mode с auto-hide header
- iOS viewport: `VisualViewport` API для клавиатуры, safe-area audit,
  PWA standalone navigation с center-tap hint
- PWA install banner с iOS-инструкциями
- Graduated resume (3 уровня: <30с pass-through, 30с–5мин soft check,
  > 5мин full reinit)
- EPUB auto-cache + offline degradation

### Changed

- Описания: расширяемая нормализация спецсимволов
  (`REMOVED_CHARS`/`EXPANDED_CHARS`), full-mode TreeWalker wrapping

---

## [v1.0] Готовность к продакшену — 2026-03-09

9 фаз, 23 плана, 9 дней. 582 файла, ~−40 000 строк (cleanup). 52/52
требований выполнены, UAT 10/10 pass.

### Added

- DEBUG=False enforcement, валидация SECRET_KEY, PyJWT, Gunicorn
- Hawk Tracker для error monitoring
- Мониторинг-стек: Netdata + VictoriaMetrics + Uptime Kuma + Dozzle + Flower
- Entity Wiki: fuzzy matching для русских имён (порог 0.75), recursive
  batched reduce для 500+ сущностей, property-based тесты spoiler-фильтрации
- Ридер: закладки, выделения с DOM span wrapping, полнотекстовый поиск,
  entity-text linking (popup при клике на имя)
- Circuit breaker для OpenRouter API (Prometheus метрики)
- Token blacklist (Redis) для безопасного logout
- Exponential backoff retry (tenacity) для всех external вызовов

### Changed

- **Миграция всех AI-сервисов на OpenRouter** (single provider): LLM
  fallback chain (Gemini 3 Flash → Claude Haiku 4.5 → Gemini Flash Lite),
  FLUX.2 для изображений
- **Reverse proxy**: nginx → Caddy (748 строк → ~80, auto-HTTPS, HTTP/3)
- **Ребрендинг**: bookreader → fancai во всей инфраструктуре
- Notes унификация: `Bookmarks` + `Highlights` → единая модель Notes
  (`bookmark.py` сохраняет CFI position и/или CFI range + colors)

### Removed

- `google-genai` SDK и все прямые Google AI SDK вызовы
- `imagen_generator.py` (заменён OpenRouter FLUX.2 path)
- NLP-артефакты, заглушки, устаревшие конфиги (~60 temp/debug файлов,
  старые workflow'ы, env templates)
- `.env.development` из git tracking (security incident P0-1)

### Security

- Hardcoded credentials в `create_admin.py` и `create_test_user.py`
  заменены на env vars
- Production secrets generation script (`generate-production-secrets.sh`)
- CSRF protection (Double Submit Cookie pattern)
- Rate limiting: auth `5→3`/min, registration `2`/min
- Password policy: min 12 chars, sequential digits detection
- CSP hardening: removed `unsafe-eval`, `unsafe-inline` из script-src;
  added `block-all-mixed-content`

---

## Pre-v1.0 (December 2025)

### Removed

- **NLP-система удалена полностью** (декабрь 2025) — RAM-оптимизация на
  production VPS. Извлечение описаний и сущностей переведено целиком на
  LLM API (через OpenRouter). См. комментарий в `backend/requirements.txt:21–22`.

---

_Файл ведётся вручную при закрытии milestone'ов. Подробности конкретных
phases — `.planning/milestones/v1.X-ROADMAP.md`._
