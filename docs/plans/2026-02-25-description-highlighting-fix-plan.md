# План исправления подсветки описаний в EPUB Reader (v2)

**Дата:** 2026-02-25 (обновлён после полного аудита бэкенда)
**Диагностический отчёт:** `docs/reports/2026-02-25-description-highlighting-diagnostic-v2.md`
**Исполнитель:** Claude Opus 4.6
**Язык коммитов:** Английский (формат: `fix(scope): subject`)

---

## Общие правила

- **НЕ подавлять ошибки типов** (`as any`, `@ts-ignore`, `@ts-expect-error` запрещены)
- **Минимальные изменения** — каждый fix затрагивает только то, что сломано
- **Импорты через `@/` alias** (не относительные пути)
- **Функциональные компоненты** с хуками (без классов)
- **Типы Python** — type hints везде
- После каждой фазы: `npm run type-check`, `npm run lint`, `npm run build`
- После всех фаз: `npm test`, backend `pytest -v`
- Коммит после каждой фазы отдельно

---

## Анамнез: как появилась проблема

Коммит `a9db947` (21.01.2026, «fix: align DescriptionType enum case with database (uppercase)») изменил значения **канонического** `DescriptionType` enum в `app/models/description.py` с lowercase (`"location"`, `"character"`, ...) на UPPERCASE (`"LOCATION"`, `"CHARACTER"`, ...), чтобы соответствовать PostgreSQL enum type.

**Что было сделано в том коммите:**
1. `models/description.py` — значения enum: `"location"` → `"LOCATION"` (и т.д.)
2. `services/gemini_extractor.py` — добавлен `.upper()` в `ExtractedDescription.to_dict()`
3. `core/tasks.py` — изменён import: из `gemini_extractor` → из `models.description`

**Что НЕ было сделано (корень текущих проблем):**
- ❌ НЕ обновлены 3 локальных `DescriptionType` enum в сервисах (они остались lowercase)
- ❌ НЕ обновлён frontend (ожидает lowercase)
- ❌ НЕ добавлена нормализация в Pydantic-сериализацию API responses
- ❌ НЕ обновлены ручные `.value` вызовы в `routers/images.py` (7 мест)
- ❌ НЕ обновлён `entity_service.py` (1 место)
- ❌ НЕ обновлена `group_by_type()` (ключи dict)

---

## Полная карта DescriptionType enum'ов в бэкенде (4 отдельных определения!)

| # | Файл | Строки | Значения | Отсутствующие типы | Используется для |
|---|------|--------|----------|-------------------|-----------------|
| 1 | `app/models/description.py` | 35-40 | **UPPERCASE** (`"LOCATION"`, `"CHARACTER"`, ...) | Нет (канонический) | DB model, Pydantic serialization |
| 2 | `app/services/imagen_generator.py` | 41-48 | **lowercase** (`"location"`, `"character"`, ...) | Нет | Style templates для генерации изображений |
| 3 | `app/services/gemini_extractor.py` | 115-121 | **lowercase** (`"location"`, `"character"`, ...) | **`ACTION` отсутствует** | Внутренняя логика extraction |
| 4 | `app/services/llm_description_enricher.py` | 27-33 | **lowercase** (`"location"`, `"character"`, ...) | **`OBJECT` и `ACTION` отсутствуют** | Enrichment стилей |

### Почему 4 отдельных enum — это проблема

1. **Рассинхронизация**: При изменении канонического enum (как в `a9db947`) легко забыть обновить остальные
2. **Неполные enum'ы**: `gemini_extractor` не знает про `ACTION`, `llm_description_enricher` — про `OBJECT` и `ACTION`. Если Gemini извлечёт description с типом `action`, код enricher'а упадёт с `ValueError`
3. **Тихие fallback'и**: В `book_tasks.py:453` при несовпадении регистра (`"location"` ≠ `"LOCATION"`) срабатывает `except ValueError` → всё становится `LOCATION`. Это **тихая потеря данных о типах**

---

## Полная карта точек сериализации/конвертации (все места, где тип попадает в API response)

### Категория A: Pydantic автоматическая сериализация

| # | Файл | Строки | Что делает | Проблема |
|---|------|--------|------------|----------|
| A1 | `schemas/responses/__init__.py` | 304-324 | `DescriptionResponse.type: DescriptionType` — Pydantic сериализует через `.value` | Отдаёт `"LOCATION"` (UPPERCASE) |

### Категория B: Ручные `.value` вызовы в роутерах (попадают в `DescriptionSummary.type: str`)

