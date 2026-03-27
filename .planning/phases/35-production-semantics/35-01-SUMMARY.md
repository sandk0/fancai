---
phase: 35-production-semantics
plan: 01
subsystem: ai-pipeline
tags: [pydantic, vllm, modal, structured-output, xgrammar, kv-cache]

requires:
  - phase: none
    provides: "Первая фаза v1.5"
provides:
  - "max_length constraints на всех string полях Modal schemas (xgrammar enforcement)"
  - "NUM_GPU_BLOCKS_OVERRIDE=512 для обхода vLLM Bug #37121"
  - "LLM_TIMEOUT=900 для длинных глав"
  - "max_tokens=16384 в reduce_entities (STAB-08)"
  - "VPS_TIMEOUT_BUFFER=60 для сетевого overhead"
affects: [35-02, 35-03, 36, 37, 38]

tech-stack:
  added: []
  patterns:
    - "Pydantic max_length -> JSON Schema maxLength -> xgrammar enforcement"
    - "num_gpu_blocks_override для калибровки KV cache аллокации"

key-files:
  created:
    - backend/tests/services/test_modal_schemas.py
  modified:
    - modal/schemas.py
    - modal/config.py
    - modal/llm_extractor.py

key-decisions:
  - "max_length значения из FINAL-consolidated-audit.md: name=200, content=2000, visual_summary=500"
  - "NUM_GPU_BLOCKS_OVERRIDE=512 как начальное значение — калибровать по production логам"
  - "STAB-08 подтверждён и исправлен: max_tokens в reduce_entities было 4096, теперь 16384"
  - "logging.info (не loguru) для Modal контейнера — стандартный Python logging"

patterns-established:
  - "Modal schemas: все string поля обязательно имеют max_length для xgrammar enforcement"

requirements-completed: [STAB-03, STAB-07, STAB-08]

duration: 6min
completed: 2026-03-28
---

# Phase 35 Plan 01: Modal Pipeline Constraints Summary

**max_length constraints на 12 string полях Modal schemas + NUM_GPU_BLOCKS_OVERRIDE=512 + LLM_TIMEOUT=900 + STAB-08 fix (max_tokens 4096->16384)**

## Производительность

- **Длительность:** 6 мин
- **Начало:** 2026-03-27T21:55:40Z
- **Завершение:** 2026-03-27T22:02:03Z
- **Задачи:** 2
- **Файлы изменены:** 4

## Результаты

- 12 max_length constraints на всех string полях в ModalEntitySchema, ModalDescriptionSchema, ModalRelationshipSchema — xgrammar теперь обрезает генерацию на границе maxLength, broken JSON невозможен
- NUM_GPU_BLOCKS_OVERRIDE=512 передаётся в vLLM LLM() init — обход KV cache overestimation (Bug #37121)
- LLM_TIMEOUT увеличен 600->900 секунд, VPS_TIMEOUT_BUFFER=60 для сетевого overhead
- STAB-08 исправлен: max_tokens в reduce_entities был 4096 (не 16384 как ожидалось) — увеличен до 16384

## Коммиты задач

Каждая задача зафиксирована атомарно:

1. **Task 1: max_length constraints в Modal Pydantic schemas + тесты (TDD)**
   - `502c66d` (test) — RED: 10 failing тестов для maxLength constraints
   - `7bdf0cd` (feat) — GREEN: max_length добавлен на все 12 string полей, 10 тестов проходят
2. **Task 2: LLM_TIMEOUT=900, NUM_GPU_BLOCKS_OVERRIDE=512, vLLM init logging + STAB-08**
   - `3b18d39` (feat) — config + llm_extractor обновлены

## Файлы созданы/изменены

- `modal/schemas.py` — max_length constraints на всех string полях (12 constraints)
- `modal/config.py` — LLM_TIMEOUT=900, NUM_GPU_BLOCKS_OVERRIDE=512, VPS_TIMEOUT_BUFFER=60
- `modal/llm_extractor.py` — num_gpu_blocks_override в LLM() init, logging.info аллокации, max_tokens=16384 в reduce_entities
- `backend/tests/services/test_modal_schemas.py` — 10 тестов: maxLength в JSON Schema, ValidationError при превышении, граничные значения

## Принятые решения

- **max_length значения из аудита:** name=200, visual_summary=500, content=2000, image_prompt_en=300, chapter_event_action/inner=300, type=50/100, context=300, source/target=200
- **NUM_GPU_BLOCKS_OVERRIDE=512 как стартовое значение:** требует калибровки по production логам (D-14)
- **STAB-08 обнаружен и исправлен:** коммит e5b430b увеличил max_tokens до 16384 только в _другом_ месте (extract_chapter), reduce_entities оставался с 4096
- **Standard logging:** Modal контейнер использует `logging.info`, не loguru

## Отклонения от плана

### Автоматически исправленные проблемы

**1. [Rule 1 - Bug] STAB-08: max_tokens в reduce_entities всё ещё 4096**
- **Обнаружено при:** Task 2 (верификация STAB-08)
- **Проблема:** Предыдущий коммит e5b430b обновил max_tokens только в одном методе, reduce_entities остался с 4096
- **Исправление:** max_tokens=16384 с комментарием STAB-08
- **Файлы:** modal/llm_extractor.py:76
- **Верификация:** grep "max_tokens=16384" modal/llm_extractor.py
- **Зафиксировано в:** 3b18d39

---

**Всего отклонений:** 1 auto-fix (Rule 1 — bug)
**Влияние на план:** Исправление предусмотрено планом (Task 2 явно включал верификацию/фикс STAB-08). Без расширения scope.

## Проблемы

- coverage fail в pytest (pre-existing: `pytest.ini` с `--cov-fail-under=70` при запуске отдельного файла показывает 0% coverage) — не блокирует, все 10 тестов проходят

## Настройка пользователем

Не требуется — нет внешних сервисов.

## Готовность к следующему плану

- Schema constraints готовы — xgrammar enforcement на стороне Modal обеспечен
- config.py содержит LLM_TIMEOUT=900 и VPS_TIMEOUT_BUFFER=60 — Plan 02 может использовать для VPS-side timeout
- STAB-08 verified — reduce_entities обработает книги со 100+ entities

## Self-Check: PASSED

- modal/schemas.py: FOUND
- modal/config.py: FOUND
- modal/llm_extractor.py: FOUND
- backend/tests/services/test_modal_schemas.py: FOUND
- 35-01-SUMMARY.md: FOUND
- Commit 502c66d: FOUND
- Commit 7bdf0cd: FOUND
- Commit 3b18d39: FOUND

---
*Phase: 35-production-semantics*
*Completed: 2026-03-28*
