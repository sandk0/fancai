# Архитектурный аудит: верификация консолидированного отчёта

**Дата:** 25 февраля 2026  
**Аудитор:** Старший архитектор-аудитор  
**Scope:** 22 файла (фазы 0-6), 10 файлов (фаза 7), 4 новых файла, 36 тестов  
**Метод:** Полное чтение затронутых файлов + 3 explore-агента + Context7 best practices + web search

---

## 1. Резюме

### Общая оценка качества изменений: 7.5/10

Набор изменений решает реальную проблему (сломанная подсветка описаний из-за case mismatch в DescriptionType enum) и делает это системно — от PostgreSQL enum до фронтенд-кеша. Архитектурные решения в целом корректны: StrEnum с `_missing_()`, идемпотентная миграция, единый маппинг типов.

### Ключевые пересмотры severity

| # | Исходная | Пересмотренная | Причина |
|---|----------|----------------|---------|
| 1 | CRITICAL | **HIGH** | Затрагивает только описания (не EPUB-контент), пользователь может читать |
| 2 | CRITICAL | **LOW** | Мismatch существует, но не эксплуатируется — стратегии ограничены длиной normalizedText |
| 4 | HIGH | **MEDIUM** | Race condition защищён manual abort check, реальный эффект — лишний трафик |
| 9 | MEDIUM | **LOW** | useChapter.ts:120 и chapterCache.ts:62 оба маппят non-completed → корректные значения |
| 12 | MEDIUM | **LOW** | test_image_generation.py — скрипт для ручного тестирования, не production |
| 18 | LOW | **ОПРОВЕРГНУТО** | server_tasks.py не существует |
| 19 | LOW | **ОПРОВЕРГНУТО** | downloaded_gemini_extractor.py не существует |
| 20 | LOW | **ОПРОВЕРГНУТО** | Тестовые файлы не существуют |

### Итоговая статистика

- **Подтверждено:** 14 из 20 findings
- **Severity пересмотрена:** 5 findings (все понижены)
- **Опровергнуто:** 3 findings (файлы не существуют)
- **Частично подтверждено:** 3 findings
- **Новых findings:** 8 (включая 2 HIGH)

---

## 2. Детальный разбор каждого finding

### CRITICAL #1: `CHAPTER_CACHE_TTL` — статическая константа

**Файл:** `frontend/src/services/db.ts:351-353`

```typescript
export const CHAPTER_CACHE_TTL = typeof navigator !== 'undefined' && navigator.onLine
  ? 1 * 60 * 60 * 1000      // 1 hour when online
  : 7 * 24 * 60 * 60 * 1000  // 7 days when offline
```

**Вердикт: ПОДТВЕРЖДЕНО, severity понижена до HIGH**

**Доказательство:** Константа вычисляется один раз при загрузке модуля. Используется в:
- `chapterCache.ts:486` — `isExpired()`: `Date.now() - cachedAt > CHAPTER_CACHE_TTL`
- `chapterCache.ts:398` — `clearExpired()`: `Date.now() - CHAPTER_CACHE_TTL`

**Сценарий бага:** Пользователь открывает приложение online (TTL=1ч) → переходит в airplane mode → через 1ч `chapterCache.get()` (строка 188) считает кеш просроченным → удаляет запись → `useChapterData.ts:83` получает null → пытается fetch с API (строка 94) → fetch fails (offline) → catch block (строка 114) устанавливает `descriptions: []` → подсветка описаний пропадает.

**Почему не CRITICAL:** Пользователь **может продолжать читать** — epub.js рендерит контент из скачанного EPUB-файла. Теряются только AI-описания (подсветки). Для PWA-ридера это значимая деградация, но не полная поломка.

**Blast radius:** Все PWA-пользователи, читающие offline более 1 часа после online-старта.

**Fix:**

```typescript
// db.ts — заменить статическую константу на функцию
export function getChapterCacheTTL(): number {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 7 * 24 * 60 * 60 * 1000; // 7 days offline
  }
  return 1 * 60 * 60 * 1000; // 1 hour online
}

// chapterCache.ts — использовать функцию вместо константы
private isExpired(cachedAt: number): boolean {
  return Date.now() - cachedAt > getChapterCacheTTL();
}
```

**Усилие:** Quick (<1ч)

---

### CRITICAL #2: `buildIndexMap` — несовпадение длины с `normalizeText`

**Файл:** `frontend/src/utils/text-search/normalization.ts:72-97`

**Вердикт: ПОДТВЕРЖДЕНО как факт, severity понижена до LOW**

**Доказательство мismatch:** Для строки `"  hello  world  "`:
- `normalizeText()` → `"hello world"` (длина 11, `.trim()` убирает trailing spaces)
- `buildIndexMap()` → массив длины 12 (включает entry для trailing collapsed space)

Разница: `indexMap.length` (12) > `normalizedText.length` (11).

