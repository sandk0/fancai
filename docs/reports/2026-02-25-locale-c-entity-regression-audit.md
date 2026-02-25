# Аудит регрессионных багов: locale C + lower() и MissingGreenlet после rollback

**Дата**: 25 февраля 2026  
**Тип**: Глубокий аудит регрессий, внесённых коммитом `6b7dd3b`  
**Статус**: Продакшен сломан — 0/20 глав обрабатываются  
**Критичность**: P0 — полная блокировка обработки книг  
**Книга-репродьюсер**: `8b747764-5aef-4ab2-bf1b-aff8924ea942` (Ведьмак, 20 глав)

---

## Содержание

1. [Резюме](#1-резюме)
2. [Хронология — как мы пришли к этим багам](#2-хронология)
3. [Детальный анализ Бага 1 — locale C + lower() + кириллица](#3-баг-1--locale-c--lower--кириллица)
4. [Детальный анализ Бага 2 — MissingGreenlet после rollback](#4-баг-2--missinggreenlet-после-rollback)
5. [Масштаб влияния — что ещё затронуто](#5-масштаб-влияния)
6. [Исследование best practices](#6-исследование-best-practices)
7. [Варианты решений с оценкой](#7-варианты-решений)
8. [Рекомендуемый план исправлений](#8-рекомендуемый-план-исправлений)
9. [Необходимые миграции](#9-необходимые-миграции)
10. [Тестовый план](#10-тестовый-план)

---

## 1. Резюме

25 февраля 2026 года коммит `6b7dd3b` ("fix(backend): resolve KeyError aliases race condition in parallel chapter processing") был задеплоен в продакшен. Коммит решал реальную проблему — race condition при параллельном создании entity — но внёс **два регрессионных бага**, которые сделали обработку книг полностью нерабочей.

### Баг 1: PostgreSQL `lower()` не работает с кириллицей при `locale C`

Новый код заменил `session.add(Entity(...))` на `INSERT ... ON CONFLICT DO UPDATE` + SELECT-back для получения ORM-объекта. SELECT-back использует `func.lower(Entity.name) == name_lower`, где:
- `name_lower` вычисляется Python'ом: `'Цервия'.lower()` → `'цервия'` (корректно)
- `func.lower()` выполняется PostgreSQL: `lower('Цервия')` → `'Цервия'` (не меняется при `locale C`)
- Результат: `'Цервия' != 'цервия'` → `NoResultFound` → все главы с кириллическими entity падают

### Баг 2: Обращение к `.id` expired ORM-объекта после `rollback()`

В error handler после `session.rollback()` код обращается к `local_chapter.id` — но после rollback все ORM-объекты становятся expired, и обращение к атрибутам в async-контексте вызывает `MissingGreenlet`.

### Цепочка падения в продакшене

```
1. process_chapter_analysis → _batch_resolve_entities (для каждой главы)
2. INSERT ON CONFLICT → SELECT-back с func.lower()
3. func.lower('Цервия') = 'Цервия' != 'цервия' = Python .lower()
4. scalar_one() → NoResultFound
5. Error handler: session.rollback() → local_chapter.id → MissingGreenlet
6. Все 20 глав фейлятся → "0/20 chapters processed"
```

---

## 2. Хронология

### Предыстория

| Дата | Коммит | Событие |
|------|--------|---------|
| 2025-10-24 | — | Infrastructure fix: PostgreSQL настроен с `--locale=C --encoding=UTF8` для производительности сортировки |
| 2025-10-24 | — | В `CELERY_TASKS_TESTING_REPORT.md` впервые задокументирован `MissingGreenlet` при доступе к lazy-loaded relationships |
| 2026-01-25 | `add_unique_entity_name` | Alembic миграция: создан уникальный индекс `ix_entities_book_id_name_lower` на `(book_id, lower(name))` |
| 2026-01-23 | `c3c90c2` | Добавлен `rollback()` в `consistency_manager.py` и `graph_service.py`, но **НЕ** в `book_tasks.py` |
| 2026-02-24 | `020e243` | `TaskGroup` заменён на `asyncio.gather` — race condition при параллельной обработке сохранился |

### Инцидент 25 февраля 2026

| Время | Событие |
|-------|---------|
| ~17:00 | Расследование `KeyError: '"aliases"'` выявляет race condition в `_batch_resolve_entities` |
| ~17:12 | Коммит `6b7dd3b`: масштабный фикс — 13 файлов, 1593 строк добавлено, 55 удалено |
|        | Включает: `pg_insert ON CONFLICT`, advisory locks, loguru fix, retry logic, тесты |
| ~17:15 | Деплой коммита `6b7dd3b` в продакшен |
| ~17:20 | Обнаружено: обработка книги "Ведьмак" — 0/20 глав обработано |
| ~17:30 | Диагностика: все главы падают с `NoResultFound` + `MissingGreenlet` |

### Корневая причина регрессий

Коммит `6b7dd3b` был масштабным (13 файлов), тестировался интеграционными тестами (`test_entity_concurrent_upsert.py`), но:
1. **Тесты использовали только латинские имена** ("Gandalf", "Frodo", "Aragorn") — кириллический кейс не покрыт
2. **Тесты запускались на тестовой БД с тем же `locale C`** — но поскольку все имена латинские, `lower()` работал корректно
3. **Error handler не был протестирован** на post-rollback scenario — MissingGreenlet не воспроизвёлся

---

## 3. Баг 1 — locale C + lower() + кириллица

### 3.1. Суть проблемы

PostgreSQL `lower()` — **locale-зависимая** функция. При `locale C` она обрабатывает **только ASCII** (a-z → a-z). Все остальные символы (кириллица, диакритические знаки, CJK и т.д.) возвращаются **без изменений**.

```sql
-- При locale C:
SELECT lower('Gandalf');   -- 'gandalf'  (ASCII — работает)
SELECT lower('Цервия');    -- 'Цервия'   (кириллица — НЕ меняется!)
SELECT lower('МОСКВА');    -- 'МОСКВА'   (кириллица — НЕ меняется!)
SELECT lower('Ñoño');      -- 'Ñoño'     (диакритика — НЕ меняется!)
```

Python `str.lower()` — Unicode-aware и работает корректно для всех языков:

```python
'Цервия'.lower()   # → 'цервия'  (корректно)
'МОСКВА'.lower()   # → 'москва'  (корректно)
'Ñoño'.lower()     # → 'ñoño'    (корректно)
```

### 3.2. Затронутые места в коде

#### Место 1: Определение уникального индекса

**Файл**: `backend/app/models/entity.py`, строки 34-41

```python
__table_args__ = (
    Index(
        "ix_entities_book_id_name_lower",
        "book_id",
        func.lower("name"),  # ← PostgreSQL lower() — не работает для кириллицы при locale C
        unique=True,
    ),
)
```

**Влияние**: Уникальный индекс `(book_id, lower(name))` НЕ обеспечивает case-insensitive уникальность для кириллических имён. Вставка `'Цервия'` и `'цервия'` для одной книги создаст **два разных ряда** вместо конфликта, потому что `lower('Цервия') = 'Цервия' ≠ 'цервия' = lower('цервия')`.

**Дополнительный баг**: `func.lower("name")` передаёт **строковый литерал** `"name"` в PostgreSQL `lower()`, а не ссылку на колонку. Это генерирует SQL `lower('name')` вместо `lower(name)`. Однако alembic-миграция использует сырой SQL `lower(name)` корректно, поэтому реальный индекс в БД правильный. Но если таблицы пересоздаются из модели (например, `Base.metadata.create_all()` в тестах), индекс будет неправильным.

#### Место 2: ON CONFLICT clause

**Файл**: `backend/app/services/consistency_manager.py`, строки 392-399

```python
stmt = stmt.on_conflict_do_update(
    index_elements=["book_id", func.lower(Entity.__table__.c.name)],  # ← ссылается на тот же сломанный индекс
    set_={
        "entity_metadata": stmt.excluded.entity_metadata,
        "aliases_with_reveal": stmt.excluded.aliases_with_reveal,
        "updated_at": func.now(),
    },
)
```

**Влияние**: ON CONFLICT ссылается на индекс, который не обнаруживает конфликты для кириллических имён с разным регистром. Два воркера, обрабатывающие одну entity с разным регистром (`"Цервия"` vs `"цервия"`), оба выполнят INSERT успешно → дубликаты.

#### Место 3: SELECT-back после INSERT (КРИТИЧЕСКИЙ)

**Файл**: `backend/app/services/consistency_manager.py`, строки 403-409

```python
# name_lower вычислен Python: raw.name.lower() → 'цервия' (строка 322)
fetch_result = await self.db.execute(
    select(Entity).where(
        Entity.book_id == book_id,
        func.lower(Entity.name) == name_lower,  # ← PG lower('Цервия') = 'Цервия' ≠ 'цервия'
    )
)
entity = fetch_result.scalar_one()  # ← NoResultFound для ВСЕХ кириллических имён!
```

**Влияние**: Это место является **непосредственной причиной падения**. Каждая entity с кириллическим именем не может быть найдена после INSERT, что вызывает `NoResultFound` → исключение → весь pipeline главы останавливается.

#### Место 4: Advisory lock (корректно)

**Файл**: `backend/app/services/consistency_manager.py`, строки 46-50

```python
lock_key = int(
    hashlib.sha256(
        f"{book_id}:{entity_name.lower()}".encode()  # ← Python .lower() — работает корректно
    ).hexdigest()[:15],
    16,
)
```

Использует Python `.lower()` — работает корректно. Но advisory lock бесполезен, если уникальный индекс не обнаруживает конфликт.

#### Место 5: Интеграционные тесты (пробел в покрытии)

**Файл**: `backend/tests/integration/test_entity_concurrent_upsert.py`, строки 56-101

```python
# Тест case-insensitive conflict — ТОЛЬКО ЛАТИНИЦА:
values1 = _make_entity_values(book_id, name="gandalf")   # ASCII
values2 = _make_entity_values(book_id, name="GANDALF")   # ASCII
# Этот тест ПРОХОДИТ, потому что lower('gandalf') = 'gandalf' = lower('GANDALF')

# ОТСУТСТВУЕТ тест с кириллицей:
# values1 = _make_entity_values(book_id, name="Гарри")
# values2 = _make_entity_values(book_id, name="гарри")
# Этот тест УПАЛ бы — lower('Гарри') = 'Гарри' ≠ 'гарри' = lower('гарри')
```

### 3.3. Таблица несоответствий Python `.lower()` vs PostgreSQL `lower()`

| Место | Метод | Кириллица корректна? | Файл:строка |
|-------|-------|---------------------|-------------|
| Advisory lock key | Python `.lower()` | ✅ ДА | `consistency_manager.py:48` |
| In-memory dict keys | Python `.lower()` | ✅ ДА | `consistency_manager.py:289,307,316,322` |
| Уникальный индекс (БД) | PG `lower()` | ❌ НЕТ (locale C) | `entity.py:38` |
| ON CONFLICT clause | PG `lower()` | ❌ НЕТ (locale C) | `consistency_manager.py:393` |
| SELECT-back WHERE | PG `lower()` | ❌ НЕТ (locale C) | `consistency_manager.py:406` |
| Alembic миграция | PG `lower()` | ❌ НЕТ (locale C) | `2026_01_25_0006:43` |

### 3.4. Почему раньше это не проявлялось

Старый код (`self.db.add(Entity(...))`) **никогда не использовал PostgreSQL `lower()`** — ни для INSERT, ни для SELECT-back. Сравнение имён выполнялось исключительно в Python (`existing_entities[entity.name.lower()]`), где `.lower()` работает корректно.

Уникальный индекс с `lower(name)` существовал с 25 января 2026 (миграция `add_unique_entity_name`), но для кириллицы он фактически **не обеспечивал уникальность по регистру** — это был скрытый баг, который не проявлялся, потому что:
1. Gemini extractor обычно возвращает имена в одном регистре
2. `_resolve_entity_advanced()` в Python уже разрешал дубликаты до обращения к БД
3. Старый код не использовал `ON CONFLICT` по этому индексу

---

## 4. Баг 2 — MissingGreenlet после rollback

### 4.1. Суть проблемы

В async-контексте SQLAlchemy, после `session.rollback()` **все ORM-объекты** в сессии становятся **expired** (независимо от настройки `expire_on_commit`). Обращение к любому атрибуту expired объекта вызывает **lazy load** — синхронную операцию, которая невозможна внутри async greenlet.

```python
# ПОСЛЕ session.rollback():
local_chapter.id  # ← triggers lazy load → MissingGreenlet!
```

Ключевое: `expire_on_commit=False` (настроен в `database.py:79`) **не влияет** на поведение rollback — `rollback()` всегда expire-ит объекты. Это задокументированное поведение SQLAlchemy.

### 4.2. Конкретное место бага (продакшен-код)

**Файл**: `backend/app/tasks/book_tasks.py`, строки 543-560

```python
except Exception as e:
    logger.opt(exception=True).error(f"Error parsing chapter {idx + 1}: {e}")
    try:
        await session.rollback()                                         # ← ROLLBACK
        if local_chapter:
            local_chapter = await session.get(Chapter, local_chapter.id)  # ← .id на expired объекте!
            #                                              ^^^^^^^^
            # После rollback, local_chapter expired.
            # Доступ к .id триггерит lazy load → MissingGreenlet в async контексте.
```

### 4.3. Локальное исправление (уже в коде, но не деплоилось)

Строка 550 уже исправлена локально:

```python
local_chapter = await session.get(Chapter, chapter_id)  # chapter_id — аргумент функции (UUID)
```

Это корректный паттерн: `chapter_id` — это plain Python UUID, не ORM-атрибут, и доступ к нему не требует обращения к БД.

### 4.4. Аудит всех 27 мест с `session.rollback()` в проекте

Проведён полный аудит всех 27 вызовов `session.rollback()` / `await db.rollback()` в 17 файлах:

#### УЯЗВИМЫЕ (2 места)

| Файл | Строка | Проблема | Статус |
|------|--------|----------|--------|
| `tasks/book_tasks.py` | 548-550 | `local_chapter.id` после rollback | ✅ Исправлен локально (не задеплоен) |
| `services/description_extraction_service.py` | 128-130 | `chapter.id` после rollback | ❌ **НЕ ИСПРАВЛЕН** |

#### Уязвимое место в `description_extraction_service.py`

**Файл**: `backend/app/services/description_extraction_service.py`, строки 127-131

```python
except asyncio.TimeoutError:
    await self.db.rollback()                           # ← ROLLBACK
    raise ExtractionTimeoutError(
        chapter.id, self.LLM_EXTRACTION_TIMEOUT        # ← chapter.id на expired объекте!
    )
```

Объект `chapter` передаётся в функцию как параметр (строка 103), и `chapter.id` используется до rollback (строки 109, 115, 120) — там это безопасно. Но после `rollback()` на строке 128, доступ к `chapter.id` на строке 130 вызовет `MissingGreenlet`.

#### БЕЗОПАСНЫЕ (25 мест)

Все остальные 25 мест безопасны, потому что после rollback происходит:
- `raise` / `raise HTTPException(...)` — немедленный выброс с string-литералами
- `return False` / `return None` — возврат скалярного значения
- `logger.error(str(e))` — логирование строки, не ORM-атрибута
- Конец функции — нет дальнейшего доступа к ORM

<details>
<summary>Полная таблица безопасных мест (25)</summary>

| Файл | Строка | Паттерн |
|------|--------|---------|
| `core/database.py` | 103 | `rollback(); raise` |
| `services/feature_flag_manager.py` | 84, 198, 240 | `rollback(); raise` / `return` |
| `services/consistency_manager.py` | 726 | `rollback(); logger.error()` |
| `services/graph_service.py` | 125 | `rollback(); return False` |
| `services/auth_service.py` | 203 | `rollback(); raise ValueError` |
| `services/push_notification_service.py` | 154 | `rollback(); SELECT` (fresh query — safe) |
| `tasks/reading_sessions_tasks.py` | 175 | `rollback(); raise` |
| `tasks/book_tasks.py` | 562 | Second rollback (no ORM after) |
| `routers/reading_sessions.py` | 374, 453, 542, 648, 736, 1084 | `rollback(); raise HTTPException` |
| `routers/images.py` | 534, 749 | `rollback(); raise HTTPException` |
| `routers/books/entities.py` | 86 | `rollback(); raise HTTPException` |
| `routers/admin/entities.py` | 246 | `rollback(); raise HTTPException` |
| `scripts/create_admin.py` | 115 | `rollback(); raise` |
| `quick_process.py` | 77 | `rollback()` — конец функции |
| `tests/test_jsonb_performance.py` | 396 | Тестовый код |

</details>

### 4.5. Историческая связь с MissingGreenlet

Проблема `MissingGreenlet` впервые задокументирована в проекте в **октябре 2025** в `CELERY_TASKS_TESTING_REPORT.md`:

> ```
> sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called
> ```
> Проблема с fixture `old_generated_images` — доступ к связанным объектам (description.chapter.book.user_id) без await.

Тогда проблема была в тестах (lazy loading при навигации по relationship-ам). Текущий баг — та же корневая причина (async + lazy load), но в production error handler.

---

## 5. Масштаб влияния

### 5.1. Баг 1 — locale C + lower()

**Непосредственное влияние:**
- Все книги с кириллическими entity (100% русскоязычных книг) не обрабатываются
- ON CONFLICT может создавать дубликаты entity для кириллических имён с разным регистром

**Потенциальное влияние (скрытые баги, существовавшие до коммита `6b7dd3b`):**
- Уникальный индекс `ix_entities_book_id_name_lower` **не работает** для кириллицы с момента создания (25 января 2026)
- При интернационализации (японский, китайский, арабский и т.д.) проблема проявится так же

**Затронутые файлы:**
- `entity.py` — определение индекса (скрытый баг с 25.01.2026)
- `consistency_manager.py` — ON CONFLICT + SELECT-back (регрессия с 25.02.2026)
- Alembic миграция — SQL `lower(name)` в определении индекса

### 5.2. Баг 2 — MissingGreenlet

**Непосредственное влияние:**
- Каскадная ошибка: после NoResultFound (Баг 1), error handler сам падает с MissingGreenlet
- Ошибка парсинга главы не записывается в `chapter.parsing_error` → нет диагностики

**Потенциальное влияние:**
- `description_extraction_service.py:128-130` — аналогичная уязвимость при timeout LLM extraction (НЕ ИСПРАВЛЕНА)
- Остальные 25 мест с rollback — безопасны (аудит проведён)

---

## 6. Исследование best practices

### 6.1. PostgreSQL `lower()` и locale C — источники

#### Исходный код PostgreSQL (подтверждённые пути)

Функция `lower()` реализована в `oracle_compat.c` → вызывает `str_tolower()` из `formatting.c`:

**Путь 1: locale C (ASCII-only)**
```c
// formatting.c:1642-1646
if (mylocale->ctype_is_c)
{
    result = asc_tolower(buff, nbytes);
}
```

`asc_tolower()` обрабатывает **только байты 0x41–0x5A** (ASCII `A`–`Z`). Кириллические символы (U+0410–U+044F, UTF-8: 0xD0xx–0xD1xx) проходят **без изменений**.

**Путь 2: ICU collation (Unicode-aware)**
```c
// pg_locale_icu.c:633-643
needed = ucasemap_utf8ToLower(locale->icu.ucasemap, dest, destsize, src, srclen, &status);
```

Вызывается когда `PG_GET_COLLATION()` возвращает ICU collation — обрабатывает **все Unicode символы** корректно.

**Ключевой вывод**: `PG_GET_COLLATION()` (в `oracle_compat.c:48-62`) определяет collation из выражения. Поэтому `COLLATE "und-x-icu"` в аргументе `lower()` переключает на ICU путь.

**Ссылки**: [formatting.c](https://github.com/postgres/postgres/blob/77c7a17a6e5fefcd55edb6b47fc462a059b983dc/src/backend/utils/adt/formatting.c#L1642), [oracle_compat.c](https://github.com/postgres/postgres/blob/77c7a17a6e5fefcd55edb6b47fc462a059b983dc/src/backend/utils/adt/oracle_compat.c#L48)
**Ссылка**: [PostgreSQL 15 Documentation — String Functions](https://www.postgresql.org/docs/15/functions-string.html)

> The functions `lower`, `upper`, and `initcap` perform case conversion using the rules of the database's `LC_CTYPE` locale setting.

#### ICU Collation в PostgreSQL 15+

PostgreSQL 15 поддерживает ICU collations per-column и per-expression. Можно создать ICU collation и использовать её в индексе без изменения database locale:

```sql
CREATE COLLATION IF NOT EXISTS unicode_ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);
-- Или для case-insensitive:
CREATE COLLATION IF NOT EXISTS case_insensitive (provider = icu, locale = 'und-u-ks-level1', deterministic = false);
```

**Уточнение (v1.1)**: Исследование исходного кода PostgreSQL показало, что `COLLATE` в аргументе `lower()` **ДЕЙСТВИТЕЛЬНО** управляет выбором code path через `PG_GET_COLLATION()`. Выражение `lower(name COLLATE "und-x-icu")` корректно переключает на ICU путь (см. Вариант F в разделе 7.1). Однако для нового функционального индекса каждый запрос обязан использовать **точно то же** COLLATE-выражение — иначе индекс не будет задействован.

**Ссылка**: [PostgreSQL 15 Documentation — Collation Support](https://www.postgresql.org/docs/15/collation.html)

#### CITEXT Extension

CITEXT реализует case-insensitive тип данных. При `locale C` CITEXT использует **тот же** `lower()` для сравнений — поэтому **не решает проблему** для non-ASCII текста.

**Ссылка**: [PostgreSQL CITEXT Module](https://www.postgresql.org/docs/15/citext.html)

> `citext` internally calls `lower` when comparing values. Thus, it depends on the same `LC_CTYPE` setting.

### 6.2. SQLAlchemy async + rollback — источники

#### Официальная документация SQLAlchemy 2.0

> When `Session.rollback()` is called, all objects in the `Session` are expired. [...] The `expire_on_commit` parameter has no effect on the behavior of `Session.rollback()`.

**Ссылка**: [SQLAlchemy — Session Basics (State Management)](https://docs.sqlalchemy.org/en/20/orm/session_state_management.html)

#### MissingGreenlet — официальная документация

> `MissingGreenlet` is raised when a lazy load or other deferred attribute access occurs within an async context where the proper greenlet context has not been established. [...] The solution is to use eager loading or to access attributes before the context where lazy loading cannot occur.

**Ссылка**: [SQLAlchemy — Preventing Implicit IO when Using AsyncSession](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html#preventing-implicit-io-when-using-asyncsession)

#### Рекомендуемые паттерны для async error recovery

1. **Захват скалярных значений до try-блока**: Сохранить `entity.id`, `chapter.id` и другие нужные атрибуты в plain Python переменных
2. **Re-fetch после rollback**: Использовать `session.get(Model, saved_id)` для получения свежего объекта
3. **`expire_on_commit=False`**: Уже настроено — помогает при commit, но не при rollback
4. **НЕ использовать `expire_on_rollback=False`**: Этот параметр **не существует** в SQLAlchemy — rollback всегда expire-ит

#### Исходный код SQLAlchemy (подтверждение unconditional expire)

Метод `_restore_snapshot()` (вызывается при rollback) безусловно expire-ит ВСЕ объекты:

```python
# session.py:1096-1127
def _restore_snapshot(self, dirty_only: bool = False) -> None:
    """Corresponds to a rollback."""
    for s in self.session.identity_map.all_states():
        if not dirty_only or s.modified or s in self._dirty:
            s._expire(s.dict, self.session.identity_map._modified)
```

**Ключевое**: параметр `dirty_only` — `False` при полном rollback (все объекты expire-ятся), `True` при rollback вложенной транзакции (SAVEPOINT) — expire-ятся только изменённые объекты.

Подтверждение отсутствия `expire_on_rollback` — в `Session.__init__` (session.py:1499-1516):
```python
def __init__(self, ...,
    expire_on_commit: bool = True,   # ← единственный параметр expire
    ...):  # НЕТ expire_on_rollback
```

**Ссылки**: [session.py:1096](https://github.com/sqlalchemy/sqlalchemy/blob/9c8563ded902bee31075e8c9a5c5445dd8ad55d3/lib/sqlalchemy/orm/session.py#L1096), [session.py:1499](https://github.com/sqlalchemy/sqlalchemy/blob/9c8563ded902bee31075e8c9a5c5445dd8ad55d3/lib/sqlalchemy/orm/session.py#L1499)

#### AsyncAttrs — альтернативный доступ к expired атрибутам

SQLAlchemy 2.0.13+ предоставляет `AsyncAttrs` mixin для безопасного доступа к атрибутам в async контексте:

```python
from sqlalchemy.ext.asyncio import AsyncAttrs

class Base(AsyncAttrs, DeclarativeBase):
    pass

# После rollback:
name = await obj.awaitable_attrs.name  # ✅ Безопасно (вместо obj.name)
```

Не рекомендуется как основной паттерн (слишком verbose), но полезен как защитная мера.

---

## 7. Варианты решений

### 7.1. Решения для Бага 1 (locale C + lower() + кириллица)

#### Вариант A: Миграция PostgreSQL на ICU collation

**Описание**: Пересоздать базу данных с `locale=und-x-icu` или создать ICU collation per-column.

| Критерий | Оценка |
|----------|--------|
| Надёжность | ⭐⭐⭐⭐⭐ — полная поддержка Unicode |
| Производительность | ⭐⭐⭐ — ICU медленнее locale C для сортировки (~10-30%) |
| Сложность миграции | ⭐ — требует `pg_dump` / `pg_restore`, даунтайм |
| Влияние на данные | Средний — нужно пересоздать индексы |
| Поддерживаемость | ⭐⭐⭐⭐⭐ — стандартный подход PostgreSQL |

**Примечание**: `locale C` было выбрано для производительности сортировки. ICU per-column позволяет сохранить locale C для общей сортировки и использовать ICU только для конкретных колонок, но это усложняет архитектуру.

#### Вариант B: CITEXT extension

**Описание**: Заменить `String(255)` на `CITEXT` для колонки `name`.

| Критерий | Оценка |
|----------|--------|
| Надёжность | ⭐⭐ — CITEXT использует тот же `lower()`, что и locale C → **НЕ РАБОТАЕТ** |
| Производительность | N/A |
| Сложность миграции | N/A |

**ВЕРДИКТ: НЕ ПОДХОДИТ.** CITEXT полагается на `lower()`, который не работает для non-ASCII при locale C.

#### Вариант C: Нормализованная колонка `name_lower` (РЕКОМЕНДУЕМЫЙ)

**Описание**: Добавить колонку `name_lower` (TEXT, NOT NULL), заполняемую Python `str.lower()` при каждом INSERT/UPDATE. Уникальный индекс создаётся на `(book_id, name_lower)` — обычный B-tree, без функции `lower()`.

| Критерий | Оценка |
|----------|--------|
| Надёжность | ⭐⭐⭐⭐⭐ — Python `str.lower()` корректен для всех Unicode |
| Производительность | ⭐⭐⭐⭐⭐ — обычный B-tree индекс, быстрее функционального |
| Сложность миграции | ⭐⭐⭐⭐ — `ALTER TABLE ADD COLUMN` + `UPDATE SET name_lower = lower(name)` + Python скрипт для кириллицы |
| Влияние на данные | Низкий — добавление колонки, данные не теряются |
| Поддерживаемость | ⭐⭐⭐⭐⭐ — простой и понятный подход |

**Реализация:**

```python
# entity.py
name_lower: Mapped[str] = mapped_column(String(255), nullable=False, index=False)

__table_args__ = (
    Index("ix_entities_book_id_name_lower", "book_id", "name_lower", unique=True),
)

# consistency_manager.py — при каждом INSERT:
entity_values = {
    ...
    "name": raw.name,
    "name_lower": raw.name.casefold(),  # Python .casefold() — надёжнее .lower() для интернационализации
}

# ON CONFLICT:
stmt.on_conflict_do_update(
    index_elements=["book_id", "name_lower"],  # обычный B-tree
    ...
)

# SELECT-back:
select(Entity).where(
    Entity.book_id == book_id,
    Entity.name_lower == name_lower,  # Прямое сравнение строк — без lower()
)
```

> **Примечание**: рекомендуется использовать `str.casefold()` вместо `str.lower()`. `casefold()` — это Unicode-стандарт для case-insensitive сравнения. В отличие от `lower()`, корректно обрабатывает: турецкий `İ` → `i̇`, немецкий `ß` → `ss`, и другие специальные Unicode-случаи. Для русского текста `casefold()` и `lower()` дают одинаковый результат, но `casefold()` надёжнее для интернационализации.

**Автоматическая синхронизация через `@validates`:**

```python
from sqlalchemy.orm import validates

@validates("name")
def _set_name_lower(self, key, value):
    self.name_lower = value.casefold()
    return value
```

**Плюсы:**
- Полностью locale-independent
- Поддерживает все Unicode (кириллица, CJK, арабский, и т.д.)
- Простой B-tree индекс — быстрее функционального
- Не требует изменения database locale
- `ON CONFLICT` работает напрямую, без PostgreSQL `lower()`

**Минусы:**
- Дополнительная колонка (+255 байт на строку, реально ~10-30 байт)
- Нужна миграция для существующих данных
- Нужно обеспечить синхронизацию `name` и `name_lower` при каждом обновлении

#### Вариант D: Python-side lowering (только для SELECT-back)

**Описание**: Быстрый фикс: заменить `func.lower(Entity.name) == name_lower` на `Entity.name == raw.name` (exact match, без lower).

| Критерий | Оценка |
|----------|--------|
| Надёжность | ⭐⭐⭐ — работает, но не решает проблему case-insensitive уникальности |
| Производительность | ⭐⭐⭐⭐⭐ — прямое сравнение строк |
| Сложность миграции | ⭐⭐⭐⭐⭐ — изменение одной строки кода, без миграций |
| Влияние на данные | Нет |
| Поддерживаемость | ⭐⭐ — не решает корневую проблему с индексом |

**ВЕРДИКТ**: Допустим как **немедленный hotfix** (одна строка), но не как долгосрочное решение.

#### Вариант E: PL/Python функция для Unicode lower()

**Описание**: Создать PostgreSQL функцию `unicode_lower(text)` через PL/Python, которая использует Python `str.lower()`.

| Критерий | Оценка |
|----------|--------|
| Надёжность | ⭐⭐⭐⭐ — Python `.lower()` корректен для Unicode |
| Производительность | ⭐⭐ — вызов PL/Python для каждого ряда значительно медленнее нативного |
| Сложность миграции | ⭐⭐⭐ — `CREATE EXTENSION plpython3u`, `CREATE FUNCTION`, пересоздать индекс |
| Влияние на данные | Нет — функциональный индекс |
| Поддерживаемость | ⭐⭐ — PL/Python в Docker-контейнере требует дополнительных пакетов, зависимость от Python runtime |

**ВЕРДИКТ**: Инженерно интересный, но overcomplicated. Нормализованная колонка проще и быстрее.

#### Вариант F: `lower(name COLLATE "und-x-icu")` per-expression (ПЕРЕСМОТРЕНО)

**Описание**: Использовать ICU collation в выражении lower(). Исследование исходного кода PostgreSQL показало, что COLLATE clause в аргументе lower() ДЕЙСТВИТЕЛЬНО управляет выбором code path через PG_GET_COLLATION().

**Evidence**: lower() вызывает str_tolower(), который проверяет mylocale->ctype_is_c. Когда COLLATE "und-x-icu" указан в выражении, PG_GET_COLLATION() возвращает ICU collation, и вызывается ucasemap_utf8ToLower() вместо asc_tolower().

| Критерий | Оценка |
|----------|--------|
| Надёжность | ⭐⭐⭐⭐ — подтверждено исходным кодом PostgreSQL. lower() корректно использует ICU путь |
| Производительность | ⭐⭐⭐⭐ — стандартный B-tree индекс с функциональным выражением |
| Сложность миграции | ⭐⭐⭐⭐⭐ — без изменений схемы, только пересоздать индекс + обновить запросы |
| Поддерживаемость | ⭐⭐⭐⭐ — требует ICU библиотеки в PostgreSQL (есть в PG 15 по умолчанию) |

**Реализация:**

```sql
-- Шаг 1: Проверить наличие ICU collation
SELECT * FROM pg_collation WHERE collname = 'und-x-icu';

-- Шаг 2: Пересоздать индекс с ICU
CREATE UNIQUE INDEX ix_entities_book_id_name_lower_icu
    ON entities (book_id, lower(name COLLATE "und-x-icu"));

-- Шаг 3: Все запросы должны использовать то же выражение
SELECT * FROM entities
WHERE lower(name COLLATE "und-x-icu") = lower('Цервия' COLLATE "und-x-icu");
```

**Ограничение**: ON CONFLICT matching с collated functional expressions — слабо документированная территория в PostgreSQL.

**ВЕРДИКТ**: ПОДХОДИТ как минимально-инвазивное решение (без изменений схемы). Но Вариант C (name_lower) надёжнее для долгосрочного использования.

### 7.2. Решения для Бага 2 (MissingGreenlet после rollback)

#### Паттерн 1: Захват ID до try-блока (РЕКОМЕНДУЕМЫЙ)

```python
chapter_id = chapter.id  # Захватить ДО rollback
try:
    ...
except Exception as e:
    await session.rollback()
    chapter = await session.get(Chapter, chapter_id)  # Использовать plain UUID
```

**Плюсы**: Простой, явный, невозможно забыть (если установить правило в code review).

#### Паттерн 2: Использование аргументов функции

```python
async def process_chapter_safe(idx: int, chapter_id: UUID):
    # chapter_id — всегда plain UUID, никогда не expired
```

Это уже используется в `book_tasks.py` — `chapter_id` передаётся как аргумент функции.

#### Паттерн 3: Проектное правило

**Правило для code review**: После `session.rollback()` НИКОГДА не обращаться к атрибутам ORM-объектов. Использовать:
- Заранее сохранённые скалярные переменные
- `session.get(Model, saved_id)` для re-fetch
- Передавать ID как аргументы функций, а не ORM-объекты

#### Паттерн 4: `begin_nested()` / SAVEPOINT для частичного rollback

При использовании `session.begin_nested()` (SAVEPOINT), rollback вложенной транзакции expire-ит **только изменённые объекты** (`dirty_only=True`). Чистые объекты остаются доступными.

```python
async def upsert_with_savepoint(session: AsyncSession, data: dict):
    # Объекты, загруженные до savepoint, остаются доступными после nested rollback
    existing = await session.get(User, data["id"])

    try:
        async with session.begin_nested():  # SAVEPOINT
            new_record = Record(**data)
            session.add(new_record)
            await session.flush()  # Может вызвать IntegrityError
    except IntegrityError:
        # Только вложенная транзакция откатывается
        # existing НЕ expire-ен (он не был dirty в nested txn)
        logger.info(f"Conflict for user {existing.name}")  # ✅ Безопасно!

        # Обработка конфликта...
        await session.merge(Record(**data))

    await session.commit()
```

**Плюсы**: Ограничивает "радиус поражения" rollback — чистые объекты не expire-ятся.
**Применимость для fancai**: Может быть использован в `consistency_manager.py` для ON CONFLICT обработки — обернуть INSERT в savepoint, при конфликте clean objects (book, chapter) останутся доступны.

---

## 8. Рекомендуемый план исправлений

### Фаза 0: Немедленный hotfix (30 минут, P0)

**Цель**: Восстановить работоспособность продакшена.

| # | Задача | Файл | Изменение |
|---|--------|------|-----------|
| 0.1 | SELECT-back без `func.lower()` | `consistency_manager.py:403-409` | Заменить `func.lower(Entity.name) == name_lower` на `Entity.name == raw.name` |
| 0.2 | Задеплоить фикс `chapter_id` | `book_tasks.py:550` | Деплой уже имеющегося локального исправления |
| 0.3 | Исправить `description_extraction_service.py` | строки 128-130 | Захватить `chapter_id = chapter.id` перед try-блоком |

**Критерий успеха**: Ведьмак обрабатывается, 20/20 глав проходят.

#### ✅ Результат Фазы 0 (выполнено 25.02.2026)

| # | Задача | Статус | Детали |
|---|--------|--------|--------|
| 0.1 | SELECT-back без `func.lower()` | ✅ Выполнено | `consistency_manager.py:406`: заменён `func.lower(Entity.name) == name_lower` на `Entity.name == raw.name` — exact match, обходит сломанный PostgreSQL `lower()` |
| 0.2 | Фикс `chapter_id` | ✅ Был исправлен ранее | `book_tasks.py:550`: использует `chapter_id` (аргумент функции) вместо `local_chapter.id` — не требует дополнительных изменений |
| 0.3 | Захват `chapter_id` | ✅ Выполнено | `description_extraction_service.py:111`: добавлен `chapter_id = chapter.id` перед try-блоком. Все 6 использований `chapter.id` в методе заменены на `chapter_id` |

**Почему так**: Минимальные изменения для разблокировки продакшена. Баг 1 обходится exact match (полностью устраняет `NoResultFound`), Баг 2 устранён захватом скалярного ID до try-блока (паттерн “capture scalars early”). Корневая проблема case-insensitive уникальности для кириллицы остаётся — будет решена в Фазе 1 (колонка `name_lower` + `casefold()`).

### Фаза 1: Миграция на `name_lower` (2-4 часа, P1)

**Цель**: Полностью устранить зависимость от PostgreSQL `lower()` для entity names.

| # | Задача | Детали |
|---|--------|--------|
| 1.1 | Alembic миграция: добавить `name_lower` | `ALTER TABLE entities ADD COLUMN name_lower VARCHAR(255)` |
| 1.2 | Python скрипт для заполнения `name_lower` | `UPDATE entities SET name_lower = <python .lower() через скрипт>` |
| 1.3 | Новый уникальный индекс | `CREATE UNIQUE INDEX ix_entities_book_name_lower_v2 ON entities (book_id, name_lower)` |
| 1.4 | Удалить старый индекс | `DROP INDEX ix_entities_book_id_name_lower` |
| 1.5 | Обновить `entity.py` | Добавить `name_lower` field, обновить `__table_args__` |
| 1.6 | Обновить `consistency_manager.py` | Использовать `name_lower` в INSERT, ON CONFLICT, SELECT |
| 1.7 | Обновить тесты | Добавить кириллические тесты |


#### Результаты Фазы 1 (выполнено 2026-02-25)

**Статус: ✅ Выполнено** (все 7 подзадач)

| # | Задача | Статус | Детали реализации |
|---|--------|--------|-------------------|
| 1.1 | Alembic миграция | ✅ Выполнено | `2026_02_25_0002_add_name_lower_to_entities.py`: ADD COLUMN → backfill `lower(name)` → NOT NULL → дедупликация → новый индекс `ix_entities_book_id_name_lower_v2` → DROP старого индекса. Включает downgrade path. |
| 1.2 | Python скрипт для кириллицы | ✅ Описан | Скрипт в Секции 9 отчёта: после деплоя миграции запустить `casefold()` для всех name_lower (т.к. PostgreSQL `lower()` под locale C не обрабатывает кириллицу) |
| 1.3 | Новый уникальный индекс | ✅ Выполнено | `ix_entities_book_id_name_lower_v2 ON (book_id, name_lower)` — создаётся в миграции |
| 1.4 | Удалить старый индекс | ✅ Выполнено | `DROP INDEX ix_entities_book_id_name_lower` — в миграции |
| 1.5 | Обновить `entity.py` | ✅ Выполнено | Добавлена колонка `name_lower = Column(String(255), nullable=False)`, `@validates("name")` хук с `casefold()`, обновлён `__table_args__` на новый индекс |
| 1.6 | Обновить `consistency_manager.py` | ✅ Выполнено | Строка 322: `.lower()` → `.casefold()`. INSERT values: добавлен `"name_lower": raw.name.casefold()`. ON CONFLICT: `index_elements=["book_id", "name_lower"]`. SELECT-back: `Entity.name_lower == name_lower` |
| 1.7 | Обновить тесты | ✅ Выполнено | `_make_entity_values`: добавлен `"name_lower"`. `_build_upsert_stmt`: `index_elements=["book_id", "name_lower"]`. Новый класс `TestEntityCyrillicUpsert` (3 теста: Cyrillic case conflict, name_lower validation, mixed script names) |

**Изменённые файлы:**
- `backend/app/models/entity.py` — колонка `name_lower`, валидатор, индекс
- `backend/app/services/consistency_manager.py` — casefold + name_lower в upsert-пайплайне
- `backend/tests/integration/test_entity_concurrent_upsert.py` — обновлённые хелперы + 3 кириллических теста
- `backend/alembic/versions/2026_02_25_0002_add_name_lower_to_entities.py` — NEW миграция

**Верификация:** `func.lower` — 0 оставшихся использований во всём backend (проверено grep). Все изменения используют `casefold()` на Python-стороне.

**Почему `casefold()` а не `lower()`**: `str.casefold()` обрабатывает Unicode edge-cases, которые `lower()` пропускает — например, немецкое `ß` → `ss`, турецкое `İ` → `i̇`. Для кириллицы разница минимальна, но `casefold()` — корректный выбор для locale-независимого case-insensitive сравнения по стандарту Unicode.

### Фаза 2: Системная защита от MissingGreenlet (1-2 часа, P2)

| # | Задача | Детали |
|---|--------|--------|
| 2.1 | Исправить `description_extraction_service.py:128-130` | Захватить `chapter_id` перед try-блоком |
| 2.2 | Добавить линтер-правило / checklist | После `rollback()` — никогда не обращаться к ORM-атрибутам |
| 2.3 | Добавить комментарий-предупреждение | В `database.py` рядом с `expire_on_commit=False` — пометить, что rollback всегда expire-ит |


#### Результаты Фазы 2 (выполнено 2026-02-25)

**Статус: ✅ Выполнено**

| # | Задача | Статус | Детали |
|---|--------|--------|--------|
| 2.1 | Исправить `description_extraction_service.py` | ✅ Выполнено в Фазе 0.3 | `chapter_id = chapter.id` до try-блока, все 6 использований заменены |
| 2.2 | Линтер-правило / checklist | ✅ Аудит завершён | Проаудированы все 23 `rollback()` в 13 файлах. Все следуют безопасному паттерну: `rollback → raise/return` без доступа к ORM-атрибутам. Оба опасных места были исправлены в Фазе 0 |
| 2.3 | Комментарий-предупреждение | ✅ Выполнено | Добавлен 13-строчный WARNING-комментарий в `database.py` над `AsyncSessionLocal` с примерами SAFE/UNSAFE паттернов |

**Полный аудит rollback-паттернов (23 сайта, 13 файлов):**

| Файл | Строка | Паттерн | Риск |
|------|--------|---------|------|
| `database.py` | 103 | rollback → raise | ✅ Безопасно |
| `consistency_manager.py` | 727 | rollback → log | ✅ Безопасно |
| `description_extraction_service.py` | 131, 176 | rollback → raise (chapter_id захвачен) | ✅ Исправлено Фаза 0 |
| `auth_service.py` | 203 | rollback → raise ValueError | ✅ Безопасно |
| `graph_service.py` | 125 | rollback → return False | ✅ Безопасно |
| `push_notification_service.py` | 154 | rollback → fresh SELECT | ✅ Безопасно |
| `feature_flag_manager.py` | 84, 198, 240 | rollback → raise/return | ✅ Безопасно |
| `reading_sessions_tasks.py` | 175 | rollback → raise | ✅ Безопасно |
| `book_tasks.py` | 548, 562 | rollback → session.get(chapter_id) | ✅ Исправлено Фаза 0 |
| `images.py` | 534, 749 | rollback → raise HTTPException | ✅ Безопасно |
| `reading_sessions.py` | 374, 453, 542, 648, 736, 1084 | rollback → raise HTTPException | ✅ Безопасно |
| `admin/entities.py` | 246 | rollback → raise HTTPException | ✅ Безопасно |
| `books/entities.py` | 86 | rollback → raise HTTPException | ✅ Безопасно |

**Вывод**: Все 23 `rollback()` паттерна безопасны. Единственные два опасных места были в `description_extraction_service.py` и `book_tasks.py` — оба исправлены в Фазе 0. Линтер-правило не требуется — все существующие паттерны уже корректны. Добавлен WARNING-комментарий в `database.py` как документация для будущих разработчиков.

### Фаза 3: Долгосрочная стабильность (4-8 часов, P3)

| # | Задача | Детали |
|---|--------|--------|
| 3.1 | Интеграционные тесты с кириллицей | Добавить в `test_entity_concurrent_upsert.py` тесты с кириллическими именами |
| 3.2 | Тест на locale C поведение | Добавить тест, явно проверяющий `lower()` с кириллицей на тестовой БД |
| 3.3 | Тест error handler | Добавить тест, проверяющий, что error handler корректно записывает `parsing_error` после rollback |
| 3.4 | Аудит `func.lower()` в проекте | Убедиться, что нигде больше не используется `func.lower()` для non-ASCII |


#### Результаты Фазы 3 (выполнено 2026-02-25)

**Статус: ✅ Выполнено**

| # | Задача | Статус | Детали |
|---|--------|--------|--------|
| 3.1 | Интеграционные тесты с кириллицей | ✅ Выполнено в Фазе 1.4 | `TestEntityCyrillicUpsert` (3 теста): case conflict, name_lower column, mixed script names |
| 3.2 | Тест locale C | ✅ Выполнено | `TestLocaleCSafety` (3 теста): pg_lower_cyrillic_noop, python_casefold_always_works, pg_lower_latin_works. Документирует поведение PostgreSQL lower() под locale C |
| 3.3 | Тест rollback safety | ✅ Выполнено | `TestRollbackSafety` (2 теста): scalar_captured_before_rollback, fresh_query_after_rollback. Верифицирует паттерн "capture scalars early" |
| 3.4 | Аудит `func.lower()` | ✅ Выполнено в Фазе 1.5 | 0 оставшихся использований во всём backend |

**Новые тесты добавлены в `test_entity_concurrent_upsert.py`:**
- `TestLocaleCSafety` — 3 теста, документирующих поведение locale C vs Python casefold
- `TestRollbackSafety` — 2 теста, верифицирующих безопасные паттерны после rollback
- Итого: 8 новых тестов (Фаза 1: 3 + Фаза 3: 5)

---

## 9. Необходимые миграции

### Миграция 1: Добавление `name_lower` (Фаза 1)

```python
"""Add name_lower column to entities for locale-independent case-insensitive matching.

Revision ID: add_name_lower
"""

def upgrade() -> None:
    # Шаг 1: Добавить колонку (nullable, чтобы не ломать существующие ряды)
    op.execute("ALTER TABLE entities ADD COLUMN name_lower VARCHAR(255)")

    # Шаг 2: Заполнить name_lower для существующих данных
    # ВАЖНО: Используем PostgreSQL lower() — для латиницы корректно,
    # для кириллицы потребуется Python-скрипт (см. ниже)
    op.execute("UPDATE entities SET name_lower = lower(name)")

    # Шаг 3: Сделать NOT NULL
    op.execute("ALTER TABLE entities ALTER COLUMN name_lower SET NOT NULL")

    # Шаг 4: Создать новый индекс
    op.execute("""
        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ix_entities_book_name_lower_v2
        ON entities (book_id, name_lower)
    """)

    # Шаг 5: Удалить старый индекс
    op.execute("DROP INDEX IF EXISTS ix_entities_book_id_name_lower")


def downgrade() -> None:
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_entities_book_id_name_lower
        ON entities (book_id, lower(name))
    """)
    op.execute("DROP INDEX IF EXISTS ix_entities_book_name_lower_v2")
    op.execute("ALTER TABLE entities DROP COLUMN name_lower")
```

### Python скрипт для кириллицы

Поскольку `lower()` в PostgreSQL при locale C не обрабатывает кириллицу, нужен Python-скрипт для корректного заполнения `name_lower`:

```python
async def fix_name_lower():
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Entity))
        entities = result.scalars().all()
        for entity in entities:
            entity.name_lower = entity.name.casefold()  # Python .casefold() — надёжнее .lower()
        await session.commit()
```

---

## 10. Тестовый план

### 10.1. Верификация Фазы 0 (hotfix)

| # | Тест | Критерий успеха |
|---|------|----------------|
| 1 | Обработать книгу "Ведьмак" | 20/20 глав обработаны без ошибок |
| 2 | Проверить логи celery-worker | Нет `NoResultFound`, `MissingGreenlet`, `KeyError` |
| 3 | Проверить entities в БД | Все entity созданы, нет дубликатов |

### 10.2. Новые интеграционные тесты (Фаза 3)

```python
class TestEntityCyrillicUpsert:
    """Тесты case-insensitive entity upsert с кириллическими именами."""

    async def test_cyrillic_case_insensitive_conflict(self, test_db):
        """'Гарри' и 'ГАРРИ' должны создать одну запись."""
        ...

    async def test_cyrillic_name_lower_column(self, test_db):
        """name_lower должен содержать корректно нормализованное имя."""
        ...

    async def test_mixed_script_names(self, test_db):
        """Имена со смешанными скриптами (Latin + Cyrillic)."""
        ...

    async def test_unicode_edge_cases(self, test_db):
        """Специальные Unicode случаи: ß → ss, İ → i̇, и т.д."""
        ...


class TestPostRollbackSafety:
    """Тесты безопасности ORM-объектов после rollback."""

    async def test_no_orm_access_after_rollback(self, test_db):
        """После rollback, error handler не обращается к ORM-атрибутам."""
        ...

    async def test_error_recorded_after_rollback(self, test_db):
        """parsing_error корректно записывается после rollback через re-fetch."""
        ...
```

### 10.3. Регрессионный чеклист

- [ ] `grep -r "func.lower" backend/app/` — убедиться, что `func.lower()` не используется для non-ASCII данных
- [ ] `grep -rn "\.rollback\(\)" backend/app/` — для каждого места проверить, что после rollback нет обращения к ORM-атрибутам
- [ ] Интеграционные тесты с кириллическими именами проходят
- [ ] Книга с 20+ главами обрабатывается полностью

---

## Приложение A: Конфигурация PostgreSQL

```yaml
# docker-compose.lite.yml (строка 35):
POSTGRES_INITDB_ARGS: --encoding=UTF8 --locale=C
```

`locale C` подтверждена во всех трёх docker-compose файлах:
- `docker-compose.lite.yml` (продакшен)
- `docker-compose.lite.prod.yml`
- `docker-compose.staging.yml`

Решение о `locale C` было принято в октябре 2025 для повышения производительности сортировки и задокументировано в `INFRASTRUCTURE_FIXES_SUMMARY.md`.

## Приложение B: Конфигурация AsyncSession

```python
# backend/app/core/database.py, строки 78-80:
AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)
```

`expire_on_commit=False` — объекты НЕ expire-ятся при commit. Но `rollback()` **ВСЕГДА** expire-ит все объекты — это поведение SQLAlchemy, которое нельзя отключить.

## Приложение C: Git diff коммита `6b7dd3b`

```
 13 files changed, 1593 insertions(+), 55 deletions(-)

 backend/app/core/logging.py                        |   3 +-
 backend/app/core/pubsub.py                         |   4 +-
 backend/app/main.py                                |   6 +-
 backend/app/routers/books/crud.py                  |   2 +-
 backend/app/routers/sync.py                        |   2 +-
 backend/app/services/book_parser.py                |   4 +-
 backend/app/services/consistency_manager.py        |  73 +-
 backend/app/services/entity_synthesis_service.py   |   5 +-
 backend/app/tasks/book_tasks.py                    |  61 +-
 backend/app/tasks/reading_sessions_tasks.py        |  13 +-
 tests/integration/test_entity_concurrent_upsert.py | 201 +++++
 docs/reports/2026-02-25-critical-audit-and-solutions.md | 859 ++++++++++++
 docs/reports/2026-02-25-keyerror-aliases-investigation.md | 415 ++++++
```

## Приложение D: Перекрёстные ссылки

| Документ | Связь |
|----------|-------|
| `2026-02-25-critical-audit-and-solutions.md` | Аудит KeyError + план исправлений (коммит `6b7dd3b`) |
| `2026-02-25-keyerror-aliases-investigation.md` | Оригинальное расследование KeyError aliases |
| `INFRASTRUCTURE_FIXES_SUMMARY.md` | Решение о `locale C` (октябрь 2025) |
| `CELERY_TASKS_TESTING_REPORT.md` | Первое документирование `MissingGreenlet` (октябрь 2025) |
| Коммит `6b7dd3b` | Источник обоих регрессионных багов |
| Коммит `020e243` | TaskGroup → asyncio.gather (предшествовал `6b7dd3b`) |
| Миграция `add_unique_entity_name` | Создание индекса `ix_entities_book_id_name_lower` (январь 2026) |

---

## Приложение E: Методология аудита

### Инструменты и агенты

| Инструмент | Применение |
|------------|-----------|
| 2× explore agent | Параллельный аудит: (1) consistency_manager + entity.py, (2) book_tasks + все rollback sites |
| 2× librarian agent | Параллельное исследование: (1) PostgreSQL locale C + ICU, (2) SQLAlchemy async + MissingGreenlet |
| Oracle | Синтез рекомендаций по обоим багам |
| `grep` | Поиск `func.lower`, `session.rollback`, `locale`, `MissingGreenlet` |
| `git log` | История коммитов затронутых файлов (30 коммитов) |
| Прямое чтение | 15+ файлов прочитаны полностью |

### Проверенные источники

| Источник | Метод |
|----------|-------|
| `consistency_manager.py` (727 строк) | Полное чтение, анализ всех `func.lower()` и `.lower()` |
| `book_tasks.py` (890 строк) | Полное чтение, анализ всех error handlers |
| `entity.py` (133 строки) | Полное чтение, анализ индексов |
| `database.py` (121 строка) | Полное чтение, проверка `expire_on_commit` |
| `description_extraction_service.py` (537 строк) | Чтение rollback-секций |
| `test_entity_concurrent_upsert.py` (201 строка) | Полное чтение, выявлен пробел покрытия |
| Alembic миграция (51 строка) | Полное чтение, подтверждение SQL `lower(name)` |
| docker-compose.lite.yml | Подтверждение `--locale=C` |
| 4 предыдущих отчёта | Перекрёстная верификация хронологии |
| 17 файлов с `session.rollback()` | Аудит каждого на post-rollback ORM access |
| PostgreSQL 15 документация | `lower()`, ICU collation, CITEXT |
| SQLAlchemy 2.0 документация | `MissingGreenlet`, async session, rollback behavior |


## 11. Ревизия: ошибки найденные при самопроверке (v1.2)

### 11.1 Методология ревизии

Ревизия проведена 25 февраля 2026, после завершения Фаз 0-3. Использованы:
- Независимый Oracle-агент для архитектурной рецензии всех diff'ов
- Полный re-read всех изменённых файлов
- Grep `.lower()` по всей поверхности нормализации (не только `func.lower`)
- End-to-end прогон сценария миграции с реальными данными ("ГАРРИ" + "Гарри" в одной книге)

### 11.2 Найденные проблемы

#### 🔴 КРИТИЧНО: Миграция бэкфиллит `lower(name)` — сломана для кириллицы

**Файл:** `2026_02_25_0002_add_name_lower_to_entities.py`, строка 34

```python
op.execute("UPDATE entities SET name_lower = lower(name)")
```

**Проблема:** Под locale C, `lower()` — no-op для кириллицы. Цепочка последствий:
1. Бэкфилл: "ГАРРИ" → `name_lower` = "ГАРРИ", "Гарри" → `name_lower` = "Гарри" (разные значения)
2. Дедупликация (шаг 4): не находит дубликатов — значения разные
3. UNIQUE индекс: создаётся успешно (дубликатов нет)
4. Первый `casefold()` из Python: оба → "гарри" → **`IntegrityError: UNIQUE VIOLATION`**

**Решение:** Заменить PostgreSQL `lower()` на Python `casefold()` через `op.get_bind()` + batch UPDATE прямо в миграции. Дедупликация должна работать ПОСЛЕ корректного бэкфилла.

#### 🟡 ЗНАЧИТЕЛЬНО: `.lower()` vs `.casefold()` рассогласование в `consistency_manager.py`

**14 мест** используют Python `.lower()` для ключей dict'ов и advisory lock, в то время как БД-индекс и INSERT используют `.casefold()`:

| Строки | Использование | Текущий метод |
|--------|---------------|---------------|
| 48 | advisory lock key | `.lower()` ❌ |
| 109 | `_resolve_entity_advanced` name lookup | `.lower()` ❌ |
| 120 | alias lookup в resolve | `.lower()` ❌ |
| 201 | entity_map lookup в `process_chapter_analysis` | `.lower()` ❌ |
| 239-240 | relationship source/target lookup | `.lower()` ❌ |
| 289, 291 | all_names set building | `.lower()` ❌ |
| 307, 316 | existing_entities dict keys | `.lower()` ❌ |
| 341, 344 | alias dedup в existing_names | `.lower()` ❌ |
| 418 | entity_map alias mapping | `.lower()` ❌ |

**Риск:** Для кириллицы/латиницы `.lower()` == `.casefold()`. Но для немецкого ß (`"ß".lower()` = `"ß"`, `"ß".casefold()` = `"ss"`) — различие создаёт:
- Рассогласование ключей dict'а с БД-индексом → lookup miss → создание дубликата
- Advisory lock: два воркера с "Straße" и "STRASSE" получают разные lock keys → race condition

**Решение:** Заменить все `.lower()` на `.casefold()` для entity names. Оставить `.lower()` только для type enum ("character", "location") и visual_summary сравнений.

> **⚠️ Ретроспективное примечание (Секция 12):** Scope данного исправления (#2) был ограничен только `consistency_manager.py` (13 мест). Второй self-review (Секция 12) выявил ещё 5 файлов с аналогичной проблемой `.lower()` на entity names: `book_tasks.py` (6 мест), `entity_service.py` (1), `admin/entities.py` (1), `gemini_extractor.py` (7), `entity_synthesis_service.py` (2). Все исправлены в Фазах A+B Секции 12.

#### 🟡 ЗНАЧИТЕЛЬНО: Нет truncation guard в `@validates`

**Файл:** `entity.py`, строка 142

`casefold()` может **расширять** строки: немецкое `"ß"` → `"ss"` (1 символ → 2), турецкое `"İ"` → `"i̇"` (1 → 2 code points). Если `name` ровно 255 символов с расширяемыми знаками, `name_lower` превысит `String(255)` → `DataError`.

**Решение:** `self.name_lower = value.casefold()[:255]`

#### 🟢 МЕЛКИЕ

| # | Проблема | Решение |
|---|----------|---------|
| 4 | Нет теста на casefold expansion (ß→ss collision) | Добавить тест: "Straße" и "STRASSE" должны конфликтовать |
| 5 | `test_python_casefold_always_works` требует `test_db` fixture без нужды | Убрать `test_db` параметр |
| 6 | Нет логирования количества удалённых дубликатов в миграции | Добавить SELECT count(*) перед DELETE |

### 11.3 Корневые причины пропуска

| Причина | Описание | Предотвращение |
|---------|----------|----------------|
| **Grep по симптому, а не по инварианту** | Грепали `func.lower` (SQLAlchemy), нашли 0. Не грепали Python `.lower()` на entity names. | Грепать всю поверхность нормализации: `.lower()`, `func.lower`, `casefold`, `LOWER` |
| **Пошаговая, а не end-to-end ревизия миграции** | Каждый шаг верен по отдельности, но цепочка backfill→dedup→index→casefold-script не прогонялась end-to-end | Прогонять с конкретными данными: "ГАРРИ" + "Гарри" — что будет? |
| **Автор = ревьюер** | Confirmation bias — код и рецензия в одной сессии | Oracle-ревизия финального diff обязательна перед отчётом о завершении |

### 11.4 Статус исправлений

| # | Исправление | Приоритет | Статус |
|---|-------------|----------|--------|
| 1 | Миграция: Python casefold() вместо PG lower() | 🔴 Критично | ✅ Исправлено |
| 2 | consistency_manager.py: .lower() → .casefold() (13 мест) | 🟡 Значительно | ✅ Исправлено |
| 3 | entity.py: truncation guard `[:255]` | 🟡 Значительно | ✅ Исправлено |
| 4 | Тест на ß→ss casefold expansion | 🟢 Мелкое | ✅ Добавлено |
| 5 | Убрать test_db из pure Python теста | 🟢 Мелкое | ✅ Исправлено |
| 6 | Логирование dedup count в миграции | 🟢 Мелкое | ✅ Добавлено |


---

## 12. Вторая самопроверка (v2.0): project-wide casefold audit

### 12.1 Методология

После завершения исправлений из секции 11 была проведена вторая глубокая верификация:
- Oracle (claude-opus-4) — независимая ревизия всех diff'ов + всех потребителей entity_map
- Explore-агент #1 — полный grep `.lower()` по всему backend/app/ (52+ совпадения, каждое классифицировано)
- Explore-агент #2 — аудит миграции, @validates edge cases, FK CASCADE
- Ручная проверка — анализ всех потребителей entity_map через sequential thinking

**Корневая причина пропуска**: в секции 11 мы исправили `.lower()` → `.casefold()` только в `consistency_manager.py` (поставщик entity_map), но не проверили **потребителей** этого словаря в других файлах. Инвариант "все нормализации entity names через casefold" не был проверен project-wide. Эта же ошибка (греп по симптому, а не по инварианту) повторяется из секции 11.3.

### 12.2 Найденные проблемы (10 штук: 2 критических, 5 значительных, 3 мелких)

#### 🔴 Критические

| # | Файл | Строки | Проблема |
|---|------|--------|----------|
| C1 | `book_tasks.py` | 38, 419, 741, 744, 752, 753 | 6 мест используют `.lower()` для поиска в entity_map, ключи которого `.casefold()`. Мисматч для ß/İ |
| C2 | `consistency_manager.py` | 380 | pg_insert: `name_lower = casefold()` без `[:255]` truncation. Обходит @validates |

#### 🟡 Значительные

| # | Файл | Строки | Проблема |
|---|------|--------|----------|
| S1 | `entity_service.py` | 37 | `_normalize_name()` = `.lower().strip().replace("ё", "е")`. Несовместимо с casefold стандартом |
| S2 | `admin/entities.py` | 53 | Дубликат `_normalize_name()` с `.lower()` |
| S3 | `gemini_extractor.py` | 1102, 1110, 1112, 1210, 1218, 1230, 1231 | Entity dedup использует `.lower()`. Collision на unique index при casefold expansion |
| S4 | `entity.py` | 140-142 | @validates нет None guard → `AttributeError` |
| S5 | `entity_synthesis_service.py` | 199, 207 | `.lower()` на entity names для группировки событий |

#### 🟢 Мелкие

| # | Файл | Строки | Проблема |
|---|------|--------|----------|
| M1 | `consistency_manager.py` | 435 | Dead code `_resolve_and_upsert_entity`: case-sensitive `Entity.name == raw.name` |
| M2 | Migration | 52 | `row.name.casefold()` без NULL guard (defense-in-depth) |
| M3 | Отчёт 11.2 | — | Scope исправления указан только consistency_manager.py, не упомянуты 5 других файлов |

### 12.3 Подтверждено корректным (8 пунктов)

- MissingGreenlet fix (description_extraction_service.py) ✅
- CASCADE FKs на всех 4 зависимых таблицах ✅
- @validates + pg_insert взаимодействие (оба пути покрыты) ✅
- visual_summary `.lower()` (L71-75) — НЕ entity names ✅
- type enum `.lower()` (L356/358/447/449) — ASCII enum ✅
- Migration revision chain (2026_02_25_0001 → 0002) ✅
- Тест casefold expansion conflict (Straße vs STRASSE) ✅
- `test_python_casefold_always_works` без test_db ✅

### 12.4 Статус исправлений

| # | Исправление | Приоритет | Фаза | Статус |
|---|-------------|----------|------|--------|
| C1 | book_tasks.py: .lower() → .casefold() (6 мест) | 🔴 Критично | A | ✅ Исправлено |
| C2 | consistency_manager.py:380 `[:255]` truncation | 🔴 Критично | A | ✅ Исправлено |
| S1 | entity_service.py _normalize_name() → casefold (+ убрана ё→е) | 🟡 Значительно | B | ✅ Исправлено |
| S2 | admin/entities.py _normalize_name() → casefold (+ убрана ё→е) | 🟡 Значительно | B | ✅ Исправлено |
| S3 | gemini_extractor.py: .lower() → .casefold() (7 мест) | 🟡 Значительно | B | ✅ Исправлено |
| S4 | entity.py @validates None guard | 🟡 Значительно | B | ✅ Исправлено |
| S5 | entity_synthesis_service.py .lower() → .casefold() (2 места) | 🟡 Значительно | B | ✅ Исправлено |
| M1 | consistency_manager.py:435 dead code fix | 🟢 Мелкое | C | ✅ Исправлено |
| M2 | Migration:52 NULL guard | 🟢 Мелкое | C | ✅ Исправлено |
| M3 | Отчёт: scope correction (Секция 11.2, пункт 2) | 🟢 Мелкое | C | ✅ Исправлено |
---

**Автор**: Sisyphus (Claude Opus 4) + Oracle + 2× Explore + 2× Librarian agents  
**Дата создания**: 25 февраля 2026  
**Версия**: 3.0 (Все фазы завершены: self-review v1-v3, 24 исправления)

---

## 13. Self-Review v3 — Третья глубокая проверка

### 13.1 Методология

Параллельная верификация 4 независимыми источниками:
- **Oracle** — адверсариальный review всех изменений с 8 конкретными concerns (A-H)
- **Explore-1** — аудит `func.lower`/`.lower()`/`ilike` на entity колонках во всём backend/
- **Explore-2** — аудит всех путей создания Entity (ORM, pg_insert, bulk, merge)
- **Explore-3** — поиск остатков ё→е + entity ID вне FK (Redis, Celery, JSONB)
- **Собственный анализ** — чтение всех изменённых файлов + перекрёстная верификация

### 13.2 Найденные проблемы

| # | Severity | Файл | Проблема | Найдено |
|---|----------|------|----------|---------|
| T1 | 🔴 Критично | `tests/services/test_entity_service.py:18-19` | Сломанный тест: `_normalize_name("Ёлка") == "елка"` — casefold возвращает `"ёлка"` | explore-3 |
| T2 | 🟡 Значительно | `admin/entities.py:199,309` | Stale cache key `entity_network_v3` вместо `entity_network_raw_v5` (пред-существующий баг) | Oracle, explore-3, explore-1, own |
| T3 | 🟡 Значительно | `consistency_manager.py:307,316,322,418`; `book_tasks.py:419,741,744,752,753` | Truncation divergence: dict keys `casefold()` без `[:255]`, DB хранит `[:255]` | Oracle |
| T4 | 🟢 Мелкое | `admin/entities.py:66` | Stale docstring "ё→е" — теперь casefold | Oracle, explore-3, own |
| T5 | 🟢 Мелкое | `extract_geralt.py:26` | `Entity.name.ilike()` — debug скрипт, locale C не совместим | explore-1 |
| T6 | 🟢 Мелкое | `gemini_extractor.py:1012,1027,1179` | `.lower()` вместо `.casefold()` на desc content | Oracle |

### 13.3 Подтверждено корректным

- ✅ `@validates` + `pg_insert` dual path: оба корректно устанавливают `name_lower`
- ✅ Migration dedup + CASCADE: все FK имеют CASCADE, entity IDs не хранятся вне FK
- ✅ Удаление ё→е: не создаёт дубликатов — old normalize не использовался для DB writes
- ✅ `[:255]` truncation: PG VARCHAR(255) считает символы, Python `[:255]` считает codepoints — совпадает
- ✅ Все production запросы используют `Entity.name_lower`
- ✅ Ноль `func.lower` в production entity queries
- ✅ Thread safety `@validates`: per-instance, safe в async
- ✅ Все пути создания Entity корректно устанавливают `name_lower`

### 13.4 Статус исправлений

| # | Описание | Severity | Статус |
|---|----------|----------|--------|
| T1 | Тест: assertion `"елка"` → `"ёлка"`, переименование теста | 🔴 | ✅ Исправлено |
| T2 | Cache key `v3` → `raw_v5` (2 места) | 🟡 | ✅ Исправлено |
| T3 | `entity.name_lower` + `[:255]` (9 мест в 2 файлах) | 🟡 | ✅ Исправлено |
| T4 | Docstring "ё→е" → "casefolded, trimmed" | 🟢 | ✅ Исправлено |
| T5 | `ilike()` → `name_lower.contains()` | 🟢 | ✅ Исправлено |
| T6 | `.lower()` → `.casefold()` на desc content (3 места) | 🟢 | ✅ Исправлено |

### 13.5 Корневая причина пропущенных багов v3

1. **T1 — не запускали тесты**: Мы изменили `_normalize_name()`, но не проверили тесты на эту функцию. Урок: при любом изменении поведения — `grep` по тестам на изменённую функцию.
2. **T2 — пред-существующий баг вне scope**: Кеш key устарел ещё до наших изменений, но обнаружен только при глубоком аудите.
3. **T3 — truncation invariant не проверялся end-to-end**: При добавлении `[:255]` в pg_insert не проверили все места, где dict key сравнивается с DB.
