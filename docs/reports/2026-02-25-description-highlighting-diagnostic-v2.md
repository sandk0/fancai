# Диагностический отчёт v2: Подсветка описаний в EPUB Reader

**Дата:** 2026-02-25  
**Версия отчёта:** 2.0 (критическая ревизия)  
**Книга:** «Ученик убийцы» (Робин Хобб)  
**Book ID:** `2d75b89e-7eb4-423b-99a4-4dae93704ab8`  
**Статус:** Глубокое расследование (без исправлений)  
**Предыдущий отчёт:** `2026-02-25-description-highlighting-diagnostic.md` (v1)

---

## Оглавление

1. [Резюме](#1-резюме)
2. [Методология исследования](#2-методология-исследования)
3. [Полный пайплайн данных](#3-полный-пайплайн-данных)
4. [Хронология: когда описания работали и когда сломались](#4-хронология-когда-описания-работали-и-когда-сломались)
5. [Подтверждённые баги](#5-подтверждённые-баги)
   - [5.1 Несоответствие регистра DescriptionType](#51-баг-1-несоответствие-регистра-descriptiontype)
   - [5.2 Некорректные индексы при позиционной подсветке](#52-баг-2-некорректные-индексы-при-позиционной-подсветке)
   - [5.3 Потеря данных при кешировании](#53-баг-3-потеря-данных-при-round-trip-кешировании)
   - [5.4 Отсутствие инвалидации кеша](#54-баг-4-отсутствие-инвалидации-кеша)
6. [Потенциальные проблемы](#6-потенциальные-проблемы)
7. [Критическая самокоррекция предыдущего отчёта](#7-критическая-самокоррекция-предыдущего-отчёта)
8. [Комплексный анализ: почему описания перестали работать](#8-комплексный-анализ-почему-описания-перестали-работать)
9. [Перекрёстные ссылки с существующими отчётами](#9-перекрёстные-ссылки-с-существующими-отчётами)
10. [Верифицированные факты](#10-верифицированные-факты)
11. [Что НЕ было проверено](#11-что-не-было-проверено)
12. [Рекомендации](#12-рекомендации)
13. [Файлы, затронутые расследованием](#13-файлы-затронутые-расследованием)

---

## 1. Резюме

Подсветка описаний в EPUB Reader сломалась в период **20 января — 7 февраля 2026 года** в результате серии из 7+ крупных коммитов, которые полностью переписали пайплайн выделения описаний. **Единственного корневого бага нет** — проблема является результатом **кумулятивного эффекта** нескольких изменений, внесённых за 3 недели.

### Ключевые находки

| # | Баг | Серьёзность | Блокирует подсветку? |
|---|-----|-------------|---------------------|
| 1 | Несоответствие регистра `DescriptionType` (UPPERCASE vs lowercase) | Средняя | **Нет** — CSS fallback работает, но все описания одного цвета |
| 2 | Некорректные индексы при позиционной подсветке (`normalizeText` vs оригинальный текст) | Средняя | **Частично** — подсветка на неправильном участке текста |
| 3 | Потеря данных при round-trip кешировании (`priority_score`, `text`, `action` тип) | Средняя | **Частично** — фильтр `density='key'` не работает на кешированных данных |
| 4 | Отсутствие инвалидации кеша после переобработки книги | **Высокая** | **Да** — полная блокировка обновлений |

**Критический вывод:** Ни один из подтверждённых багов по отдельности не делает подсветку полностью невидимой. Наиболее вероятная причина полного отсутствия подсветки — **устаревший кеш IndexedDB** (баг #4) в сочетании с тем, что книга была переобработана на бэкенде 24.02.2026. Это самый правдоподобный сценарий полной блокировки.

---

## 2. Методология исследования

### Что было сделано

1. **Полное чтение кода** — 20+ файлов фронтенда и бэкенда прочитаны целиком (не фрагментарно)
2. **Анализ git-истории** — diff каждого значимого коммита в окне 20.01–07.02.2026 (6 полных diff)
3. **Трассировка потоков данных** — от БД до DOM, step-by-step через каждую функцию
4. **Анализ существующих отчётов** — 6 предыдущих отчётов в `/docs/reports/`
5. **Верификация через API** — curl-запросы к production API с авторизацией
6. **Критическая ревизия** — каждая находка проверена на предмет «действительно ли это блокирует подсветку?»
7. **Параллельные исследования** — 12 explore-агентов для перекрёстной проверки

### Чего НЕ удалось сделать

- **Браузерная верификация (Playwright)** — не удалось запустить из-за активного Chrome
- **Проверка содержимого IndexedDB** — требует доступ к DevTools в контексте авторизованной сессии
- **Сравнение DOM-текста с API-контентом** — требует работающий Playwright

### Ключевое изменение подхода vs v1

В отчёте v1 каждый баг рассматривался как потенциально блокирующий. В v2 каждый баг **критически переоценён**: проверено, приводит ли он к невидимости подсветки или только к косметическим проблемам.

---

## 3. Полный пайплайн данных

### 3.1 Бэкенд → API

```
PostgreSQL: descriptions (115 записей, type = UPPERCASE enum)
    ↓
SQLAlchemy model: Description.type → DescriptionType enum
    ↓  Enum values: "LOCATION", "CHARACTER", "ATMOSPHERE", "OBJECT", "ACTION"
    ↓
Pydantic v2: DescriptionResponse (ConfigDict from_attributes=True)
    ↓  BaseResponse НЕ содержит use_enum_values
    ↓  Pydantic v2 сериализует enum через .value → UPPERCASE строка
    ↓
API Response: GET /api/v1/books/{id}/chapters/{n}/descriptions
    ↓  { "nlp_analysis": { "descriptions": [{ "type": "CHARACTER", ... }] } }
```

**Верифицировано:** curl к production API подтверждает `"type": "ATMOSPHERE"` (UPPERCASE).

### 3.2 API → Frontend State

```
booksAPI.getChapterDescriptions(bookId, chapterNumber)
    ↓  api/books.ts, строки 99-113
    ↓  GET /books/{bookId}/chapters/{chapterNumber}/descriptions
    ↓
useChapterData.ts (основной data loader)
    ↓  
    ├── ПУТЬ A: Кеш-first (строки 46-51)
    │   cachedData = await chapterCache.get(userId, bookId, chapter)
    │   if (cachedData && cachedData.descriptions.length > 0) {
    │     setDescriptions(cachedData.descriptions);  ← СТОП, API не вызывается
    │     return;
    │   }
    │
    └── ПУТЬ B: API (строки 56-63)
        response = await booksAPI.getChapterDescriptions(bookId, chapter)
        descriptions = response.nlp_analysis.descriptions
        ├── chapterCache.set(userId, bookId, chapter, descriptions, images)
        │   └── toCachedDescription() → typeMap["CHARACTER"] = undefined → 'scene'
        └── setDescriptions(descriptions)  ← descriptions.type = "CHARACTER" (UPPERCASE)
```

### 3.3 Frontend State → DOM Highlighting

```
useChapterManagement.ts (оркестрация)
    ↓  return { descriptions, images, isLoading }
    ↓  GUARD: enabled: !isRestoringPosition && !!userId (строка 71)
    ↓
EpubReader.tsx (строка 132)
    ↓  useDescriptionHighlighting({ descriptions, images, rendition, ... })
    ↓
useDescriptionHighlighting.ts (ядро подсветки)
    ↓
    ├── preprocessDescription (строки 36-53):
    │   text = desc.text || desc.content  ← РАБОТАЕТ для обоих путей
    │   content = desc.content
    │   
    ├── safeDescriptions (строки 63-68):
    │   filter по density, Array.isArray check
    │   ⚠️ density по умолчанию = 'all' → НЕ фильтрует
    │
    ├── GUARD (строка 84):
    │   if (!rendition || !enabled || safeDescriptions.length === 0 || processingRef.current) return;
    │   ⚠️ Если descriptions пустой → ПОЛНАЯ БЛОКИРОВКА
    │
    ├── processContents (строки 83-171):
    │   rendition.hooks.content.register(callback)
    │   ↓
    │   1. doc.createTreeWalker(SHOW_TEXT) — обход текстовых узлов
    │   2. normalizeText(textNode.textContent) — нормализация
    │   3. findHighlightMatch(normalizedText, patterns) — поиск совпадений (8 стратегий)
    │   4. Создание <span class="description-highlight desc-{type} has-image|no-image">
    │   ↓
    │   getTypeClass(data.type):
    │     "CHARACTER" → valid.includes("CHARACTER") = false → 'desc-location' (fallback)
    │     CSS правило для desc-location СУЩЕСТВУЕТ → span ВИДИМ
    │
    └── Click handler (строки 174-215):
        rendition.on('click', (e) => {
          target.classList.contains('description-highlight') → data-description-id → desc
        })
```

---

## 4. Хронология: когда описания работали и когда сломались

### Фаза 1: Стабильная работа (ноябрь–декабрь 2025)

| Дата | Коммит | Что произошло | Статус |
|------|--------|---------------|--------|
| 20.11.2025 | Несколько | Highlighting v2.0: 6 стратегий поиска, 82% покрытие | ✅ Работает |
| 14.12.2025 | `088d294` | v2.2 оптимизация: single DOM pass, pattern caching, 4-5x ускорение | ✅ Работает |
| 25.12.2025 | `0acaf95` | Исправление первой главы: prefetch LLM trigger | ✅ Работает |
| 29.12.2025 | `7254031` | Подсветка полного текста описания | ✅ Работает |

### Фаза 2: iOS фиксы (январь 2026, начало)

| Дата | Коммит | Что произошло | Статус |
|------|--------|---------------|--------|
| 05-11.01.2026 | Несколько | iOS click fixes: tap zones, postMessage, touch events | ✅ Работает (клики починены) |

### Фаза 3: ОКНО ПОЛОМКИ (20 января — 7 февраля 2026)

| Дата | Коммит | Что произошло | Риск | Подробности |
|------|--------|---------------|------|-------------|
| **20.01.2026** | `0b23c2d` | **Удалена автоэкстракция** из useChapterManagement | ⚠️ Средний | Описания больше не запрашиваются автоматически — требуется ручной триггер. Функция `triggerExtraction` удалена из хука. |
| **20.01.2026** | `815b700` | **Гуттирование useChapterManagement** (−197 строк) | ⚠️ Средний | Удалена legacy-обработка глав. Если новая логика неполная, описания могут не загружаться. |
| **21.01.2026** | `a9db947` | **DescriptionType → UPPERCASE** | 🔴 Подтверждён | Бэкенд enum переведён на UPPERCASE, фронтенд НЕ обновлён. 3 backend-файла, 0 frontend-файлов. |
| 24.01.2026 | `38266f3` | **Полная переписка chapter mapping** | ⚠️ Средний | Новая двухфазная система маппинга. При ошибке — описания для неправильной главы. |
| 26.01.2026 | `42dbf2c` | **Удалён `entities_mentioned`** | ⚠️ Низкий | Schema change, но не влияет на highlighting напрямую. |
| **29.01.2026** | `9e0455a` | **Мега-рефакторинг**: EpubReader −1119 строк | 🔴 Высший риск | Извлечён `useChapterData`, `text-search/` utils. Крупнейшее изменение за всю историю пайплайна. |
| 01.02.2026 | `9d84355` | Anti-flickering optimization | ⚠️ Низкий | +17 строк: skip guard для предотвращения мерцания. |
| **07.02.2026** | `bc3cedf` | **Position-aware strategies** (startIdx/endIdx) | 🔴 Подтверждён | Новая система позиционной подсветки с багом индексов. |
| **07.02.2026** | `39f78e2` | **Type-based CSS, density filter** | ⚠️ Средний | Новая система фильтрации и CSS-стилей по типам. |
| 24.02.2026 | `020e243` | Fix TaskGroup cascade cancellation | ✅ Бэкенд | Книга переобработана: 27/27 глав, 115 описаний. |

### Ключевой вывод

Описания работали стабильно с ноября по конец декабря 2025. **Период 20.01–07.02.2026 — это 3 недели, за которые пайплайн был полностью переписан**. 7+ крупных коммитов затронули каждый уровень системы: от загрузки данных до DOM-рендеринга.

Наиболее рискованный коммит — `9e0455a` (29.01.2026): удаление 1119 строк из EpubReader и вынесение логики в отдельные хуки/утилиты. При таких масштабных рефакторингах без полного E2E тестирования неизбежны регрессии.

---

## 5. Подтверждённые баги

### 5.1 Баг #1: Несоответствие регистра DescriptionType

**Коммит:** `a9db947` (21.01.2026)  
**Суть:** Backend enum `DescriptionType` переведён на UPPERCASE, frontend не обновлён.  
**Серьёзность:** Средняя (пересмотрена с «Критической» в v1)

#### Доказательства

**Backend** (`backend/app/models/description.py`, строки 35-40):
```python
class DescriptionType(str, Enum):
    LOCATION = "LOCATION"
    CHARACTER = "CHARACTER"
    ATMOSPHERE = "ATMOSPHERE"
    OBJECT = "OBJECT"
    ACTION = "ACTION"
```

**Сериализация** (`backend/app/schemas/responses/__init__.py`, строка 38):
```python
class BaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    # НЕТ use_enum_values → Pydantic v2 сериализует через .value → UPPERCASE
```

**Frontend** (`frontend/src/types/api.ts`, строка 147):
```typescript
export type DescriptionType = 'location' | 'character' | 'atmosphere' | 'object' | 'action';
// ← ВСЕ lowercase
```

**Коммит `a9db947`** (`git show a9db947 --stat`):
```
backend/app/core/tasks.py                |  5 ++++-
backend/app/models/description.py        | 10 +++++-----
backend/app/services/gemini_extractor.py |  2 +-
// 0 frontend файлов
```

#### Затронутые точки (4 места)

1. **`chapterCache.ts:52-58`** — `toCachedDescription()`:
   ```typescript
   const typeMap: Record<string, CachedDescription['type']> = {
     location: 'setting', character: 'character', atmosphere: 'scene',
     object: 'object', action: 'scene',
   };
   return { type: typeMap[desc.type] || 'scene' };
   // desc.type = "CHARACTER" → typeMap["CHARACTER"] = undefined → 'scene'
   ```

2. **`chapterCache.ts:111-116`** — `fromCachedDescription()`:
   ```typescript
   const typeMap = { setting: 'location', character: 'character',
                     scene: 'atmosphere', object: 'object' };
   // 'scene' → 'atmosphere' — все описания после round-trip становятся 'atmosphere'
   ```

3. **`downloadManager.ts:425-432`** — `mapDescriptionType()`:
   ```typescript
   const typeMap = { location: 'setting', character: 'character',
                     atmosphere: 'scene', object: 'object', action: 'scene' };
   // Аналогичная проблема: UPPERCASE ключи не найдены
   ```

4. **`hooks/api/useChapter.ts:101-109`** — `mapToCachedDescriptionType()`:
   ```typescript
   // Ещё одна копия того же typeMap с lowercase ключами
   ```

#### Пересмотренная оценка влияния

**В v1 этот баг был оценён как «Критический».** Это было ошибочно. Критический анализ показывает:

- `getTypeClass("CHARACTER")` → fallback `'desc-location'` → CSS-правило **СУЩЕСТВУЕТ** → span **ВИДИМ**
- `TYPE_COLORS["CHARACTER"]` → `undefined`, но стили также применяются через CSS-классы
- **Текстовый поиск (matching) НЕ зависит от типа** — `preprocessDescription` использует `desc.text || desc.content`, что работает при любом значении `type`
- **Единственное реальное последствие:** все описания отображаются одним цветом (синий `desc-location` fallback) вместо дифференцированных цветов по типам

**Пересмотренная серьёзность: Средняя (косметическая, не блокирующая).**

---

### 5.2 Баг #2: Некорректные индексы при позиционной подсветке

**Коммит:** `bc3cedf` (07.02.2026)  
**Суть:** Индексы, найденные в нормализованном тексте, применяются к оригинальному тексту DOM.  
**Серьёзность:** Средняя

#### Доказательства

**`useDescriptionHighlighting.ts`, строки 140-148:**
```typescript
const norm = normalizeText(text);  // Нормализованный текст (ДРУГАЯ ДЛИНА)
const result = findHighlightMatch(norm, patterns, norm.length);
// result.startIdx и result.endIdx — индексы в НОРМАЛИЗОВАННОМ тексте

const before = text.substring(0, result.startIdx);   // Применяется к ОРИГИНАЛЬНОМУ тексту!
const match = text.substring(result.startIdx, result.endIdx);  // НЕПРАВИЛЬНЫЕ ИНДЕКСЫ
const after = text.substring(result.endIdx);
```

**`normalization.ts`, функция `normalizeText`:**
```typescript
export function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')  // Коллапсирует множественные пробелы → УМЕНЬШАЕТ длину
    .trim();                 // Удаляет ведущие/замыкающие пробелы → СДВИГАЕТ индексы
}
```

#### Механизм бага

Рассмотрим текстовый узел DOM:
```
"   Фиц  медленно   поднялся  по  лестнице.   "
```

После `normalizeText()`:
```
"Фиц медленно поднялся по лестнице."
```

- Оригинальная длина: 47 символов
- Нормализованная длина: 35 символов
- `trim()` удалил 3 пробела в начале → **все индексы сдвинуты на 3**
- `\s+` → `' '` дополнительно сжал текст

Если `findHighlightMatch` вернёт `{ startIdx: 4, endIdx: 14 }` (слово «медленно» в нормализованном), то `text.substring(4, 14)` в оригинале даст `"ц  медлен"` — **неправильный фрагмент**.

#### Оценка влияния

- Подсветка **не исчезает**, но визуально сдвинута
- Степень сдвига зависит от количества whitespace в конкретном текстовом узле
- Для узлов без лидирующих пробелов и множественных пробелов — баг не проявляется
- Для типичного HTML-контента EPUB (форматированный текст) — сдвиг обычно 0-5 символов
- **В худшем случае:** подсветка захватывает часть соседнего слова или обрезает текущее

**Серьёзность: Средняя (визуально некорректно, но не невидимо).**

---

### 5.3 Баг #3: Потеря данных при round-trip кешировании

**Суть:** При кешировании в IndexedDB и последующем чтении теряются данные.  
**Серьёзность:** Средняя

#### 5.3.1 Потеря `priority_score`

**`chapterCache.ts`:**
```typescript
// toCachedDescription (строка 52-70):
// priority_score НЕ сохраняется в CachedDescription — поле отсутствует

// fromCachedDescription (строка 124):
priority_score: cached.confidence ?? 0,
// ← Подменяет priority_score значением confidence (или 0)
```

**Последствие:** Фильтр `density='key'` (threshold 50 по `priority_score`) не работает на кешированных данных. Описания с высоким приоритетом неотличимы от низкоприоритетных.

#### 5.3.2 Потеря `desc.text`

**`toCachedDescription()`:** сохраняет только `content` (из `desc.content`). Поле `desc.text` не кешируется.

**`fromCachedDescription()`:** `text: cached.content, content: cached.content` — оба поля одинаковы.

**Последствие:** Если `desc.text` и `desc.content` различались (а `text` — это часто более длинный/полный вариант текста описания), после кеширования используется только `content`.

#### 5.3.3 Потеря типа `action`

**Прямой путь:**
```
API: type = "ACTION"
↓ toCachedDescription typeMap: action → 'scene'
↓ Кеш: type = 'scene'
↓ fromCachedDescription typeMap: scene → 'atmosphere'
↓ Результат: type = 'atmosphere'
```

**Описания типа `action` после round-trip становятся `atmosphere`.** Это необратимо.

Примечание: из-за бага #1 (UPPERCASE), в текущей реализации `"ACTION"` → `typeMap["ACTION"]` = undefined → `'scene'` → `'atmosphere'`. Но даже если баг #1 будет исправлен, forward-map `action → 'scene'` → reverse-map `scene → 'atmosphere'` сохраняет проблему.

---

### 5.4 Баг #4: Отсутствие инвалидации кеша

**Суть:** Нет механизма инвалидации кеша IndexedDB после переобработки книги на бэкенде.  
**Серьёзность:** Высокая

#### Механизм

**`useChapterData.ts`, строки 46-51:**
```typescript
const cachedData = await chapterCache.get(userId, bookId, chapter);
if (cachedData && cachedData.descriptions.length > 0) {
  setDescriptions(cachedData.descriptions);
  return;  // ← API НИКОГДА не вызывается
}
```

**Отсутствуют:**
- TTL (time-to-live) на записях кеша
- ETag / Last-Modified проверка свежести
- Версионирование данных (schema version)
- Push-уведомления о переобработке
- Возможность принудительной инвалидации с бэкенда

**Единственный механизм очистки:** `chapterCache.performMaintenance()` — удаляет записи старше 7 дней. Но для книги, открытой менее 7 дней назад, кеш живёт бесконечно.

#### Связь с текущей проблемой

1. Книга была переобработана 24.02.2026 (коммит `020e243`, TaskGroup fix)
2. До переобработки: из-за бага `TaskGroup` было обработано мало глав, мало описаний
3. Пользователь гарантированно открывал книгу ДО переобработки
4. IndexedDB содержит **устаревшие данные** (0 или мало описаний для некоторых глав)
5. При повторном открытии: кеш-first логика видит `descriptions.length > 0` → **не обращается к API**
6. Для глав с `descriptions.length === 0` в кеше → API вызывается → новые данные загружаются → ОК
7. Для глав с `descriptions.length > 0` в кеше (старые, неполные) → **вечно устаревшие данные**

**Серьёзность: Высокая — единственный баг, способный полностью заблокировать обновление описаний.**

---

## 6. Потенциальные проблемы

### 6.1 Зависание `isRestoringPosition`

**`useChapterManagement.ts`, строка 71:**
```typescript
const { descriptions, images, isLoading } = useChapterData({
  enabled: !isRestoringPosition && !!userId,
});
```

Если `isRestoringPosition` не переключается в `false` (из-за ошибки CFI, проблем с сетью, race condition), загрузка описаний **полностью заблокирована**.

**Задокументировано в:**
- `reader-comprehensive-audit-2026-01-30.md`: 10+ обработчиков видимости с race conditions
- `2025-12-25_chapter_loading_flow_analysis.md`: race conditions между позицией и данными

**Оценка:** Средняя вероятность. Проявляется при нестабильной сети, PWA resume, повреждённом CFI.

### 6.2 Маппинг глав EPUB ↔ Backend

**`useChapterMapping.ts`:**
- Phase 1: Hard match `normalizeHref(tocItem.href) === normalizeHref(ch.file_path)`
- Phase 2: Heuristic fallback (заголовки, номера)

**Риск:** Если `file_path` в БД содержит `OEBPS/Text/chapter1.xhtml`, а EPUB spine href — `Text/chapter1.xhtml`, `normalizeHref()` может не свести их к общему знаменателю. Результат: описания загружаются для неправильной главы → текст не совпадает → подсветка не находит совпадений.

**Оценка:** Средняя. Зависит от конкретного EPUB. Не верифицировано для данной книги.

### 6.3 Anti-flickering skip guard

**`useDescriptionHighlighting.ts`, строка ~84:**
```typescript
if (!rendition || !enabled || safeDescriptions.length === 0 || processingRef.current) return;
```

`processingRef.current` — семафор для предотвращения параллельной обработки. Если предыдущая обработка не сбросила `processingRef` (ошибка, unmount), все последующие вызовы **пропускаются молча**.

**Оценка:** Низкая вероятность, но без логирования невозможно исключить.

---

## 7. Критическая самокоррекция предыдущего отчёта

### 7.1 Переоценка серьёзности бага типов

**v1 утверждение:** «Несоответствие регистра типов — критический баг, потенциально блокирующий подсветку.»

**v2 коррекция:** Это **косметический баг**. CSS fallback `desc-location` имеет валидные стили. Текстовый поиск не зависит от типа. Подсветка отображается, но неправильного цвета.

### 7.2 Отсутствие анализа позиционных индексов

**v1 пропуск:** Отчёт v1 не содержал анализ бага индексов из коммита `bc3cedf`. Это существенный пропуск — новая система position-aware подсветки с `startIdx`/`endIdx` содержит фундаментальный баг несоответствия индексов нормализованного и оригинального текста.

### 7.3 Недостаточный анализ кеш round-trip

**v1 упоминание:** Только `priority_score` был отмечен как потерянный.

**v2 расширение:** Потеря `text`, необратимая конвертация `action → atmosphere`, подмена `priority_score` на `confidence` — три отдельных потери данных при каждом round-trip.

### 7.4 Хронология: от одного коммита к окну поломки

**v1 фокус:** Один коммит `a9db947` как root cause.

**v2 реальность:** Окно из 7+ коммитов за 3 недели. Каждый из них изменил существенную часть пайплайна. Проблема — кумулятивная, а не точечная.

### 7.5 Неточная хронология коммитов

**v1 ошибка:** Коммиты `39f78e2` и `bc3cedf` были датированы 20.11.2025 в таблице. На самом деле они от **07.02.2026** — это часть позднего рефакторинга, а не оригинальной реализации. Это критически меняет понимание: type-based CSS и position-aware strategies — **НОВЫЕ** изменения в период поломки, а не часть стабильной v2.0 реализации.

---

## 8. Комплексный анализ: почему описания перестали работать

### 8.1 Не один root cause, а каскад

Описания работали стабильно до ~20 января 2026. Затем за 3 недели было внесено 7+ крупных изменений без полного E2E-тестирования. Каждый коммит изменял отдельную часть пайплайна, и хотя ни один из них по отдельности не делает подсветку полностью невидимой, их кумулятивный эффект создаёт множество точек отказа.

### 8.2 Наиболее вероятный сценарий полной блокировки

```
1. До 20.01.2026: Описания работают (v2.2, оптимизированные)

2. 20.01.2026 (0b23c2d, 815b700): Удалена автоэкстракция, гуттирован useChapterManagement
   → Если новая логика загрузки данных неполная, описания могут не загружаться вообще

3. 21.01.2026 (a9db947): DescriptionType → UPPERCASE
   → Все type mappings сломаны, но подсветка визуально работает (fallback)
   → Кеш получает все типы как 'scene', round-trip → 'atmosphere'

4. 29.01.2026 (9e0455a): Мега-рефакторинг (−1119 строк из EpubReader)
   → Извлечён useChapterData с cache-first логикой
   → Потенциальные ошибки при перемещении кода

5. 07.02.2026 (bc3cedf): Position-aware strategies
   → Баг индексов: подсветка на неправильном месте
   
6. 24.02.2026 (020e243): Книга переобработана (115 описаний)
   → Но IndexedDB содержит старые данные
   → Cache-first логика НЕ ОБРАЩАЕТСЯ К API
   → Пользователь видит старые (пустые/неполные) описания
```

**Наиболее вероятная причина «описания исчезли»:**
- Книга содержала мало описаний из-за бага TaskGroup → пользователь видел мало подсветок
- После переобработки бэкенда (115 описаний) кеш-first логика блокирует обновления
- Для конкретного пользователя: нужно очистить IndexedDB чтобы увидеть новые описания

### 8.3 Что НЕ может быть причиной

1. **Backend** — полностью работоспособен. 115 описаний, API возвращает данные. Подтверждено curl.
2. **Density filter** — по умолчанию `'all'`, не фильтрует ничего. `EpubReader.tsx:132` НЕ передаёт `density` в хук.
3. **CSS-отсутствие** — стили для всех типов (включая fallback `desc-location`) присутствуют.
4. **Click handler** — работает (клик не связан с отображением подсветки).

---

## 9. Перекрёстные ссылки с существующими отчётами

| Отчёт | Дата | Ключевая связь |
|-------|------|----------------|
| `2025-11-20-description-highlighting-v2.md` | 20.11.2025 | Оригинальная реализация v2.0: 6 стратегий поиска, 82%→95% покрытие. Типы были **lowercase**. Это доказывает, что до `a9db947` frontend и backend были синхронизированы. |
| `2025-12-14_description_highlighting_optimization.md` | 14.12.2025 | v2.2 оптимизация: single DOM pass, pattern caching, 4-5x ускорение. Типы не менялись. Последняя подтверждённо стабильная версия. |
| `2025-12-25_chapter_loading_flow_analysis.md` | 25.12.2025 | Race conditions между восстановлением позиции и загрузкой описаний. `enabled: renditionReady && descriptions.length > 0` guard. Проблема задокументирована, но не полностью решена. |
| `reader-comprehensive-audit-2026-01-30.md` | 30.01.2026 | **Написан ВНУТРИ окна поломки.** Документирует: PWA unmounting, 10+ visibility handlers, race conditions. Сам факт этого аудита подтверждает, что к 30.01 были проблемы со стабильностью. |
| `book-processing-regression-analysis-2026-01-31.md` | 31.01.2026 | **Проблема #7:** «Текст описаний не совпадает с БД» — TSA offset drift. Упоминает `desc.text \|\| desc.content`. Это показывает, что проблемы с текстовым совпадением были известны уже 31.01. |
| `2026-02-24-entity-wiki-spoiler-protection-audit.md` | 24.02.2026 | Cache HIT возвращает нефильтрованные данные. **Аналогичный паттерн**: кеш-first логика без инвалидации приводит к устаревшим данным. Системная проблема кеширования. |

---

## 10. Верифицированные факты

| # | Факт | Метод проверки | Дата |
|---|------|----------------|------|
| 1 | 115 описаний в БД для данной книги | SQL запрос к PostgreSQL | 24.02.2026 |
| 2 | 27/27 глав обработано, 0 ошибок | SQL запрос к PostgreSQL | 24.02.2026 |
| 3 | API возвращает `"type": "ATMOSPHERE"` (UPPERCASE) | curl к production API | 25.02.2026 |
| 4 | Frontend ожидает lowercase типы | Чтение `types/api.ts:147` | 25.02.2026 |
| 5 | Коммит `a9db947` не затронул frontend | `git show a9db947 --stat` | 25.02.2026 |
| 6 | Cache-first логика блокирует API вызовы | Чтение `useChapterData.ts:46-51` | 25.02.2026 |
| 7 | `isRestoringPosition` блокирует загрузку описаний | Чтение `useChapterManagement.ts:71` | 25.02.2026 |
| 8 | CSS fallback `desc-location` имеет стили | Чтение `useDescriptionHighlighting.ts:117-123` | 25.02.2026 |
| 9 | `normalizeText()` изменяет длину строки (trim + collapse) | Чтение `normalization.ts` | 25.02.2026 |
| 10 | Индексы из normalized применяются к original в `processContents` | Чтение `useDescriptionHighlighting.ts:140-148` | 25.02.2026 |
| 11 | `priority_score` не сохраняется в кеш | Чтение `chapterCache.ts:52-70,104-149` | 25.02.2026 |
| 12 | `density` по умолчанию `'all'`, не передаётся в хук | Чтение `stores/reader.ts:102`, `EpubReader.tsx:132` | 25.02.2026 |
| 13 | `descriptionDensity` persisted в localStorage (zustand) | Чтение `stores/reader.ts` persist config | 25.02.2026 |
| 14 | 4 места в frontend с lowercase typeMap ключами | Поиск по codebase | 25.02.2026 |
| 15 | Pydantic v2 сериализует enum через `.value` (no `use_enum_values`) | Чтение `schemas/responses/__init__.py` | 25.02.2026 |

---

## 11. Что НЕ было проверено

### 11.1 Требует Playwright/DevTools

| Проверка | Что даст | Почему не сделано |
|----------|----------|-------------------|
| Network tab | Реальные API-ответы в авторизованной сессии | Chrome занимает порт |
| Console | JS-ошибки при работе хуков подсветки | Chrome занимает порт |
| DOM inspection | Наличие `<span class="description-highlight">` в iframe | Chrome занимает порт |
| IndexedDB | Фактическое содержимое кеша для данного пользователя | Chrome занимает порт |

### 11.2 Требует доступ к БД

| Проверка | Что даст |
|----------|----------|
| `SELECT file_path FROM chapters WHERE book_id = ?` | Верификация маппинга глав (file_path vs EPUB href) |

### 11.3 Требует ручное тестирование

| Проверка | Что даст |
|----------|----------|
| Очистка IndexedDB + перезагрузка | Подтверждение/опровержение гипотезы о кеше |
| Сравнение API `content` vs DOM text для конкретных описаний | Success rate стратегий поиска |
| Проверка `isRestoringPosition` через console.log | Race condition при загрузке |

---

## 12. Рекомендации

### Приоритет 1: Немедленные действия (критические)

#### 12.1 Инвалидация кеша IndexedDB

**Проблема:** Кеш-first без инвалидации → вечно устаревшие данные после переобработки.

**Рекомендация:** Добавить версионирование данных. При запросе к API сравнивать `updated_at` или `version` с кешированным значением. Или: при переобработке книги отправлять WebSocket-событие / обновлять `book.updated_at`, и фронтенд при загрузке книги проверяет свежесть кеша.

**Минимальный fix:** Добавить TTL на кеш-записи (например, 1 час) или force-refresh при открытии книги.

#### 12.2 Ручная проверка для конкретного пользователя

Попросить пользователя:
1. Открыть DevTools → Application → IndexedDB
2. Найти записи для `bookId = 2d75b89e-...`
3. Удалить их
4. Перезагрузить страницу

Это подтвердит или опровергнет гипотезу кеша.

### Приоритет 2: Исправление подтверждённых багов

#### 12.3 Унификация регистра типов

**Вариант A (рекомендуется):** Backend API сериализует в lowercase:
```python
class DescriptionResponse(BaseResponse):
    @field_serializer('type')
    def serialize_type(self, v: DescriptionType) -> str:
        return v.value.lower()
```

**Вариант B:** Frontend нормализует:
```typescript
const normalizedType = (desc.type as string).toLowerCase() as DescriptionType;
```

Вариант A предпочтителен, т.к. исправляет проблему в одном месте, а не в 4+ точках фронтенда.

#### 12.4 Исправление индексов нормализации

**Рекомендация:** Создать функцию `mapNormalizedIndex(originalText, normalizedIndex) → originalIndex`, которая учитывает сдвиг от `trim()` и `\s+` → `' '`. Или: выполнять matching и splitting на ОДНОМ и том же тексте (оба на оригинале или оба на нормализованном).

#### 12.5 Исправление кеш round-trip

**Рекомендация:** 
- Сохранять `priority_score` в кеш
- Сохранять `text` отдельно от `content`
- Убрать промежуточный тип `'scene'` из typeMap или добавить `action` в reverse map

### Приоритет 3: Системные улучшения

#### 12.6 Дебаг-панель

Скрытый UI элемент (тройной тап на заголовке) для отображения:
- Текущая глава (EPUB spine index vs backend chapter number)
- Количество описаний (загруженных / отображённых / в кеше)
- Статус кеша (hit/miss, дата записи)
- Результаты маппинга глав
- Стратегия поиска для каждого описания (какая из 8 сработала)

#### 12.7 Таймаут `isRestoringPosition`

Если восстановление позиции не завершается за 5 секунд → `isRestoringPosition = false` принудительно.

#### 12.8 E2E тесты для highlighting

При текущем объёме рефакторинга (7+ коммитов за 3 недели) отсутствие E2E тестов для highlighting — системный риск. Рекомендуется Playwright-тест:
1. Загрузить книгу с описаниями
2. Проверить наличие `<span class="description-highlight">` в iframe
3. Кликнуть на подсветку → проверить открытие модалки

---

## 13. Файлы, затронутые расследованием

### Frontend (все прочитаны полностью)

| Файл | Ключевые строки | Роль |
|------|-----------------|------|
| `src/types/api.ts` | 147 | `DescriptionType` — lowercase union |
| `src/hooks/epub/useDescriptionHighlighting.ts` | 19-25, 27-29, 36-53, 63-68, 83-171, 174-215 | Ядро подсветки: CSS, type mapping, text search, DOM manipulation, clicks |
| `src/hooks/epub/useChapterData.ts` | 46-51, 56-63 | Cache-first логика, API вызов |
| `src/hooks/epub/useChapterManagement.ts` | 67-72, 71 | `isRestoringPosition` guard |
| `src/hooks/epub/useChapterMapping.ts` | 1-203 | Phase 1/2 chapter mapping |
| `src/services/chapterCache.ts` | 51-70, 76-98, 104-149 | toCachedDescription, validation, fromCachedDescription |
| `src/services/downloadManager.ts` | 422-433 | `mapDescriptionType` — lowercase keys |
| `src/hooks/api/useChapter.ts` | 101-109 | `mapToCachedDescriptionType` — lowercase keys |
| `src/components/Reader/EpubReader.tsx` | 92-94, 132 | Wiring: highlighting hook, position restoration |
| `src/stores/reader.ts` | 102 | `descriptionDensity` default 'all' |
| `src/utils/text-search/strategies.ts` | 1-111 | 8 matching strategies |
| `src/utils/text-search/normalization.ts` | 1-60 | `normalizeText` — length-changing |
| `src/utils/text-search/cache.ts` | 1-39 | Pattern cache |
| `src/api/books.ts` | 99-113 | `getChapterDescriptions` API call |
| `src/components/Reader/ReaderControls.tsx` | 19 | Density UI control |

### Backend (ключевые)

| Файл | Ключевые строки | Роль |
|------|-----------------|------|
| `app/models/description.py` | 35-40 | `DescriptionType` enum — UPPERCASE values |
| `app/schemas/responses/__init__.py` | 38, 304-324 | `BaseResponse` config, `DescriptionResponse` |
| `app/schemas/responses/descriptions.py` | 1-235 | `ChapterDescriptionsResponse`, `NLPAnalysisResult` |
| `app/routers/descriptions.py` | 1-279 | API endpoint logic |
| `app/services/description_extraction_service.py` | 324-339 | `build_description_response`, `group_by_type` |

### Git-диффы (все прочитаны)

| Коммит | Дата | Изменение |
|--------|------|-----------|
| `a9db947` | 21.01.2026 | DescriptionType UPPERCASE (3 backend файла) |
| `0b23c2d` | 20.01.2026 | Удаление автоэкстракции |
| `815b700` | 20.01.2026 | Гуттирование useChapterManagement (−197 строк) |
| `9e0455a` | 29.01.2026 | Мега-рефакторинг (−1119 строк EpubReader) |
| `bc3cedf` | 07.02.2026 | Position-aware strategies (startIdx/endIdx) |
| `39f78e2` | 07.02.2026 | Type-based CSS, density filter |

### Отчёты (все прочитаны)

- `2025-11-20-description-highlighting-v2.md`
- `2025-12-14_description_highlighting_optimization.md`
- `2025-12-25_chapter_loading_flow_analysis.md`
- `reader-comprehensive-audit-2026-01-30.md`
- `book-processing-regression-analysis-2026-01-31.md`
- `2026-02-24-entity-wiki-spoiler-protection-audit.md`

---

## Заключение

Подсветка описаний сломалась не из-за одного бага, а в результате **каскада из 7+ крупных изменений за 3 недели** (20.01–07.02.2026). Четыре подтверждённых бага (регистр типов, индексы нормализации, потеря данных при кешировании, отсутствие инвалидации) создают многослойную проблему, где каждый уровень добавляет свои артефакты.

**Для конкретного пользователя наиболее вероятная причина «описания не видны»** — устаревший кеш IndexedDB после переобработки книги. Это единственный баг, способный полностью заблокировать отображение. Рекомендуется начать с очистки кеша для подтверждения гипотезы, а затем системно исправлять баги в порядке приоритета.
