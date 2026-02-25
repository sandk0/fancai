# Диагностический отчёт: Подсветка описаний в EPUB Reader

**Дата:** 2026-02-25  
**Книга:** «Ученик убийцы» (Робин Хобб)  
**Book ID:** `2d75b89e-7eb4-423b-99a4-4dae93704ab8`  
**Статус:** Исследование (без исправлений)

---

## Резюме

Описания (115 шт.) успешно извлечены и хранятся в БД после исправления бага каскадной отмены `asyncio.TaskGroup` (коммит `020e243`). API корректно возвращает данные. Однако на фронтенде существует **критический баг несоответствия регистра типов** (`DescriptionType`), внесённый коммитом `a9db947`, который затрагивает конвертацию типов в кеше и CSS-классы подсветки. Помимо этого, выявлено ещё 4 потенциальных проблемы в пайплайне отображения.

---

## 1. Полный пайплайн: от бэкенда до DOM

```
Backend DB (115 descriptions, type UPPERCASE)
    ↓
API: GET /api/v1/books/{id}/chapters/{n}/descriptions
    ↓  Ответ: { nlp_analysis: { descriptions: [...] } }
    ↓  Тип: "CHARACTER", "LOCATION", "ATMOSPHERE", "OBJECT", "ACTION"
    ↓
Frontend: useChapterData.ts (line 63)
    ↓  loadedDescriptions = response.nlp_analysis.descriptions
    ↓
    ├── → chapterCache.set() → toCachedDescription() → IndexedDB
    │       typeMap ключи: LOWERCASE → "CHARACTER" не найден → default 'scene'
    │
    └── → setDescriptions(loadedDescriptions) — тип остаётся UPPERCASE
            ↓
useChapterManagement.ts (line 67-72)
    ↓  return { descriptions, images }
    ↓
EpubReader.tsx (line 132)
    ↓  useDescriptionHighlighting({ descriptions, images, ... })
    ↓
useDescriptionHighlighting.ts
    ├── preprocessDescription (line 36-39): desc.text || desc.content → текст ОК
    ├── safeDescriptions (line 63-68): фильтр по density, Array.isArray — ОК
    ├── processContents (line 83-171): TreeWalker + text matching
    │       ↓
    │   getTypeClass(data.type) → data.type = "CHARACTER" (UPPERCASE)
    │       valid = ['location','character','atmosphere','object','action'] (lowercase)
    │       "CHARACTER" NOT IN valid → fallback 'desc-location'
    │       ↓
    │   <span class="description-highlight desc-location no-image" data-description-id="...">
    │       CSS правила для desc-location СУЩЕСТВУЮТ → подсветка видна
    │       ↓
    └── Click handler (line 178-187): ищет .description-highlight → data-description-id → OK
```

---

## 2. Критическая находка #1: Несоответствие регистра DescriptionType

### Хронология

| Когда | Что произошло |
|-------|---------------|
| До коммита `a9db947` | Backend отдавал типы в lowercase (`character`, `location`, ...) |
| Коммит `a9db947` (21.01.2026) | Backend enum `DescriptionType` переведён на UPPERCASE (`CHARACTER`, `LOCATION`, ...) |
| После `a9db947` | Frontend **НЕ БЫЛ ОБНОВЛЁН** — ожидает lowercase |

### Доказательства

**Коммит `a9db947`** затронул ТОЛЬКО 3 backend-файла:
```
backend/app/core/tasks.py                |  5 ++++-
backend/app/models/description.py        | 10 +++++-----
backend/app/services/gemini_extractor.py |  2 +-
```

**API ответ** (проверено curl, 2026-02-25):
```json
{
  "type": "ATMOSPHERE",  // UPPERCASE
  "content": "Воспоминание почти физическое: холодные сумерки..."
}
```

**Frontend типы** (`frontend/src/types/api.ts`, строка 147):
```typescript
export type DescriptionType = 'location' | 'character' | 'atmosphere' | 'object' | 'action';
// Все lowercase — НЕ СООТВЕТСТВУЕТ API
```

### Последствия по цепочке

#### 2.1. Кеширование: `toCachedDescription()` (`chapterCache.ts`, строки 51-70)

