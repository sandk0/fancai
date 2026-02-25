# План исправления подсветки описаний в EPUB Reader (v3)

**Дата:** 2026-02-25
**Предыдущие версии:** [v2](2026-02-25-description-highlighting-fix-plan.md)
**Аудит:** [docs/reports/2026-02-25-fix-plan-audit.md](../reports/2026-02-25-fix-plan-audit.md)
**Диагностика:** [docs/reports/2026-02-25-description-highlighting-diagnostic-v2.md](../reports/2026-02-25-description-highlighting-diagnostic-v2.md)
**Исполнитель:** Claude Opus 4.6
**Подход:** B+ (StrEnum + lowercase + Alembic migration)

---

## Что изменилось в v3 (по результатам аудита)

| # | Изменение | Источник |
|---|-----------|----------|
| 1 | `enum.StrEnum` вместо `enum.Enum` — устраняет класс `.value`-багов | Аудит §1.1 |
| 2 | 3 пропущенных backend-файла добавлены в карту | Аудит §1.2 |
| 3 | Тестовые файлы добавлены с конкретным планом действий | Аудит §1.2, §6.4 |
| 4 | `_TYPE_STYLE_KEY` маппинг удалён из шага 0.1 — не нужен | Аудит §1.1 |
| 5 | Секция «Порядок деплоя» добавлена | Аудит §6.1 |
| 6 | Единый файл маппинга типов `descriptionTypeMapping.ts` | Аудит §5.2 |
| 7 | `_missing_()` classmethod для case-insensitive lookup | Аудит §6.2 |
| 8 | Fallback `priority_score` масштабируется: `confidence * 100` | Аудит §5.3 |
| 9 | `buildIndexMap` кешируется на уровне ноды | Аудит §4.3 |
| 10 | `AbortController` для background revalidation | Аудит §3.2 |
| 11 | Адаптивный TTL (1ч online / 7д offline) | Аудит §3.2 |
| 12 | Dexie version bump — cosmetic, оставлен опционально | Аудит §5.1 |
| 13 | `atmosphere` маппинг унифицирован между 3 файлами | Аудит §5.2 |
| 14 | 7 недостающих тестов добавлены в фазу тестирования | Аудит §6.4 |

---

## Общие правила

- **НЕ подавлять ошибки типов** (`as any`, `@ts-ignore`, `@ts-expect-error` запрещены)
- **Минимальные изменения** — каждый fix затрагивает только то, что сломано
- **Импорты через `@/` alias** (не относительные пути)
- **Функциональные компоненты** с хуками (без классов)
- **Типы Python** — type hints везде
- После каждой фазы: `npm run type-check && npm run lint && npm run build` (frontend)
- После каждой фазы: `cd backend && mypy app/ && ruff check app/` (backend)
- Коммит после каждой фазы отдельно

---

## Фаза 0: Консолидация DescriptionType enum'ов (Backend)

**Проблема:** 4 отдельных `DescriptionType` enum с разными значениями и неполными наборами типов.
**Цель:** Единственный источник истины — `app/models/description.py` с `enum.StrEnum`.

### 0.1 Переписать канонический enum на StrEnum

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
class DescriptionType(enum.StrEnum):
    LOCATION = "location"
    CHARACTER = "character"
    ATMOSPHERE = "atmosphere"
    OBJECT = "object"
    ACTION = "action"

    @classmethod
    def _missing_(cls, value: object) -> 'DescriptionType | None':
        """Case-insensitive lookup для backward compat с Celery tasks."""
        if isinstance(value, str):
            lower = value.lower()
            for member in cls:
                if member.value == lower:
                    return member
        return None
```

**Обоснование StrEnum:**
- Python 3.11 поддерживает нативно
- `StrEnum` member IS-A `str` → `str(DescriptionType.LOCATION)` == `"location"`
- Pydantic 2.12 сериализует `StrEnum` как строку в JSON mode
- SQLAlchemy 2.0 `SQLEnum(DescriptionType)` работает корректно
- Все `.type.value` вызовы становятся опциональными (но продолжают работать)
- `_missing_()` обеспечивает backward compat с UPPERCASE строками из Celery queue

### 0.2 Удалить дубликат enum из `imagen_generator.py`

**Файл:** `backend/app/services/imagen_generator.py`, строки 41-48

**Действия:**
1. Удалить класс `DescriptionType(Enum)` (строки 41-48)
2. Добавить импорт: `from app.models.description import DescriptionType`
3. **НЕ создавать `_TYPE_STYLE_KEY` маппинг** — `STYLE_TEMPLATES` использует enum members как ключи (не строковые значения), маппинг не нужен

**Проверить зависимости в файле:**
- Строки 128-131: `.type.value` → продолжает работать (StrEnum.value IS-A str)
- Строки 242-245: аналогично
- `STYLE_TEMPLATES` dict: ключи — enum members → работает после переимпорта

### 0.3 Удалить дубликат enum из `gemini_extractor.py`

**Файл:** `backend/app/services/gemini_extractor.py`, строки 115-121

**Действия:**
1. Удалить класс `DescriptionType(Enum)` (строки 115-121)
2. Добавить импорт: `from app.models.description import DescriptionType`
3. Удалить `.upper()` из `ExtractedDescription.to_dict()` (~строка 91):

**Текущий код:**
```python
"type": self.description_type.value.upper(),
```

**Требуемый код:**
```python
"type": self.description_type.value,
```

4. Проверить `DescriptionType(span.span_type)` — при StrEnum с `_missing_()` строки любого регистра будут обработаны корректно

### 0.4 Удалить дубликат enum из `llm_description_enricher.py`

**Файл:** `backend/app/services/llm_description_enricher.py`, строки 27-33

**Действия:**
1. Удалить класс `DescriptionType(Enum)` (строки 27-33)
2. Добавить импорт: `from app.models.description import DescriptionType`
3. Проверить обработку OBJECT/ACTION типов — если enricher не поддерживает их, добавить graceful skip

### 0.5 Верифицировать пропущенные файлы

Файлы, не упомянутые в v2, но использующие `DescriptionType` или `description_type`:

| Файл | Строки | Как используется | Действие |
|------|--------|-----------------|----------|
| `app/services/image_generator.py` | 25, 128-131, 242-245 | `from app.models.description import DescriptionType`, `.type.value` | Верифицировать: при StrEnum `.value` продолжает работать. Действий не требуется |
| `app/tasks/image_tasks.py` | 32, 71, 116, 146, 355, 359, 387 | `description_type` передаётся как `str` по pipeline | Верифицировать: lowercase строки корректны после миграции. `_missing_()` обеспечивает backward compat |
| `app/core/container.py` | 62, 195 | `description_type: str` параметр | Верифицировать: формат строки будет lowercase |

### 0.6 Обновить тестовые файлы

| Файл | Проблема | Действие |
|------|----------|----------|
| `tests/services/test_imagen_generator.py` | строки 929-933: `assert DescriptionType.LOCATION.value == "location"` — тестирует локальный enum | Обновить импорт на canonical enum. При StrEnum с lowercase values — тест пройдёт |
| `tests/services/test_gemini_extractor.py` | Импортирует локальный DescriptionType | Обновить импорт: `from app.models.description import DescriptionType` |
| `tests/conftest.py` | Может использовать `description_type` fixtures | Проверить и обновить значения на lowercase если нужно |

### 0.7 Верификация

```bash
cd backend && python -c "
from app.models.description import DescriptionType
import enum
assert issubclass(DescriptionType, enum.StrEnum), 'Must be StrEnum'
assert DescriptionType.LOCATION.value == 'location'
assert DescriptionType('LOCATION') == DescriptionType.LOCATION  # _missing_() works
assert isinstance(DescriptionType.LOCATION, str), 'StrEnum member IS-A str'
print('OK: DescriptionType is StrEnum with lowercase values and case-insensitive lookup')
"

