# Аудит плана исправлений подсветки описаний (v2)

**Дата:** 2026-02-25
**Аудитор:** Claude Opus 4.6 (старший инженер)
**Аудируемый документ:** `docs/plans/2026-02-25-description-highlighting-fix-plan.md`
**Диагностический отчёт:** `docs/reports/2026-02-25-description-highlighting-diagnostic-v2.md`

---

## Резюме

План предлагает 5 фаз исправлений для сломанной подсветки описаний в EPUB Reader. Общая стратегия **верная** — подход B (возврат DB enum к lowercase) действительно минимизирует количество изменений. Однако аудит выявил **3 критических пропуска файлов**, **2 архитектурных проблемы**, и **несколько технических неточностей**, которые могут привести к регрессиям при реализации.

### Общая оценка по фазам

| Фаза | Оценка | Краткий вердикт |
|------|--------|-----------------|
| 0 — Консолидация enum | ⚠️ | Верно по сути, но пропущены файлы и ненужный маппинг `_TYPE_STYLE_KEY` |
| 1 — Нормализация регистра | ✅ | Подход B корректен, миграция безопасна, но StrEnum не рассмотрен |
| 2 — Инвалидация кеша | ⚠️ | SWR реализован вручную вместо использования TanStack Query 5 staleTime/gcTime |
| 3 — Индексы нормализации | ⚠️ | `buildIndexMap` не учитывает замену кавычек/тире в `normalizeText()` |
| 4 — Cache round-trip | ⚠️ | Dexie version bump не нужен, `downloadManager.ts` маппинг расходится |

---

## Фаза 0: Консолидация DescriptionType enum'ов

### 1.1 Соответствие best practices технологического стека

**Вердикт: ⚠️ Частично соответствует**

**Что верно:**
- Консолидация 4 дубликатов enum в единый источник истины — абсолютно правильный подход
- Импорт из `app.models.description` — корректное размещение для FastAPI-проекта (enum определён рядом с моделью, которая его использует)
- Удаление неполных enum'ов (без `ACTION`, без `OBJECT`) предотвращает `ValueError` при runtime

**Что не рассмотрено:**

1. **`enum.StrEnum` (Python 3.11+) не рассмотрен как альтернатива.** Проект использует Python 3.11, где `enum.StrEnum` доступен нативно. При `StrEnum` с lowercase значениями:
   - Pydantic 2.12 сериализует `.value` напрямую как строку в JSON mode (подтверждено документацией: *"In JSON mode, enum instances are serialized using their value"*)
   - SQLAlchemy 2.0 корректно работает с `StrEnum` в `mapped_column(SQLEnum(...))`
   - Все ручные `.value` вызовы в роутерах становятся **избыточными** — `StrEnum` member IS-A `str`, поэтому `str(desc.type)` уже даёт `"location"`
   - Это устраняет целый класс багов: забытые `.value` вызовы

   ```python
   # Рекомендация: вместо
   class DescriptionType(enum.Enum):
       LOCATION = "location"
   
   # Использовать
   class DescriptionType(enum.StrEnum):
       LOCATION = "location"
   ```

   **Gotcha с SQLAlchemy**: `SQLEnum(DescriptionType)` по умолчанию использует `values_callable=lambda e: [m.value for m in e]`. Для `StrEnum` это вернёт `["location", ...]` — корректно. Но при `create_constraint=True` имя PostgreSQL типа берётся из `enum.__name__` — так что имя `descriptiontype` сохранится.

2. **Маппинг `_TYPE_STYLE_KEY` в шаге 0.1 избыточен.** План предлагает создать `_TYPE_STYLE_KEY = {dt: dt.value.lower() for dt in DescriptionType}` в `imagen_generator.py`. Однако при чтении кода `imagen_generator.py` (строки 53-260) обнаружено, что `STYLE_TEMPLATES` использует **enum member'ы как ключи** (`DescriptionType.LOCATION: {...}`), а не строковые значения. При подходе B (lowercase enum) никакой маппинг не нужен — достаточно просто заменить импорт.

### 1.2 Пропущенные файлы и точки изменений

**Вердикт: ❌ Пропущены 3 файла**

Grep по всему codebase выявил файлы, использующие `DescriptionType` или `description_type`, которые **не упомянуты** в плане:

| # | Файл | Строки | Как используется | Требуемое действие |
|---|------|--------|-----------------|-------------------|
| 1 | `app/services/image_generator.py` | 25, 128-131, 242-245 | `from app.models.description import DescriptionType`, `.type.value` | При подходе B: ничего. При подходе A: добавить `.lower()` |
| 2 | `app/tasks/image_tasks.py` | 32, 71, 116, 146, 355, 359, 387 | `description_type` передаётся как `str` параметр через весь pipeline | Верифицировать, что строковые значения будут lowercase после миграции |
| 3 | `app/core/container.py` | 62, 195 | `description_type: str` параметр | Верифицировать формат строки |

**Также не учтены тестовые файлы:**

| # | Файл | Проблема |
|---|------|----------|
| 4 | `tests/services/test_imagen_generator.py:929-933` | `assert DescriptionType.LOCATION.value == "location"` — тестирует ЛОКАЛЬНЫЙ дубликат enum. После удаления дубликата тест будет импортировать canonical enum. При подходе B — пройдёт. Но план упоминает это только вскользь в таблице в конце, без конкретного плана действий |
| 5 | `tests/services/test_gemini_extractor.py` | Импортирует локальный `DescriptionType` — после удаления нужно обновить импорт |
| 6 | `tests/conftest.py` | Может использовать `description_type` fixtures с конкретными значениями |

### 1.3 Риски и рекомендации

**Риски:**
- **Средний**: `imagen_generator.py` (сервис, не путать с `imagen_generator.py`) имеет `STYLE_TEMPLATES` с enum member'ами как ключами. Если при консолидации случайно переименовать member'ы (не значения), lookup сломается молча
- **Низкий**: Тесты используют локальные enum'ы с lowercase значениями. При подходе B всё корректно, но при подходе A тесты сломаются

**Рекомендации:**
1. Добавить `image_generator.py`, `image_tasks.py`, `container.py` в карту файлов
2. Рассмотреть `enum.StrEnum` вместо `enum.Enum` для устранения класса `.value`-багов
3. Удалить шаг с `_TYPE_STYLE_KEY` маппингом — он не нужен
4. Добавить явный план обновления тестовых файлов (не просто таблицу в конце)

---

## Фаза 1: Нормализация регистра DescriptionType

### 2.1 Соответствие best practices технологического стека

**Вердикт: ✅ Корректно**

**ALTER TYPE ... RENAME VALUE:**
- PostgreSQL 15 полностью поддерживает `ALTER TYPE ... RENAME VALUE` (доступно с PG 10)
- **RENAME VALUE транзакционно-безопасна** — в отличие от `ALTER TYPE ... ADD VALUE` (который до PG 12 требовал `autocommit_block`), RENAME VALUE выполняется внутри транзакции и откатывается при ошибке
- Alembic `autocommit_block` **НЕ нужен** для RENAME VALUE — план корректно не использует его

**Alembic автогенерация:**
- План корректно отмечает, что `alembic revision --autogenerate` **не подхватывает** изменения значений enum — только добавление/удаление типов. Ручная миграция обязательна
- `alembic revision --autogenerate -m "..."` с последующей ручной правкой — правильный workflow

**Что подтверждено исследованием:**
- PostgreSQL автоматически обновляет все существующие записи при RENAME VALUE — данные не теряются
- SQLAlchemy кеширует метаданные enum'а в `MetaData`, но при перезапуске приложения кеш сбрасывается. В рамках одной migration сессии это не проблема

### 2.2 Пропущенные сценарии

**Вердикт: ⚠️ Есть пробелы**

1. **Нет rollback-плана при частичном failover.** Миграция содержит 5 RENAME VALUE операций. Хотя каждая транзакционно-безопасна, что если на production обнаружится проблема ПОСЛЕ миграции, но ДО деплоя нового кода? Рекомендация: добавить `downgrade()` в миграцию (план его содержит — ✅) И указать порядок деплоя:
   ```
   1. Deploy backend с новым кодом (enum values lowercase)
   2. Запустить alembic upgrade head
   ```
   Или наоборот? **План не указывает порядок.** При подходе B правильный порядок:
   ```
   1. alembic upgrade head (DB enum → lowercase)
   2. Deploy backend (код ожидает lowercase)
   ```
   Если сделать наоборот — между деплоем кода и миграцией будет окно, когда код ожидает lowercase, а DB хранит UPPERCASE.