```typescript
const typeMap: Record<string, CachedDescription['type']> = {
  location: 'setting',    // ← ключи lowercase
  character: 'character',
  atmosphere: 'scene',
  object: 'object',
  action: 'scene',
};
return {
  type: typeMap[desc.type] || 'scene',  // desc.type = "CHARACTER" → undefined → 'scene'
};
```

**Результат:** ВСЕ описания кешируются с типом `'scene'`, независимо от реального типа. Дифференциация по типу (персонаж / локация / атмосфера) полностью теряется.

#### 2.2. Восстановление из кеша: `fromCachedDescription()` (`chapterCache.ts`, строки 104-149)

```typescript
const typeMap: Record<CachedDescription['type'], Description['type']> = {
  setting: 'location',
  character: 'character',
  scene: 'atmosphere',  // ← scene → atmosphere
  object: 'object',
};
```

**Результат:** При повторной загрузке из кеша все описания получают тип `'atmosphere'` (т.к. в кеше все имеют тип `'scene'`, а `scene → atmosphere`).

#### 2.3. CSS-классы: `getTypeClass()` (`useDescriptionHighlighting.ts`, строки 27-29)

```typescript
const getTypeClass = (type: string): string => {
  const valid = ['location', 'character', 'atmosphere', 'object', 'action'];
  return valid.includes(type) ? `desc-${type}` : 'desc-location';
};
```

**Результат при первой загрузке (данные из API):**
- `data.type = "CHARACTER"` (UPPERCASE) → `valid.includes("CHARACTER")` = false → fallback `'desc-location'`
- ВСЕ описания получают CSS-класс `desc-location` (синий цвет) вместо типо-специфичных цветов

**Результат при загрузке из кеша:**
- `data.type = "atmosphere"` (после двойной конвертации) → `valid.includes("atmosphere")` = true → `'desc-atmosphere'`
- ВСЕ описания получают CSS-класс `desc-atmosphere` (жёлтый цвет)

#### 2.4. TYPE_COLORS (строки 19-25)

```typescript
const TYPE_COLORS: Record<string, { bg: string; border: string; active: string }> = {
  location:   { bg: 'rgba(96,165,250,0.2)',  border: 'rgba(96,165,250,0.6)',  ... },  // Синий
  character:  { bg: 'rgba(167,139,250,0.2)', border: 'rgba(167,139,250,0.6)', ... },  // Фиолетовый
  atmosphere: { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.5)',  ... },  // Жёлтый
  object:     { bg: 'rgba(74,222,128,0.15)', border: 'rgba(74,222,128,0.5)',  ... },  // Зелёный
  action:     { bg: 'rgba(96,165,250,0.2)',  border: 'rgba(96,165,250,0.6)',  ... },  // Синий
};
```

CSS-правила генерируются для `desc-location`, `desc-character`, `desc-atmosphere`, `desc-object`, `desc-action`. Класс `desc-location` (fallback при UPPERCASE) имеет CSS-правило → **подсветка визуально отображается**, но с неправильным цветом.

### Вывод по находке #1

Баг несоответствия регистра **НЕ БЛОКИРУЕТ** отображение подсветки, но **НАРУШАЕТ** цветовую дифференциацию по типам. Все описания отображаются одним цветом вместо четырёх.

---

## 3. Критическая находка #2: Маппинг глав EPUB ↔ Backend

### Механизм (`useChapterMapping.ts`, строки 1-203)

Маппинг EPUB spine href → номер главы в БД происходит в два этапа:

**Phase 1 (Hard Match):** Точное соответствие `chapter.file_path` из БД и `tocItem.href` из EPUB:
```typescript
chapters.forEach(ch => {
  const href = ch.file_path;  // из БД
  tocItems.forEach(item => {
    if (normalizeHref(item.href) === normalizeHref(href)) {
      mapping[item.href] = ch.number;
    }
  });
});
```

**Phase 2 (Heuristic):** Только если Phase 1 не нашла совпадений — заголовки, номера глав, регулярные выражения.

### Риск

Если `chapter.file_path` в БД содержит путь вида `OEBPS/Text/chapter1.xhtml`, а EPUB spine href — `Text/chapter1.xhtml` (без `OEBPS/`), то `normalizeHref()` может не привести их к общему знаменателю. В этом случае:
- Phase 1 не найдёт совпадений
- Phase 2 попытается угадать по заголовкам и номерам
- При ошибке: описания загрузятся для **неправильной главы** → текст не совпадёт → подсветка не сработает