**Почему LOW, а не CRITICAL:** Стратегии поиска (`strategies.ts`) работают на `normalizedText` и возвращают `startIdx`/`endIdx` в пределах `normalizedText.length`. Функция `mapNormalizedRange` (строки 103-121) обрабатывает out-of-bounds через fallback на `original.length`:

```typescript
const startIdx = normalizedStartIdx < indexMap.length
  ? indexMap[normalizedStartIdx]
  : original.length;  // fallback
```

Лишние entries в `indexMap` никогда не адресуются валидными результатами стратегий. Я проверил все 8 стратегий в `strategies.ts` — все используют `indexOf()` на `normalizedText`, что гарантирует `endIdx <= normalizedText.length`.

**Blast radius:** Теоретический — только если будет добавлена стратегия, возвращающая `endIdx > normalizedText.length`.

**Fix (code quality):**

```typescript
// normalization.ts:94 — добавить trim trailing whitespace
export const buildIndexMap = (original: string): number[] => {
  const map: number[] = [];
  // ... existing code ...
  // Trim trailing collapsed whitespace to match normalizeText().trim()
  while (map.length > 0 && /\s/.test(original[map[map.length - 1]])) {
    map.pop();
  }
  return map;
};
```

**Усилие:** Quick (<1ч)

---

### HIGH #3: Локальный `DescriptionType` без `'object'` и `'action'`

**Файлы:** `ImagesGalleryPage.tsx:23`, `ImageFilters.tsx:15`

**Вердикт: ПОДТВЕРЖДЕНО, severity HIGH**

**Доказательство:**

```typescript
// ImagesGalleryPage.tsx:23
type DescriptionType = 'all' | 'location' | 'character' | 'atmosphere';

// ImageFilters.tsx:15
type DescriptionType = 'all' | 'location' | 'character' | 'atmosphere';
```

Оба файла определяют **локальный** тип без `'object'` и `'action'`. При этом:
- `frontend/src/types/api.ts:147` определяет полный тип: `'location' | 'character' | 'atmosphere' | 'object' | 'action'`
- Backend DescriptionType StrEnum содержит все 5 типов
- `useDescriptionHighlighting.ts:23-24` корректно обрабатывает `object` и `action`

**Blast radius:** Все пользователи галереи изображений. Описания типов `object` и `action` отображаются, но:
1. Нет фильтра для них в dropdown (строки 53-58 ImageFilters.tsx)
2. Нет статистики в stats-блоке (строки 212-248 ImagesGalleryPage.tsx)
3. При фильтрации по `atmosphere` описания `object`/`action` не показываются

**Fix:**

```typescript
// ImagesGalleryPage.tsx:23 и ImageFilters.tsx:15
type DescriptionType = 'all' | 'location' | 'character' | 'atmosphere' | 'object' | 'action';

// ImagesGalleryPage.tsx:117-122 — добавить типы в массив
const descriptionTypes = [
  { value: 'all', label: t('imagesGallery.all_types'), icon: Sparkles },
  { value: 'location', label: t('imagesGallery.stats.locations'), icon: MapPin },
  { value: 'character', label: t('imagesGallery.stats.characters'), icon: UserIcon },
  { value: 'atmosphere', label: t('imagesGallery.stats.atmosphere'), icon: Sparkles },
  { value: 'object', label: t('imagesGallery.stats.objects'), icon: Box },
  { value: 'action', label: t('imagesGallery.stats.actions'), icon: Zap },
];
```

**Усилие:** Quick (<1ч), требует добавления i18n-ключей

---

### HIGH #4: Race condition в background revalidation

**Файл:** `frontend/src/hooks/epub/useChapterData.ts:28-65`

**Вердикт: ЧАСТИЧНО ПОДТВЕРЖДЕНО, severity понижена до MEDIUM**

**Анализ:** Сценарий из отчёта:
1. Пользователь на главе 1, bg-fetch запущен (строка 89)
2. Переключение на главу 2 → cleanup (строка 127) вызывает `bgAbortControllerRef.current?.abort()`
3. Bg-fetch главы 1 завершается

Защита работает: строки 40, 51, 56 проверяют `bgController.signal.aborted`. Однако **signal не передаётся в fetch-вызовы** (строки 39, 50), поэтому HTTP-запрос не отменяется — только предотвращается `setState`.

**Реальный эффект:** Лишний сетевой трафик, но НЕ показ данных чужой главы. Окно race condition между `if (bgController.signal.aborted) return` (строка 40) и `setDescriptions` (строка 57) теоретически существует, но на практике JavaScript однопоточен — между проверкой и setState нет yield point (await), поэтому race невозможен в рамках одного microtask.

**Blast radius:** Минимальный — лишний трафик при быстром переключении глав.

