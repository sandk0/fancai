# Итоговое исследование проекта

**Project:** fancai v1.5 — Modal Batch Processing & Production Stability
**Domain:** Стабилизация и ускорение GPU inference pipeline (vLLM + Modal + OpenRouter)
**Researched:** 2026-03-27
**Confidence:** HIGH (производственный код проверен, аудит верифицирован GPT 5.4 cross-audit)

## Обзор

v1.5 — это не feature-milestone, а engineering-milestone: стабилизация сломанного производственного pipeline и переход от sequential к batch-обработке глав. Существующий pipeline критически дефектен: книга с 43% failed chapters получает статус "успешно обработана" из-за безусловного `descriptions_extracted=True` в `book_tasks.py:918`. Одновременно 10 из 23 глав в тестовой книге падают с `JSONDecodeError` из-за отсутствия `maxLength` constraints в Pydantic-схемах — модель генерирует бесконечные строки, исчерпывает `max_tokens`, создаёт broken JSON. Generic `except Exception` скрывает все типы ошибок, делая retry-стратегию невозможной.

Рекомендуемый подход: двухэтапная реализация. Этап 1 (стабилизация) — семь независимых LOW-complexity fix'ов, устраняющих критические production дефекты без изменения архитектуры. Этап 2 (batch) — новый метод `extract_chapters_batch()` в `llm_extractor.py` и `ChapterBatchRunner` в backend, трансформирующие pipeline из sequential в sub-batch (4-8 глав за вызов). Ожидаемый эффект: speedup 7-13x ($3.48 -> $0.26-0.49 за книгу). Для книг 100+ глав batch — необходимость, не оптимизация: sequential при `LLM_TIMEOUT=900s` превышает Celery 3h hard limit в 1.9x.