### Оценка вероятности

Средняя. Зависит от конкретного EPUB-файла. Для «Ученика убийцы» требуется проверка фактических значений `file_path` в БД vs href в EPUB spine.

---

## 4. Критическая находка #3: Кеш-инвалидация после переобработки книги

### Проблема

`useChapterData.ts`, строки 46-51:
```typescript
const cachedData = await chapterCache.get(userId, bookId, chapter);
if (cachedData && cachedData.descriptions.length > 0) {
  setDescriptions(cachedData.descriptions);
  return;  // ← Не обращается к API
}
```

**Сценарий:**
1. Пользователь открывает книгу → глава 1 загружается → кешируется (IndexedDB)
2. Книга переобрабатывается на бэкенде (новые/изменённые описания)
3. Пользователь снова открывает ту же главу → данные берутся из кеша → **старые описания**

### Связь с текущей проблемой

Книга была переобработана 24.02.2026 (коммит `020e243`). Если пользователь ранее открывал книгу (когда было мало описаний из-за бага `TaskGroup`), в IndexedDB могут храниться **устаревшие данные** с неполным набором описаний.

**Механизм инвалидации отсутствует.** Нет API для проверки «свежести» данных, нет ETag/Last-Modified, нет TTL на записях кеша.

### Оценка вероятности

Высокая для данного конкретного случая. Пользователь гарантированно открывал книгу ДО переобработки.

---

## 5. Критическая находка #4: Гонка состояний при восстановлении позиции

### Механизм

`useChapterManagement.ts`, строка 71:
```typescript
const { descriptions, images, isLoading } = useChapterData({
  enabled: !isRestoringPosition && !!userId,
});
```

`EpubReader.tsx`, строки 92-94:
```typescript
const { isRestoringPosition } = useReaderPosition({
  rendition, renditionReady, bookId, locations, goToCFI, ...
});
```

**Проблема:** Пока `isRestoringPosition === true`, загрузка описаний **полностью заблокирована**. Если восстановление позиции зависнет (ошибка сети, повреждённый CFI, race condition с locations), описания **никогда не загрузятся**.

### Документация проблемы

Отчёт `2025-12-25_chapter_loading_flow_analysis.md` документирует:
> «First chapter always requires LLM extraction (20s delay)»
> «enabled: renditionReady && descriptions.length > 0 guard in highlighting»

Отчёт `reader-comprehensive-audit-2026-01-30.md` документирует:
> «usePWAResumeGuard unmounting EpubReader, reading session cascade errors, 10+ visibility handlers with race conditions»

### Оценка вероятности

Средняя. Проблема проявляется при нестабильном сетевом соединении или при восстановлении PWA из фона.

---

## 6. Критическая находка #5: Валидация кеша отфильтровывает повреждённые записи

### Механизм

`chapterCache.ts`, строки 76-98:
```typescript
function isValidCachedDescription(cached: unknown): cached is CachedDescription {
  const validTypes = ['setting', 'character', 'scene', 'object'];
  if (typeof desc.type !== 'string' || !validTypes.includes(desc.type)) {
    return false;  // ← Запись отбрасывается
  }
  return true;
}
```

**В нормальном потоке:** `toCachedDescription()` преобразует UPPERCASE тип в `'scene'` (fallback), который входит в `validTypes`. Запись проходит валидацию.

**Однако:** Если IndexedDB содержит записи, созданные ДО рефакторинга типов (когда типы были lowercase и корректно маппились в `setting`/`character`/`object`), то при обновлении формата кеша старые записи тоже пройдут валидацию. Проблем с потерей данных при валидации **не обнаружено**.

---

## 7. Поток данных при клике на подсветку

```
Пользователь кликает на <span class="description-highlight">
    ↓
1. rendition.on('click') → handleClick (useDescriptionHighlighting.ts:178)
    ↓  target.classList.contains('description-highlight') → true
    ↓  id = target.getAttribute('data-description-id')
    ↓  desc = safeDescriptions.find(x => x.id === id)
    ↓  onDescriptionClick(desc, image)
    ↓
2. EpubReader.tsx:132 → async (d, i) => await openModal(d, i)
    ↓
3. useImageModal → показывает модалку с описанием и опцией генерации
```

**Альтернативный путь (iOS PWA):**
```
postMessage({ type: 'DESCRIPTION_CLICK', id }) → handleMessage (строка 190)
```