| # | Файл | Строка | Контекст | Проблема |
|---|------|--------|----------|----------|
| B1 | `routers/images.py` | 476 | `batch_generate` → dict для `image_gen_svc` | `"LOCATION"` (UPPERCASE), передаётся в imagen_generator |
| B2 | `routers/images.py` | 513 | `GeneratedImageSummary(description_type=desc.type.value)` | `"LOCATION"` в API response |
| B3 | `routers/images.py` | 575 | `DescriptionSummary(type=description.type.value)` — get image detail | `"LOCATION"` в API response |
| B4 | `routers/images.py` | 618 | `DescriptionSummary(type=description.type.value)` — get book images | `"LOCATION"` в API response |
| B5 | `routers/images.py` | 740 | `DescriptionSummary(type=description.type.value)` — regenerate image | `"LOCATION"` в API response |
| B6 | `routers/images.py` | 833 | `description.type.value` → `queue_image_generation(description_type=...)` | `"LOCATION"` для image gen queue |
| B7 | `routers/images.py` | 899 | `d.type.value` → dict для `queue_batch_generation` | `"LOCATION"` для batch gen queue |

**Важно:** `DescriptionSummary.type` (файл `schemas/responses/images.py:170`) имеет тип `str`, а не `DescriptionType`. Поэтому `field_serializer` на `DescriptionResponse` **не поможет** — данные уже строкой подаются в конструктор.

### Категория C: `group_by_type()` — ключи dict в NLP response

| # | Файл | Строки | Что делает | Проблема |
|---|------|--------|------------|----------|
| C1 | `services/description_extraction_service.py` | 317-322 | `group_by_type()` → `desc.type.value` как ключ dict | Ключи `{"LOCATION": 5, "CHARACTER": 3}` — UPPERCASE |

Это попадает в `NLPAnalysisResult.by_type: Dict[str, int]` (`schemas/responses/descriptions.py:60`), описание в docstring даже говорит `"LOCATION, CHARACTER, ATMOSPHERE, etc."` — т.е. автор знал, что ключи UPPERCASE.

### Категория D: entity_service — тип в notes

| # | Файл | Строка | Что делает | Проблема |
|---|------|--------|------------|----------|
| D1 | `services/entity_service.py` | 487 | `"type": d.type.value if d.type else "UNKNOWN"` в dict для entity notes | `"LOCATION"` (UPPERCASE) в API response |

### Категория E: Конвертация gemini output → DB model

| # | Файл | Строки | Что делает | Проблема |
|---|------|--------|------------|----------|
| E1 | `tasks/book_tasks.py` | 453-460 | `DescriptionType(d_dict.get("type", "location"))` | Если gemini вернёт lowercase → `ValueError` → fallback `LOCATION` |
| E2 | `services/description_extraction_service.py` | 294-298 | `DescriptionType(type_str)` | Аналогично — lowercase → fallback `LOCATION` |

**Замечание по E1-E2:** Коммит `a9db947` добавил `.upper()` в `ExtractedDescription.to_dict()` (gemini_extractor.py:91), поэтому **основной путь** через `to_dict()` теперь корректно возвращает UPPERCASE. Но если `d_dict` приходит как `dict` без прохождения через `to_dict()` (строка 446-448 в book_tasks.py), lowercase тип может просочиться.

### Категория F: Внутренние сервисы (НЕ попадают в API, но потенциальные ошибки)

| # | Файл | Строки | Что делает | Риск |
|---|------|--------|------------|------|
| F1 | `services/imagen_generator.py` | 913, 954 | `DescriptionType(description_type.lower())` — использует СВОЙ enum (lowercase) | Безопасно: self-contained, но B1/B6/B7 передают UPPERCASE → `.lower()` корректно |
| F2 | `services/gemini_extractor.py` | 913, 1045 | `DescriptionType(span.span_type)` — использует СВОЙ enum (lowercase) | Безопасно: internal, не попадает в API |
| F3 | `services/image_generator.py` | 416 | `[t.value for t in DescriptionType]` — использует model enum (UPPERCASE) | Безопасно: используется для внутренней валидации |

---

## Стратегия исправления: сравнение подходов

### Подход A: `field_serializer` + ручной `.value.lower()` везде (текущий план v1)
- ✅ Не меняет DB schema
- ❌ Нужно найти и исправить 11+ мест вручную
- ❌ `DescriptionSummary.type: str` не проходит через `field_serializer` — нужно менять `.value` → `.value.lower()` в каждом роутере
- ❌ Хрупко: новый код легко забудет `.lower()`

### Подход B: Вернуть DB enum к lowercase + Alembic migration
- ✅ Одно место: `models/description.py` — `"LOCATION"` → `"location"`
- ✅ Все `.value` автоматически станут lowercase
- ✅ Все 4 enum'а снова синхронизированы
- ❌ Требует Alembic migration (`ALTER TYPE descriptiontype RENAME VALUE`)
- ❌ PostgreSQL `ALTER TYPE ... RENAME VALUE` доступен с PostgreSQL 10+ (у нас 15 — OK)
- ❌ Нужно убрать `.upper()` из `gemini_extractor.py:91` (добавленный в `a9db947`)

### Подход C: Единый нормализатор-хелпер
- ✅ Одна функция `normalize_description_type(value) -> str` — вызывается везде
- ❌ Всё равно нужно найти и поменять 11+ мест

### Рекомендация: **Подход B (вернуть lowercase в DB enum)**

