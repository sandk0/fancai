---
phase: 03-migration-services
plan: 02
subsystem: ai-services
tags: [openrouter, migration, structured-output, gemini-extractor, entity-dedup]
dependency_graph:
  requires: [03-01]
  provides: [gemini_extractor-openrouter, entity_dedup-openrouter]
  affects: [book_tasks.py, images.py]
tech_stack:
  added: []
  patterns: [generate_structured-with-pydantic-schema, _inline_defs-for-nested-models]
key_files:
  created: []
  modified:
    - backend/app/services/gemini_extractor.py
    - backend/app/services/entity_deduplication_service.py
    - backend/tests/services/test_gemini_extractor.py
    - backend/tests/services/test_entity_deduplication.py
    - backend/requirements.txt
decisions:
  - "_inline_defs из openrouter_client.py корректно разворачивает Optional поля в DeduplicationResponse — anyOf:[type,null] обрабатывается правильно"
  - "google-genai остаётся в requirements.txt до Plan 03-03 — imagen_generator.py ещё использует SDK"
  - "asyncio.to_thread убран из _call_gemini_with_retry и _call_gemini_tsa — httpx.AsyncClient полностью async"
  - "data-обёртка legacy ответов сохранена в обоих методах — обратная совместимость"
metrics:
  duration: "~35 мин"
  completed_date: "2026-03-01"
  tasks_completed: 2
  files_modified: 5
---

# Phase 3 Plan 02: Миграция gemini_extractor и entity_dedup на OpenRouter

Мигрированы два сложных LLM-сервиса с google-genai SDK на OpenRouter generate_structured() — сервисы со structured output через вложенные Pydantic модели.

## Обзор

Два финальных LLM-сервиса (из 4 в фазе 3) переведены на OpenRouter:
- `gemini_extractor.py` — самый сложный: TSA-режим + legacy-режим, оба через `generate_structured()`
- `entity_deduplication_service.py` — `DeduplicationResponse` с Optional полями, корректно обрабатывается `_inline_defs`

## Выполненные задачи

### Задача 1: Миграция gemini_extractor на OpenRouter (commits: f4186b5)

**Изменения в `backend/app/services/gemini_extractor.py`:**
- Убран `from google import genai` и `from google.genai import types`
- Добавлен `from app.core.openrouter_client import get_openrouter_client`
- `_initialize()` — заменён `genai.Client(api_key=...)` на `get_openrouter_client()`; убран `self._types`; убран try/except для ImportError google-genai
- `_call_gemini_with_retry()` — заменён `asyncio.to_thread(self._client.models.generate_content, ...)` на `await self._client.generate_structured(prompt=prompt, schema_class=GeminiResponseSchema, temperature=0.3)`
- `_call_gemini_tsa()` — аналогично с `schema_class=GeminiTSAResponseSchema`
- Оба метода: убраны asyncio.TimeoutError обработчики (timeout теперь внутри httpx), упрощена обработка ошибок
- Сохранена логика data-обёртки, промпты без изменений, tenacity retry декораторы

**Обновлены тесты `test_gemini_extractor.py`:**
- Удалены все mock google-genai fixtures
- Добавлены тесты: `TestNoGoogleGenaiImport` (3 теста), `TestCallGeminiWithRetry` (5 тестов), `TestCallGeminiTSA` (3 теста)
- Все 27 тестов проходят

### Задача 2: Миграция entity_dedup на OpenRouter, пометка google-genai (commit: fbabc3a)

**Изменения в `backend/app/services/entity_deduplication_service.py`:**
- Убраны `import google.genai as genai`, `from google.genai import types`, `from app.core.config import settings`
- Добавлен `from app.core.openrouter_client import get_openrouter_client`
- `_call_gemini()` — заменён `client.aio.models.generate_content(...)` на `await client.generate_structured(prompt=prompt, schema_class=DeduplicationResponse, temperature=0.1)`
- Убраны lazy-импорты внутри метода; клиент теперь через `get_openrouter_client()` напрямую

**Обновлены тесты `test_entity_deduplication.py`:**
- Добавлен класс `TestOpenRouterMigration` (4 теста): no google.genai import, get_openrouter_client присутствует, _inline_defs корректно обрабатывает Optional поля, generate_structured вызывается с правильным schema_class
- Все 17+4=21 тестов проходят

**Изменения в `requirements.txt`:**
- Строка google-genai помечена как `TODO(03-03): remove after imagen_generator.py migrated to OpenRouter`
- Зависимость сохранена — imagen_generator.py ещё использует google-genai SDK

## Итоги верификации

```
60 passed (test_entity_deduplication + test_gemini_extractor + test_openrouter_client)
```

Все 4 LLM-сервиса теперь используют OpenRouter:
- `entity_synthesis_service.py` — generate_text() (Plan 03-01)
- `consistency_manager.py` — generate_text() (Plan 03-01)
- `gemini_extractor.py` — generate_structured(GeminiResponseSchema / GeminiTSAResponseSchema) (этот план)
- `entity_deduplication_service.py` — generate_structured(DeduplicationResponse) (этот план)

```bash
# Проверка: нет import google в мигрированных LLM-файлах
grep -r "import google" app/services/entity_synthesis_service.py app/services/consistency_manager.py app/services/gemini_extractor.py app/services/entity_deduplication_service.py
# → нет вывода (все чисто)

# Проверка: нет asyncio.to_thread в gemini_extractor
grep "asyncio.to_thread" app/services/gemini_extractor.py
# → нет вывода

# Проверка: все 4 сервиса используют openrouter_client
grep "get_openrouter_client" app/services/entity_synthesis_service.py app/services/consistency_manager.py app/services/gemini_extractor.py app/services/entity_deduplication_service.py
# → все 4 файла содержат get_openrouter_client
```

## Отклонения от плана

Нет — план выполнен точно. Google-genai не удалён из requirements.txt согласно примечанию в плане: imagen_generator.py мигрируется в Plan 03-03.

## Self-Check: PASSED

Файлы существуют:
- FOUND: backend/app/services/gemini_extractor.py
- FOUND: backend/app/services/entity_deduplication_service.py
- FOUND: backend/tests/services/test_gemini_extractor.py
- FOUND: backend/tests/services/test_entity_deduplication.py

Коммиты существуют:
- FOUND: f4186b5 (feat(03-02): migrate gemini_extractor)
- FOUND: fbabc3a (feat(03-02): migrate entity_dedup)