**Альтернативный путь (Tap Zones):**
```
handleCenterTap (EpubReader.tsx:192) → elementFromPoint → traverse up → 
  .description-highlight → handleDescriptionClick(id)
```

### Риск при клике

Если `safeDescriptions` не содержит описание с данным `id` (например, описания были обновлены/очищены между моментом рендеринга и кликом), `desc` будет `undefined`, и клик ничего не сделает.

---

## 8. Перекрёстные ссылки с существующими отчётами

| Отчёт | Связь |
|-------|-------|
| `2025-11-20-description-highlighting-v2.md` | Оригинальная реализация. 6 стратегий поиска, 82%→95% покрытие. Типы были lowercase. |
| `2025-12-14_description_highlighting_optimization.md` | Оптимизация v2.1→v2.2: single DOM pass, pattern caching. Типы не менялись. |
| `book-processing-regression-analysis-2026-01-31.md` | **Проблема #7**: «Текст описаний не совпадает с БД» — TSA offset drift. Упоминает `desc.text \|\| desc.content`. |
| `2025-12-25_chapter_loading_flow_analysis.md` | Гонка состояний между восстановлением позиции и загрузкой описаний. `enabled: renditionReady && descriptions.length > 0`. |
| `reader-comprehensive-audit-2026-01-30.md` | `usePWAResumeGuard` unmounting reader. 10+ обработчиков видимости с race conditions. |
| `2026-02-24-entity-wiki-spoiler-protection-audit.md` | Cache HIT возвращает нефильтрованные данные. Аналогичный паттерн кеш-проблем. |

---

## 9. Релевантные коммиты (хронология)

| Дата | Коммит | Описание | Влияние |
|------|--------|----------|---------|
| 20.11.2025 | `39f78e2` | Phase 5: Description Pipeline — type-based highlights | Оригинальная реализация |
| 20.11.2025 | `bc3cedf` | Phase 3: TypeScript types, entity labels | Типы описаний |
| 14.12.2025 | `9d84355` | Optimize highlighting to prevent flickering | Debounce + chunk processing |
| 14.12.2025 | `7254031` | Highlight full description text | Расширение зоны подсветки |
| 25.12.2025 | `0acaf95` | Fix first chapter missing highlights | Prefetch LLM trigger |
| 25.12.2025 | `03f4936` | Use rendition.on('click') for highlights | Click handler |
| 25.12.2025 | `52c065e` | postMessage fallback for iOS PWA | iOS fix |
| **21.01.2026** | **`a9db947`** | **Align DescriptionType enum (UPPERCASE)** | **Сломан маппинг типов на фронтенде** |
| 24.02.2026 | `020e243` | Fix TaskGroup cascade cancellation | Все 27 глав обработаны |

**Ключевой момент:** Коммит `a9db947` от 21.01.2026 изменил enum `DescriptionType` на бэкенде с lowercase на UPPERCASE, но **не обновил фронтенд**. Все коммиты после этой даты работают с рассогласованными типами.

---

## 10. Ранжирование потенциальных причин отсутствия подсветки

| # | Причина | Вероятность | Блокирует подсветку? | Влияние |
|---|---------|-------------|----------------------|---------|
| 1 | **Устаревший кеш IndexedDB** с пустыми описаниями | **Высокая** | **Да** (полностью) | Если в кеше пусто от предыдущих визитов до переобработки, API не вызывается |
| 2 | **Неверный маппинг глав** EPUB ↔ Backend | **Средняя** | **Да** (для неправильно замапленных глав) | Описания загружаются для другой главы → текст не совпадает |
| 3 | **Зависание `isRestoringPosition`** | **Средняя** | **Да** (полностью) | Загрузка описаний заблокирована до завершения восстановления |
| 4 | **Несоответствие регистра типов** | **Подтверждено** | **Нет** (частично) | CSS fallback работает, но все описания одного цвета |
| 5 | **Несоответствие текста** API content vs EPUB DOM | **Низкая** | **Частично** | Если TSA offset drift — часть описаний не найдёт совпадение в DOM |

---

## 11. Рекомендации (без реализации)

### Приоритет 1 (Критический)

1. **Очистка кеша IndexedDB** — добавить версионирование кеша или TTL. При переобработке книги инвалидировать кеш для данного `bookId`.

