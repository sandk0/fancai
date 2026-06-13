# План доработки админ-панели для динамического управления Gemini API

**Дата:** 2026-03-31  
**Основание:** исправленный отчет `docs/research/gemini-api-consolidated.md` + объединенный аудит `docs/research/gemini-api-consolidated-merged-audit-2026-03-31.md` + анализ текущей кодовой базы и продовой БД через `ssh fancai`

## 1. Цель

Сделать админ-панель источником правды для всей runtime-конфигурации Gemini API и связанных AI-маршрутов, чтобы администратор мог без деплоя и без правки `.env`:

- менять настройки для каждого тарифа (`free`, `premium`, `ultimate`);
- управлять маршрутизацией между Direct Gemini API и OpenRouter;
- менять модели, fallback chain, thinking, temperature, schema mode, caching, batch, PDF/image/embedding/File Search параметры;
- запускать и анализировать A/B тесты;
- видеть, какая именно конфигурация дала конкретный cost, latency и результат.

## 2. Допущения

План строится на следующих допущениях:

1. В первой версии сохраняются текущие тарифы `free`, `premium`, `ultimate`, но архитектура не должна блокировать будущие сегменты и эксперименты.
2. Изменения в админке применяются ко всем **новым** запросам сразу после публикации; уже запущенные jobs продолжают работать на snapshot-конфиге, с которым стартовали.
3. Direct Gemini API и OpenRouter должны сосуществовать: Direct нужен для `Batch API`, `File Search`, `Interactions`, актуальных image/PDF/caching-возможностей; OpenRouter остается как routing/fallback слой там, где это выгодно.
4. Нельзя делать Redis источником правды для Gemini-конфигов. Redis допустим только как кэш поверх Postgres.
5. Для будущих A/B тестов обязательно нужна атрибуция: каждый AI-вызов и каждое сгенерированное изображение должны знать, какой конфиг их породил.

## 3. Что показал анализ текущего состояния

### 3.1 Фронтенд админки

- `frontend/src/pages/AdminDashboardEnhanced.tsx` содержит рабочие вкладки только для overview/parsing/entities; `images`, `system`, `users` по сути placeholder.
- `frontend/src/components/Admin/AdminTabNavigation.tsx` вообще не знает про отдельный AI/Gemini раздел.
- `frontend/src/api/admin.ts` типизирует только `ParsingSettings`, `ImageGenerationSettings`, `SystemSettings`; для Gemini runtime-конфигурации клиента нет.
- `frontend/src/components/Admin/AdminParsingSettings.tsx` показывает текущий паттерн формы, но это один небольшой CRUD без версионирования, diff, preview effective config и audit trail.

Вывод: текущая админка годится как UI-шаблон, но не как основа для сложной AI control plane.

### 3.2 Бэкенд и runtime-конфигурация

- `backend/app/services/settings_manager.py` хранит админ-настройки как Redis-blobs по категориям (`parsing`, `image_generation`, `system`, `advanced_parser`).
- `backend/app/routers/admin/images.py` и `backend/app/routers/admin/parsing.py` действительно работают с этим Redis-слоем, но он:
  - не versioned;
  - не audit-friendly;
  - не типизирован на уровне предметной модели Gemini;
  - не умеет plan-specific overrides;
  - не подходит для A/B тестов.
- `backend/app/core/openrouter_client.py` содержит hardcoded `FALLBACK_MODELS` и `DEFAULT_IMAGE_MODEL`.
- `backend/app/services/gemini_extractor.py` держит `GeminiConfig` внутри кода. Там hardcoded:
  - `model_extraction`;
  - `model_translation`;
  - `model_reduce`;
  - chunking;
  - cache TTL;
  - retry/timeouts;
  - температура и другие runtime-параметры.
- `backend/app/services/imagen_generator.py` использует `settings.OPENROUTER_IMAGE_MODEL` и hardcoded `image_size="1K"`, а не админские настройки.
- `backend/app/routers/users.py` и `backend/app/routers/images.py` держат plan limits и generation limits в коде/`config.py`, а не в DB-driven policy.

Вывод: почти вся фактическая AI-логика сейчас управляется не из админки, а из Python-кода и `.env`.

### 3.3 Важные несоответствия в текущей админ-инфраструктуре

Есть минимум одна системная проблема, которую нужно учесть до Gemini control plane:

- `backend/app/services/parsing_manager.py` использует Redis-ключи `global:parsing:lock` и `global:parsing:queue`;
- `backend/app/routers/admin/parsing.py` и `backend/app/routers/admin/stats.py` читают другие ключи: `global_parsing_lock` и `parsing_queue`.

Следствие: текущая админка уже сейчас может показывать не реальное состояние очереди/локов. Новую AI-панель нельзя строить по такой же схеме "есть форма, но она не гарантирует, что runtime действительно использует эти данные".

### 3.4 Продовая БД (`ssh fancai`)

Подтверждено на проде:

- база: `fancai`;
- пользователь БД: `fancai`;
- основные связанные таблицы: `feature_flags`, `subscriptions`, `llm_usage_log`, `generated_images`, `usage_records`.

Фактические наблюдения:

- `subscriptions`: 3 строки; модель пока очень простая, без отдельной policy-таблицы для лимитов и AI-entitlements.
- `feature_flags`: реально используются в проде; sample rows подтверждают, что DB-driven feature flags уже живут в системе и подходят как архитектурный референс.
- `llm_usage_log`: есть production-трафик, хранятся `model`, `service`, `prompt_tokens`, `completion_tokens`, `cost_dollars`, `request_id`; sample показал свежие записи от `2026-03-30`.
- `usage_records`: таблица существует, но сейчас пустая; это хороший момент, чтобы эволюционировать ее без боли.
- `generated_images`: подтверждены реальные продовые записи; сейчас сохраняется `service_used=imagen`, но нет строгой нормализации по `provider_kind`, `model_id`, `resolution`, `config_snapshot_id`.

Вывод: база уже содержит telemetry и operational tables, но не умеет отвечать на главный для A/B вопрос: **какая конкретно конфигурация вызвала этот результат и этот cost**.

## 4. Требования к целевой системе

Новая админ-панель должна покрывать не "часть Gemini", а полный рабочий слой управления AI-пайплайнами:

1. **Маршрутизация**
   - Direct Gemini API / OpenRouter / fallback chain;
   - primary/fallback/provider order;
   - feature availability only for direct Gemini (`Batch`, `File Search`, `Interactions`, explicit caching).

2. **Task-specific runtime**
   - extraction;
   - hard extraction fallback;
   - translation;
   - dedup/reduce;
   - synthesis;
   - image generation;
   - PDF discovery / document processing;
   - embeddings;
   - File Search;
   - экспериментальные `Interactions`.

3. **Model controls**
   - `model_id`;
   - `thinking_level` для Gemini 3;
   - `thinking_budget` только для 2.5;
   - `temperature`;
   - `max_output_tokens`;
   - structured output mode и schema binding.

4. **Gemini-specific capabilities из отчета**
   - explicit/implicit caching;
   - Batch API;
   - `media_resolution` для PDF;
   - image resolution (`0.5K`, `1K`, `2K`, `4K`);
   - File Search metadata/citations;
   - embeddings dimensions/model switching;
   - safety/finish reason handling;
   - deprecation awareness по model IDs.

5. **Plan-aware управление**
   - разные конфиги для `free`, `premium`, `ultimate`;
   - plan entitlements: какие возможности доступны тарифу;
   - plan budgets/cost caps;
   - different latency/quality/cost profiles per tariff.

6. **A/B and ops**
   - versioning;
   - rollback;
   - staged rollout;
   - cohort override;
   - audit log;
   - effective config preview;
   - telemetry attribution до уровня конкретного запроса.

## 5. Рекомендованная архитектура

Рекомендация: **Postgres-backed hybrid control plane**.

Ключевая идея:

- типизированные сущности и связи хранятся в Postgres;
- фактический payload capability-настроек хранится в JSONB, но валидируется Pydantic-схемами;
- Redis используется только как кэш effective config;
- каждый runtime-вызов работает не "по текущим глобальным переменным", а по **разрешенному snapshot-конфигу**.

### 5.1 Слои конфигурации

Конфиг разрешается по слоям:

1. `global default`
2. `plan binding`
3. `rollout/cohort override`
4. `manual user override` для QA/отладки, если позже понадобится

На выходе сервис получает один immutable effective config object, который:

- вычислен один раз;
- содержит `config_snapshot_id`;
- логируется в usage/telemetry;
- не меняется посередине запроса.