**Обоснование:**
1. PostgreSQL 15 поддерживает `ALTER TYPE ... RENAME VALUE`
2. Это исправляет корень проблемы — все `.value` вызовы автоматически становятся lowercase
3. Не нужно менять роутеры, entity_service, group_by_type — они уже используют `.value`
4. Минимальный риск: данные в DB хранятся как строки enum, PostgreSQL автоматически мигрирует
5. Frontend уже ожидает lowercase — после миграции всё заработает без изменений

**Fallback:** Если подход B невозможен (проблемы с миграцией на production), применить подход A с полным списком мест из этого плана.

---

## Фаза 0: Консолидация DescriptionType enum'ов (Backend)

**Проблема:** 4 отдельных `DescriptionType` enum с разными значениями и неполными наборами типов.
**Цель:** Единственный источник истины — `app/models/description.py`. Все сервисы импортируют оттуда.

### 0.1 Удалить дубликат enum из `imagen_generator.py`

**Файл:** `backend/app/services/imagen_generator.py`
**Строки:** 41-48

**Текущий код:**
```python
class DescriptionType(Enum):
    LOCATION = "location"
    CHARACTER = "character"
    ATMOSPHERE = "atmosphere"
    OBJECT = "object"
    ACTION = "action"
```

**Действия:**
1. Удалить этот класс (строки 41-48)
2. Добавить импорт: `from app.models.description import DescriptionType`
3. Найти все места в файле, где используется `DescriptionType.XXX.value` — если код опирается на lowercase значения (например для ключей dict в `STYLE_TEMPLATES`), создать маппинг:

```python
from app.models.description import DescriptionType

# Mapping for style templates (lowercase keys preserved for backward compat)
_TYPE_STYLE_KEY = {dt: dt.value.lower() for dt in DescriptionType}
```

4. В `STYLE_TEMPLATES` dict (если ключи — это `.value` этого enum) заменить на: `_TYPE_STYLE_KEY[DescriptionType.LOCATION]` или, проще, использовать `.name.lower()` как ключ.

**ВАЖНО:** Если применяется Подход B (lowercase DB enum), то `.value` уже будет lowercase, и маппинг не нужен. Просто удалить дубликат и импортировать из model.

### 0.2 Удалить дубликат enum из `gemini_extractor.py`

**Файл:** `backend/app/services/gemini_extractor.py`
**Строки:** 115-121

**Текущий код:**
```python
class DescriptionType(Enum):
    LOCATION = "location"
    CHARACTER = "character"
    OBJECT = "object"
    ATMOSPHERE = "atmosphere"
```

**Проблема:** Отсутствует `ACTION`.

**Действия:**
1. Удалить этот класс (строки 115-121)
2. Добавить импорт: `from app.models.description import DescriptionType`
3. Проверить все внутренние использования — если код строит `DescriptionType(span.span_type)` где `span_type` — lowercase строка, нужно нормализовать: `DescriptionType(span.span_type.upper())` (для UPPERCASE enum) или без `.upper()` (для lowercase enum после подхода B)

### 0.3 Удалить дубликат enum из `llm_description_enricher.py`

**Файл:** `backend/app/services/llm_description_enricher.py`
**Строки:** 27-33

**Текущий код:**
```python
class DescriptionType(Enum):
    LOCATION = "location"
    CHARACTER = "character"
    ATMOSPHERE = "atmosphere"
```

**Проблема:** Отсутствуют `OBJECT` и `ACTION`.

**Действия:**
1. Удалить этот класс (строки 27-33)
2. Добавить импорт: `from app.models.description import DescriptionType`
3. Проверить все внутренние использования — если enricher не поддерживает OBJECT/ACTION, добавить обработку или graceful skip

### 0.4 Удалить `.upper()` из `gemini_extractor.py`

**Файл:** `backend/app/services/gemini_extractor.py`
**Строка:** ~91 (в `ExtractedDescription.to_dict()`)

**Текущий код (добавлен в `a9db947`):**
```python
"type": self.description_type.value.upper(),
```

**Требуемый код (при подходе B):**
```python
"type": self.description_type.value,
```

При подходе B (lowercase enum) `.value` уже будет lowercase. `.upper()` больше не нужен.

**При подходе A:** Оставить `.upper()` как есть.

### 0.5 Верификация

```bash
cd backend && python -c "
from app.models.description import DescriptionType
print('Canonical enum values:', [t.value for t in DescriptionType])
# Should print: ['location', 'character', 'atmosphere', 'object', 'action'] (after approach B)
# Or: ['LOCATION', 'CHARACTER', 'ATMOSPHERE', 'OBJECT', 'ACTION'] (approach A)
"

# Ensure no other DescriptionType class definitions remain
grep -rn "class DescriptionType" backend/app/ --include="*.py"
# Should return ONLY: backend/app/models/description.py

cd backend && pytest tests/ -v --no-cov -x
```

**Коммит:** `refactor(backend): consolidate 4 duplicate DescriptionType enums into single canonical source`

---

## Фаза 1: Нормализация регистра DescriptionType (Backend)

**Баг:** Backend API отдаёт `"type": "CHARACTER"` (UPPERCASE), frontend ожидает `"character"` (lowercase).
**Коммит-причина:** `a9db947` (21.01.2026) изменил DB enum на UPPERCASE, но не обновил сериализацию.