2. **Унификация регистра типов** — один из двух вариантов:
   - **Вариант A (рекомендуется):** Бэкенд API сериализует enum в lowercase через `@validator` или кастомный `json_serializer`
   - **Вариант B:** Фронтенд нормализует тип через `.toLowerCase()` при получении из API

### Приоритет 2 (Важный)

3. **Проверка маппинга глав** — добавить логирование Phase 1/Phase 2 результатов в `useChapterMapping` для диагностики.

4. **Таймаут для `isRestoringPosition`** — если восстановление позиции не завершается за N секунд, принудительно разблокировать загрузку описаний.

### Приоритет 3 (Улучшение)

5. **Дебаг-панель** — добавить скрытый UI элемент (например, тройной тап на заголовке) для отображения:
   - Текущая глава (EPUB spine index vs backend chapter number)
   - Количество описаний (загруженных / отображённых)
   - Статус кеша (hit/miss)
   - Результаты маппинга

---

## 12. Верифицированные факты

| Факт | Статус | Метод проверки |
|------|--------|----------------|
| 115 описаний в БД | Подтверждено | SQL запрос к PostgreSQL (24.02.2026) |
| 27/27 глав обработано | Подтверждено | SQL запрос к PostgreSQL |
| API возвращает UPPERCASE типы | Подтверждено | curl к `https://fancai.ru/api/v1/...` (25.02.2026) |
| Frontend ожидает lowercase типы | Подтверждено | Чтение `types/api.ts:147` |
| Коммит `a9db947` не затронул frontend | Подтверждено | `git show a9db947 --stat` — 3 backend файла |
| Кеш-first логика в `useChapterData` | Подтверждено | Чтение `useChapterData.ts:46-51` |
| `isRestoringPosition` блокирует загрузку | Подтверждено | Чтение `useChapterManagement.ts:71` |
| CSS fallback `desc-location` существует | Подтверждено | Чтение `useDescriptionHighlighting.ts:117-123` |

---

## 13. Что НЕ было проверено

1. **Браузерная верификация** — Playwright не смог запуститься из-за активного Chrome. Не проверено:
   - Network tab: реальный ответ API в контексте авторизованной сессии
   - Console: ошибки JavaScript при работе хуков
   - DOM: наличие/отсутствие `<span class="description-highlight">` элементов
   - IndexedDB: фактическое содержимое кеша для данного пользователя

2. **Маппинг глав** — не проверены фактические значения `file_path` в БД vs EPUB spine hrefs для конкретной книги.

3. **Текстовое совпадение** — не сравнивался текст `content` из API с фактическим текстом DOM для оценки success rate стратегий поиска.

---

## Файлы, затронутые расследованием

### Frontend (все прочитаны полностью)
- `src/types/api.ts` — Определение `DescriptionType` (строка 147)
- `src/services/chapterCache.ts` — `toCachedDescription` (51-70), `isValidCachedDescription` (76-98), `fromCachedDescription` (104-149)
- `src/hooks/epub/useDescriptionHighlighting.ts` — `TYPE_COLORS` (19-25), `getTypeClass` (27-29), `preprocessDescription` (36-39), `processContents` (83-171), click handler (178-187)
- `src/hooks/epub/useChapterData.ts` — cache-first логика (46-51), API вызов (56-63)
- `src/hooks/epub/useChapterManagement.ts` — `enabled: !isRestoringPosition` (71), chapter detection (90-94)
- `src/hooks/epub/useChapterMapping.ts` — Phase 1 hard match, Phase 2 heuristic
- `src/components/Reader/EpubReader.tsx` — Wiring всех хуков (132, 92-98)

### Backend (ключевые)
- `app/routers/descriptions.py` — API endpoint
- `app/schemas/responses/__init__.py` — `DescriptionResponse`, `DescriptionType` enum (UPPERCASE)
- `app/schemas/responses/descriptions.py` — `ChapterDescriptionsResponse`
- `app/models/description.py` — Enum определение

### Отчёты (прочитаны)
- `2025-11-20-description-highlighting-v2.md`
- `2025-12-14_description_highlighting_optimization.md`
- `book-processing-regression-analysis-2026-01-31.md`
- `2025-12-25_chapter_loading_flow_analysis.md`
- `reader-comprehensive-audit-2026-01-30.md`
- `2026-02-24-entity-wiki-spoiler-protection-audit.md`
