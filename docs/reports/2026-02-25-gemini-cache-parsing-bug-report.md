# Gemini LLM Cache Parsing Bug — Root Cause Analysis

**Дата:** 2026-02-25
**Scope:** `backend/app/services/llm_cache_service.py`, `backend/app/services/gemini_extractor.py`
**Триггер:** Книга `ce28a54e` обрабатывается за 2 секунды с 0 описаниями

## Executive Summary

Метод `LLMCacheService.set()` оборачивает данные в `{"data": value, "metadata": {...}}`, но `get()` возвращает полную обёртку, не извлекая `value`. При чтении из кэша `GeminiTSAResponseSchema.model_validate(cached)` получает `{data, metadata}` вместо ожидаемого `{tagged_text, entities, relationships}` — и всегда падает с 3 validation errors. Баг проявляется только при **повторной** обработке текста (cache HIT). Первичная обработка (cache MISS → Gemini API) работает корректно.

## Findings

### Finding 1: Асимметрия set/get в LLMCacheService

**`set()` (строки 78-107):**
```python
payload = {
    "data": value,       # ← оборачивает в "data"
    "metadata": {        # ← добавляет служебные данные
        "cached_at": datetime.now(timezone.utc).isoformat(),
        "key_components": asdict(key),
    },
}
serialized = dump_json(payload)
await self._redis.setex(redis_key, ttl, serialized)
```

**`get()` (строки 55-76):**
```python
data = await self._redis.get(redis_key)
return parse_json_safe(data)  # ← возвращает ВЕСЬ payload, включая обёртку
```

Результат: `set(key, X)` → `get(key)` возвращает `{"data": X, "metadata": {...}}`, а не `X`.

### Finding 2: Потребители кэша не знают об обёртке

Оба потребителя кэша валидируют результат `get()` напрямую:

**TSA mode (`_process_chunk_tsa`, строка 947):**
```python
cached = await llm_cache.get(cache_key_obj)
tsa_response = GeminiTSAResponseSchema.model_validate(cached)  # ПАДАЕТ
```

**Legacy mode (`_process_chunk_legacy`, строка 983):**
```python
cached = await llm_cache.get(cache_key_obj)
gemini_response = GeminiResponseSchema.model_validate(cached)  # ТОЖЕ ПАДАЕТ
```

### Finding 3: Почему одни книги работают, другие нет

| Сценарий | Cache | Результат |
|----------|-------|-----------|
| Книга обрабатывается ВПЕРВЫЕ (или текст не кэширован) | MISS | ✅ Gemini API → `_call_gemini_tsa` корректно парсит → сохраняет в кэш |
| Книга с тем же текстом обрабатывается ПОВТОРНО | HIT | ❌ `get()` возвращает `{data, metadata}` → validation error |

**Доказательство из Redis (130 закэшированных записей):**
```json
{"data": {"tagged_text": "БОГАТЫЕ ЗАПАСЫ Шут прибыл...", ...}, "metadata": {"cached_at": "...", ...}}
```

**Ключевой факт:** `book_id="unknown"` в ключе кэша — кэш НЕ привязан к книге. Любой текст с тем же хэшем, промптом и моделью даёт HIT.

### Finding 4: Таймлайн провальной книги `ce28a54e`

```
02:24:35.085 — EPUB загружен, 20 глав в БД
02:24:41.000 — POST /process-descriptions
02:24:42.368 — Gemini extractor инициализирован
02:24:42.899 — Chunk 0 analysis failed: 3 validation errors (×20, все главы)
02:24:43.018 — 20/20 chapters processed, 0 descriptions extracted
02:24:43.384 — Task succeeded in 2.28s
```

Для сравнения, успешная книга `2d75b89e` (первичная обработка): **1518 секунд** (25 минут), 115 описаний.

### Finding 5: `_call_gemini_tsa` уже знает про data-обёртку

Метод `_call_gemini_tsa` (строки 844-846) **уже обрабатывает** `data`-обёртку от Gemini API:
```python
if isinstance(parsed, dict) and "data" in parsed:
    logger.warning("Unwrapping 'data' key from Gemini TSA response")
    parsed = parsed["data"]
```

Но кэш-слой добавляет **вторую** `data`-обёртку, и при чтении из кэша этот unwrapping не применяется.

## Root Cause

**`LLMCacheService.get()` нарушает принцип симметрии с `set()`.** Кэш-сервис добавляет служебную обёртку `{"data": ..., "metadata": ...}` при записи, но не снимает её при чтении. Потребители получают внутреннюю структуру кэша вместо чистых данных.

## Recommendations

| # | Рекомендация | Приоритет | Сложность | Место |
|---|-------------|-----------|-----------|-------|
| 1 | Исправить `get()` — извлекать `["data"]` из payload перед возвратом | P0 | Низкая | `llm_cache_service.py:69` |
| 2 | Существующие 130 записей не нужно чистить — фикс `get()` автоматически распакует их | P1 | — | Redis |
| 3 | Добавить интеграционный тест: `set()` → `get()` → `model_validate()` | P1 | Низкая | `tests/` |

### Рекомендуемый фикс

**`llm_cache_service.py`, метод `get()`, строка 69:**

До:
```python
return parse_json_safe(data, log_error=True)
```

После:
```python
parsed = parse_json_safe(data, log_error=True)
if isinstance(parsed, dict) and "data" in parsed:
    return parsed["data"]
return parsed
```

Это:
- Восстанавливает симметрию set/get
- Автоматически исправляет все 130 существующих записей в Redis
- Не ломает новые записи (проверка `isinstance` + `"data" in`)
- Не требует изменений в потребителях кэша

## Appendix: Affected Files

| Файл | Строки | Описание |
|------|--------|----------|
| `backend/app/services/llm_cache_service.py` | 69, 92-98 | Асимметрия set/get |
| `backend/app/services/gemini_extractor.py` | 947, 983 | Потребители без unwrap |