### Вариант 1.B (Рекомендуется): Вернуть DB enum к lowercase + Alembic migration

#### 1.B.1 Изменить канонический enum

**Файл:** `backend/app/models/description.py`, строки 35-40

**Текущий код:**
```python
class DescriptionType(enum.Enum):
    LOCATION = "LOCATION"
    CHARACTER = "CHARACTER"
    ATMOSPHERE = "ATMOSPHERE"
    OBJECT = "OBJECT"
    ACTION = "ACTION"
```

**Требуемый код:**
```python
class DescriptionType(enum.Enum):
    LOCATION = "location"
    CHARACTER = "character"
    ATMOSPHERE = "atmosphere"
    OBJECT = "object"
    ACTION = "action"
```

#### 1.B.2 Создать Alembic migration

```bash
cd backend && alembic revision --autogenerate -m "revert descriptiontype enum values to lowercase"
```

Если автогенерация не подхватывает изменение значений enum (Alembic обычно не отслеживает), создать ручную миграцию:

```python
"""revert descriptiontype enum values to lowercase"""

from alembic import op

# revision identifiers
revision = 'xxxx'
down_revision = 'yyyy'

def upgrade():
    # PostgreSQL 10+ supports ALTER TYPE ... RENAME VALUE
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'LOCATION' TO 'location'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'CHARACTER' TO 'character'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'ATMOSPHERE' TO 'atmosphere'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'OBJECT' TO 'object'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'ACTION' TO 'action'")

def downgrade():
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'location' TO 'LOCATION'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'character' TO 'CHARACTER'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'atmosphere' TO 'ATMOSPHERE'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'object' TO 'OBJECT'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'action' TO 'ACTION'")
```

**ВАЖНО:** Миграция не требует пересоздания данных — PostgreSQL обновляет enum type in-place. Все существующие записи автоматически будут использовать новые значения.

#### 1.B.3 Применить миграцию

```bash
cd backend && alembic upgrade head
```

#### 1.B.4 Верификация

```bash
cd backend && python -c "
from app.models.description import DescriptionType
assert DescriptionType.LOCATION.value == 'location'
assert DescriptionType.CHARACTER.value == 'character'
print('OK: enum values are lowercase')
"

# Verify DB
psql -U postgres -d bookreader_dev -c "SELECT unnest(enum_range(NULL::descriptiontype));"
# Should show: location, character, atmosphere, object, action

cd backend && pytest tests/ -v --no-cov -x
```

### Вариант 1.A (Fallback): field_serializer + ручной .lower() во всех точках

**Применять ТОЛЬКО если подход B невозможен (проблемы с миграцией).**

#### 1.A.1 `field_serializer` в `DescriptionResponse`

**Файл:** `backend/app/schemas/responses/__init__.py`, строки 304-324

Добавить `field_serializer` для поля `type`:

```python
from pydantic import field_serializer  # Добавить к импорту

class DescriptionResponse(BaseResponse):
    # ... existing fields ...

    @field_serializer('type')
    def serialize_type(self, v: DescriptionType) -> str:
        """Serialize DescriptionType enum to lowercase for frontend compatibility."""
        return v.value.lower()
```

#### 1.A.2 Исправить `group_by_type()` — UPPERCASE ключи dict

**Файл:** `backend/app/services/description_extraction_service.py`, строки 317-322

**Текущий код:**
```python
def group_by_type(descriptions: List[Description]) -> Dict[str, int]:
    by_type: Dict[str, int] = {}
    for desc in descriptions:
        type_value = desc.type.value if desc.type else "location"
        by_type[type_value] = by_type.get(type_value, 0) + 1
    return by_type
```

**Требуемый код:**
```python
def group_by_type(descriptions: List[Description]) -> Dict[str, int]:
    by_type: Dict[str, int] = {}
    for desc in descriptions:
        type_value = desc.type.value.lower() if desc.type else "location"
        by_type[type_value] = by_type.get(type_value, 0) + 1
    return by_type
```

#### 1.A.3 Исправить ВСЕ `.value` вызовы в `routers/images.py` (7 мест)

**Файл:** `backend/app/routers/images.py`

Каждый `d.type.value` или `description.type.value` заменить на `d.type.value.lower()` или `description.type.value.lower()`:

| Строка | Текущий код | Требуемый код |
|--------|-------------|---------------|
| 476 | `"type": d.type.value if hasattr(d.type, "value") else str(d.type)` | `"type": d.type.value.lower() if hasattr(d.type, "value") else str(d.type).lower()` |
| 513 | `description_type=desc.type.value` | `description_type=desc.type.value.lower()` |
| 575 | `type=description.type.value` | `type=description.type.value.lower()` |
| 618 | `type=description.type.value` | `type=description.type.value.lower()` |
| 740 | `type=description.type.value` | `type=description.type.value.lower()` |
| 833 | `description.type.value if hasattr(description.type, "value") else str(description.type)` | `description.type.value.lower() if hasattr(description.type, "value") else str(description.type).lower()` |
| 899 | `"type": d.type.value if hasattr(d.type, "value") else str(d.type)` | `"type": d.type.value.lower() if hasattr(d.type, "value") else str(d.type).lower()` |