2. **`field_serializer` в подходе A — неполное решение.** План корректно отмечает, что `DescriptionSummary.type: str` не проходит через `field_serializer`, потому что данные подаются строкой напрямую. Но не отмечено, что `DescriptionResponse.type: DescriptionType` при стандартной Pydantic JSON-сериализации уже выдаёт `.value` (т.е. `"LOCATION"`). Проблема не в отсутствии сериализатора, а в том, что `.value` — UPPERCASE.

3. **Подход C (единый нормализатор) отвергнут слишком быстро.** При использовании `enum.StrEnum` с lowercase значениями, нормализатор не нужен — но если остаётся `enum.Enum`, комбинация подхода B + централизованная helper-функция `normalize_type(v: DescriptionType) -> str` обеспечивает двойную защиту от будущих рассинхронизаций.

### 2.3 Конкретная альтернатива

Вместо подхода B в текущем виде, рекомендуется **Подход B+**:

```python
import enum

class DescriptionType(enum.StrEnum):
    LOCATION = "location"
    CHARACTER = "character"
    ATMOSPHERE = "atmosphere"
    OBJECT = "object"
    ACTION = "action"
```

**Преимущества перед текущим планом:**
- `StrEnum` member IS-A `str` → `str(DescriptionType.LOCATION)` == `"location"`
- Pydantic 2.12 сериализует `StrEnum` как строку в обоих режимах (JSON и Python)
- Все 7 мест с `.type.value` в `routers/images.py` можно заменить на просто `.type` (или оставить `.type.value` — оба работают)
- `group_by_type()` с `desc.type.value` продолжает работать (`.value` IS-A `str`)
- SQLAlchemy 2.0 `SQLEnum(DescriptionType)` работает корректно с `StrEnum`
- Alembic migration — та же самая (RENAME VALUE)

**Единственная gotcha**: Существующие `isinstance(x, str)` проверки для `StrEnum` member'а вернут `True` — это может быть и плюсом, и минусом в зависимости от контекста.

---

## Фаза 2: Инвалидация кеша IndexedDB

### 3.1 Соответствие best practices технологического стека

**Вердикт: ⚠️ Дублирует функциональность TanStack Query 5**

Проект использует TanStack Query 5.90, который имеет **встроенные механизмы** для stale-while-revalidate:

| Механизм TQ5 | Что делает | Аналог в плане |
|---------------|-----------|----------------|
| `staleTime` | Время, в течение которого данные считаются свежими (не перезапрашиваются) | `CHAPTER_CACHE_TTL` |
| `gcTime` | Время хранения неиспользуемых данных в памяти (по умолчанию 5 мин) | TTL записей в Dexie |
| Автоматический refetch | При `staleTime` expiry + window focus/reconnect | Ручной `revalidateInBackground()` |
| `@tanstack/query-persist-client-core` | Персистенция кеша в IndexedDB/localStorage | Ручное Dexie кеширование |

**Проблема архитектуры:** В текущем коде `useChapterData.ts` выполняет manual fetch (не через TQ5 `useQuery`). План предлагает добавить ещё один слой ручного SWR поверх ручного кеша. Это создаёт **дуалистическую систему кеширования**:
- TanStack Query кеширует результаты API-запросов в памяти
- Dexie кеширует те же данные на диск с отдельным TTL
- Ручной `revalidateInBackground()` дублирует TQ5 auto-refetch

**Рекомендация:** Рефакторить `useChapterData` на использование `useQuery` с настройками:

```typescript
const { data } = useQuery({
  queryKey: ['chapter-descriptions', bookId, chapter],
  queryFn: () => booksAPI.getChapterDescriptions(bookId, chapter, false),
  staleTime: 60 * 60 * 1000, // 1 час — аналог CHAPTER_CACHE_TTL
  gcTime: 24 * 60 * 60 * 1000, // 24 часа — хранить в памяти дольше
});
```

Для offline persistence использовать `@tanstack/query-persist-client-core` с `createSyncStoragePersister` (idb-keyval) или `experimental_createPersister` (experimental, но работает).