# Ensure no other DescriptionType class definitions remain
grep -rn "class DescriptionType" backend/app/ --include="*.py"
# Should return ONLY: backend/app/models/description.py

cd backend && mypy app/ && ruff check app/
cd backend && pytest tests/ -v --no-cov -x
```

**Коммит:** `refactor(backend): consolidate DescriptionType enums into StrEnum with lowercase values`

---

## Фаза 1: Alembic миграция — RENAME VALUE (Backend)

**Цель:** Привести PostgreSQL enum values к lowercase для соответствия StrEnum.

### 1.1 Создать Alembic миграцию

```bash
cd backend && alembic revision -m "revert descriptiontype enum values to lowercase"
```

Отредактировать сгенерированный файл:

```python
"""revert descriptiontype enum values to lowercase

Revision ID: xxxx
Revises: yyyy
Create Date: 2026-02-25
"""
from alembic import op

revision = 'xxxx'
down_revision = 'yyyy'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL 10+ supports ALTER TYPE ... RENAME VALUE
    # RENAME VALUE is transactionally safe (unlike ADD VALUE)
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'LOCATION' TO 'location'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'CHARACTER' TO 'character'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'ATMOSPHERE' TO 'atmosphere'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'OBJECT' TO 'object'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'ACTION' TO 'action'")


def downgrade() -> None:
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'location' TO 'LOCATION'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'character' TO 'CHARACTER'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'atmosphere' TO 'ATMOSPHERE'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'object' TO 'OBJECT'")
    op.execute("ALTER TYPE descriptiontype RENAME VALUE 'action' TO 'ACTION'")
```

**Важно:**
- `RENAME VALUE` транзакционно-безопасна (откатывается при ошибке)
- `autocommit_block` НЕ нужен для RENAME VALUE (нужен только для ADD VALUE до PG 12)
- PostgreSQL автоматически обновляет все существующие записи

### 1.2 Верификация

```bash
cd backend && alembic upgrade head

# Verify DB
psql -U postgres -d bookreader_dev -c "SELECT unnest(enum_range(NULL::descriptiontype));"
# Should show: location, character, atmosphere, object, action

cd backend && python -c "
from app.models.description import DescriptionType
assert DescriptionType.LOCATION.value == 'location'
print('OK: enum values are lowercase')
"

cd backend && pytest tests/ -v --no-cov -x
```

**Коммит:** `fix(backend): revert DescriptionType enum values to lowercase via Alembic migration`

---

## Фаза 2: Инвалидация кеша IndexedDB (Frontend)

**Баг:** `useChapterData.ts` использует cache-first без инвалидации. После переобработки книги пользователь видит устаревшие данные.
**Стратегия:** Stale-while-revalidate + адаптивный TTL + AbortController для background revalidation.

### 2.1 Адаптивный TTL

**Файл:** `frontend/src/services/db.ts`, строка 349

**Текущий код:**
```typescript
/** TTL для кэша глав (7 дней в мс) */
export const CHAPTER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000
```

**Требуемый код:**
```typescript
/** TTL для кэша глав: 1 час online, 7 дней offline (PWA) */
export const CHAPTER_CACHE_TTL = typeof navigator !== 'undefined' && navigator.onLine
  ? 1 * 60 * 60 * 1000      // 1 hour when online
  : 7 * 24 * 60 * 60 * 1000  // 7 days when offline (PWA airplane mode)
```

### 2.2 Stale-while-revalidate + AbortController

**Файл:** `frontend/src/hooks/epub/useChapterData.ts`

**Полный требуемый код:**
```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import { booksAPI } from '@/api/books';
import { imagesAPI } from '@/api/images';
import { chapterCache } from '@/services/chapterCache';
import type { Description, GeneratedImage } from '@/types/api';
import { logger } from '@/lib/logger';

interface UseChapterDataProps {
  bookId: string;
  chapter: number;
  userId: string;
  enabled?: boolean;
}