#### 1.A.4 Исправить `entity_service.py`

**Файл:** `backend/app/services/entity_service.py`, строка 487

**Текущий код:**
```python
"type": d.type.value if d.type else "UNKNOWN",
```

**Требуемый код:**
```python
"type": d.type.value.lower() if d.type else "unknown",
```

#### 1.A.5 Исправить конвертацию в `book_tasks.py`

**Файл:** `backend/app/tasks/book_tasks.py`, строки 453-455

**Текущий код:**
```python
d_type = DescriptionType(d_dict.get("type", "location"))
```

**Требуемый код:**
```python
raw_type = d_dict.get("type", "LOCATION")
d_type = DescriptionType(raw_type.upper() if isinstance(raw_type, str) else "LOCATION")
```

(Нормализуем входное значение к UPPERCASE перед конвертацией в DB enum.)

#### 1.A.6 Исправить конвертацию в `description_extraction_service.py`

**Файл:** `backend/app/services/description_extraction_service.py`, строки 294-298

Аналогичная нормализация: `DescriptionType(type_str.upper())`.

### 1.* Верификация (для обоих вариантов)

```bash
# 1. Type check
cd backend && mypy app/schemas/responses/__init__.py app/routers/images.py app/services/entity_service.py

# 2. Unit test
cd backend && python -c "
from app.schemas.responses import DescriptionResponse
from app.models.description import DescriptionType
from uuid import uuid4
from datetime import datetime

d = DescriptionResponse(
    id=uuid4(), chapter_id=uuid4(), type=DescriptionType.CHARACTER,
    content='test', context='ctx', confidence_score=0.9, priority_score=80,
    position_in_chapter=0, word_count=5, is_suitable_for_generation=True,
    image_generated=False, created_at=datetime.now(), updated_at=datetime.now()
)
data = d.model_dump()
assert data['type'] == 'character', f'Expected lowercase, got: {data[\"type\"]}'
print('OK: DescriptionResponse.type serializes as lowercase')
"

# 3. Full test suite
cd backend && pytest tests/ -v --no-cov -x
```

**Коммит:** `fix(backend): normalize DescriptionType to lowercase in all API responses`

---

## Фаза 2: Инвалидация кеша IndexedDB

**Баг:** `useChapterData.ts` использует cache-first без инвалидации. После переобработки книги на бэкенде пользователь видит устаревшие данные.
**Стратегия:** Добавить stale-while-revalidate + уменьшить TTL.

### 2.1 Уменьшить TTL описаний

**Файл:** `frontend/src/services/db.ts`, строка 349

**Текущий код:**
```typescript
/** TTL для кэша глав (7 дней в мс) */
export const CHAPTER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000
```

**Требуемый код:**
```typescript
/** TTL для кэша глав (1 час в мс) */
export const CHAPTER_CACHE_TTL = 1 * 60 * 60 * 1000
```

**Обоснование:** 1 час — достаточно для offline-сессии чтения, но позволяет получить обновлённые данные при следующем визите.

### 2.2 Добавить stale-while-revalidate в `useChapterData`

**Файл:** `frontend/src/hooks/epub/useChapterData.ts`

**Текущий код (строки 42-52):**
```typescript
      // 1. Check Cache
      const cachedData = await chapterCache.get(userId, bookId, chapter);
      if (signal.aborted) return;

      if (cachedData && cachedData.descriptions.length > 0) {
        logger.debug(`[useChapterData] Cache hit for chapter ${chapter}`);
        setDescriptions(cachedData.descriptions);
        setImages(cachedData.images);
        setIsLoading(false);
        return;
      }
```

**Требуемый код:**
```typescript
      // 1. Check Cache
      const cachedData = await chapterCache.get(userId, bookId, chapter);
      if (signal.aborted) return;

      if (cachedData && cachedData.descriptions.length > 0) {
        logger.debug(`[useChapterData] Cache hit for chapter ${chapter}`);
        setDescriptions(cachedData.descriptions);
        setImages(cachedData.images);
        setIsLoading(false);
        // Stale-while-revalidate: serve cached data immediately, then update in background
        revalidateInBackground(bookId, chapter, cachedData.descriptions.length, signal);
        return;
      }
```

**Добавить функцию `revalidateInBackground` перед `loadData`:**
```typescript
  const revalidateInBackground = useCallback(async (
    bookId: string,
    chapter: number,
    cachedCount: number,
    signal: AbortSignal,
  ) => {
    try {
      const response = await booksAPI.getChapterDescriptions(bookId, chapter, false);
      if (signal.aborted) return;

      const freshDescriptions = response.nlp_analysis.descriptions || [];
      // Only update if data actually changed (different count or different IDs)
      if (freshDescriptions.length !== cachedCount) {
        logger.debug(`[useChapterData] Background revalidation: descriptions changed (${cachedCount} → ${freshDescriptions.length})`);
        const imagesResponse = await imagesAPI.getBookImages(bookId, chapter);
        if (signal.aborted) return;

        const freshImages = imagesResponse.images;
        await chapterCache.set(userId, bookId, chapter, freshDescriptions, freshImages);
        setDescriptions(freshDescriptions);
        setImages(freshImages);
      }
    } catch {
      // Background revalidation failure is non-critical — user already has cached data
      logger.debug(`[useChapterData] Background revalidation failed for chapter ${chapter}`);
    }
  }, [userId]);
```