**Однако**, учитывая объём изменений и риски рефакторинга кеширования, **план минимального исправления допустим как тактическое решение**. Дублирование — проблема архитектуры, не баг.

### 3.2 Пропущенные сценарии

**Вердикт: ⚠️ Есть пробелы**

1. **Race condition в `revalidateInBackground`.** Если пользователь переключает главы быстро:
   - Глава 1: кеш hit → `revalidateInBackground(ch1)` запущен
   - Глава 2: кеш hit → `revalidateInBackground(ch2)` запущен  
   - Глава 1 снова: кеш hit → `revalidateInBackground(ch1)` ещё один запущен
   
   Два `revalidateInBackground(ch1)` могут работать одновременно. Plan использует `signal.aborted` для cancellation, но `signal` привязан к текущему `loadData` effect, а не к `revalidateInBackground`. Если пользователь быстро переключает главы, background revalidation предыдущей главы продолжит работать.
   
   **Fix:** Добавить `AbortController` для каждого background revalidation, отменять при смене главы.

2. **Сравнение по `freshDescriptions.length !== cachedCount` ненадёжно.** Если бэкенд обновил содержимое описания (текст/тип изменился), но количество осталось прежним — revalidation не обнаружит изменение. Лучше сравнивать по hash или по массиву ID.

3. **TTL 1 час** может быть слишком агрессивным для offline-first PWA. Если пользователь читает в самолёте 3+ часов, после 1 часа кеш инвалидируется, и при попытке переключить главу без сети — данные пропадут. Рекомендация: TTL 24 часа + SWR, или TTL 1 час + не удалять данные при offline (только помечать stale).

### 3.3 Конкретная альтернатива

**Минимальное исправление текущего плана** (без рефакторинга на TQ5):

```typescript
// 1. Не сравнивать только по длине:
const freshIds = freshDescriptions.map(d => d.id).sort().join(',');
const cachedIds = cachedDescriptions.map(d => d.id).sort().join(',');
if (freshIds !== cachedIds) { /* update */ }

// 2. AbortController для background revalidation:
const bgControllerRef = useRef<AbortController | null>(null);
const revalidateInBackground = useCallback(async (...) => {
  bgControllerRef.current?.abort();
  const bgController = new AbortController();
  bgControllerRef.current = bgController;
  // ... use bgController.signal instead of parent signal
}, [...]);

// 3. TTL гибкий:
export const CHAPTER_CACHE_TTL = navigator.onLine ? 1 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
```

---

## Фаза 3: Исправление индексов нормализации

### 4.1 Соответствие best practices технологического стека

**Вердикт: ⚠️ Алгоритм `buildIndexMap` неполный**

**Что верно:**
- Идея маппинга индексов из нормализованного текста в оригинальный — правильный подход
- O(n) сложность — оптимально
- Обработка leading whitespace (trim) и whitespace collapse — корректна

**Что НЕ учтено:**

Функция `normalizeText()` выполняет 5 трансформаций (из `frontend/src/utils/text-search/normalization.ts`):

```typescript
export const normalizeText = (text: string): string =>
  text
    .replace(/\u00A0/g, ' ')           // 1. NBSP → space (1:1)
    .replace(/\s+/g, ' ')              // 2. Whitespace collapse (N:1)
    .replace(/[«»\u201C\u201D]/g, '"') // 3. Fancy quotes → ASCII quote (1:1)
    .replace(/[\u2013\u2014]/g, '-')   // 4. En/em dash → hyphen (1:1)
    .trim()                            // 5. Trim (removes chars)
```

**`buildIndexMap` учитывает только трансформации 1, 2 и 5** (NBSP, whitespace collapse, trim). Трансформации 3 и 4 (замена кавычек и тире) **не учтены** в маппинге.

Однако — и это критический момент — **трансформации 3 и 4 являются 1:1 заменами** (один символ Unicode → один символ ASCII). Это означает, что они **не меняют длину строки** и **не сдвигают индексы**. Поэтому `buildIndexMap` формально работает корректно для ТЕКУЩЕЙ реализации `normalizeText()`.

**Но это хрупко:** Если кто-то добавит трансформацию N:M (например, лигатуры `ﬁ` → `fi`, или `…` → `...`), `buildIndexMap` молча сломается. Рекомендация: сделать маппинг generic, обрабатывающий ВСЕ трансформации, или хотя бы добавить комментарий-предупреждение.

