# Phase 35: Стабилизация production semantics - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Pipeline выдаёт корректные статусы книг и не создаёт broken JSON — каждая обработанная книга отражает реальный результат. Корректные статусы, schema constraints, timeout/budget защита, reconciliation существующих данных. Frontend изменения НЕ входят в scope (только WebSocket message format).

</domain>

<decisions>
## Implementation Decisions

### Семантика статусов книги
- **D-01:** `descriptions_extracted = True` только при 0 failed chapters. Любые failures = False. Перенести проверку failed_chapters ДО установки флага (текущий баг: `book_tasks.py:918` ставит True безусловно)
- **D-02:** WebSocket публикует `status: "completed_with_errors"` при partial failures, включая `chapters_failed` count и `failed_chapter_numbers` array
- **D-03:** `descriptions_processing_error` сохраняет сообщение о partial failure (не сбрасывается в None)
- **D-04:** Push notification (`send_book_ready_notification`) НЕ отправляется при `completed_with_errors` — пользователь увидит статус при следующем визите

### Reconciliation существующих данных
- **D-05:** Admin endpoint `POST /admin/reconcile-statuses` — находит книги с `descriptions_extracted=True` при наличии chapters с `parsing_error IS NOT NULL`, исправляет: `descriptions_extracted=False`, `descriptions_processing_error='Требуется переобработка'`
- **D-06:** Endpoint возвращает отчёт: список найденных книг, что исправлено. Можно перезапускать после каждого деплоя
- **D-07:** Пользователь может запустить reprocess через существующий UI

### Schema constraints (maxLength)
- **D-08:** Все string поля в `modal/schemas.py` получают `max_length` constraints:
  - `content` (description): 2000
  - `image_prompt_en`: 300
  - `visual_summary`: 500
  - `chapter_event_action`: 300
  - `chapter_event_inner`: 300
  - `context` (relationship): 300
  - `name` (entity): 200
- **D-09:** Значения из таблицы аудита (`docs/research/FINAL-consolidated-audit.md`). Truncation на полуслове приемлема — лучше обрезанное описание, чем broken JSON

### Timeout и budget архитектура
- **D-10:** Per-chapter `asyncio.wait_for()` вокруг каждого Modal вызова `extract_chapter`. Timeout = `LLM_TIMEOUT + 60` секунд (запас на сетевой overhead). При timeout — глава помечается как failed, следующая продолжается
- **D-11:** `LLM_TIMEOUT = 900` секунд (15 минут, было 600). Достаточно для длинных глав
- **D-12:** Per-book time budget check перед каждой главой: оставшееся время до Celery hard limit > LLM_TIMEOUT? Если нет — skip оставшиеся главы, завершить книгу с `completed_with_errors`

### num_gpu_blocks_override
- **D-13:** Начальное значение `num_gpu_blocks_override = 512` в `modal/llm_extractor.py` для обхода vLLM Bug #37121 (7x KV cache overestimation для Qwen3.5)
- **D-14:** Логировать vLLM reported GPU blocks и memory usage для калибровки значения по production данным

### Loguru аудит
- **D-15:** Все 32 файла с `logger.opt()` проверены — Loguru import гарантирован. Файлы в Modal контейнере используют стандартный `logging` API (не Loguru)

### STAB-08 (max_tokens для reduce_entities)
- **D-16:** Уже fix'нут коммитом `e5b430b` — `max_tokens=16384`. Верифицировать при тестировании, не реимплементировать

### Claude's Discretion
- Конкретная реализация per-book budget check (механика подсчёта оставшегося времени)
- Формат structured log для timeout/failure events
- Организация кода: отдельный helper для timeout wrapping или inline
- Порядок задач в планах

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Эталонный аудит
- `docs/research/FINAL-consolidated-audit.md` — Полный аудит pipeline, maxLength таблица, приоритеты P0-P12, risk matrix. ОСНОВНОЙ ДОКУМЕНТ для Phase 35-38

### Pipeline code (VPS)
- `backend/app/tasks/book_tasks.py` — Основной flow обработки книги. Строка 918: баг `descriptions_extracted=True`. Строки 952-965: проверка failed chapters
- `backend/app/services/modal_client.py` — Lazy references на Modal classes, `modal_response_to_chapter_result()`
- `backend/app/services/consistency_manager.py` — `reduce_entities`, entity resolution
- `backend/app/services/push_notification_service.py` — Push notification service
- `backend/app/routers/websocket.py` — WebSocket progress endpoint
- `backend/app/core/celery_app.py` — Celery config, soft/hard time limits

### Pipeline code (Modal)
- `modal/schemas.py` — Pydantic schemas БЕЗ maxLength (target файл для D-08)
- `modal/config.py` — LLM_TIMEOUT=600 (изменить на 900), GPU settings
- `modal/llm_extractor.py` — vLLM LLM init (добавить num_gpu_blocks_override)

### Admin routes
- `backend/app/routers/admin/` — Существующие admin endpoints (паттерн для reconciliation)

### Requirements
- `.planning/REQUIREMENTS.md` — STAB-01..09 requirements с traceability

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `FeatureFlagManager` — feature flags для rollback (USE_MODAL_PIPELINE уже есть)
- Существующие admin endpoints (`backend/app/routers/admin/`) — паттерн для reconciliation endpoint
- `publish_book_progress()` — WebSocket helper, уже поддерживает status field
- `push_notification_service.send_book_ready_notification()` — push notification, нужно обернуть в условие

### Established Patterns
- Celery tasks: `book_tasks.py` использует `asyncio.run()` wrapper, Redis distributed lock
- Modal calls: lazy `modal.Cls.from_name()` → `.remote()` вызовы
- Error handling: `logger.opt(exception=True).error()` через Loguru
- Admin endpoints: SQLAlchemy queries с пагинацией в `/admin/` роутах

### Integration Points
- `book_tasks.py:918` — точка фикса для descriptions_extracted
- `book_tasks.py:990` — точка фикса для push notification
- `modal/config.py` — LLM_TIMEOUT, новая константа VPS_TIMEOUT_BUFFER
- `modal/llm_extractor.py` — num_gpu_blocks_override в LLM() init
- `modal/schemas.py` — max_length constraints на все string fields
- `backend/app/routers/admin/` — новый reconciliation endpoint

</code_context>

<specifics>
## Specific Ideas

Нет специфических требований — решения основаны на аудите `docs/research/FINAL-consolidated-audit.md` и production данных (10/23 глав падают).

</specifics>

<deferred>
## Deferred Ideas

None — обсуждение осталось в рамках Phase 35.

</deferred>

---

*Phase: 35-production-semantics*
*Context gathered: 2026-03-28*