### 2.3 Верификация

```bash
cd frontend && npm run type-check && npm run lint && npm run build
```

**Ручная проверка:**
1. Открыть книгу в браузере
2. DevTools → Application → IndexedDB → FancaiDB → chapters
3. Убедиться что записи кешируются
4. Переключить главу и вернуться — данные должны загрузиться из кеша и обновиться в фоне

**Коммит:** `fix(frontend): add stale-while-revalidate to chapter cache and reduce TTL to 1 hour`

---

## Фаза 3: Исправление индексов нормализации

**Баг:** `normalizeText()` изменяет длину строки (trim + \s+ collapse), но индексы из нормализованного текста применяются к оригинальному.
**Файл:** `frontend/src/hooks/epub/useDescriptionHighlighting.ts`, строки 139-148

### 3.1 Создать функцию маппинга индексов

**Файл:** `frontend/src/utils/text-search/normalization.ts`

**Добавить в конец файла:**
```typescript
/**
 * Build a mapping from normalized text indices to original text indices.
 * Accounts for trim() offset and whitespace collapse (\s+ → ' ').
 *
 * Returns an array where map[normalizedIdx] = originalIdx.
 */
export const buildIndexMap = (original: string): number[] => {
  const map: number[] = [];

  // Skip leading whitespace (from trim)
  let oi = 0;
  while (oi < original.length && /\s/.test(original[oi])) {
    oi++;
  }

  let inWhitespace = false;
  while (oi < original.length) {
    const ch = original[oi];
    if (/\s/.test(ch)) {
      if (!inWhitespace) {
        // First whitespace char in a run → maps to the single normalized space
        map.push(oi);
        inWhitespace = true;
      }
      // Subsequent whitespace chars are collapsed — no normalized index for them
      oi++;
    } else {
      inWhitespace = false;
      map.push(oi);
      oi++;
    }
  }

  return map;
};

/**
 * Map a range [startIdx, endIdx) from normalized text back to original text.
 */
export const mapNormalizedRange = (
  original: string,
  normalizedStartIdx: number,
  normalizedEndIdx: number,
): { startIdx: number; endIdx: number } => {
  const map = buildIndexMap(original);

  const startIdx = normalizedStartIdx < map.length ? map[normalizedStartIdx] : original.length;
  const lastNormIdx = normalizedEndIdx - 1;
  let endIdx: number;
  if (lastNormIdx < map.length) {
    endIdx = map[lastNormIdx] + 1;
  } else {
    endIdx = original.length;
  }

  return { startIdx, endIdx };
};
```

### 3.2 Использовать маппинг в `useDescriptionHighlighting.ts`

**Файл:** `frontend/src/hooks/epub/useDescriptionHighlighting.ts`

**Шаг 1:** Обновить импорт:
```typescript
import { normalizeText, removeChapterHeaders, getFirstWords, mapNormalizedRange } from '@/utils/text-search/normalization';
```

**Шаг 2:** Исправить применение индексов (строки 142-148):

**Текущий код:**
```typescript
              const norm = normalizeText(text);
              for (const { data, patterns } of processed) {
                const result = findHighlightMatch(norm, patterns, norm.length);
                if (result.found && result.startIdx !== undefined && result.endIdx !== undefined) {
                  const before = text.substring(0, result.startIdx);
                  const match = text.substring(result.startIdx, result.endIdx);
                  const after = text.substring(result.endIdx);
```

**Требуемый код:**
```typescript
              const norm = normalizeText(text);
              for (const { data, patterns } of processed) {
                const result = findHighlightMatch(norm, patterns, norm.length);
                if (result.found && result.startIdx !== undefined && result.endIdx !== undefined) {
                  // Map indices from normalized text back to original DOM text
                  const mapped = mapNormalizedRange(text, result.startIdx, result.endIdx);
                  const before = text.substring(0, mapped.startIdx);
                  const match = text.substring(mapped.startIdx, mapped.endIdx);
                  const after = text.substring(mapped.endIdx);
```

### 3.3 Верификация

```bash
cd frontend && npm run type-check && npm run lint && npm run build
```

**Юнит-тест:**
```typescript
import { buildIndexMap, mapNormalizedRange, normalizeText } from '@/utils/text-search/normalization';

describe('mapNormalizedRange', () => {
  it('handles leading whitespace', () => {
    const original = '   Hello world';
    const norm = normalizeText(original); // 'Hello world'
    const { startIdx, endIdx } = mapNormalizedRange(original, 0, 5);
    expect(original.substring(startIdx, endIdx)).toBe('Hello');
  });

  it('handles collapsed whitespace', () => {
    const original = 'Фиц  медленно   поднялся';
    const norm = normalizeText(original); // 'Фиц медленно поднялся'
    const { startIdx, endIdx } = mapNormalizedRange(original, 4, 12);
    expect(original.substring(startIdx, endIdx)).toBe('медленно');
  });
});
```