### 4.2 Корректность алгоритма `buildIndexMap`

**Вердикт: ⚠️ Есть edge case**

Пошаговая проверка на примере из плана:

```
original: "   Hello world"   (3 пробела в начале)
```

1. Skip leading whitespace: `oi = 3` (пропущены 3 пробела)
2. `H` (oi=3): не whitespace → `map.push(3)`, oi=4 → map=[3]
3. `e` (oi=4): → `map.push(4)` → map=[3,4]
4. `l` (oi=5): → map=[3,4,5]
5. `l` (oi=6): → map=[3,4,5,6]
6. `o` (oi=7): → map=[3,4,5,6,7]
7. ` ` (oi=8): whitespace, !inWhitespace → `map.push(8)`, inWhitespace=true → map=[3,4,5,6,7,8]
8. `w` (oi=9): → inWhitespace=false, `map.push(9)` → map=[3,4,5,6,7,8,9]
9. ... остальные символы

normalized: "Hello world"

`mapNormalizedRange(original, 0, 5)`:
- startIdx = map[0] = 3
- lastNormIdx = 5-1 = 4
- endIdx = map[4] + 1 = 7 + 1 = 8
- `original.substring(3, 8)` = "Hello" ✅

**Edge case — trailing whitespace:**

```
original: "Hello   "  (3 trailing пробела)
normalized: "Hello"   (trim убирает их)
```

1. No leading whitespace: oi=0
2. `H`→`e`→`l`→`l`→`o`: map=[0,1,2,3,4]
3. ` ` (oi=5): whitespace, !inWhitespace → map.push(5), inWhitespace=true → map=[0,1,2,3,4,5]
4. ` ` (oi=6): whitespace, inWhitespace → skip
5. ` ` (oi=7): whitespace, inWhitespace → skip

Но normalized = "Hello" (длина 5). map имеет 6 элементов [0,1,2,3,4,5]. Элемент map[5]=5 — это пробел, который НЕ существует в normalized строке. Однако это не вызывает ошибку, потому что `mapNormalizedRange` не будет вызван с индексами > 4 для строки "Hello".

**Реальный edge case — множественные пробелы ВНУТРИ строки:**

```
original: "Фиц  медленно   поднялся"
             0123456789...
normalized: "Фиц медленно поднялся"
```

1. `Ф`(0)→`и`(1)→`ц`(2): map=[0,1,2]
2. ` `(3): whitespace, !inWhitespace → map.push(3) → map=[0,1,2,3]
3. ` `(4): whitespace, inWhitespace → skip
4. `м`(5): → map.push(5), inWhitespace=false → map=[0,1,2,3,5]
5. `е`(6)→...→`о`(12): map=[0,1,2,3,5,6,7,8,9,10,11,12]
6. ` `(13): whitespace → map.push(13) → map=[...,13]
7. ` `(14), ` `(15): skip
8. `п`(16)→...→`я`(23): map=[...,16,17,18,19,20,21,22,23]

normalized[4] → map[4] = 5 → `м` ✅
`mapNormalizedRange(original, 4, 12)`:
- startIdx = map[4] = 5
- lastNormIdx = 11
- endIdx = map[11] + 1 = 12 + 1 = 13
- `original.substring(5, 13)` = "медленно" ✅

Алгоритм **корректен для текущих трансформаций**, но хрупок для будущих.

### 4.3 Рекомендация

1. **Добавить комментарий** к `buildIndexMap`:
   ```typescript
   // WARNING: This function only handles whitespace-related transformations
   // (NBSP→space, collapse, trim). If normalizeText() is extended with N:M
   // character replacements (e.g., ligatures, multi-char substitutions),
   // this function must be updated to track those replacements too.
   ```

2. **Добавить больше тестов:**
   - NBSP внутри строки: `"Hello\u00A0world"` → `"Hello world"` (NBSP → space, не collapse)
   - Кавычки: `"«Привет»"` → `'"Привет"'` (1:1, индексы сохраняются)
   - Em dash: `"слово\u2014слово"` → `"слово-слово"` (1:1)
   - Комбинация: `"  «Фиц»  \u2014  медленно  "` (trim + collapse + quotes + dash)

