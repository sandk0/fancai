---
phase: 03-migration-services
plan: "01"
subsystem: ai-services
tags:
  - openrouter
  - llm-migration
  - fallback-chain
  - tdd
dependency_graph:
  requires:
    - "02-02: NLP cleanup завершён, google.genai вызовы изолированы"
  provides:
    - "openrouter_client.py: единый клиент для всех AI-сервисов"
    - "entity_synthesis и consistency_manager мигрированы на OpenRouter"
  affects:
    - "03-02: будет использовать openrouter_client для gemini_extractor и entity_dedup"
    - "03-03: imagen_generator будет использовать generate_image() из этого клиента"
tech_stack:
  added:
    - "httpx (уже в requirements) — используется напрямую для OpenRouter API"
    - "OPENROUTER_API_KEY и OPENROUTER_IMAGE_MODEL в Settings"
  patterns:
    - "Fallback chain: клиентский цикл по FALLBACK_MODELS с перехватом HTTPStatusError/TimeoutException"
    - "_inline_defs: рекурсивное разворачивание $defs/$ref для Google моделей через OpenRouter"
    - "TDD: RED (падающие тесты) → GREEN (реализация) → коммит"
key_files:
  created:
    - "backend/app/core/openrouter_client.py"
    - "backend/tests/core/__init__.py"
    - "backend/tests/core/test_openrouter_client.py"
    - "backend/tests/services/test_consistency_manager.py"
  modified:
    - "backend/app/core/config.py"
    - "backend/app/services/entity_synthesis_service.py"
    - "backend/app/services/consistency_manager.py"
    - "backend/tests/services/test_entity_synthesis.py"
decisions:
  - "httpx async напрямую вместо OpenAI SDK — httpx уже в requirements, нет лишних зависимостей"
  - "Fallback перехватывает ТОЛЬКО httpx.HTTPStatusError и httpx.TimeoutException — json.JSONDecodeError пробрасывается вверх"
  - "generate_image() использует /chat/completions с modalities=['image'] — НЕ /images/generations"
  - "DEFAULT_IMAGE_MODEL = flux.2-klein-4b — самая быстрая/дешёвая в FLUX.2 семействе"
  - "EntitySynthesisService: убран gemini_client параметр из __init__ — клиент получается через get_openrouter_client()"
metrics:
  duration: "~34 мин"
  completed_date: "2026-03-01"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 4
  tests_added: 33
  tests_passing: 33
---

# Phase 3 Plan 01: Создание OpenRouter клиента и миграция первых двух сервисов

## Одна строка

OpenRouter клиент с fallback chain (Gemini 3 Flash → Claude Haiku 4.5 → Gemini 2.5 Flash Lite) + миграция entity_synthesis и consistency_manager с google-genai на OpenRouter httpx.

## Итоги выполнения

### Что сделано

**Task 1: Создан OpenRouter клиент (TDD)**

Создан `backend/app/core/openrouter_client.py` — единый клиент для всех AI-вызовов:
- `generate_text()` — JSON mode (заменяет `response_mime_type="application/json"` из google-genai)
- `generate_structured()` — JSON Schema mode с inlined schema (заменяет `response_schema=PydanticModel`)
- `generate_image()` — POST `/chat/completions` с `modalities=["image"]` (НЕ `/images/generations`)
- `_inline_defs()` — рекурсивное разворачивание `$defs/$ref` для Google моделей через OpenRouter
- FALLBACK_MODELS: 3 модели в цикле, fallback только на `httpx.HTTPStatusError` и `httpx.TimeoutException`
- Интеграция с `metrics.py`: `record_llm_request()` и `record_llm_error()` при каждом вызове
- `get_openrouter_client()` singleton с lazy init из `settings.OPENROUTER_API_KEY`

Добавлено в `config.py`:
- `OPENROUTER_API_KEY: str = ""`
- `OPENROUTER_IMAGE_MODEL: str = "black-forest-labs/flux.2-klein-4b"`

Создано 16 тестов в `tests/core/test_openrouter_client.py`.

**Task 2: Мигрированы entity_synthesis и consistency_manager (TDD)**

`entity_synthesis_service.py`:
- `_call_gemini()` заменён: google.genai → `get_openrouter_client().generate_text()`
- Убран `gemini_client` параметр из `__init__`
- Убран `import google.genai.types as types` и зависимость от `extractor._client`
- Сохранена логика `parse_json_safe()` после получения ответа

`consistency_manager.py`:
- `optimize_book_entities()`: google.genai блок заменён на `get_openrouter_client().generate_text()`
- Убраны `import google.genai.types as types`, мёртвый код `extractor.is_available()`
- Сохранена вся логика merge/delete операций и commit
- Добавлен `import get_openrouter_client` на уровне модуля

Добавлено 17 тестов: 8 в `test_entity_synthesis.py` + 5 в `test_consistency_manager.py`.

## Верификация

```
✓ openrouter_client.py создан с тремя методами и _inline_defs
✓ OPENROUTER_API_KEY добавлен в config.py
✓ OPENROUTER_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b" в config.py
✓ generate_image() использует /chat/completions с modalities=["image"]
✓ Fallback ловит ТОЛЬКО httpx.HTTPStatusError и httpx.TimeoutException
✓ entity_synthesis_service.py вызывает openrouter_client.generate_text()
✓ consistency_manager.py вызывает openrouter_client.generate_text()
✓ Оба файла НЕ содержат import google.genai
✓ Все 33 теста проходят
```

## Отклонения от плана

### Автоматически исправленные проблемы

**1. [Rule 1 - Bug] httpx.Response без request объекта вызывает RuntimeError при raise_for_status()**

- **Обнаружено во время:** Task 1 (TDD GREEN фаза)
- **Проблема:** `httpx.Response(status_code=200, content=..., headers=...)` без `request=` выбрасывает `RuntimeError: Cannot call raise_for_status as the request instance has not been set` при вызове `resp.raise_for_status()`
- **Исправление:** В тестовом хелпере `_make_response()` добавлен `request=httpx.Request("POST", url)`
- **Файлы:** `tests/core/test_openrouter_client.py`

**2. [Rule 1 - Bug] Некорректная оценка условного выражения в assert**

- **Обнаружено во время:** Task 2 (TDD GREEN фаза)
- **Проблема:** `call_kwargs.kwargs.get("prompt") or call_kwargs.args[0] if call_kwargs.args else ""` — из-за приоритета операторов Python выражение вычислялось как `(result_of_or) if condition else ""`, что давало пустую строку когда `prompt` передан как keyword arg
- **Исправление:** Явные скобки: `call_kwargs.kwargs.get("prompt") or (call_kwargs.args[0] if call_kwargs.args else "")`
- **Файлы:** `tests/services/test_entity_synthesis.py`

## Self-Check: PASSED

| Артефакт | Статус |
|----------|--------|
| `backend/app/core/openrouter_client.py` | FOUND |
| `backend/tests/core/test_openrouter_client.py` | FOUND |
| `backend/tests/services/test_consistency_manager.py` | FOUND |
| commit `ce7e910` (test RED) | FOUND |
| commit `ae81d9b` (openrouter_client) | FOUND |
| commit `454ea22` (migration) | FOUND |
| 33 тестов passing | PASSED |