**Коммит:** `fix(frontend): map normalized text indices back to original DOM text for correct highlighting`

---

## Фаза 4: Исправление потери данных при кешировании

**Баги:**
- `priority_score` не сохраняется → фильтр `density='key'` не работает на кешированных данных
- `text` не сохраняется → оба поля `text` и `content` идентичны после round-trip
- `action` тип необратимо конвертируется в `atmosphere`

### 4.1 Обновить тип `CachedDescription`

**Файл:** `frontend/src/services/db.ts`, строки 36-43

**Текущий код:**
```typescript
export interface CachedDescription {
  id: string
  content: string
  type: 'scene' | 'character' | 'setting' | 'object'
  confidence: number
  imageUrl: string | null
  imageStatus: 'none' | 'pending' | 'generated' | 'error'
}
```

**Требуемый код:**
```typescript
export interface CachedDescription {
  id: string
  content: string
  text: string | null
  type: 'scene' | 'character' | 'setting' | 'object' | 'action'
  confidence: number
  priorityScore: number
  imageUrl: string | null
  imageStatus: 'none' | 'pending' | 'generated' | 'error'
}
```

### 4.2 Обновить Dexie schema version

**Файл:** `frontend/src/services/db.ts`

Добавить version bump:
```typescript
    // v3: Added text, priorityScore, action type to CachedDescription
    this.version(3).stores({
      offlineBooks: 'id, userId, bookId, status, lastAccessedAt',
      chapters: 'id, [userId+bookId], [userId+bookId+chapterNumber], lastAccessedAt',
      images: 'id, userId, bookId, descriptionId, cachedAt',
      syncQueue: 'id, userId, type, priority, status, createdAt',
      readingProgress: 'id, userId, bookId, updatedAt, synced',
      pendingSyncRequests: 'id, timestamp',
    })
```

### 4.3 Обновить `toCachedDescription`

**Файл:** `frontend/src/services/chapterCache.ts`, строки 51-69

**Текущий код:**
```typescript
function toCachedDescription(desc: Description): CachedDescription {
  const typeMap: Record<string, CachedDescription['type']> = {
    location: 'setting',
    character: 'character',
    atmosphere: 'scene',
    object: 'object',
    action: 'scene',
  }

  return {
    id: desc.id,
    content: desc.content,
    type: typeMap[desc.type] || 'scene',
    confidence: desc.confidence_score,
    imageUrl: desc.generated_image?.image_url ?? null,
    imageStatus: desc.generated_image
      ? (desc.generated_image.status === 'completed' ? 'generated' : 'pending')
      : 'none',
  }
}
```

**Требуемый код:**
```typescript
function toCachedDescription(desc: Description): CachedDescription {
  const typeMap: Record<string, CachedDescription['type']> = {
    location: 'setting',
    character: 'character',
    atmosphere: 'scene',
    object: 'object',
    action: 'action',
  }

  return {
    id: desc.id,
    content: desc.content,
    text: desc.text ?? null,
    type: typeMap[desc.type] || 'scene',
    confidence: desc.confidence_score,
    priorityScore: desc.priority_score,
    imageUrl: desc.generated_image?.image_url ?? null,
    imageStatus: desc.generated_image
      ? (desc.generated_image.status === 'completed' ? 'generated' : 'pending')
      : 'none',
  }
}
```

### 4.4 Обновить `isValidCachedDescription`

**Файл:** `frontend/src/services/chapterCache.ts`, строка 92

**Текущий:** `const validTypes = ['setting', 'character', 'scene', 'object']`
**Требуемый:** `const validTypes = ['setting', 'character', 'scene', 'object', 'action']`

### 4.5 Обновить `fromCachedDescription`

**Файл:** `frontend/src/services/chapterCache.ts`, строки 111-148

Добавить маппинг `action: 'action'` в `typeMap` и исправить:
- `text: cached.content` → `text: cached.text ?? cached.content`
- `priority_score: cached.confidence ?? 0` → `priority_score: cached.priorityScore ?? cached.confidence ?? 0`

### 4.6 Обновить `downloadManager.ts`

**Файл:** `frontend/src/services/downloadManager.ts`, строки 422-432

Изменить `action: 'scene'` → `action: 'action'`

### 4.7 Обновить `useChapter.ts`

**Файл:** `frontend/src/hooks/api/useChapter.ts`, строки 101-109

Изменить `action: 'scene'` → `action: 'action'`

### 4.8 Верификация

```bash
cd frontend && npm run type-check && npm run lint && npm run build
```

**Коммит:** `fix(frontend): preserve priority_score, text and action type in cache round-trip`

---

## Фаза 5: Финальная верификация

### 5.1 Frontend build + lint + type-check

```bash
cd frontend
npm run type-check
npm run lint
npm run build
```