3. **Performance:** `buildIndexMap` создаёт массив на каждый вызов. Для длинных глав (10K+ символов) это O(n) аллокация. Если `mapNormalizedRange` вызывается для каждого description в главе (может быть 20-50), то `buildIndexMap` вызывается 20-50 раз для одного и того же текста. **Рекомендация**: кешировать `map` на уровне ноды (передавать как параметр, а не вычислять внутри `mapNormalizedRange`):

   ```typescript
   // Вместо
   const mapped = mapNormalizedRange(text, result.startIdx, result.endIdx);
   
   // Предварительно вычислить один раз
   const indexMap = buildIndexMap(text);
   // ... для каждого description:
   const mapped = mapRangeWithMap(indexMap, result.startIdx, result.endIdx);
   ```

---

## Фаза 4: Исправление потери данных при кешировании

### 5.1 Соответствие best practices технологического стека

**Вердикт: ⚠️ Dexie version bump не нужен**

**Ключевое открытие:** В Dexie 4.x, `version().stores()` определяет **только индексируемые поля**, а не все поля объекта. Добавление неиндексированных свойств (`text`, `priorityScore`) к существующим объектам **не требует** version bump.

Из документации Dexie:
> *"Unlike SQL, you don't need to specify all properties to store. Only indexed properties need to be specified."*

Поля `text`, `priorityScore` и `action` type — это **неиндексированные свойства** `CachedDescription`. Они хранятся как часть объекта, но не используются для поиска. Поэтому:

- `this.version(3).stores({...})` **не нужен** — достаточно обновить TypeScript интерфейс `CachedDescription`
- Существующие кешированные записи без `text`/`priorityScore` будут иметь `undefined` для этих полей — код должен обрабатывать это gracefully (что план делает в `fromCachedDescription`: `cached.text ?? cached.content`, `cached.priorityScore ?? cached.confidence ?? 0`)

**Если Dexie version bump всё же добавить** (для explicitness), это не навредит — Dexie проигнорирует `stores()` если индексы не изменились. Но это создаёт ложное впечатление, что произошла schema migration.

### 5.2 Три разных type mapping'а на фронтенде

**Вердикт: ❌ Критическая несогласованность не устранена**

В кодовой базе обнаружены **три отдельных type mapping'а**, каждый с РАЗНОЙ логикой:

| Файл | `action` маппится в | `atmosphere` маппится в | Reverse `scene` маппится в |
|------|--------------------|-----------------------|---------------------------|
| `chapterCache.ts` (toCached) | `'scene'` | `'scene'` | — |
| `chapterCache.ts` (fromCached) | — | — | `'atmosphere'` |
| `useChapter.ts` (mapToCachedDescriptionType) | `'scene'` | `'setting'` | — |
| `useChapter.ts` (mapDescriptionType reverse) | — | — | `'action'` (!!) |
| `downloadManager.ts` | `'scene'` | `'setting'` | — |

**Проблема:** Данные, кешированные через `chapterCache.ts`, при чтении обратно (`fromCachedDescription`) превращают `scene` → `atmosphere`. Но данные, прошедшие через `useChapter.ts`, при reverse mapping превращают `scene` → `action`. **Это означает, что один и тот же `scene` type в кеше может стать РАЗНЫМ типом в зависимости от пути чтения.**

**План исправляет** `action: 'scene'` → `action: 'action'` в трёх файлах, но **не устраняет расхождение** `atmosphere` маппинга:
- `chapterCache.ts`: `atmosphere` → `'scene'`
- `useChapter.ts` и `downloadManager.ts`: `atmosphere` → `'setting'`

**Это два разных маппинга для одного типа!** После исправления `action` проблема с `atmosphere` останется.

**Рекомендация:** Единый маппинг в одном месте:

```typescript
// src/utils/descriptionTypeMapping.ts
export const API_TO_CACHE_TYPE: Record<DescriptionType, CachedDescription['type']> = {
  location: 'setting',
  character: 'character',
  atmosphere: 'scene',
  object: 'object',
  action: 'action',
} as const;

export const CACHE_TO_API_TYPE: Record<CachedDescription['type'], DescriptionType> = {
  setting: 'location',
  character: 'character',
  scene: 'atmosphere',
  object: 'object',
  action: 'action',
} as const;
```