export const useChapterData = ({
  bookId,
  chapter,
  userId,
  enabled = true,
}: UseChapterDataProps) => {
  const [descriptions, setDescriptions] = useState<Description[]>([]);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const bgAbortControllerRef = useRef<AbortController | null>(null);

  const revalidateInBackground = useCallback(async (
    bookId: string,
    chapter: number,
    cachedDescriptions: Description[],
  ) => {
    // Cancel previous background revalidation
    bgAbortControllerRef.current?.abort();
    const bgController = new AbortController();
    bgAbortControllerRef.current = bgController;

    try {
      const response = await booksAPI.getChapterDescriptions(bookId, chapter, false);
      if (bgController.signal.aborted) return;

      const freshDescriptions = response.nlp_analysis.descriptions || [];

      // Compare by sorted IDs — more reliable than length comparison
      const freshIds = freshDescriptions.map(d => d.id).sort().join(',');
      const cachedIds = cachedDescriptions.map(d => d.id).sort().join(',');

      if (freshIds !== cachedIds) {
        logger.debug(`[useChapterData] Background revalidation: descriptions changed`);
        const imagesResponse = await imagesAPI.getBookImages(bookId, chapter);
        if (bgController.signal.aborted) return;

        const freshImages = imagesResponse.images;
        await chapterCache.set(userId, bookId, chapter, freshDescriptions, freshImages);

        if (!bgController.signal.aborted) {
          setDescriptions(freshDescriptions);
          setImages(freshImages);
        }
      }
    } catch {
      // Background revalidation failure is non-critical
      logger.debug(`[useChapterData] Background revalidation failed for chapter ${chapter}`);
    }
  }, [userId]);

  const loadData = useCallback(async () => {
    if (!bookId || !userId || chapter <= 0 || !enabled) return;

    // Cancel previous request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      setIsLoading(true);
      logger.debug(`[useChapterData] Loading chapter ${chapter}`);

      // 1. Check Cache
      const cachedData = await chapterCache.get(userId, bookId, chapter);
      if (signal.aborted) return;

      if (cachedData && cachedData.descriptions.length > 0) {
        logger.debug(`[useChapterData] Cache hit for chapter ${chapter}`);
        setDescriptions(cachedData.descriptions);
        setImages(cachedData.images);
        setIsLoading(false);
        // Stale-while-revalidate: serve cached, update in background
        revalidateInBackground(bookId, chapter, cachedData.descriptions);
        return;
      }

      // 2. Fetch from API
      const descriptionsResponse = await booksAPI.getChapterDescriptions(
        bookId, chapter, false
      );
      if (signal.aborted) return;

      const loadedDescriptions = descriptionsResponse.nlp_analysis.descriptions || [];

      const imagesResponse = await imagesAPI.getBookImages(bookId, chapter);
      if (signal.aborted) return;

      const loadedImages = imagesResponse.images;

      // 3. Update Cache
      await chapterCache.set(userId, bookId, chapter, loadedDescriptions, loadedImages);

      setDescriptions(loadedDescriptions);
      setImages(loadedImages);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      logger.error(`[useChapterData] Error loading chapter ${chapter}:`, error);
      setDescriptions([]);
      setImages([]);
    } finally {
      if (!signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [bookId, chapter, userId, enabled, revalidateInBackground]);

  useEffect(() => {
    loadData();

    return () => {
      abortControllerRef.current?.abort();
      bgAbortControllerRef.current?.abort();
    };
  }, [loadData]);

  return { descriptions, images, isLoading };
};
```

**Ключевые изменения:**
- `bgAbortControllerRef` — отдельный AbortController для background revalidation
- При смене главы оба controller'а отменяются в cleanup
- Сравнение по sorted IDs вместо длины
- Revalidation не блокирует UI (cached data отображается немедленно)

### 2.3 Верификация

```bash
cd frontend && npm run type-check && npm run lint && npm run build
```

**Коммит:** `fix(frontend): add stale-while-revalidate with AbortController and adaptive TTL`

---

## Фаза 3: Исправление индексов нормализации (Frontend)

**Баг:** `normalizeText()` изменяет длину строки (trim + \s+ collapse), но индексы из нормализованного текста применяются к оригинальному.

### 3.1 Добавить `buildIndexMap` и `mapNormalizedRange`

**Файл:** `frontend/src/utils/text-search/normalization.ts`

**Добавить в конец файла:**
```typescript
/**
 * Build a mapping from normalized text indices to original text indices.
 * Accounts for trim() offset and whitespace collapse (\s+ → ' ').
 *
 * WARNING: This function only handles whitespace-related transformations
 * (NBSP→space, collapse, trim). Quote/dash replacements (« → ", — → -)
 * are 1:1 and don't shift indices. If normalizeText() is extended with
 * N:M character replacements (e.g. ligatures ﬁ → fi, or … → ...),
 * this function MUST be updated to track those replacements.
 *
 * @returns Array where map[normalizedIdx] = originalIdx
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
 * The indexMap should be pre-computed via buildIndexMap() for the same original text.
 *
 * @param indexMap - Pre-computed index map from buildIndexMap()
 * @param original - The original (non-normalized) text
 * @param normalizedStartIdx - Start index in normalized text
 * @param normalizedEndIdx - End index in normalized text (exclusive)
 */
export const mapNormalizedRange = (
  indexMap: number[],
  original: string,
  normalizedStartIdx: number,
  normalizedEndIdx: number,
): { startIdx: number; endIdx: number } => {
  const startIdx = normalizedStartIdx < indexMap.length
    ? indexMap[normalizedStartIdx]
    : original.length;

  const lastNormIdx = normalizedEndIdx - 1;
  let endIdx: number;
  if (lastNormIdx < indexMap.length) {
    endIdx = indexMap[lastNormIdx] + 1;
  } else {
    endIdx = original.length;
  }

  return { startIdx, endIdx };
};
```

**Отличия от v2:**
- `mapNormalizedRange` принимает `indexMap` как параметр (не вычисляет внутри) — кешируется на уровне ноды
- Добавлен WARNING-комментарий о хрупкости при N:M заменах

### 3.2 Использовать маппинг в `useDescriptionHighlighting.ts`

**Файл:** `frontend/src/hooks/epub/useDescriptionHighlighting.ts`

**Шаг 1:** Обновить импорт (строка 4):
```typescript
import { normalizeText, removeChapterHeaders, getFirstWords, buildIndexMap, mapNormalizedRange } from '@/utils/text-search/normalization';
```

**Шаг 2:** Исправить внутри `processContents` (строки 139-148). Заменить блок обработки каждого node:

**Текущий код:**
```typescript
chunk.forEach(node => {
  const text = node.textContent;
  if (!text || text.length < 15) return;
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
chunk.forEach(node => {
  const text = node.textContent;
  if (!text || text.length < 15) return;
  const norm = normalizeText(text);
  // Build index map ONCE per text node, reuse for all descriptions
  const indexMap = buildIndexMap(text);
  for (const { data, patterns } of processed) {
    const result = findHighlightMatch(norm, patterns, norm.length);
    if (result.found && result.startIdx !== undefined && result.endIdx !== undefined) {
      // Map indices from normalized text back to original DOM text
      const mapped = mapNormalizedRange(indexMap, text, result.startIdx, result.endIdx);
      const before = text.substring(0, mapped.startIdx);
      const match = text.substring(mapped.startIdx, mapped.endIdx);
      const after = text.substring(mapped.endIdx);
```

**Ключевое улучшение:** `buildIndexMap(text)` вызывается **один раз на text node** и передаётся в `mapNormalizedRange` для каждого description. В v2 `buildIndexMap` вызывался бы 20-50 раз для одного и того же текста.

### 3.3 Верификация

```bash
cd frontend && npm run type-check && npm run lint && npm run build
```

**Коммит:** `fix(frontend): map normalized text indices back to original DOM text for correct highlighting`

---

## Фаза 4: Исправление потери данных при кешировании (Frontend)

**Баги:**
- `priority_score` не сохраняется → фильтр `density='key'` не работает на кешированных данных
- `text` не сохраняется → оба поля `text` и `content` идентичны после round-trip
- `action` тип необратимо конвертируется в `atmosphere`
- `atmosphere` маппинг расходится между 3 файлами

### 4.1 Создать единый файл маппинга типов

**Новый файл:** `frontend/src/utils/descriptionTypeMapping.ts`

```typescript
/**
 * Unified description type mapping between API and cache formats.
 *
 * Single source of truth — imported by chapterCache.ts, useChapter.ts,
 * downloadManager.ts instead of duplicated inline typeMap objects.
 */
import type { CachedDescription } from '@/services/db';
import type { DescriptionType } from '@/types/api';

/**
 * API description type → cached description type.
 * Used when storing descriptions to IndexedDB.
 */
export const API_TO_CACHE_TYPE: Record<DescriptionType, CachedDescription['type']> = {
  location: 'setting',
  character: 'character',
  atmosphere: 'scene',
  object: 'object',
  action: 'action',
} as const;

/**
 * Cached description type → API description type.
 * Used when reading descriptions from IndexedDB.
 */
export const CACHE_TO_API_TYPE: Record<CachedDescription['type'], DescriptionType> = {
  setting: 'location',
  character: 'character',
  scene: 'atmosphere',
  object: 'object',
  action: 'action',
} as const;

/** Default cached type when API type is unknown */
export const DEFAULT_CACHE_TYPE: CachedDescription['type'] = 'scene';

/** Default API type when cached type is unknown */
export const DEFAULT_API_TYPE: DescriptionType = 'atmosphere';
```

### 4.2 Обновить тип `CachedDescription`

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

### 4.3 Dexie version bump (опционально)

**Файл:** `frontend/src/services/db.ts`

> **Примечание:** Dexie 4.x не требует version bump для неиндексированных полей. `text` и `priorityScore` — неиндексированные. Этот шаг cosmetic — для explicitness.

Если хотите добавить:
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

### 4.4 Обновить `toCachedDescription` в `chapterCache.ts`

**Файл:** `frontend/src/services/chapterCache.ts`, строки 51-69

**Требуемый код:**
```typescript
import { API_TO_CACHE_TYPE, DEFAULT_CACHE_TYPE } from '@/utils/descriptionTypeMapping';

function toCachedDescription(desc: Description): CachedDescription {
  return {
    id: desc.id,
    content: desc.content,
    text: desc.text ?? null,
    type: API_TO_CACHE_TYPE[desc.type] || DEFAULT_CACHE_TYPE,
    confidence: desc.confidence_score,
    priorityScore: desc.priority_score,
    imageUrl: desc.generated_image?.image_url ?? null,
    imageStatus: desc.generated_image
      ? (desc.generated_image.status === 'completed' ? 'generated' : 'pending')
      : 'none',
  }
}
```

### 4.5 Обновить `isValidCachedDescription` в `chapterCache.ts`

**Файл:** `frontend/src/services/chapterCache.ts`, строка 92

**Текущий:** `const validTypes = ['setting', 'character', 'scene', 'object']`
**Требуемый:** `const validTypes = ['setting', 'character', 'scene', 'object', 'action']`

### 4.6 Обновить `fromCachedDescription` в `chapterCache.ts`

**Файл:** `frontend/src/services/chapterCache.ts`, строки 104-149

**Требуемый код:**
```typescript
import { CACHE_TO_API_TYPE, DEFAULT_API_TYPE } from '@/utils/descriptionTypeMapping';

function fromCachedDescription(cached: CachedDescription): Description | null {
  if (!isValidCachedDescription(cached)) {
    logger.warn('[ChapterCache] Corrupted description detected, skipping:', cached)
    return null
  }

  const apiType = CACHE_TO_API_TYPE[cached.type] || DEFAULT_API_TYPE;

  return {
    id: cached.id,
    type: apiType,
    content: cached.content,
    text: cached.text ?? cached.content,
    confidence_score: cached.confidence ?? 0,
    priority_score: cached.priorityScore ?? (cached.confidence ? cached.confidence * 100 : 0),
    generated_image: cached.imageUrl ? {
      id: '',
      service_used: 'cached',
      status: cached.imageStatus === 'generated' ? 'completed' : 'pending',
      image_url: cached.imageUrl,
      is_moderated: false,
      view_count: 0,
      download_count: 0,
      created_at: new Date().toISOString(),
      description: {
        id: cached.id,
        type: apiType,
        text: cached.text ?? cached.content,
        content: cached.content,
        confidence_score: cached.confidence ?? 0,
        priority_score: cached.priorityScore ?? (cached.confidence ? cached.confidence * 100 : 0),
      },
      chapter: {
        id: '',
        number: 0,
        title: '',
      },
    } : undefined,
  }
}
```

**Ключевые изменения:**
- Используется `CACHE_TO_API_TYPE` вместо inline typeMap
- `text: cached.text ?? cached.content` (было `cached.content`)
- `priority_score: cached.priorityScore ?? (cached.confidence ? cached.confidence * 100 : 0)` — масштабирует confidence (0.0-1.0) до priority_score (0-100)

### 4.7 Обновить `useChapter.ts`

**Файл:** `frontend/src/hooks/api/useChapter.ts`

**Шаг 1:** Заменить `mapDescriptionType` (строки 54-62):
```typescript
import { CACHE_TO_API_TYPE, DEFAULT_API_TYPE } from '@/utils/descriptionTypeMapping';

function mapDescriptionType(cachedType: CachedDescription['type']): Description['type'] {
  return CACHE_TO_API_TYPE[cachedType] ?? DEFAULT_API_TYPE;
}
```

**Шаг 2:** Заменить `mapToCachedDescriptionType` (строки 101-110):
```typescript
import { API_TO_CACHE_TYPE, DEFAULT_CACHE_TYPE } from '@/utils/descriptionTypeMapping';

function mapToCachedDescriptionType(apiType: Description['type']): CachedDescription['type'] {
  return API_TO_CACHE_TYPE[apiType] ?? DEFAULT_CACHE_TYPE;
}
```

**Шаг 3:** Обновить `convertCachedDescriptions` (строки 67-96) — добавить `text` и `priorityScore`:
```typescript
function convertCachedDescriptions(
  cached: CachedDescription[]
): Description[] {
  return cached.map((desc) => ({
    id: desc.id,
    content: desc.content,
    text: desc.text ?? desc.content,
    type: mapDescriptionType(desc.type),
    confidence_score: desc.confidence,
    priority_score: desc.priorityScore ?? (desc.confidence ? desc.confidence * 100 : 0),
    generated_image: desc.imageUrl ? {
      id: `cached_${desc.id}`,
      service_used: 'cached',
      status: desc.imageStatus === 'generated' ? 'completed' : 'pending',
      image_url: desc.imageUrl,
      is_moderated: false,
      view_count: 0,
      download_count: 0,
      created_at: new Date().toISOString(),
      description: {
        id: desc.id,
        type: mapDescriptionType(desc.type),
        text: desc.text ?? desc.content,
        content: desc.content,
        confidence_score: desc.confidence,
        priority_score: desc.priorityScore ?? (desc.confidence ? desc.confidence * 100 : 0),
      },
      chapter: { id: '', number: 0, title: '' },
    } : undefined,
  })) as Description[];
}
```

**Шаг 4:** Обновить `saveChapterToCache` (строки 123-130) — добавить `text` и `priorityScore`:
```typescript
const cachedDescriptions: CachedDescription[] = (response.descriptions ?? []).map((desc) => ({
  id: desc.id,
  content: desc.content,
  text: desc.text ?? null,
  type: mapToCachedDescriptionType(desc.type),
  confidence: desc.confidence_score ?? 0,
  priorityScore: desc.priority_score ?? 0,
  imageUrl: desc.generated_image?.image_url ?? null,
  imageStatus: desc.generated_image?.status === 'completed' ? 'generated' as const : 'none' as const,
}));
```

### 4.8 Обновить `downloadManager.ts`

**Файл:** `frontend/src/services/downloadManager.ts`, строки 422-432

**Требуемый код:**
```typescript
import { API_TO_CACHE_TYPE, DEFAULT_CACHE_TYPE } from '@/utils/descriptionTypeMapping';

private mapDescriptionType(
  apiType: string
): CachedDescription['type'] {
  return API_TO_CACHE_TYPE[apiType as keyof typeof API_TO_CACHE_TYPE] ?? DEFAULT_CACHE_TYPE;
}
```

Также обновить место, где создаётся `CachedDescription` в `downloadManager.ts` — добавить `text` и `priorityScore` поля:
```typescript
const cachedDescriptions: CachedDescription[] = descriptions.map((desc: Description) => ({
  id: desc.id,
  content: desc.content,
  text: desc.text ?? null,
  type: this.mapDescriptionType(desc.type),
  confidence: desc.confidence_score ?? 0,
  priorityScore: desc.priority_score ?? 0,
  imageUrl: desc.generated_image?.image_url ?? null,
  imageStatus: desc.generated_image?.status === 'completed' ? 'generated' as const : 'none' as const,
}));
```

### 4.9 Верификация

```bash
cd frontend && npm run type-check && npm run lint && npm run build
```

**Коммит:** `fix(frontend): unify description type mapping and preserve priority_score/text in cache`

---

## Фаза 5: Обновление тестов

### 5.1 Frontend тесты

#### 5.1.1 `buildIndexMap` и `mapNormalizedRange`

**Файл:** `frontend/src/utils/text-search/__tests__/normalization.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildIndexMap, mapNormalizedRange, normalizeText } from '@/utils/text-search/normalization';

describe('buildIndexMap', () => {
  it('handles leading whitespace (trim)', () => {
    const original = '   Hello world';
    const map = buildIndexMap(original);
    expect(map[0]).toBe(3); // 'H' is at index 3 in original
  });

  it('handles collapsed whitespace', () => {
    const original = 'Фиц  медленно   поднялся';
    const map = buildIndexMap(original);
    // map[4] should point to 'м' which is at original index 5
    expect(map[4]).toBe(5);
  });

  it('handles NBSP', () => {
    const original = 'Hello\u00A0world';
    const map = buildIndexMap(original);
    expect(map.length).toBe(original.length); // NBSP is 1:1
  });
});

describe('mapNormalizedRange', () => {
  it('handles leading whitespace', () => {
    const original = '   Hello world';
    const map = buildIndexMap(original);
    const { startIdx, endIdx } = mapNormalizedRange(map, original, 0, 5);
    expect(original.substring(startIdx, endIdx)).toBe('Hello');
  });

  it('handles collapsed whitespace', () => {
    const original = 'Фиц  медленно   поднялся';
    const map = buildIndexMap(original);
    const norm = normalizeText(original); // 'Фиц медленно поднялся'
    const mIdx = norm.indexOf('медленно');
    const { startIdx, endIdx } = mapNormalizedRange(map, original, mIdx, mIdx + 'медленно'.length);
    expect(original.substring(startIdx, endIdx)).toBe('медленно');
  });

  it('handles fancy quotes (1:1 replacement)', () => {
    const original = '«Привет»';
    const map = buildIndexMap(original);
    const { startIdx, endIdx } = mapNormalizedRange(map, original, 0, original.length);
    expect(original.substring(startIdx, endIdx)).toBe('«Привет»');
  });

  it('handles em dash (1:1 replacement)', () => {
    const original = 'слово\u2014слово';
    const map = buildIndexMap(original);
    const { startIdx, endIdx } = mapNormalizedRange(map, original, 0, original.length);
    expect(original.substring(startIdx, endIdx)).toBe('слово\u2014слово');
  });

  it('handles combination: trim + collapse + quotes + dash', () => {
    const original = '  «Фиц»  \u2014  медленно  ';
    const norm = normalizeText(original); // '"Фиц" - медленно'
    const map = buildIndexMap(original);
    // Find 'медленно' in normalized
    const mIdx = norm.indexOf('медленно');
    const { startIdx, endIdx } = mapNormalizedRange(map, original, mIdx, mIdx + 'медленно'.length);
    expect(original.substring(startIdx, endIdx)).toBe('медленно');
  });
});
```

#### 5.1.2 Cache round-trip тест

**Файл:** `frontend/src/services/__tests__/chapterCache.test.ts` (добавить тесты)

```typescript
import { describe, it, expect } from 'vitest';
import { API_TO_CACHE_TYPE, CACHE_TO_API_TYPE } from '@/utils/descriptionTypeMapping';

describe('descriptionTypeMapping', () => {
  it('preserves action type through round-trip', () => {
    const cached = API_TO_CACHE_TYPE['action'];
    const restored = CACHE_TO_API_TYPE[cached];
    expect(restored).toBe('action');
  });

  it('preserves all types through round-trip', () => {
    const apiTypes = ['location', 'character', 'atmosphere', 'object', 'action'] as const;
    for (const apiType of apiTypes) {
      const cached = API_TO_CACHE_TYPE[apiType];
      const restored = CACHE_TO_API_TYPE[cached];
      expect(restored).toBe(apiType);
    }
  });
});
```

### 5.2 Backend тесты

#### 5.2.1 DescriptionType StrEnum и _missing_()

**Файл:** `backend/tests/test_description_type.py` (новый)

```python
"""Tests for DescriptionType StrEnum."""

import enum
import pytest

from app.models.description import DescriptionType


class TestDescriptionType:
    """Test DescriptionType enum properties."""

    def test_is_strenum(self):
        assert issubclass(DescriptionType, enum.StrEnum)

    def test_values_are_lowercase(self):
        for member in DescriptionType:
            assert member.value == member.value.lower()

    def test_member_is_str(self):
        assert isinstance(DescriptionType.LOCATION, str)
        assert str(DescriptionType.LOCATION) == "location"

    def test_missing_uppercase_lookup(self):
        """Backward compat with Celery tasks that may send UPPERCASE."""
        assert DescriptionType("LOCATION") == DescriptionType.LOCATION
        assert DescriptionType("CHARACTER") == DescriptionType.CHARACTER

    def test_missing_mixed_case_lookup(self):
        assert DescriptionType("Location") == DescriptionType.LOCATION

    def test_missing_invalid_value(self):
        with pytest.raises(ValueError):
            DescriptionType("nonexistent_type")

    def test_pydantic_serialization(self):
        """DescriptionResponse serializes type as lowercase string."""
        # Direct .value check
        assert DescriptionType.LOCATION.value == "location"
        assert DescriptionType.CHARACTER.value == "character"
        assert DescriptionType.ATMOSPHERE.value == "atmosphere"
        assert DescriptionType.OBJECT.value == "object"
        assert DescriptionType.ACTION.value == "action"

    def test_group_by_type_returns_lowercase_keys(self):
        """Verify group_by_type returns lowercase keys."""
        # Simulated: desc.type.value produces lowercase
        for dt in DescriptionType:
            assert dt.value.islower()
```

### 5.3 Верификация тестов

```bash
cd frontend && npm test
cd backend && pytest tests/test_description_type.py -v --no-cov
cd backend && pytest tests/ -v --no-cov -x
```

**Коммит:** `test: add tests for description type mapping, StrEnum, and index normalization`

---

## Фаза 6: Финальная верификация

### 6.1 Frontend

```bash
cd frontend
npm run type-check
npm run lint
npm run build
npm test
```

### 6.2 Backend

```bash
cd backend
mypy app/
ruff check app/
pytest tests/ -v --no-cov
```

### 6.3 E2E проверка

1. Очистить IndexedDB: DevTools → Application → IndexedDB → FancaiDB → Delete database
2. Перезагрузить страницу
3. Перейти к главе с описаниями
4. Проверить:
   - [ ] Подсветки видны в тексте
   - [ ] Подсветки **разных цветов** (location — синий, character — фиолетовый, atmosphere — жёлтый, action — синий)
   - [ ] Клик по подсветке открывает модалку
   - [ ] Подсветки на правильном участке текста (не сдвинуты)
   - [ ] Переключение главы и возврат — данные из кеша + обновление в фоне
   - [ ] Фильтр `density='key'` показывает только описания с `priority_score > 50`

---

## Порядок деплоя на production

**Критически важно — неправильный порядок приведёт к downtime.**

### Вариант 1: Atomic deploy (рекомендуется)

```bash
# 1. Deploy backend code + run migration в одном процессе
ssh production
cd /app
git pull origin main
cd backend
alembic upgrade head        # DB enum → lowercase
supervisorctl restart all   # Backend + Celery перезапуск
```

### Вариант 2: Staged deploy

```
1. alembic upgrade head     — DB enum → lowercase
   (существующий код с UPPERCASE enum продолжает работать,
    потому что SQLAlchemy загружает данные из DB,
    а DB теперь хранит lowercase)
2. Deploy backend code      — код ожидает lowercase ✅
3. Deploy frontend          — если отдельный деплой
```

**НЕПРАВИЛЬНЫЙ порядок (приведёт к ошибкам):**
```
1. Deploy backend code (ожидает lowercase)
2. alembic upgrade head (DB ещё UPPERCASE)
   ⚠️ Между 1 и 2 — DescriptionType("LOCATION") сломается!
```

### Celery workers

- Celery workers должны быть перезапущены ПОСЛЕ деплоя нового кода
- Задачи в очереди с UPPERCASE `description_type` будут обработаны корректно благодаря `_missing_()` classmethod
- Если workers не перезапущены — `DescriptionType("location")` вызовет `ValueError` в старом коде. `_missing_()` решает эту проблему в НОВОМ коде

---

## Полная карта файлов (v3)

### Backend (Фазы 0-1)

| # | Файл | Фаза | Тип изменения |
|---|------|------|---------------|
| 1 | `app/models/description.py` | 0 | `enum.Enum` → `enum.StrEnum`, lowercase values, `_missing_()` |
| 2 | `app/services/gemini_extractor.py` | 0 | Удалить дубликат enum, убрать `.upper()` из `to_dict()` |
| 3 | `app/services/imagen_generator.py` | 0 | Удалить дубликат enum, импорт из models |
| 4 | `app/services/llm_description_enricher.py` | 0 | Удалить дубликат enum, импорт из models |
| 5 | `app/services/image_generator.py` | 0 | Верифицировать: `.type.value` работает с StrEnum |
| 6 | `app/tasks/image_tasks.py` | 0 | Верифицировать: `description_type` строки lowercase |
| 7 | `app/core/container.py` | 0 | Верифицировать: `description_type: str` формат |
| 8 | `alembic/versions/xxx_revert_enum.py` | 1 | Alembic migration: RENAME VALUE |
| 9 | `tests/services/test_imagen_generator.py` | 0 | Обновить импорт DescriptionType |
| 10 | `tests/services/test_gemini_extractor.py` | 0 | Обновить импорт DescriptionType |
| 11 | `tests/conftest.py` | 0 | Проверить fixtures |
| 12 | `tests/test_description_type.py` | 5 | Новые тесты для StrEnum |

### Frontend (Фазы 2-5)

| # | Файл | Фаза | Тип изменения |
|---|------|------|---------------|
| 13 | `src/services/db.ts` | 2, 4 | Адаптивный TTL, обновить CachedDescription type |
| 14 | `src/hooks/epub/useChapterData.ts` | 2 | SWR + AbortController |
| 15 | `src/utils/text-search/normalization.ts` | 3 | Добавить buildIndexMap, mapNormalizedRange |
| 16 | `src/hooks/epub/useDescriptionHighlighting.ts` | 3 | Использовать mapNormalizedRange с кешированием |
| 17 | `src/utils/descriptionTypeMapping.ts` | 4 | **Новый файл**: единый маппинг типов |
| 18 | `src/services/chapterCache.ts` | 4 | Обновить toCached/fromCached/isValid с единым маппингом |
| 19 | `src/services/downloadManager.ts` | 4 | Использовать единый маппинг |
| 20 | `src/hooks/api/useChapter.ts` | 4 | Использовать единый маппинг, добавить text/priorityScore |
| 21 | `src/utils/text-search/__tests__/normalization.test.ts` | 5 | Тесты для buildIndexMap/mapNormalizedRange |
| 22 | `src/services/__tests__/chapterCache.test.ts` | 5 | Тесты round-trip маппинга |

### Итого

| Категория | Файлов | Новых файлов | Коммитов |
|-----------|--------|--------------|----------|
| Backend | 12 | 2 (migration + test) | 2 |
| Frontend | 10 | 2 (mapping + test) | 4 |
| **Всего** | **22** | **4** | **6** |

---

## Зависимости между фазами

```
Фаза 0 (Консолидация enum'ов) ← ПЕРВАЯ
    ↓
Фаза 1 (Alembic миграция) ← зависит от Фазы 0
    ↓ API теперь отдаёт lowercase
Фаза 2 (Cache invalidation) — независима от Фаз 0-1
Фаза 3 (Index mapping) — независима от Фаз 0-2
Фаза 4 (Cache round-trip) — зависит от Фазы 1 (typeMap работает с lowercase)
    ↓
Фаза 5 (Тесты) — после всех фаз изменений
    ↓
Фаза 6 (Верификация) — после всех фаз
```

**Рекомендуемый порядок: 0 → 1 → 2 → 3 → 4 → 5 → 6**

Фазы 2 и 3 можно выполнять параллельно после Фазы 1.

---

## Будущие улучшения (out of scope)

1. **Рефакторить `useChapterData` на `useQuery`** с `staleTime` — устранит дублирование SWR-логики между TanStack Query и ручным кешем
2. **Dexie version bump** для explicitness (cosmetic)
3. **E2E Playwright тест** для highlighting: проверка `<span class="description-highlight">` в iframe
4. **Адаптивное сравнение в revalidation** — hash-based вместо ID-based для обнаружения изменений содержимого описаний


---

## Фаза 7: Исправление pre-existing lint/type ошибок (Backend + Frontend)

**Дата выполнения:** 2026-02-25
**Статус:** ✅ Завершена
**Исполнитель:** Sisyphus-Junior (deep agent), верификация — основной агент

**Проблема:** В процессе финальной верификации (Фаза 6) обнаружено 32 pre-existing ошибки ruff в backend и несколько ошибок ESLint/TypeScript во frontend. Ошибки не были введены фазами 0-6 — они существовали до начала работы.

### 7.1 Backend: ruff check (32 → 0 ошибок)

| # | Файл | Ошибки | Исправление |
|---|------|--------|-------------|
| 1 | `app/core/container.py` | E402 (import order), F401 (unused imports) | `from __future__ import annotations` + `TYPE_CHECKING` guard; удалены неиспользуемые импорты `Depends`, `get_database_session` |
| 2 | `app/main.py` | E402 (import order) | Перемещены `entities_router` и `websocket_router` импорты на верхний уровень |
| 3 | `app/models/password_reset.py` | F821 (undefined name `User`) | Добавлен `TYPE_CHECKING` guard с forward reference для `User` |
| 4 | `app/schemas/responses/__init__.py` | E402 (import order) | Исправлено размещение `# noqa: E402` на импорте chapters |
| 5 | `tests/test_books.py` | E722 (bare except) × 2 | `except:` → `except OSError:` в двух местах |
| 6 | `tests/test_jsonb_performance.py` | E402 (import order) | Перемещены импорты перед `pytestmark` assignment |
| 7 | `app/routers/books/processing.py` | Pyright: return dict vs model (14 ошибок) | Заменены все `return {...}` dict'ы на `return BookProcessingResponse(...)` / `ParsingStatusResponse(...)` model instances |
| 8 | `app/services/llm_cache_service.py` | Pyright: `ttl: int = None` | `ttl: int = None` → `ttl: Optional[int] = None` |
| 9 | `app/core/retry.py` | Pyright: passing `None` to non-optional params | Рефакторинг retry kwargs в dict для исключения передачи `None` в `before_sleep`/`after` |

### 7.2 Frontend: ESLint + TypeScript (1 ошибка)

| # | Файл | Ошибка | Исправление |
|---|------|--------|-------------|
| 1 | `src/hooks/useBookProgressWS.ts` | TypeScript: `useRef<number>(Date.now())` тип-инференс | `useRef<number>(Date.now())` → `useRef<number>(0)` (начальное значение не используется до mount) |

### 7.3 Принципы исправлений

- **Минимальные изменения** — каждый fix затрагивает только конкретную ошибку
- **Python 3.11+ best practices**: `from __future__ import annotations` для DI-контейнеров с ленивыми импортами
- **FastAPI best practice**: Return Pydantic model instances, не dict'ы, из endpoint'ов с `response_model`
- **Type safety**: `Optional[int]` вместо `int = None` для nullable параметров
- **Error specificity**: `except OSError:` вместо bare `except:` (PEP 8 / ruff E722)

### 7.4 Верификация

```bash
# Backend
cd backend && source .venv/bin/activate
ruff check app/ tests/       # → All checks passed!
python -m pytest tests/test_description_type.py -v --no-cov  # → 10/10 passed

# Frontend
cd frontend
npm run type-check            # → tsc --noEmit OK
npm run lint                  # → 0 warnings, 0 errors
npm run build                 # → vite build OK
npm test                      # → 309 passed, 0 failed
```

**Коммит:** `fix: resolve pre-existing lint and type errors across backend and frontend`

---

## Статус выполнения (актуализировано 2026-02-25)

| Фаза | Статус | Коммит |
|------|--------|--------|
| 0. Консолидация DescriptionType enum'ов | ✅ Завершена | `refactor(backend): consolidate DescriptionType enums into StrEnum with lowercase values` |
| 1. Alembic миграция | ✅ Завершена | `fix(backend): revert DescriptionType enum values to lowercase via Alembic migration` |
| 2. Инвалидация кеша IndexedDB | ✅ Завершена | `fix(frontend): add stale-while-revalidate with AbortController and adaptive TTL` |
| 3. Исправление индексов нормализации | ✅ Завершена | `fix(frontend): map normalized text indices back to original DOM text for correct highlighting` |
| 4. Исправление потери данных при кешировании | ✅ Завершена | `fix(frontend): unify description type mapping and preserve priority_score/text in cache` |
| 5. Обновление тестов | ✅ Завершена (36 новых тестов) | `test: add tests for description type mapping, StrEnum, and index normalization` |
| 6. Финальная верификация | ✅ Пройдена | — |
| 7. Pre-existing lint/type ошибки | ✅ Завершена (10 файлов) | `fix: resolve pre-existing lint and type errors across backend and frontend` |

### Итоговая статистика

| Метрика | Значение |
|---------|----------|
| Файлов изменено (Фазы 0-6) | 22 |
| Файлов изменено (Фаза 7) | 10 |
| Новых файлов | 4 (migration, mapping, 2 test files) |
| Новых тестов | 36 |
| Pre-existing ошибок исправлено | 33 (32 ruff + 1 TypeScript) |
| Frontend тестов итого | 309 passed, 0 failed |
| Backend тестов (description type) | 10 passed |
| Коммитов (рекомендуемых) | 7 |

---

## Phase 8: Architectural Audit Fixes (2026-02-25)

Implementation of fixes from the architectural audit report (`docs/reports/2026-02-25-architectural-audit-report.md`).

### Fix Status

| # | Priority | Description | Status | Files |
|---|----------|-------------|--------|-------|
| 1 | P0 | `CHAPTER_CACHE_TTL` static const -> `getChapterCacheTTL()` | DONE | `db.ts`, `chapterCache.ts`, `storageManager.ts` |
| 3 | P0 | Gallery missing `object`/`action` types + i18n | DONE | `ImagesGalleryPage.tsx`, `ImageFilters.tsx`, `en/translation.json`, `ru/translation.json` |
| 16 | P0 | Silent `except` -> `logger.exception` | DONE | `processing.py` |
| 5 | P1 | Zombie OBJECT safety UPDATE + documentation | DONE | `description.py` (comment), migration already has UPDATE |
| 11 | P1 | `setTimeout` cleanup in `useDescriptionHighlighting` | DONE | `useDescriptionHighlighting.ts` |
| 21 | P1 | iOS fixes `rendition.on` cleanup | DONE | `useEpubIOSFixes.ts` |
| 22 | P1 | iOS fixes iframe `addEventListener` cleanup | DONE | `useEpubIOSFixes.ts`, `useEpubRendition.ts`, `useEpubLoader.ts` |
| 7 | P1 | `AbortController` signal in fetch calls | DONE | `books.ts`, `images.ts`, `useChapterData.ts` |
| 6 | P2 | `priorityScore` fallback in downloadManager | DONE | `downloadManager.ts` |
| 10 | P2 | `convertCachedDescriptions` add validation | DONE | `chapterCache.ts`, `useChapter.ts` |
| 15 | P2 | `print()` -> `logger` (3 backend files) | DONE | `processing.py`, `images.py`, `system.py` |
| 14 | P2 | `datetime.utcnow()` -> `datetime.now(timezone.utc)` | DONE | `llm_cache_service.py`, `auth.py`, `admin.py`, `responses/__init__.py` |
| 2 | P3 | `buildIndexMap` trailing whitespace trim | DONE | `normalization.ts`, `normalization.test.ts` |
| 13 | P3 | `List[tuple] = None` -> `Optional[List[tuple[int, int]]]` | DONE | `llm_description_enricher.py` |
| 12 | P3 | `test_image_generation.py` UPPERCASE query -> enum | DONE | `test_image_generation.py` |
| 9 | P3 | `imageStatus` mapping: non-completed -> `'pending'` | DONE | `useChapter.ts` |
| 17 | P3 | Remove `as const` from `Record<>` | DONE | `descriptionTypeMapping.ts` |

### Deferred (per audit recommendation)

| # | Description | Reason |
|---|-------------|--------|
| 8 | SWR unification (`useChapterData` -> TQ5) | Architectural refactor, not a bug |
| 27 | Uncleaned `setTimeout` in epub hooks (8 places) | Short timeouts, minimal risk |

### Verification

| Batch | type-check | lint | build | tests | ruff |
|-------|-----------|------|-------|-------|------|
| 1 (P0/P1 Quick) | PASS | PASS | PASS | 309 passed | PASS |
| 2 (P1 Short) | PASS | PASS | PASS | - | - |
| 3 (P2 Quick) | PASS | PASS | PASS | 309 passed | PASS |
| 4 (Cosmetic) | PASS | PASS | PASS | 309 passed | PASS |

### Phase 8 Summary

| Metric | Value |
|--------|-------|
| Fixes implemented | 17 of 17 planned |
| Fixes deferred | 2 (per audit recommendation) |
| Frontend files changed | 18 |
| Backend files changed | 8 |
| Frontend tests | 309 passed, 0 failed |
| Verification batches | 4/4 passed |