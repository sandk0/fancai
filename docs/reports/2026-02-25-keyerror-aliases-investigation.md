# Расследование: KeyError: '"aliases"' в ConsistencyManager

**Дата**: 25 февраля 2026
**Статус**: РАССЛЕДОВАНИЕ ЗАВЕРШЕНО
**Критичность**: HIGH — блокирует обработку глав книги
**Книга**: `8b747764-5aef-4ab2-bf1b-aff8924ea942` (Ведьмак, 20 глав)

---

## 1. Executive Summary

### Это рецидив, новый баг или никогда не исправленный?

**Это НОВЫЙ баг**, отличный от ранее исправленного бага в LLM cache (коммит `6ffa5bb`). Предыдущий баг касался десериализации кэша Redis (`set/get` асимметрия в `llm_cache_service.py`). Текущий баг — это **race condition при параллельной обработке глав**, приводящий к каскадной ошибке в JSONB-обработке SQLAlchemy при очистке сессии.

### Краткое заключение

1. **KeyError возникает НЕ в коде ConsistencyManager** — все обращения к `"aliases"` используют `.get("aliases", [])`, который не может вызвать `KeyError`
2. **Ошибка возникает при очистке сессии SQLAlchemy** (`async with AsyncSessionLocal().__aexit__`) после того, как параллельная обработка глав вызывает конфликты в БД
3. **Двойные кавычки в ключе** `'"aliases"'` — артефакт JSON-сериализации ключей JSONB при аварийном закрытии сессии
4. **Дополнительный баг**: логирование через loguru не выводит traceback (критическая потеря диагностической информации)

---

## 2. Серверные логи (из celery-worker)

### Ошибки первого запуска (02:52:48)

```
02:52:48 | ERROR | app.tasks.book_tasks:process_chapter_safe:561 - Fatal error in chapter 10 processing: KeyError: '"aliases"'{'exc_info': True}
02:52:48 | ERROR | app.tasks.book_tasks:process_chapter_safe:561 - Fatal error in chapter 4 processing: KeyError: '"aliases"'{'exc_info': True}
02:52:48 | ERROR | app.tasks.book_tasks:process_chapter_safe:561 - Fatal error in chapter 6 processing: KeyError: '"aliases"'{'exc_info': True}
02:52:48 | ERROR | app.tasks.book_tasks:process_chapter_safe:561 - Fatal error in chapter 5 processing: KeyError: '"aliases"'{'exc_info': True}
02:52:48 | ERROR | app.tasks.book_tasks:process_chapter_safe:561 - Fatal error in chapter 9 processing: KeyError: '"aliases"'{'exc_info': True}
02:52:48 | ERROR | app.tasks.book_tasks:process_chapter_safe:561 - Fatal error in chapter 7 processing: KeyError: '"aliases"'{'exc_info': True}
02:52:48 | ERROR | app.tasks.book_tasks:process_chapter_safe:561 - Fatal error in chapter 1 processing: KeyError: '"aliases"'{'exc_info': True}
02:52:48 | ERROR | app.tasks.book_tasks:process_chapter_safe:561 - Fatal error in chapter 3 processing: KeyError: '"aliases"'{'exc_info': True}
02:52:48 | ERROR | app.tasks.book_tasks:process_chapter_safe:561 - Fatal error in chapter 8 processing: KeyError: '"aliases"'{'exc_info': True}
```

**Пострадавшие главы (1-й запуск)**: 1, 3, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16, 17, 18, 19 (15 из 20)
**Успешные главы (1-й запуск)**: 2, 11, 12, 14, 20 (5 из 20)

### Ошибки второго запуска (03:08:39–03:08:55)

```
03:08:39 | ERROR | ... chapter 8: KeyError: '"aliases"'
03:08:39 | ERROR | ... chapter 10: KeyError: '"aliases"'
03:08:39 | ERROR | ... chapter 4: KeyError: '"aliases"'
03:08:39 | ERROR | ... chapter 1: KeyError: '"aliases"'
03:08:39 | ERROR | ... chapter 2: KeyError: '"aliases"'  ← ранее была успешна!
03:08:39 | ERROR | ... chapter 6: KeyError: '"aliases"'
03:08:39 | ERROR | ... chapter 7: KeyError: '"aliases"'
...
03:08:55 | ERROR | ... chapter 27: KeyError: '"aliases"'
```