Импортировать из всех трёх файлов вместо дублирования.

### 5.3 Пропущенные сценарии

1. **`fromCachedDescription` использует `priority_score: cached.confidence ?? 0`** — это маппит `confidence` (0.0-1.0) в `priority_score` (0-100). После исправления на `cached.priorityScore ?? cached.confidence ?? 0`, fallback на `cached.confidence` вернёт значение в диапазоне 0-1, когда ожидается 0-100. Для существующих кешированных данных (без `priorityScore`) это вернёт 0.85 вместо 85. **Рекомендация:** Fallback должен масштабировать:
   ```typescript
   priority_score: cached.priorityScore ?? (cached.confidence ? cached.confidence * 100 : 0)
   ```

2. **`text: cached.text ?? cached.content`** — при первоначальном кешировании через `toCachedDescription` поле `desc.text` берётся из API response. Если API не возвращает `text` (или возвращает `null`), в кеше `text = null`. При чтении `cached.text ?? cached.content` вернёт `cached.content`. Это корректно, но стоит убедиться, что API действительно возвращает `text` отдельно от `content`.

---

## Общие вопросы

### 6.1 Порядок деплоя

**Вердикт: ❌ Не указан**

План не описывает порядок деплоя на production:

**Для подхода B (рекомендуемого):**
1. Deploy backend code (enum values в Python = lowercase, но DB ещё UPPERCASE)
   - ⚠️ В этот момент `DescriptionType("LOCATION")` сломается!
2. Alembic upgrade head (DB → lowercase)
   - ✅ Теперь всё работает

**Правильный порядок:**
1. `alembic upgrade head` — DB enum → lowercase (существующий код с UPPERCASE enum продолжает работать, потому что SQLAlchemy загружает данные из DB, а DB теперь хранит lowercase)
2. Deploy backend code
3. Deploy frontend (если есть отдельный деплой)

**Или atomic deploy:**
1. Deploy backend + run migration в одном процессе (standard Alembic pattern)

### 6.2 Обратная совместимость

**Вердикт: ⚠️ Частично учтена**

- **Backend→Frontend**: После фазы 1 API начнёт отдавать lowercase. Frontend уже ожидает lowercase → ✅
- **Кешированные данные**: Существующие записи в IndexedDB с неправильным маппингом (action→scene) будут читаться через `fromCachedDescription`. План добавляет `action` type, но не инвалидирует существующие записи с `scene` type (которые на самом деле `action` или `atmosphere`). **Рекомендация:** При первом запуске после обновления очистить `chapters` store в IndexedDB или добавить version-tag к записям
- **Celery tasks**: Если Celery worker'ы используют старый код (не обновлены одновременно с backend), задачи в очереди могут содержать UPPERCASE `description_type` строки. `imagen_generator.py` вызывает `DescriptionType(description_type.lower())` — это сработает. Но `book_tasks.py:453` без нормализации сломается. **Рекомендация:** Добавить case-insensitive lookup в canonical enum:

```python
class DescriptionType(enum.StrEnum):
    LOCATION = "location"
    # ...
    
    @classmethod
    def _missing_(cls, value: object) -> 'DescriptionType | None':
        if isinstance(value, str):
            for member in cls:
                if member.value == value.lower():
                    return member
        return None
```

### 6.3 Пропущенные файлы (полный список)

| # | Файл | Категория | Риск | В плане? |
|---|------|-----------|------|----------|
| 1 | `app/services/image_generator.py` | Backend service | Средний | ❌ |
| 2 | `app/tasks/image_tasks.py` | Backend tasks | Средний | ❌ |
| 3 | `app/core/container.py` | Backend DI | Низкий | ❌ |
| 4 | `tests/services/test_imagen_generator.py` | Tests | Средний | Вскользь упомянут |
| 5 | `tests/services/test_gemini_extractor.py` | Tests | Средний | Вскользь упомянут |
| 6 | `tests/conftest.py` | Test fixtures | Низкий | ❌ |
| 7 | `frontend/src/components/` (CSS classes) | Frontend styles | Низкий | ❌ |

### 6.4 Пропущенные тесты

**Вердикт: ⚠️ Тестовое покрытие неполное**