### 5.2 Почему не Redis-only и не "все поля отдельными колонками"

**Почему не Redis-only:**

- нет истории изменений;
- нет согласованной схемы;
- нет связей с тарифами и экспериментами;
- сложно делать diff, rollback, attribution и SQL-анализ.

**Почему не полностью нормализованная колонка на каждую Gemini-опцию:**

- Gemini API меняется быстро;
- придется слишком часто делать миграции под новые поля;
- часть настроек естественно живет как вложенные объекты.

**Итог:** typed metadata + JSONB payload + schema validation.

## 6. Целевая модель данных

### 6.1 Новые таблицы

#### `ai_provider_accounts`

Хранит provider endpoints и привязанные секреты/учетки.

Минимальные поля:

- `id`
- `provider_kind` (`gemini_direct`, `openrouter`, `modal`, `other`)
- `account_key`
- `display_name`
- `enabled`
- `base_url`
- `project_id`
- `secret_ref` или `encrypted_secret`
- `created_at`, `updated_at`, `updated_by`

Замечание: секреты нельзя хранить открытым текстом. Нужна маскировка в UI и шифрование at-rest через master key из env/KMS.

#### `ai_capability_profiles`

Именованные versioned-профили конфигурации.

Минимальные поля:

- `id`
- `profile_key`
- `capability` (`extraction`, `translation`, `dedup`, `synthesis`, `image`, `pdf`, `file_search`, `embeddings`, `interactions`)
- `schema_version`
- `status` (`draft`, `active`, `archived`)
- `config_json` (`JSONB`)
- `notes`
- `created_at`, `created_by`
- `updated_at`, `updated_by`
- `published_at`

#### `ai_plan_entitlements`

Plan-level политика и лимиты.

Минимальные поля:

- `id`
- `plan_code` (`free`, `premium`, `ultimate`)
- `books_limit`
- `images_limit_month`
- `monthly_ai_budget_usd`
- `max_request_cost_usd`
- `allow_pdf`
- `allow_file_search`
- `allow_embeddings`
- `allow_premium_image_tier`
- `allow_interactions`
- `max_parallel_jobs`
- `updated_at`, `updated_by`

#### `ai_profile_bindings`

Связывает capability-профили с тарифами и runtime-слоями.

Минимальные поля:

- `id`
- `scope_type` (`global`, `plan`, `cohort`, `user`)
- `scope_key` (`free`, `premium`, `ultimate`, `ab-exp-1`, `user:<uuid>`)
- `capability`
- `profile_id`
- `fallback_profile_id`
- `priority`
- `enabled`
- `starts_at`, `ends_at`
- `updated_at`, `updated_by`

#### `ai_rollout_rules`

Нужна для controlled A/B и gradual rollout.

Минимальные поля:

- `id`
- `rule_key`
- `capability`
- `plan_code`
- `match_type` (`percentage`, `user_list`, `feature_flag`, `manual`)
- `match_config_json`
- `profile_id`
- `enabled`
- `created_at`, `updated_at`, `updated_by`

#### `ai_config_audit_log`

Нормальный audit trail изменений.

Минимальные поля:

- `id`
- `entity_type`
- `entity_id`
- `action`
- `before_json`
- `after_json`
- `diff_json`
- `actor_email`
- `comment`
- `created_at`

### 6.2 Расширение существующих таблиц

#### `llm_usage_log`

Добавить:

- `provider_kind`
- `plan_code`
- `capability`
- `config_snapshot_id`
- `latency_ms`
- `cache_mode` (`none`, `implicit`, `explicit`)
- `batch_job_id` при batch-сценариях

Причина: сейчас таблица знает модель и cost, но не знает, **почему была выбрана именно эта модель**.

#### `usage_records`

Добавить:

- `plan_code`
- `capability`
- `config_snapshot_id`
- `provider_kind`
- `model_id`
- `request_mode`

Причина: таблица пока пустая и идеально подходит под новое cost attribution.

#### `generated_images`

Нормализовать метаданные генерации:

- `provider_kind`
- `model_id`
- `config_snapshot_id`
- `image_resolution`
- `request_mode`

Можно частично использовать уже существующий `generation_parameters`, но ключевые поля лучше иметь в явном виде для аналитики и фильтрации.