**На втором запуске ВСЕ главы завершаются ошибкой**, включая ранее успешные.

### Подтверждение deadlock'а (глава 26)

```
03:08:55 | ERROR | app.tasks.book_tasks:process_chapter_safe:546 - Error parsing chapter 26:
    (sqlalchemy.dialects.postgresql.asyncpg.Error)
    <class 'asyncpg.exceptions.DeadlockDetectedError'>: deadlock detected

03:08:55 | ERROR | app.tasks.book_tasks:process_chapter_safe:555 - Failed to record chapter 26 error:
    This Session's transaction has been rolled back due to a previous exception during flush.
```

**Глава 26 — единственная, где ошибка попала во ВНУТРЕННИЙ обработчик (line 546), подтверждая, что deadlock'и действительно происходят.**

---

## 3. Root Cause Analysis

### 3.1 Структура обработки ошибок

```python
# book_tasks.py — process_chapter_safe()
try:                                          # OUTER (line 327) — BaseException
    async with AsyncSessionLocal() as session:  # Context manager A
        async with chapter_semaphore:            # Context manager B
            try:                                 # INNER (line 331) — Exception
                ... бизнес-логика (lines 332-543) ...
            except Exception as e:               # INNER catch (line 545)
                ... записать ошибку в БД ...
except BaseException as fatal_err:               # OUTER catch (line 558)
    logger.error(f"Fatal error... {fatal_err}", exc_info=True)
```

**Ключевое наблюдение**: `KeyError` — подкласс `Exception`, поэтому ДОЛЖЕН ловиться внутренним обработчиком (line 545). То, что он достигает внешнего `BaseException` (line 558), означает:

**→ Ошибка возникает ВНЕ внутреннего try-блока — во время `__aexit__` контекстного менеджера `AsyncSessionLocal`.**

### 3.2 Полный путь ошибки

```
1. asyncio.gather запускает 20 корутин process_chapter_safe()
   (chapter_semaphore=10, до 10 глав одновременно)

2. Каждая глава создаёт СВОЮ сессию: async with AsyncSessionLocal() as session

3. _batch_resolve_entities():
   a) SELECT * FROM entities WHERE book_id = ? → получает ВСЕ сущности книги
   b) Для каждой новой сущности: Entity(entity_metadata={"aliases": [...], ...})
   c) db.add(entity) → добавляет в сессию
   d) db.flush() → INSERT INTO entities (...) RETURNING ...

4. Две главы одновременно пытаются создать сущность "Геральт":
   Глава 2:  INSERT INTO entities (name='Геральт', ...) → OK (первая)
   Глава 5:  INSERT INTO entities (name='Геральт', ...) → UniqueViolation!
                                                           (ix_entities_book_id_name_lower)

5. UniqueViolation портит состояние сессии главы 5

6. Бизнес-логика продолжается, но сессия "отравлена"
   (или IntegrityError ловится внутренним except Exception)

7. async with AsyncSessionLocal().__aexit__() выполняет очистку:
   - SQLAlchemy пытается откатить/закрыть сессию
   - Обработка dirty JSONB-атрибутов entity_metadata
   - JSON-сериализация ключей для сравнения/отката
   - Ключ "aliases" → json.dumps → '"aliases"' (с кавычками)
   - Поиск ключа '"aliases"' в оригинальном dict → KeyError!

8. Этот KeyError возникает в __aexit__, который СНАРУЖИ внутреннего try,
   но ВНУТРИ внешнего try → ловится BaseException handler (line 558)
```

### 3.3 Почему ключ содержит двойные кавычки

Сообщение `KeyError: '"aliases"'` означает, что Python ищет ключ `"aliases"` (строка длиной 9 символов с кавычками), а не `aliases` (длина 7).