**Fix:** Передать signal в API-вызовы (см. MEDIUM #7).

**Усилие:** Short (1-4ч) — требует изменения сигнатур API-функций

---

### HIGH #5: Zombie-значение `'OBJECT'` в PostgreSQL enum

**Файл:** `backend/alembic/versions/2026_02_25_0001_lowercase_descriptiontype_enum.py`

**Вердикт: ПОДТВЕРЖДЕНО, severity HIGH**

**Доказательство:** Миграция `2026_01_21` добавила lowercase `'object'`:
```python
# 2026_01_21_add_object_to_descriptiontype.py:21
op.execute("ALTER TYPE descriptiontype ADD VALUE IF NOT EXISTS 'object'")
```

Миграция `2026_02_25` пытается переименовать `'OBJECT'` → `'object'`, но пропускает, т.к. `'object'` уже существует:
```sql
IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'object'
) THEN
    ALTER TYPE descriptiontype RENAME VALUE 'OBJECT' TO 'object';
END IF;
```

Результат: enum содержит **6 значений** вместо 5: `location, character, atmosphere, OBJECT, object, action`. Значение `'OBJECT'` — zombie, не используется кодом, но может быть вставлено через raw SQL.

**Blast radius:** Низкий для production (SQLAlchemy всегда пишет lowercase через StrEnum), но нарушает data integrity constraint. Может вызвать проблемы при ручных SQL-операциях или миграциях.

**Fix:**

```python
# Новая миграция: удаление zombie OBJECT
def upgrade() -> None:
    # PostgreSQL не поддерживает DROP VALUE напрямую.
    # Нужно пересоздать enum без OBJECT.
    op.execute("""
    DO $$
    BEGIN
        -- Убедимся что нет строк с 'OBJECT'
        IF EXISTS (SELECT 1 FROM descriptions WHERE type = 'OBJECT') THEN
            UPDATE descriptions SET type = 'object' WHERE type = 'OBJECT';
        END IF;
    END $$;
    """)
    # Для удаления значения из enum нужен ALTER TYPE ... RENAME + recreate
    # или pg_enum hack (DELETE FROM pg_enum WHERE ...)
    # Безопаснее оставить zombie и задокументировать
```

**Примечание:** В PostgreSQL нет `ALTER TYPE ... DROP VALUE`. Удаление требует пересоздания типа, что рискованно на production. Рекомендация: **задокументировать zombie, не удалять**.

**Усилие:** Quick (<1ч) для UPDATE safety net, Medium (4-16ч) для полного удаления

---

### MEDIUM #6: Inconsistent `priorityScore` fallback

**Файл:** `frontend/src/services/chapterCache.ts:59`

**Вердикт: ПОДТВЕРЖДЕНО, severity MEDIUM**

**Доказательство:** Три разных формулы fallback:

1. `chapterCache.ts:59` (toCachedDescription):
   ```typescript
   priorityScore: desc.priority_score ?? (desc.confidence_score ? desc.confidence_score * 100 : 0)
   ```

2. `downloadManager.ts:398`:
   ```typescript
   priorityScore: 0  // Всегда 0!
   ```

3. Backend `description.py:136-165` (calculate_priority_score):
   ```python
   type_priority + confidence_weight + length_score  # 0-100
   ```

**Blast radius:** Описания, загруженные через downloadManager, всегда имеют `priorityScore: 0`. При density='key' (фильтр `priority_score > 50`) все offline-загруженные описания будут скрыты.

**Fix:** Использовать ту же формулу что в chapterCache.ts:

```typescript
// downloadManager.ts:398
priorityScore: desc.confidence_score ? desc.confidence_score * 100 : 0,
```

**Усилие:** Quick (<1ч)

---

### MEDIUM #7: AbortController signal не передаётся в fetch

**Файл:** `frontend/src/hooks/epub/useChapterData.ts:39,50,94,101`

**Вердикт: ПОДТВЕРЖДЕНО, severity MEDIUM**

**Доказательство:** Signal создаётся (строка 73), но не передаётся:

```typescript
// Строка 94 — signal НЕ передан
const descriptionsResponse = await booksAPI.getChapterDescriptions(bookId, chapter, false);
// Строка 101 — signal НЕ передан
const imagesResponse = await imagesAPI.getBookImages(bookId, chapter);
```

Abort работает как "проверка после завершения" (строки 81, 97, 102), а не реальная отмена HTTP-запроса.

**Blast radius:** Лишний сетевой трафик при быстром переключении глав. На медленных соединениях (3G) может вызвать заметные задержки.

**Fix:**

```typescript
const descriptionsResponse = await booksAPI.getChapterDescriptions(
  bookId, chapter, false, { signal }
);
const imagesResponse = await imagesAPI.getBookImages(
  bookId, chapter, { signal }
);
```

Требует обновления сигнатур `booksAPI.getChapterDescriptions` и `imagesAPI.getBookImages`.

**Усилие:** Short (1-4ч)

---

### MEDIUM #8: Дублирование SWR-логики

**Файлы:** `useChapterData.ts` + `useChapter.ts`

**Вердикт: ПОДТВЕРЖДЕНО, severity MEDIUM**

**Доказательство:** Проект имеет **два параллельных механизма** загрузки chapter data:

1. `hooks/epub/useChapterData.ts` — ручная реализация SWR (useState + useEffect + AbortController)
2. `hooks/api/useChapter.ts` — TanStack Query с IndexedDB integration

Оба файла:
- Обращаются к `chapterCache` (IndexedDB)
- Вызывают `booksAPI.getChapterDescriptions`
- Маппят типы через `descriptionTypeMapping`

**Blast radius:** Maintenance burden. Баг-фиксы нужно применять в двух местах. Потенциальные расхождения в поведении кеширования.

**Fix:** Долгосрочно — мигрировать `useChapterData.ts` на TanStack Query. Краткосрочно — задокументировать, что `useChapterData` используется в reader, а `useChapter` — в остальном UI.

**Усилие:** Medium (4-16ч) для миграции

---

### MEDIUM #9: `imageStatus` маппинг

**Файл:** `useChapter.ts:120`

**Вердикт: ЧАСТИЧНО ПОДТВЕРЖДЕНО, severity понижена до LOW**

**Доказательство:**

```typescript
// useChapter.ts:120
imageStatus: desc.generated_image?.status === 'completed' ? 'generated' as const : 'none' as const,
```

```typescript
// chapterCache.ts:61-63
imageStatus: desc.generated_image
  ? (desc.generated_image.status === 'completed' ? 'generated' : 'pending')
  : 'none',
```

Разница: `useChapter.ts` маппит non-completed → `'none'`, а `chapterCache.ts` маппит non-completed с image → `'pending'`. Однако `imageStatus` используется только для визуального индикатора (dashed vs solid border в подсветке). Разница между `'none'` и `'pending'` минимальна для UX.

**Blast radius:** Косметический — стиль border подсветки может отличаться для pending images.

**Усилие:** Quick (<1ч)

---

### MEDIUM #10: `convertCachedDescriptions` без валидации

**Файл:** `frontend/src/hooks/api/useChapter.ts:62-92`

**Вердикт: ПОДТВЕРЖДЕНО, severity MEDIUM**

**Доказательство:**

```typescript
// useChapter.ts:62-92
function convertCachedDescriptions(cached: CachedDescription[]): Description[] {
  return cached.map((desc) => ({
    id: desc.id,
    content: desc.content,
    // ... no validation
  })) as Description[];
}
```

В отличие от `chapterCache.ts:99-103` (`fromCachedDescription`), который вызывает `isValidCachedDescription()`, `convertCachedDescriptions` не валидирует данные. Corrupted IndexedDB entries пройдут без фильтрации.

**Blast radius:** Пользователи с corrupted IndexedDB (PWA edge case) могут увидеть broken descriptions.

**Fix:**

```typescript
function convertCachedDescriptions(cached: CachedDescription[]): Description[] {
  return cached
    .filter(isValidCachedDescription)  // Добавить валидацию
    .map((desc) => ({ ... })) as Description[];
}
```

Нужно импортировать `isValidCachedDescription` из `chapterCache.ts` или вынести в shared utility.

**Усилие:** Quick (<1ч)

---

### MEDIUM #11: `setTimeout` не очищается при unmount

**Файл:** `frontend/src/hooks/epub/useDescriptionHighlighting.ts:224`

**Вердикт: ПОДТВЕРЖДЕНО, severity MEDIUM**

**Доказательство:**

```typescript
// Строки 221-226
useEffect(() => {
  if (safeDescriptions.length > 0 && prevCount.current === 0) {
    setTimeout(processContents, 200);  // НЕ сохранён в ref, НЕ очищается
  }
  prevCount.current = safeDescriptions.length;
}, [safeDescriptions.length, processContents]);
```

Этот useEffect **не возвращает cleanup function**. Если компонент unmount'ится в течение 200мс, `processContents` выполнится на unmounted component, потенциально вызывая `setState` на stale state.

**Blast radius:** Быстрое переключение глав или закрытие ридера может вызвать React warning "Can't perform a React state update on an unmounted component".

**Fix:**

```typescript
useEffect(() => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (safeDescriptions.length > 0 && prevCount.current === 0) {
    timer = setTimeout(processContents, 200);
  }
  prevCount.current = safeDescriptions.length;
  return () => { if (timer) clearTimeout(timer); };
}, [safeDescriptions.length, processContents]);
```

**Усилие:** Quick (<1ч)

---

### MEDIUM #12: `test_image_generation.py` — UPPERCASE query

**Файл:** `backend/test_image_generation.py:33`

**Вердикт: ПОДТВЕРЖДЕНО, severity понижена до LOW**

**Доказательство:**

```python
# backend/test_image_generation.py:33
.where(Description.type == 'LOCATION')
```

После миграции `2026_02_25_0001` PostgreSQL enum содержит lowercase `'location'`. Этот запрос вернёт 0 результатов.

**Почему LOW:** Это standalone тестовый скрипт (`backend/test_image_generation.py`), не часть production кода и не часть test suite. Используется для ручного тестирования генерации изображений.

**Fix:**

```python
.where(Description.type == DescriptionType.LOCATION)  # Использовать enum
```

**Усилие:** Quick (<1ч)

---

### LOW #13: `List[tuple]` → `Optional[List[tuple]]`

**Файл:** `backend/app/services/llm_description_enricher.py:47`

**Вердикт: ПОДТВЕРЖДЕНО**

```python
source_spans: List[tuple] = None  # Должно быть Optional[List[tuple]] = None
```

Также `tuple` без параметров — нет type safety. Рекомендуется `Optional[List[tuple[int, int]]] = None`.

**Усилие:** Quick (<1ч)

---

### LOW #14: `datetime.utcnow()` deprecated

**Файл:** `backend/app/services/llm_cache_service.py:95`

**Вердикт: ПОДТВЕРЖДЕНО + расширено**

Найдено **5 вхождений** в 4 файлах:
- `llm_cache_service.py:95`
- `schemas/responses/auth.py:34, 97`
- `schemas/responses/admin.py:80`
- `schemas/responses/__init__.py:507`

`datetime.utcnow()` deprecated в Python 3.12+. Проект на Python 3.11, но это tech debt.

**Fix:** `datetime.now(timezone.utc)`

**Усилие:** Quick (<1ч)

---

### LOW #15: `print()` вместо `logger`

**Файл:** `backend/app/routers/books/processing.py:158`

**Вердикт: ПОДТВЕРЖДЕНО + расширено**

```python
print(f"[PARSING-STATUS] Request for book_id={book.id}, user={current_user.email}")
```

Дополнительно найдено в:
- `backend/app/routers/admin/images.py:42`
- `backend/app/routers/admin/system.py:43`

**Проблема:** Помимо нарушения logging convention, строка 158 **выводит email пользователя** в stdout, что может быть PII compliance issue.

**Усилие:** Quick (<1ч)

---

### LOW #16: Silent `except Exception:` без логирования

**Файл:** `backend/app/routers/books/processing.py:100`

**Вердикт: ПОДТВЕРЖДЕНО, severity повышена до MEDIUM**

```python
except Exception:
    await parsing_manager.release_parsing_lock(book_id)
    # Fallback на синхронную обработку — ошибка НЕ логируется
    from ...services.nlp_processor import process_book_descriptions
    result = await process_book_descriptions(book_id, db)
```

Ошибка Celery task dispatch полностью проглатывается. Если Celery недоступен, администратор не узнает об этом из логов — система молча переключится на синхронную обработку, что может вызвать таймауты HTTP-запросов.

**Fix:**

```python
except Exception:
    logger.exception("Failed to dispatch Celery task, falling back to sync processing")
    await parsing_manager.release_parsing_lock(book_id)
    ...
```

**Усилие:** Quick (<1ч)

---

### LOW #17: `as const` на `Record<>` — избыточно

**Файл:** `frontend/src/utils/descriptionTypeMapping.ts:4-18`

**Вердикт: ПОДТВЕРЖДЕНО, severity LOW**

```typescript
export const API_TO_CACHE_TYPE: Record<DescriptionType, CachedDescription['type']> = {
  ...
} as const
```

`as const` на типизированном `Record<>` не добавляет narrowing — тип уже полностью определён. Не вредит, но избыточно.

**Усилие:** Quick (<1ч), не приоритетно

---

### LOW #18: Импорт DescriptionType через re-export

**Файл:** `backend/app/services/server_tasks.py:25`

**Вердикт: ОПРОВЕРГНУТО**

Файл `backend/app/services/server_tasks.py` **не существует**. Поиск по всему проекту не нашёл этого файла. DescriptionType импортируется напрямую из `app.models.description` в `app/tasks/book_tasks.py:274`.

---

### LOW #19: Stale `class DescriptionType(Enum)` в `downloaded_gemini_extractor.py`

**Файл:** `backend/app/services/downloaded_gemini_extractor.py:40`

**Вердикт: ОПРОВЕРГНУТО**

Файл `downloaded_gemini_extractor.py` **не существует**. Единственное определение `DescriptionType` — в `app/models/description.py:35`.

---

### LOW #20: Import из несуществующего `advanced_parser.config`

**Файлы:** `test_advanced_parser_adapter_simple.py`, `test_enrichment_integration.py`

**Вердикт: ОПРОВЕРГНУТО**

Оба тестовых файла **не существуют**. Единственное упоминание `advanced_parser.config` — в markdown-документации (`docs/reports/archive/`), не в Python-коде.

---

## 3. Пропущенные проблемы

### НОВЫЙ HIGH #21: `useEpubIOSFixes.ts` — rendition event listeners без cleanup

**Файл:** `frontend/src/hooks/epub/useEpubIOSFixes.ts:59,63`

```typescript
rendition.on('layout', (layout) => { ... });
rendition.on('displayed', () => { ... });
```

Функция `applyIOSSpreadFix()` регистрирует два event listener'а с **анонимными** arrow functions. Нет `rendition.off()` нигде. Поскольку ссылки анонимные, их невозможно удалить. Listeners накапливаются при каждом вызове.

**Blast radius:** iOS PWA пользователи. Memory leak при длительном чтении.

**Fix:** Рефакторить в hook с cleanup, или сохранять ссылки на handlers.

**Усилие:** Short (1-4ч)

---

### НОВЫЙ HIGH #22: `useEpubIOSFixes.ts` — iframe addEventListener без cleanup

**Файл:** `frontend/src/hooks/epub/useEpubIOSFixes.ts:137-139`

```typescript
doc.addEventListener('touchstart', blockEpubJsTouchHandler, { capture: true });
doc.addEventListener('touchmove', blockEpubJsTouchHandler, { capture: true });
doc.addEventListener('touchend', blockEpubJsTouchHandler, { capture: true });
```

Три touch event listener'а добавляются в iframe document без `removeEventListener`. Вызывается на каждый `rendered` event, что может привести к накоплению listeners.

**Blast radius:** iOS PWA пользователи. Потенциальная деградация touch-отзывчивости.

**Усилие:** Short (1-4ч)

---

### НОВЫЙ MEDIUM #23: XSS-безопасность DOM-манипуляций в `useDescriptionHighlighting.ts`

**Файл:** `frontend/src/hooks/epub/useDescriptionHighlighting.ts:148-163`

**Анализ:** Проверены все точки DOM-манипуляций:

```typescript
// Строка 110 — БЕЗОПАСНО: textContent (не innerHTML)
p.replaceChild(doc.createTextNode(el.textContent || ''), el);

// Строка 159 — БЕЗОПАСНО: textContent (не innerHTML)
span.textContent = match;

// Строка 158 — БЕЗОПАСНО: setAttribute с data-description-id
span.setAttribute('data-description-id', data.id);

// Строка 123 — ПОТЕНЦИАЛЬНО ОПАСНО: textContent в style element
s.textContent = `.description-highlight { ... }\n${rules}`;
```

`rules` формируется из `TYPE_COLORS` (строки 19-25) — это hardcoded объект, не пользовательские данные. `data.type` проходит через `getTypeClass()` (строка 28) с whitelist-валидацией.

**Вердикт:** XSS-безопасно. Все пользовательские данные (текст описаний) вставляются через `textContent`, не `innerHTML`. Description IDs — UUID из backend. Стили формируются из hardcoded констант.

---

### НОВЫЙ MEDIUM #24: Concurrent writes в IndexedDB

**Анализ:** `useChapterData.ts` и `useChapter.ts` оба пишут в `chapterCache`:
- `useChapterData.ts:107` — `chapterCache.set()`
- `useChapter.ts:104-134` — `saveChapterToCache()` (прямой `db.chapters.put()`)

Dexie.js использует IndexedDB transactions, которые обеспечивают atomicity на уровне отдельных операций. `put()` — upsert, поэтому concurrent writes не вызовут дублирования. Однако **last-write-wins** может привести к потере данных, если один хук пишет более свежие данные, а другой перезаписывает старыми.

**Вердикт:** Низкий риск на практике — оба хука пишут одни и те же данные из одного API. Но архитектурно это code smell.

**Усилие:** Решается при миграции на единый механизм (MEDIUM #8).

---

### НОВЫЙ MEDIUM #25: IndexedDB schema evolution — старые записи без `text`/`priorityScore`/`action`

**Анализ:** Dexie schema (db.ts) определяет `CachedDescription` с полями `text`, `priorityScore`, тип `'action'`. Но Dexie version не была bumped (остаётся version 2). IndexedDB не enforce'ит schema на уровне данных — старые записи без этих полей будут прочитаны как `undefined`.

**Проверка путей чтения:**

1. `chapterCache.ts:99-103` (`fromCachedDescription`) — **ЗАЩИЩЁН**: `cached.text ?? cached.content`, `cached.priorityScore ?? (cached.confidence ? ...)`. Fallbacks корректны.

2. `useChapter.ts:62-92` (`convertCachedDescriptions`) — **ЗАЩИЩЁН**: `desc.text ?? desc.content`, `desc.priorityScore ?? (desc.confidence ? ...)`. Fallbacks корректны.

3. `downloadManager.ts:390-401` — **Только пишет**, не читает старые данные.

**Вердикт:** Все пути чтения используют `??` fallbacks. Старые записи обрабатываются корректно. **Безопасно.**

---

### НОВЫЙ LOW #26: `downloadManager.ts:400` — imageStatus маппинг inconsistency

```typescript
imageStatus: desc.generated_image?.status === 'completed' ? 'generated' : 'none',
```

Если `desc.generated_image` существует но status !== 'completed', маппится в `'none'` вместо `'pending'`. Аналогично MEDIUM #9.

---

### НОВЫЙ LOW #27: Множественные uncleaned setTimeout в epub hooks

Найдено 8 мест с uncleaned setTimeout/requestIdleCallback в epub hooks:
- `useSwipeNavigation.ts:399`
- `useTextSelection.ts:112`
- `useProgressSync.ts:192`
- `useResizeHandler.ts:59, 103-105`
- `useImageModal.ts:90, 521`

Все имеют короткие таймауты (50-300мс) и низкий практический риск.

---

## 4. Best Practices Audit (февраль 2026)

### 4.1 React 19

**`use()` hook:** Не используется в проекте. Мог бы заменить ручной data fetching в `useChapterData.ts` в сочетании с Suspense. Однако для EPUB-ридера с complex state management это не приоритетно.

**`forwardRef` removal:** Найдено **45 использований `forwardRef`** в 18 файлах (в основном shadcn/ui компоненты). React 19 позволяет передавать ref как обычный prop. Рекомендация: обновить при следующем обновлении shadcn/ui, не приоритетно.

**`useTransition`/`useDeferredValue`:** Не используются для подсветки описаний. `processContents` в `useDescriptionHighlighting.ts` — тяжёлая операция (TreeWalker + DOM manipulation). `useDeferredValue` для `safeDescriptions` мог бы предотвратить блокировку UI при большом количестве описаний. Рекомендация: рассмотреть для будущей оптимизации.

**Suspense для data fetching:** TanStack Query уже поддерживает Suspense mode. Не используется в проекте. Для EPUB-ридера с offline-first архитектурой Suspense менее полезен, т.к. данные часто приходят из IndexedDB синхронно.

### 4.2 TanStack Query 5.90

**Правильно ли НЕ используется TQ5 для chapter data?** Это **архитектурная ошибка**. Проект уже имеет `hooks/api/useChapter.ts` с TanStack Query + IndexedDB integration. Параллельный `hooks/epub/useChapterData.ts` с ручным SWR — дублирование (MEDIUM #8).

**`@tanstack/query-persist-client`:** TQ5 имеет official plugin для IndexedDB persistence через `createIDBPersister`. Проект использует custom Dexie-based caching вместо этого. Custom решение более гибкое (TTL, LRU, per-chapter granularity), но требует больше maintenance. Рекомендация: оставить custom решение, оно лучше подходит для offline-first PWA.

**`staleTime` vs ручной TTL:** Проект использует оба: TQ5 `staleTime` (10 мин для chapters) и custom `CHAPTER_CACHE_TTL` (1ч/7д). Это создаёт путаницу. Рекомендация: унифицировать — использовать TQ5 `staleTime` для in-memory cache и Dexie TTL только для persistent storage.

### 4.3 Python 3.11 + StrEnum

**StrEnum + SQLAlchemy 2.0 + Pydantic 2.12:** Комбинация работает корректно. StrEnum members являются строками, SQLAlchemy корректно маппит их на PostgreSQL native enum, Pydantic v2 сериализует как строковые значения. `_missing_()` — документированный паттерн для backward compatibility.

**Альтернативы `_missing_()`:** Можно использовать Pydantic validator на уровне schema, но `_missing_()` на уровне enum — более фундаментальное решение, покрывающее все точки десериализации (включая Celery).

### 4.4 Dexie 4.x

**Schema evolution без version bump:** Dexie не enforce'ит schema на данных — только на индексах. Добавление полей в TypeScript interface без version bump безопасно, если код обрабатывает `undefined` (что проект делает через `??` fallbacks). Однако best practice — bump version при добавлении новых индексов.

**Concurrent write safety:** Dexie wraps IndexedDB transactions. Individual `put()` operations atomic. Для multi-step operations рекомендуется `db.transaction()` (используется в `downloadManager.ts:296`).

**TTL-based cache invalidation:** Dexie не имеет built-in TTL. Текущий подход (проверка при чтении + periodic cleanup) — стандартный паттерн. Рекомендация: использовать `navigator.onLine` event listener для динамического TTL (fix для HIGH #1).

### 4.5 FastAPI 0.125

**Response models:** Проект использует Pydantic models для response_model (корректно). В некоторых местах images router возвращает dict вместо Pydantic model — это работает, но теряет автоматическую валидацию и OpenAPI schema.

**Enum serialization:** `StrEnum` сериализуется как строка автоматически. `use_enum_values` не нужен для StrEnum (он нужен только для обычных Enum). Текущая конфигурация корректна.

### 4.6 Alembic 1.14

**Enum migration в PostgreSQL 15:** `ALTER TYPE ... RENAME VALUE` — корректный подход, transactionally safe в PG 10+. `ADD VALUE` не transactional (known PG limitation), но `RENAME VALUE` — да.

**Идемпотентность:** Миграция использует `IF NOT EXISTS` checks — повторный запуск безопасен. Downgrade → upgrade цикл также безопасен благодаря симметричным checks.

**Zombie value:** PostgreSQL не поддерживает `DROP VALUE` для enum. Единственный способ удалить — пересоздать тип, что требует `ALTER TABLE ... ALTER COLUMN ... TYPE text`, `DROP TYPE`, `CREATE TYPE`, `ALTER TABLE ... ALTER COLUMN ... TYPE new_enum`. Рискованно на production.

---

## 5. Сериализация DescriptionType: полная цепочка

Проверена полная цепочка сериализации (по результатам explore-агента):

```
PostgreSQL enum 'descriptiontype'
  Значения: location, character, atmosphere, object, action (+ zombie OBJECT)
    ↓
SQLAlchemy: SQLEnum(DescriptionType) → DescriptionType member
  'location' → DescriptionType.LOCATION (str value = "location")
    ↓
Pydantic: DescriptionResponse.type: DescriptionType
  model_config = ConfigDict(from_attributes=True)
  Сериализация: StrEnum → string value ("location")
    ↓
JSON API Response: {"type": "location"}
    ↓
Frontend: DescriptionType = 'location' | 'character' | 'atmosphere' | 'object' | 'action'
```

**Вердикт:** Цепочка корректна. Нет промежуточного `.value` который мог бы вернуть UPPERCASE. Images router использует explicit `.value` calls, но StrEnum `.value` возвращает lowercase.

---

## 6. План действий

### Приоритизированная таблица

| Приоритет | # | Проблема | Усилие | Зависимости |
|-----------|---|----------|--------|-------------|
| **P0** | 1 | CHAPTER_CACHE_TTL → функция | Quick | — |
| **P0** | 3 | Gallery missing object/action types | Quick | i18n keys |
| **P0** | 16 | Silent except → logger.exception | Quick | — |
| **P1** | 5 | Zombie OBJECT safety UPDATE | Quick | — |
| **P1** | 11 | setTimeout cleanup в highlighting | Quick | — |
| **P1** | 21 | iOS fixes rendition.on cleanup | Short | — |
| **P1** | 22 | iOS fixes iframe addEventListener cleanup | Short | Зависит от #21 |
| **P1** | 7 | AbortController signal в fetch | Short | API signature changes |
| **P2** | 6 | priorityScore fallback в downloadManager | Quick | — |
| **P2** | 10 | convertCachedDescriptions валидация | Quick | — |
| **P2** | 15 | print() → logger (3 файла) | Quick | — |
| **P2** | 14 | datetime.utcnow() → datetime.now(UTC) (5 мест) | Quick | — |
| **P2** | 8 | Унификация SWR (useChapterData → TQ5) | Medium | Архитектурное решение |
| **P3** | 2 | buildIndexMap trailing whitespace | Quick | — |
| **P3** | 13 | List[tuple] → Optional[List[tuple]] | Quick | — |
| **P3** | 12 | test_image_generation.py UPPERCASE | Quick | — |
| **P3** | 9 | imageStatus mapping consistency | Quick | — |
| **P3** | 17 | as const на Record (cosmetic) | Quick | — |
| **P3** | 27 | Uncleaned setTimeout в epub hooks (8 мест) | Short | — |

### Что можно БЕЗОПАСНО отложить

- **#2** (buildIndexMap trailing whitespace) — не эксплуатируется, code quality fix
- **#8** (SWR унификация) — архитектурный рефакторинг, не баг
- **#17** (as const cosmetic) — zero impact
- **#27** (uncleaned setTimeout) — короткие таймауты, минимальный риск
- **forwardRef migration** — shadcn/ui обновит при следующем release

### Рекомендуемый порядок

1. **Batch 1 (Quick fixes, 2-3ч):** #1, #3, #11, #16, #6, #10, #15
2. **Batch 2 (Short fixes, 4-8ч):** #7, #21, #22
3. **Batch 3 (Medium, планирование):** #8, #5 (zombie cleanup)
4. **Batch 4 (Low priority, по возможности):** #14, #13, #2, #12, #27

---

## Приложение A: Файлы из отчёта, которые НЕ существуют

| Файл из отчёта | Статус |
|----------------|--------|
| `backend/app/services/server_tasks.py` | Не существует |
| `backend/app/services/downloaded_gemini_extractor.py` | Не существует |
| `backend/tests/test_advanced_parser_adapter_simple.py` | Не существует |
| `backend/tests/test_enrichment_integration.py` | Не существует |

Эти файлы, вероятно, были удалены в предыдущих cleanup-сессиях. Findings #18, #19, #20 основаны на несуществующих файлах и **опровергнуты**.

---

## Приложение B: Подтверждено безопасным (из исходного отчёта)

Все пункты из секции "Подтверждено безопасным" **верифицированы**:

- **`_missing_()` + Celery:** StrEnum сериализуется как строка в JSON. `_missing_()` корректно обрабатывает case-insensitive lookup. Подтверждено тестами (`test_description_type.py`).
- **Alembic атомарность:** `RENAME VALUE` transactionally safe в PostgreSQL 10+. Подтверждено документацией PostgreSQL.
- **Круговые зависимости:** Не обнаружены. `DescriptionType` импортируется из единого источника `app.models.description`.
- **Old cached data:** Fallbacks через `??` корректно обрабатывают старый формат (проверено в `fromCachedDescription`, `convertCachedDescriptions`).
- **Deployment order:** Frontend `types/api.ts:147` уже содержит все 5 lowercase типов. Backend migration может быть применена независимо.