## 7. Формат capability-конфига

Каждый `config_json` должен валидироваться отдельной Pydantic-схемой, но следовать общей структуре:

```json
{
  "provider": {
    "provider_kind": "gemini_direct",
    "account_key": "google-main"
  },
  "routing": {
    "model_id": "gemini-3-flash-preview",
    "fallback_chain": [
      {"provider_kind": "gemini_direct", "model_id": "gemini-3.1-pro-preview"},
      {"provider_kind": "openrouter", "model_id": "google/gemini-2.5-flash"}
    ]
  },
  "generation": {
    "temperature": 1.0,
    "max_output_tokens": 64000
  },
  "thinking": {
    "mode": "level",
    "thinking_level": "minimal",
    "thinking_budget": null
  },
  "structured_output": {
    "enabled": true,
    "mode": "json_schema",
    "schema_key": "gemini_tsa_v1"
  },
  "caching": {
    "explicit_enabled": false,
    "implicit_allowed": true,
    "min_tokens": 1024
  },
  "batch": {
    "enabled": false
  },
  "guardrails": {
    "max_request_cost_usd": 0.03,
    "timeout_seconds": 120,
    "retry_attempts": 3
  },
  "advanced_overrides": {}
}
```

`advanced_overrides` нужен как страховка под быстро меняющиеся поля Gemini API, чтобы не делать миграцию/рефактор при каждом новом capability-параметре.

## 8. Что именно должно стать изменяемым в админке

Ниже список не "nice to have", а обязательного покрытия, исходя из исправленного Gemini-отчета.

### 8.1 Text/structured capabilities

- `model_id`
- provider route (`gemini_direct` / `openrouter`)
- `thinking_level`
- `thinking_budget` для legacy 2.5 use-cases
- `temperature`
- `max_output_tokens`
- JSON mode / JSON Schema mode
- выбранная schema version
- timeout/retries
- fallback chain

### 8.2 Caching

- explicit caching on/off
- implicit caching allowed on/off
- minimum token threshold
- reusable segments (`contents`, `system_instruction`, `tools`, `tool_config`)
- TTL/business policy
- per-capability allow/deny

### 8.3 Batch API

- enabled per capability
- batch size
- polling interval
- max job age
- retry policy
- fallback when batch unavailable

Важно: UI должен явно предупреждать, что `Batch API` доступен только для Direct Gemini, не для OpenRouter.

### 8.4 PDF/document processing

- `media_resolution`
- `countTokens()` preflight required/optional
- max pages / max bytes
- whole-book vs chapter-sliced mode
- Files API usage mode
- searchable PDF flow enablement

Важно: админка должна использовать термины из отчета, а не старые heuristics типа `258 tok/page`.

### 8.5 Image generation

- model family
- `image_size` / resolution
- batch mode
- premium tier enablement
- fallback chain
- reference image policy
- safety policy
- prompt translation model/profile

Важно: текущие Redis image-settings в рантайме почти не участвуют; новая панель должна управлять **реальным** image pipeline.

### 8.6 Embeddings / File Search / Interactions

- embedding model
- dimensions
- re-embed strategy
- File Search enablement per tariff
- citations/grounding extraction
- metadata filtering defaults
- Interactions API feature-gate

## 9. Backend план работ

### 9.1 Фаза 0. Починить админ-фундамент

Сначала устранить расхождения между admin UI и runtime:

- выровнять Redis-ключи parsing/status в `admin/parsing.py` и `admin/stats.py` с `parsing_manager.py`;
- зафиксировать, какие текущие admin settings реально используются, а какие являются мертвыми;
- добавить smoke tests на admin queue/status endpoints.

Без этого новая панель рискует повторить ту же проблему "настройка меняется в UI, но не влияет на реальную систему".

### 9.2 Фаза 1. DB schema и сервис разрешения конфигов

Сделать:

- Alembic migration на новые таблицы `ai_provider_accounts`, `ai_capability_profiles`, `ai_plan_entitlements`, `ai_profile_bindings`, `ai_rollout_rules`, `ai_config_audit_log`;
- SQLAlchemy models;
- `AIConfigService` для CRUD;
- `AIConfigResolver` для построения effective config по plan + capability + rollout context;
- Redis cache поверх resolved config + invalidation on publish.

### 9.3 Фаза 2. Интеграция с runtime-сервисами