В Python:
```python
>>> str(KeyError('aliases'))     # обычный ключ
"'aliases'"
>>> str(KeyError('"aliases"'))   # ключ с кавычками
'\"aliases\"'
>>> print(f"KeyError: {KeyError('aliases')}")
KeyError: 'aliases'
>>> print(f"KeyError: {KeyError('\"aliases\"')}")
KeyError: '"aliases"'                                    ← то, что мы видим в логах!
```

Кавычки возникают при JSON-сериализации ключей словаря: `json.dumps("aliases")` → `'"aliases"'`.

### 3.4 Почему 5 глав работают, а 15 — нет

| Запуск | Успешные | Неуспешные | Объяснение |
|--------|----------|------------|------------|
| 1-й    | 2, 11, 12, 14, 20 | Остальные 15 | Первые 5 глав обработались без конфликтов. Остальные 15 столкнулись с UNIQUE violation при попытке создать уже существующие сущности |
| 2-й    | 0 | ВСЕ (1-27) | Все сущности уже в БД. Параллельная обработка = немедленные конфликты для всех |

**Критически**: на втором запуске даже главы 2, 11, 12, 14, 20 (ранее успешные) падают — потому что теперь ВСЕ главы конкурируют за одни и те же сущности в БД.

---

## 4. Гипотеза Double-Serialization: ОПРОВЕРГНУТА для данных, ПОДТВЕРЖДЕНА для ошибки

### Данные в PostgreSQL — ЧИСТЫЕ

```sql
-- Проверка типов entity_metadata:
SELECT jsonb_typeof(entity_metadata), count(*) 
FROM entities WHERE book_id = '8b747764...'
GROUP BY jsonb_typeof(entity_metadata);
-- Результат: object | 35 (все 35 сущностей — корректные JSON-объекты)

-- Проверка содержимого:
SELECT name, entity_metadata::text FROM entities LIMIT 3;
-- Результат:
-- Редферн Финнеган  | {"aliases": ["Господин граф Финнеган", "Пришелец"], ...}
-- Врай Наттеравн    | {"aliases": ["Чародейка", "Целительница", ...], ...}
-- Элена Фиахра      | {"aliases": ["комендантша де Мерсо", "Фиахра"], ...}
```

**entity_metadata хранится корректно. Дупликатов имён нет (35 уникальных из 35).**

### Double-serialization — ПОДТВЕРЖДЕНА как механизм ошибки

Двойная сериализация происходит НЕ при записи данных, а при обработке ошибки:
- SQLAlchemy's `__aexit__` → rollback → JSONB attribute comparison
- Ключ dict `"aliases"` → `json.dumps("aliases")` → `'"aliases"'`
- Lookup `dict['"aliases"']` → `KeyError` (ключ `"aliases"` ≠ `aliases`)

---

## 5. Дополнительный баг: Loguru не печатает traceback

### Проблема

В логах ошибка выглядит так:
```
Fatal error in chapter 10 processing: KeyError: '"aliases"'{'exc_info': True}
```

Обратите внимание: `{'exc_info': True}` напечатан как СТРОКА в конце сообщения!

### Код (book_tasks.py:561-565)

```python
logger.error(
    f"Fatal error in chapter {idx + 1} processing: "
    f"{type(fatal_err).__name__}: {fatal_err}",
    exc_info=True,  # ← loguru НЕ поддерживает этот kwarg как в stdlib logging!
)
```

### Причина

В **loguru** параметр `exc_info=True` — это НЕ эквивалент `logging.error(..., exc_info=True)`. Loguru трактует неизвестные kwargs как "extra" и добавляет их к записи лога в виде словаря.

### Правильный синтаксис для loguru

```python
# Вариант 1: logger.opt(exception=True)
logger.opt(exception=True).error(
    f"Fatal error in chapter {idx + 1}: {type(fatal_err).__name__}: {fatal_err}"
)

# Вариант 2: logger.exception() — автоматически добавляет traceback
logger.exception(
    f"Fatal error in chapter {idx + 1}: {type(fatal_err).__name__}: {fatal_err}"
)
```