План предлагает unit-тесты для `buildIndexMap`/`mapNormalizedRange` (2 теста). Но не предлагает:

1. **Backend тест**: Сериализация `DescriptionResponse` → JSON с проверкой lowercase type
2. **Backend тест**: `group_by_type()` возвращает lowercase ключи
3. **Backend тест**: `DescriptionType._missing_()` для case-insensitive lookup (если добавить)
4. **Frontend тест**: `toCachedDescription` → `fromCachedDescription` round-trip сохраняет `action` type
5. **Frontend тест**: `toCachedDescription` сохраняет `priorityScore` и `text`
6. **Frontend тест**: `revalidateInBackground` обновляет state при изменении данных
7. **Integration тест**: E2E поток от API response до подсветки в DOM

---

## Итоговые рекомендации

### Критические (блокирующие реализацию)

1. **Добавить `image_generator.py`, `image_tasks.py`, `container.py` в карту файлов.** Без этого после миграции возможны ошибки в pipeline генерации изображений
2. **Определить порядок деплоя** (migration first, then code deploy). Без этого на production будет downtime
3. **Устранить расхождение `atmosphere` маппинга** между `chapterCache.ts` и `useChapter.ts`/`downloadManager.ts`. Без этого round-trip кеширования ломает типы описаний

### Важные (высокий приоритет)

4. **Рассмотреть `enum.StrEnum`** вместо `enum.Enum` — устраняет целый класс `.value`-багов
5. **Удалить `_TYPE_STYLE_KEY` маппинг** из шага 0.1 — он не нужен (STYLE_TEMPLATES используют enum members, не значения)
6. **Исправить fallback `priority_score`** в `fromCachedDescription`: `cached.confidence * 100`, не `cached.confidence`
7. **Кешировать `buildIndexMap`** — вычислять один раз на текст ноды, а не на каждое описание
8. **Добавить `AbortController`** для background revalidation в фазе 2
9. **Добавить `_missing_()` classmethod** в DescriptionType для case-insensitive lookup (backward compat с Celery tasks)

### Рекомендуемые (улучшения)

10. **Создать единый файл маппинга типов** (`src/utils/descriptionTypeMapping.ts`) вместо 3 отдельных typeMap
11. **Dexie version bump** не нужен для неиндексированных полей — убрать из плана или оставить как cosmetic
12. **TTL**: рассмотреть адаптивный TTL (1ч online, 7д offline) для PWA-совместимости
13. **Тесты**: добавить 7 недостающих тестов (см. раздел 6.4)
14. В будущем: рефакторить `useChapterData` на `useQuery` с `staleTime` вместо ручного SWR

---

## Ссылки на best practices

| Технология | Ссылка | Релевантность |
|-----------|--------|---------------|
| Pydantic 2.12 Enum serialization | [docs.pydantic.dev/2.12/api/standard_library_types](https://docs.pydantic.dev/2.12/api/standard_library_types) | В JSON mode enum сериализуется через `.value` |
| Pydantic `use_enum_values` | [docs.pydantic.dev/2.12/api/config](https://docs.pydantic.dev/2.12/api/config) | Замещает enum objects на `.value` при валидации |
| PostgreSQL ALTER TYPE | [postgresql.org/docs/15/sql-altertype.html](https://www.postgresql.org/docs/15/sql-altertype.html) | RENAME VALUE доступен с PG 10, транзакционно-безопасен |
| Alembic enum migrations | [alembic.sqlalchemy.org/en/latest/ops.html](https://alembic.sqlalchemy.org/en/latest/ops.html) | `autocommit_block` НЕ нужен для RENAME VALUE |
| TanStack Query 5 persistence | [tanstack.com/query/v5/docs/plugins/persistQueryClient](https://tanstack.com/query/v5/docs/plugins/persistQueryClient) | `@tanstack/query-persist-client-core` для IndexedDB |
| Dexie schema versioning | [dexie.org/docs/Version/Version.stores()](https://dexie.org/docs/Version/Version.stores()) | Version bump нужен ТОЛЬКО при изменении индексов |
| Python StrEnum (3.11) | [docs.python.org/3.11/library/enum.html#enum.StrEnum](https://docs.python.org/3.11/library/enum.html#enum.StrEnum) | `StrEnum` member IS-A `str` |