Перевести на resolver:

- `gemini_extractor.py`
- `imagen_generator.py`
- `openrouter_client.py`
- сервисы dedup/synthesis/translation
- image tasks
- PDF / File Search / embeddings adapters, когда они будут добавлены

Принцип: сервис не читает hardcoded constants для модели/температуры/route. Он получает `effective_config` и работает только через него.

### 9.4 Фаза 3. Логирование snapshot attribution

Добавить:

- `config_snapshot_id` в usage tables;
- plan/capability/provider/model attribution;
- сохранение точного выбранного route;
- сохранение фактического `model_id`, а не только "service used".

Это критично для A/B и cost analysis.

### 9.5 Фаза 4. Admin API

Нужны новые endpoints:

- `GET /admin/ai/providers`
- `POST /admin/ai/providers`
- `GET /admin/ai/entitlements`
- `PUT /admin/ai/entitlements/{plan}`
- `GET /admin/ai/profiles`
- `POST /admin/ai/profiles`
- `PUT /admin/ai/profiles/{id}`
- `POST /admin/ai/profiles/{id}/publish`
- `GET /admin/ai/bindings`
- `PUT /admin/ai/bindings/{id}`
- `GET /admin/ai/effective-config`
- `GET /admin/ai/audit-log`
- `POST /admin/ai/test-run`

`test-run` особенно полезен: админ должен иметь возможность руками прогнать extraction/image/PDF test against selected profile без деплоя.

## 10. Frontend план работ

### 10.1 Новая структура вкладок

Вместо текущих placeholder-tab'ов нужен отдельный AI-раздел с поднавигацией:

1. `Overview`
2. `Plans`
3. `Profiles`
4. `Bindings`
5. `Experiments`
6. `Telemetry`
7. `Audit`

Опционально `Providers` как отдельная подстраница.

### 10.2 UX-паттерны

Обязательные UX-возможности:

- plan switcher (`free` / `premium` / `ultimate`);
- capability switcher;
- clone profile;
- diff current vs draft;
- publish with comment;
- rollback to previous revision;
- effective config preview;
- warnings based on report knowledge.

Примеры встроенных предупреждений:

- `thinking_budget` нельзя показывать как основной контрол для Gemini 3;
- `Batch API` на OpenRouter недоступен;
- `Flash-Lite` нельзя предлагать как extraction default без предупреждения;
- PDF budgeting должен опираться на `media_resolution`;
- image economics без явного resolution недопустима.

### 10.3 Форма редактирования

Лучший компромисс:

- обычные типизированные поля для 90% кейсов;
- расширенный JSON editor для `advanced_overrides`;
- preview effective JSON before publish.

Иначе админка либо станет слишком ограниченной, либо превратится в один большой сырой JSON textarea.

## 11. Файлы и модули, которые почти наверняка будут затронуты

### Backend

- `backend/app/routers/admin/__init__.py`
- `backend/app/routers/admin/stats.py`
- `backend/app/routers/admin/parsing.py`
- `backend/app/routers/admin/images.py`
- `backend/app/models/__init__.py`
- `backend/app/models/llm_usage_log.py`
- `backend/app/models/usage_record.py`
- `backend/app/models/image.py`
- `backend/app/models/user.py`
- `backend/app/services/settings_manager.py`
- `backend/app/services/gemini_extractor.py`
- `backend/app/services/imagen_generator.py`
- `backend/app/core/openrouter_client.py`

Новые модули:

- `backend/app/models/ai_provider_account.py`
- `backend/app/models/ai_capability_profile.py`
- `backend/app/models/ai_plan_entitlement.py`
- `backend/app/models/ai_profile_binding.py`
- `backend/app/models/ai_rollout_rule.py`
- `backend/app/models/ai_config_audit_log.py`
- `backend/app/services/ai_config_service.py`
- `backend/app/services/ai_config_resolver.py`
- `backend/app/services/ai_config_publisher.py`
- `backend/app/routers/admin/ai_configs.py`

### Frontend

- `frontend/src/pages/AdminDashboardEnhanced.tsx`
- `frontend/src/components/Admin/AdminTabNavigation.tsx`
- `frontend/src/api/admin.ts`

Новые модули:

- `frontend/src/components/Admin/Gemini/AdminAIOverview.tsx`
- `frontend/src/components/Admin/Gemini/AdminAIPlans.tsx`
- `frontend/src/components/Admin/Gemini/AdminAIProfiles.tsx`
- `frontend/src/components/Admin/Gemini/AdminAIBindings.tsx`
- `frontend/src/components/Admin/Gemini/AdminAIExperiments.tsx`
- `frontend/src/components/Admin/Gemini/AdminAITelemetry.tsx`
- `frontend/src/components/Admin/Gemini/AdminAIAudit.tsx`
- `frontend/src/components/Admin/Gemini/CapabilityProfileForm.tsx`
- `frontend/src/components/Admin/Gemini/EffectiveConfigPreview.tsx`

## 12. Миграция данных

Начальная миграция должна:

1. создать default entitlements для `free`, `premium`, `ultimate`;
2. создать стартовые capability-профили на основе исправленного Gemini-отчета;
3. создать bindings для всех трех тарифов;
4. перенести полезные части текущих hardcoded настроек в DB-профили;
5. не удалять старые Redis settings мгновенно, а перевести runtime на новый resolver и только потом вычистить legacy.

Важно: стартовые профили должны учитывать выводы из отчета, а не просто копировать текущие значения из кода.

## 13. Приоритеты настройки по тарифам

Рекомендуемая стартовая логика после внедрения control plane:

- `free`: более дешевый и ограниченный route; lower monthly budget; image tier без premium; без тяжелых PDF/File Search путей по умолчанию.
- `premium`: основной экспериментальный слой; сюда логично вынести первые A/B по `3 Flash`, caching, PDF discovery, image resolution.
- `ultimate`: максимальная гибкость; разрешить premium image tier, advanced PDF/File Search, более высокий budget ceiling.

Ключевая мысль: тариф управляет не только лимитами, но и **качеством AI-маршрута**.

## 14. Верификация

Нужно заложить следующие проверки:

### Backend

- unit tests на resolver merge order;
- tests на schema validation;
- tests на publish/rollback;
- integration tests на admin endpoints;
- tests на правильную атрибуцию `config_snapshot_id`.

### Frontend

- React Query tests на CRUD flow;
- form validation tests;
- snapshot/effective config preview tests.

### E2E

- админ меняет профиль extraction для `premium`;
- новый runtime-запрос реально идет с новой моделью;
- `llm_usage_log` получает новый `config_snapshot_id`;
- rollback возвращает старый маршрут.

## 15. Основные риски и как их снять

### Риск 1. Панель снова станет "декоративной"

Снимать через:

- единственный resolver;
- отказ от прямого чтения hardcoded constants в runtime;
- интеграционные тесты "admin change -> live request uses new config".

### Риск 2. Слишком жесткая схема не переживет новые Gemini-поля

Снимать через:

- JSONB payload;
- schema versioning;
- `advanced_overrides`.

### Риск 3. Потеря управляемости из-за слишком свободного JSON

Снимать через:

- типизированные формы;
- publish validation;
- warning engine на базе правил из отчета;
- revision history и rollback.

### Риск 4. Невозможно анализировать A/B

Снимать через:

- `config_snapshot_id`;
- plan/capability/provider/model attribution;
- нормализацию image/usage telemetry.

## 16. Рекомендуемая последовательность реализации

1. Починить текущую админ-диагностику и Redis key mismatch.
2. Ввести новую DB-схему и backend resolver.
3. Перевести extraction и image generation на новый resolver.
4. Добавить plan entitlements и bindings.
5. Собрать новый AI/Gemini раздел админки.
6. Добавить audit, test-run и telemetry views.
7. Затем подключать PDF, File Search, embeddings и более сложные A/B сценарии.

## 17. Итоговая рекомендация

Не пытаться "допилить существующие Redis settings". Это тупиковый путь.

Правильная цель: построить небольшой, но строгий **AI control plane** поверх Postgres, где:

- тариф определяет entitlement и budget;
- capability-профили определяют Gemini/OpenRouter runtime;
- bindings определяют, что реально активно;
- runtime пишет back telemetry с `config_snapshot_id`;
- админка становится не набором форм, а операционной консолью для A/B тестов и быстрых переключений.

Именно такая архитектура даст реальную пользу для последующего brainstorming и быстрых продуктовых экспериментов, а не еще один слой настроек, который не влияет на production path.