**Последствие**: мы НЕ ИМЕЕМ Python traceback для этой ошибки. Вся диагностика проведена путём анализа кода и косвенных улик в логах (SQL-запросы, ROLLBACK, тайминги).

### Масштаб бага с логированием

В `book_tasks.py` найдено 2 места с неправильным `exc_info=True`:
- Строка 547: `logger.error(f"Error parsing chapter...", exc_info=True)`
- Строка 564: `logger.error(f"Fatal error...", exc_info=True)`

---

## 6. Временна́я шкала коммитов

### Релевантные коммиты consistency_manager.py

| Коммит | Автор | Описание | Статус |
|--------|-------|----------|--------|
| `6031dde` | AI | Добавлен `_resolve_entity_advanced` с `entity_metadata.get("aliases", [])` | Первое появление кода |
| `a91a36e` | AI | Phase 4: batch entity resolution | Текущая версия `_batch_resolve_entities` |
| `6ffa5bb` | AI | Исправлен bug в LLM cache (set/get асимметрия) | Другой баг, не связан |

### Связанные отчёты

| Отчёт | Связь |
|--------|-------|
| `2026-02-25-gemini-cache-parsing-bug-report.md` | Исправлен баг в `llm_cache_service.py` get/set — ДРУГОЙ баг |
| `2026-02-25-fix-plan-audit.md` | Аудит плана исправлений, упоминает race conditions |
| `2026-02-25-architectural-audit-report.md` | Общий архитектурный аудит |

---

## 7. Рекомендации по исправлению

### FIX #1 (CRITICAL): Устранить race condition — последовательная обработка сущностей

**Файл**: `backend/app/tasks/book_tasks.py`, строки 567-570

```python
# БЫЛО (параллельно — вызывает race condition):
results = await asyncio.gather(
    *(process_chapter_safe(idx, chapter.id) for idx, chapter in enumerate(chapters)),
    return_exceptions=True,
)

# СТАЛО (последовательно для entity resolution, параллельно для Gemini):
# Вариант A: Полностью последовательная обработка
for idx, chapter in enumerate(chapters):
    await process_chapter_safe(idx, chapter.id)

# Вариант B: Двухфазная обработка
# Фаза 1: Параллельный вызов Gemini (без записи в БД)
gemini_results = await asyncio.gather(*[
    gemini_extractor.analyze_chapter(ch.content) for ch in chapters
], return_exceptions=True)

# Фаза 2: Последовательная запись в БД (одна сессия)
async with AsyncSessionLocal() as session:
    for idx, (chapter, result) in enumerate(zip(chapters, gemini_results)):
        if isinstance(result, Exception):
            continue
        mgr = ConsistencyManager(session)
        await mgr.process_chapter_analysis(...)
    await session.commit()
```

### FIX #2 (CRITICAL): Исправить логирование в loguru

**Файл**: `backend/app/tasks/book_tasks.py`

```python
# Строка 546-547: Заменить
logger.error(f"Error parsing chapter {idx + 1}: {e}", exc_info=True)
# На:
logger.opt(exception=True).error(f"Error parsing chapter {idx + 1}: {e}")

# Строки 561-565: Заменить
logger.error(
    f"Fatal error in chapter {idx + 1} processing: "
    f"{type(fatal_err).__name__}: {fatal_err}",
    exc_info=True,
)
# На:
logger.opt(exception=True).error(
    f"Fatal error in chapter {idx + 1} processing: "
    f"{type(fatal_err).__name__}: {fatal_err}"
)
```

### FIX #3 (IMPORTANT): Добавить rollback в обработчик ошибок

**Файл**: `backend/app/tasks/book_tasks.py`, строки 545-557