### 5.2 Frontend tests

```bash
cd frontend && npm test
```

### 5.3 Backend tests

```bash
cd backend && pytest tests/ -v --no-cov
```

### 5.4 E2E проверка

1. Открыть https://fancai.ru
2. Войти (sandk008@gmail.com)
3. Открыть «Ученик убийцы»
4. Очистить IndexedDB (DevTools → Application → IndexedDB → FancaiDB → Delete database)
5. Перезагрузить страницу
6. Перейти к главе с описаниями
7. Проверить:
   - [ ] Подсветки видны в тексте
   - [ ] Подсветки разных цветов (location — синий, character — фиолетовый, atmosphere — жёлтый)
   - [ ] Клик по подсветке открывает модалку
   - [ ] Подсветки на правильном участке текста (не сдвинуты)

---

## Полная карта файлов для изменения (v2)

### Backend (Фаза 0 + 1)

| # | Файл | Фаза | Тип изменения |
|---|------|------|---------------|
| 1 | `app/models/description.py` | 1.B | Вернуть enum values к lowercase |
| 2 | `app/services/gemini_extractor.py` | 0 | Удалить дубликат enum, импортировать из models. Удалить `.upper()` из `to_dict()` |
| 3 | `app/services/imagen_generator.py` | 0 | Удалить дубликат enum, импортировать из models |
| 4 | `app/services/llm_description_enricher.py` | 0 | Удалить дубликат enum, импортировать из models |
| 5 | `alembic/versions/xxx_revert_enum.py` | 1.B | Alembic migration: RENAME VALUE |
| 6 | `app/schemas/responses/__init__.py` | 1.A* | `field_serializer` (только для подхода A) |
| 7 | `app/services/description_extraction_service.py` | 1.A* | `.lower()` в `group_by_type()` (только для подхода A) |
| 8 | `app/routers/images.py` | 1.A* | `.lower()` в 7 местах (только для подхода A) |
| 9 | `app/services/entity_service.py` | 1.A* | `.lower()` в 1 месте (только для подхода A) |
| 10 | `app/tasks/book_tasks.py` | 1.A* | `.upper()` нормализация входа (только для подхода A) |

*Файлы 6-10 нужны только при подходе A. При подходе B (рекомендуемом) все `.value` автоматически станут lowercase.*

### Frontend (Фазы 2-4)

| # | Файл | Фаза | Тип изменения |
|---|------|------|---------------|
| 11 | `src/services/db.ts` | 2, 4 | Уменьшить TTL, добавить v3 schema, обновить CachedDescription |
| 12 | `src/hooks/epub/useChapterData.ts` | 2 | Добавить stale-while-revalidate |
| 13 | `src/utils/text-search/normalization.ts` | 3 | Добавить buildIndexMap, mapNormalizedRange |
| 14 | `src/hooks/epub/useDescriptionHighlighting.ts` | 3 | Использовать mapNormalizedRange |
| 15 | `src/services/chapterCache.ts` | 4 | Обновить toCached/fromCached/isValid |
| 16 | `src/services/downloadManager.ts` | 4 | Обновить typeMap (action) |
| 17 | `src/hooks/api/useChapter.ts` | 4 | Обновить typeMap (action) |

### Итого

| Подход | Backend файлов | Frontend файлов | Всего | Коммитов |
|--------|---------------|-----------------|-------|----------|
| **B (рекомендуемый)** | 5 (enum + migration + 3 сервиса) | 7 | **12** | **5** |
| A (fallback) | 9 | 7 | **16** | **5** |

---

## Зависимости между фазами

```
Фаза 0 (Консолидация enum'ов) ← ПЕРВАЯ, устраняет дубликаты
    ↓
Фаза 1 (Нормализация регистра) ← зависит от Фазы 0
    ↓ API теперь отдаёт lowercase
Фаза 2 (Cache invalidation) — независима от Фаз 0-1
Фаза 3 (Index mapping) — независима от Фаз 0-2
Фаза 4 (Cache round-trip) — зависит от Фазы 1 (typeMap корректно маппит после lowercase)
Фаза 5 (Верификация) — после всех фаз
```

**Рекомендуемый порядок: 0 → 1 → 2 → 3 → 4 → 5**

Фазы 2 и 3 можно выполнять параллельно после Фазы 1.

---

## Тесты, которые могут сломаться и потребовать обновления

| Тестовый файл | Что может сломаться | Что сделать |
|---------------|--------------------|----|
| `tests/services/test_imagen_generator.py:929-933` | Ассерты `DescriptionType.LOCATION.value == "location"` — после удаления локального enum тест начнёт использовать канонический | При подходе B (lowercase enum) — тесты пройдут без изменений. При подходе A — тест будет проверять UPPERCASE, нужно обновить |
| `tests/services/test_gemini_extractor.py` | Локальный enum удалён, импорт изменён | Обновить импорт `DescriptionType` |
| Другие тесты, использующие `DescriptionType` | Зависит от того, какой enum импортировали | Проверить: `grep -rn "DescriptionType" backend/tests/` |