Ключевые риски: (1) отсутствие batch error isolation в vLLM (Issue #16732, closed not_planned) — одна oversized глава убивает весь sub-batch; mitigation — pre-validation длин обязательна до batch. (2) Bug #37121 (7x KV cache overestimation для Qwen3.5) — потенциальная причина части production timeout'ов; mitigation — `num_gpu_blocks_override=512` как стартовая гипотеза с profiling sweep. (3) GPU snapshots — alpha 8+ месяцев, ноль примеров для `vllm.LLM` + Modal; не включать в milestone.

## Ключевые выводы

### Рекомендуемый стек

Существующий стек не меняется. v1.5 вносит только точечные изменения конфигурации.

**Изменения в зависимостях:**
- `modal>=0.73` -> `modal>=1.3.0` — единственное изменение в requirements.txt (нужно для `startup_timeout`, появившегося в v1.1.4)
- `vllm>=0.18.0` -> `vllm==0.18.0` — pin конкретной версии (API нестабильный между минорами)

**Новые компоненты конфигурации (не pip):**
- `StructuredOutputsConfig(backend="xgrammar")` — explicit выбор backend для batch (лучше throughput при фиксированной схеме)
- `num_gpu_blocks_override=512` — обход Bug #37121 (KV cache overestimation Qwen3.5)
- `compile_cache_volume` — Modal Volume для `~/.cache/vllm/` (эффект: -20-30s cold start)
- `modal.exception.FunctionTimeoutError / RemoteError / InputCancellation` — раздельные catch вместо generic Exception

**Что НЕ менять:**
- Loguru (30+ файлов, `serialize=True` достаточно для JSON logging)
- vLLM server mode (LLM class достаточен для offline batch)
- Prometheus/Grafana (overkill, Loguru structured + return metadata достаточно)
- FlashAttention backend (FA2 оптимален для L40S/Ada Lovelace SM 8.9)

### Ожидаемые фичи

**Обязательно (table stakes — production сломан без них):**
- Корректные статусы книг при partial failures — `descriptions_extracted=True` только при 0 failed chapters
- `maxLength` constraints на все string fields в `modal/schemas.py` — предотвращает broken JSON
- Классификация ошибок по типам — фундамент retry-стратегии и observability
- `finish_reason` проверка в `llm_extractor.py` — defensive parsing до `json.loads()`
- VPS-side timeout на Modal вызовы — `asyncio.wait_for(timeout=LLM_TIMEOUT+60)`
- `reduce_entities` max_tokens 4096 -> 8192-16384 — fix для книг 100+ entities

**Ускорение (differentiators):**
- Sub-batch vLLM processing (4-8 глав за вызов) — 7-13x speedup, $3.48 -> $0.26-0.49/книга
- Pre-validation длин глав — guard clause для batch (hard dependency)
- Structured observability (per-chapter JSON метрики: duration, error_type, finish_reason)
- OpenRouter auto-fallback при Modal failures (circuit breaker: 3 consecutive errors)
- `num_gpu_blocks_override` — снижение timeout rate
- LLM_TIMEOUT 600s -> 900s + Celery time budget check

**Отложить (v1.6+):**
- GPU snapshot POC — alpha 8+ месяцев, нет примеров для vllm.LLM + 9B модели
- xgrammar vs auto backend benchmark — имеет смысл только при стабильном batch
- Compile cache volume — LOW priority, добавить в любой фазе

### Архитектурный подход

Текущий pipeline: `book_tasks.py` (1000+ строк mixed concerns) -> `modal_client.py` -> Modal `extract_chapter()` (sequential, Semaphore(1)) или `gemini_extractor.py` (OpenRouter legacy). Все ошибки в `except Exception`, все статусы в безусловных присвоениях.

Целевая архитектура добавляет три новых компонента поверх существующего, не ломая его:

1. **`ChapterBatchRunner`** (`backend/app/services/chapter_batch_runner.py`) — оркестрация sub-batch обработки: chunking, pre-validation, time_budget, checkpoint после каждого sub-batch, retry failed chapters individually
2. **`ModalFallbackController`** (`backend/app/services/modal_fallback_controller.py`) — решение Modal vs OpenRouter с circuit breaker (per-task lifecycle, не global singleton)
3. **`ErrorClassifier`** (`backend/app/services/error_classifier.py`) — типизированная классификация: `timeout / json_error / modal_error / validation / cancelled / truncated / unknown`

На стороне Modal: `extract_chapters_batch()` метод в `llm_extractor.py` — `llm.chat([conv1, conv2, ..., convN], params)` (batch chat API, PR #8648 merged). Compile cache volume для torch.compile артефактов.

**Ключевое ограничение архитектуры:** vLLM batch error isolation отсутствует (Issue #16732, closed not_planned). Pre-validation обязательна. При падении sub-batch — retry каждой главы individual'но. Reduce вызывается **один раз** после всех sub-batches, не внутри loop.

### Критические риски

1. **Семантическая коррупция данных** (`descriptions_extracted=True` при partial failure) — каждая минута без фикса создаёт inconsistent записи в БД. Нужен reconciliation script для существующих данных. Обнаружение: `SELECT count(*) FROM books WHERE descriptions_extracted=true AND EXISTS (SELECT 1 FROM chapters WHERE chapters.book_id=books.id AND parsing_error IS NOT NULL)`.

2. **Batch error isolation отсутствует** — vLLM Issue #16732 closed not_planned. Одна oversized глава убивает весь sub-batch. Pre-validation (`len(text)/3.5 ~ tokens`) — hard dependency для batch, не optional.

3. **KV cache overestimation Qwen3.5** (Issue #37121 OPEN) — 7x завышение для hybrid GatedDeltaNet+Attention архитектуры. PR #37429 not merged. `num_gpu_blocks_override=512` — стартовая гипотеза, требует profiling sweep (256, 512, 1024, без override).

4. **Celery time budget overflow** — при `LLM_TIMEOUT=900s` + 23 главы sequential = 5.75h > Celery hard limit 3h. Нужен per-task deadline check: `remaining_budget = soft_time_limit - elapsed`.

5. **reduce_entities max_tokens=4096** — книги с 100+ entities (реальные: 80-150) ломаются при reduce. Независимый от batch баг, требует fix в Фазе 1.

## Импликации для roadmap

Структура из 4 фаз, логика которых исходит из dependency graph фич и критических рисков.

### Phase 1: Стабилизация production semantics и schemas

**Rationale:** Все 6 фиксов независимы между собой, все LOW/TRIVIAL complexity, все устраняют текущие production дефекты. Выполняются параллельно или последовательно в одной фазе. Без этой фазы batch не имеет смысла — мы добавим 7-13x speedup поверх pipeline, который даёт неверные статусы.

**Delivers:**
- `descriptions_extracted=True` только при 0 failed chapters + `completed_with_errors` WebSocket status
- Reconciliation script для существующих inconsistent books в БД
- `maxLength` constraints на все string fields в `modal/schemas.py` (включая reduce schema)
- `reduce_entities` max_tokens 4096 -> 16384
- `num_gpu_blocks_override=512` в `modal/config.py` + `llm_extractor.py`
- `LLM_TIMEOUT = 900` + Celery time budget check
- `modal>=1.3.0` в requirements.txt + `vllm==0.18.0` pin

**Avoids:** Pitfall 1 (семантическая коррупция), Pitfall 4 (broken JSON), Pitfall 5 (Celery budget), Pitfall 7 (reduce max_tokens)

### Phase 2: Error classification и observability

**Rationale:** Error classification — фундамент для OpenRouter fallback и structured observability. Отдельная фаза потому что касается 3 новых файлов (`ErrorClassifier`, `ModalFallbackController` интерфейс, изменения `book_tasks.py`) и требует осторожного рефактора горячего кода.

**Delivers:**
- `ErrorClassifier` модуль: раздельный catch `FunctionTimeoutError / RemoteError / InputCancellation / JSONDecodeError`
- `Chapter.parsing_error` содержит структурированный `[ERROR_TYPE] detail`
- `finish_reason` проверка в `llm_extractor.py` до `json.loads()`
- VPS-side timeout: `asyncio.wait_for(asyncio.to_thread(...), timeout=LLM_TIMEOUT+60)`
- Per-chapter structured JSON log: `chapter_id`, `duration_ms`, `result_type`, `error_type`, `finish_reason`
- Modal response: `{"results": [...], "metrics": {"cold_start_ms": ..., "inference_ms": ...}}`

**Avoids:** Pitfall 6 (json.loads без защиты), Pitfall 3 generic Exception

### Phase 3: Sub-batch архитектура

**Rationale:** Требует Фазы 1 (maxLength, num_gpu_blocks_override) и Фазы 2 (error classification для batch failure handling). Это самая сложная фаза. `ChapterBatchRunner` — новый класс с batch logic, checkpoint'ами, time budget, retry logic.

**Delivers:**
- `extract_chapters_batch()` метод в `modal/llm_extractor.py` (batch chat API)
- `ChapterBatchRunner` (`backend/app/services/chapter_batch_runner.py`) с pre-validation + checkpoint + retry
- `ModalFallbackController` (`backend/app/services/modal_fallback_controller.py`) с circuit breaker
- Pre-validation: oversized chapters (>32K estimated tokens) -> sequential path
- Compile cache volume в `modal/app.py` (`~/.cache/vllm/`)
- `scaledown_window` снижен до 60s (batch быстрее -> меньше idle)
- Начальный `SUB_BATCH_SIZE=4`, увеличивать по benchmark'ам

**Avoids:** Pitfall 2 (batch error isolation через pre-validation + retry), Pitfall 5 (Celery budget через time_budget в BatchRunner)

**Uses:** vLLM batch chat API (PR #8648), `StructuredOutputsConfig(backend="xgrammar")`, Modal compile cache volume

### Phase 4: OpenRouter auto-fallback и production hardening

**Rationale:** OpenRouter fallback requires error classification (Фаза 2) и enhances batch (Фаза 3 — если batch нестабилен, fallback обеспечивает safety net). Финальная фаза — добавляет reliability поверх готовой batch архитектуры.

**Delivers:**
- `ModalFallbackController` полная реализация: auto-fallback при 3 consecutive Modal failures
- Push notification обновление: "Обработано N из M глав" при `completed_with_errors`
- Entity Wiki: badge/warning "Обработано N/M глав" при partial success
- WebSocket progress: "Запуск GPU...", "Загрузка модели..." во время cold start
- Global Celery concurrency limit (Redis counter) для Modal GPU containers (не более 1-2 concurrent)

### Порядок фаз: обоснование

- **Фаза 1 первой** — устраняет активное загрязнение БД (каждая минута создаёт inconsistent данные) и готовит схемы для batch
- **Фаза 2 второй** — error classification нужна batch runner'у для типизированных retry-решений; нельзя строить batch без понимания типов ошибок
- **Фаза 3 третьей** — все hard dependencies выполнены (maxLength, finish_reason, error classification, pre-validation в составе фазы)
- **Фаза 4 последней** — polish и reliability layer поверх работающего batch pipeline

### Research Flags

Требует Phase Research перед планированием:
- **Phase 3** (Sub-batch) — `num_gpu_blocks_override` оптимальное значение неизвестно (требует profiling sweep), реальный speedup Qwen3.5 в batch неизвестен (DeltaNet hybrid architecture), оптимальный `SUB_BATCH_SIZE` неизвестен (1, 4, 8, 12?)

Стандартные паттерны (без дополнительного research):
- **Phase 1** — Pydantic `max_length`, Celery time budget, Modal config changes — всё задокументировано
- **Phase 2** — Modal exception imports, Loguru structured logging — всё задокументировано
- **Phase 4** — OpenRouter circuit breaker уже существует, WebSocket patterns уже реализованы

## Оценка уверенности

| Область | Уровень | Обоснование |
|---------|---------|-------------|
| Stack | HIGH | vLLM v0.18.0 код проверен прямо. Modal exceptions в docs. Pydantic max_length documented. Единственное LOW: GPU snapshot (alpha) — исключён из milestone |
| Features | HIGH | Все P0 фичи — прямой code review production-кода. Зависимости проверены через GitHub Issues. Speedup 7-13x — MEDIUM (расчётный из аудита, требует benchmark) |
| Architecture | HIGH | Три новых компонента — чёткие границы ответственности, проверены против существующего кода. Batch API (PR #8648 merged) подтверждён |
| Pitfalls | HIGH | Все critical pitfalls — direct production code review (commit `e5b430b`) + verified GitHub Issues. Единственное MEDIUM: конкретное значение num_gpu_blocks_override |

**Overall confidence:** HIGH

### Пробелы для уточнения

- **`num_gpu_blocks_override` значение**: Bug #37121 repro на 4B-AWQ + DGX Spark + v0.17.1. Для 9B + L40S + v0.18.0 — гипотеза. Нужен profiling sweep в Фазе 3.
- **Реальный speedup Qwen3.5 в batch**: DeltaNet (24/32 слоёв) имеет sequential dependency в recurrence. 7-13x — экстраполяция из аудита, не benchmark. Уточнить после первых batch тестов.
- **GPU snapshot с vllm.LLM**: `enable_gpu_snapshot=True` уже включён в production, но `enable_sleep_mode` не добавлен в `LLM()`. Эффект неизвестен. POC требуется, но не в рамках v1.5.
- **Sub-batch size оптимум**: Начало с 4. Может быть 8 или 12 после stabilization. Зависит от KV cache utilization и batch error rate.

## Источники

### Primary (HIGH confidence)

- Производственный код commit `e5b430b` — прямой code review `book_tasks.py`, `llm_extractor.py`, `schemas.py`, `config.py`, `modal/app.py`
- `docs/research/FINAL-consolidated-audit.md` — финальный аудит, перекрёстно верифицирован GPT 5.4 Codex
- [vLLM PR #8648](https://github.com/vllm-project/vllm/pull/8648) — batch chat API, MERGED
- [vLLM Structured Outputs docs](https://docs.vllm.ai/en/latest/features/structured_outputs/) — StructuredOutputsConfig API
- [Modal exception reference](https://modal.com/docs/reference/modal.exception) — FunctionTimeoutError, RemoteError, InputCancellation
- [Pydantic JSON Schema docs](https://docs.pydantic.dev/latest/concepts/json_schema/) — max_length -> maxLength

### Secondary (MEDIUM confidence)

- [vLLM Issue #37121](https://github.com/vllm-project/vllm/issues/37121) — KV cache 7x overestimation (OPEN)
- [vLLM Issue #16732](https://github.com/vllm-project/vllm/issues/16732) — batch error isolation (CLOSED, not_planned)
- [vLLM Issue #35700](https://github.com/vllm-project/vllm/issues/35700) — Qwen3.5 structured output + thinking (OPEN)
- [Modal GPU Snapshot blog](https://modal.com/blog/gpu-mem-snapshots) — alpha, benchmark до 3B
- [Modal vLLM inference example](https://modal.com/docs/examples/vllm_inference) — compile cache volume pattern
- [xgrammar maxLength support](https://deepwiki.com/mlc-ai/xgrammar/5.2-regular-expression-to-ebnf-conversion) — maxLength respected

### Tertiary (LOW confidence)

- GPU snapshot с vllm.LLM + snap=True — ноль официальных примеров. POC required.
- Sub-batch speedup 7-13x для Qwen3.5 — расчётный, не измеренный. DeltaNet hybrid может снизить линейность.

---
*Research completed: 2026-03-27*
*Ready for roadmap: yes*