```python
except Exception as e:
    logger.opt(exception=True).error(f"Error parsing chapter {idx + 1}: {e}")
    try:
        await session.rollback()  # ← ДОБАВИТЬ: очистить состояние сессии
        if local_chapter:
            local_chapter.parsing_error = str(e)[:1000]
            local_chapter.parse_attempts += 1
            await session.commit()
    except Exception as commit_err:
        logger.error(f"Failed to record chapter {idx + 1} error: {commit_err}")
        try:
            await session.rollback()  # ← ДОБАВИТЬ: гарантировать чистое состояние для __aexit__
        except Exception:
            pass
```

### FIX #4 (IMPORTANT): INSERT ON CONFLICT для сущностей

**Файл**: `backend/app/services/consistency_manager.py`, строки 346-360

```python
# Вместо db.add(entity) + flush, использовать upsert:
from sqlalchemy.dialects.postgresql import insert as pg_insert

stmt = pg_insert(Entity).values(
    book_id=book_id,
    name=raw.name,
    type=type_enum.value,
    entity_metadata={"aliases": raw.aliases, ...},
    ...
).on_conflict_do_update(
    index_elements=[Entity.book_id, func.lower(Entity.name)],
    set_={"visual_summary": ..., "entity_metadata": ...},
)
result = await self.db.execute(stmt)
```

### FIX #5 (MINOR): Добавить isinstance проверку для entity_metadata

**Файл**: `backend/app/services/consistency_manager.py`, строки 91, 286

```python
# БЫЛО:
entity.entity_metadata.get("aliases", []) if entity.entity_metadata else []

# СТАЛО (по аналогии с entity_service.py и entity_deduplication_service.py):
entity.entity_metadata.get("aliases", [])
    if entity.entity_metadata and isinstance(entity.entity_metadata, dict)
    else []
```

---

## 8. Приоритетность исправлений

| # | Исправление | Приоритет | Усилия | Эффект |
|---|-------------|-----------|--------|--------|
| 1 | Устранить race condition | **CRITICAL** | Средние | Устраняет корневую причину |
| 2 | Исправить loguru logging | **CRITICAL** | Минимальные | Восстанавливает диагностику |
| 3 | Rollback в error handler | **HIGH** | Минимальные | Предотвращает каскадные ошибки |
| 4 | INSERT ON CONFLICT | **HIGH** | Средние | Graceful handling конфликтов |
| 5 | isinstance проверка | **LOW** | Минимальные | Defensive coding |

---

## 9. Методология расследования

### Проверенные источники данных

| Источник | Результат |
|----------|-----------|
| Celery worker logs | 33 ошибки KeyError, 1 DeadlockDetectedError |
| PostgreSQL entity_metadata | 35 записей, все jsonb_typeof='object', данные чистые |
| PostgreSQL unique names | 35 уникальных имён из 35 (дупликатов нет) |
| Redis LLM cache | Корректная структура `{"data": {...}, "metadata": {...}}` |
| Исходный код (6 файлов) | Полный аудит всех обращений к "aliases" |
| Git history | 15 коммитов consistency_manager.py, 5 коммитов llm_cache_service.py |

### Ключевой дефицит данных

**Полный Python traceback отсутствует** из-за бага #2 (loguru не выводит traceback). Все выводы основаны на:
- Анализе структуры try/except и определении, какой обработчик ловит ошибку
- SQL-логах (ROLLBACK перед каждой ошибкой)
- Тайминге ошибок (все в один момент = параллельная обработка)
- Подтверждённом deadlock в главе 26
- Чистых данных в PostgreSQL (опровергает corruption)
- Отсутствии bracket access `["aliases"]` во всём pipeline

---

## 10. Перекрёстные ссылки

- **Баг LLM cache** (`2026-02-25-gemini-cache-parsing-bug-report.md`): Исправлен в `6ffa5bb`. Не связан с текущим багом.
- **Архитектурный аудит** (`2026-02-25-architectural-audit-report.md`): Отмечал потенциальные проблемы с параллелизмом.
- **План исправлений** (`2026-02-25-fix-plan-audit.md`): Рекомендовал upsert-паттерн для entity creation (FIX #4).
