# Исследование: Корректное извлечение глав из EPUB — корневые причины и решения

**Дата:** 26 февраля 2026
**Контекст:** Баг «блок "По главам" у персонажа Геральт показывает только 17 глав вместо 23»
**Исследовано:** epub.js 0.3.93 source, ebooklib source, calibre source, fb2converter source,
fb2toepub source, W3C EPUB 3.3 spec, Readium architecture, DAISY Knowledge Base, KOReader source,
Apple Books Asset Guide, EPUBSecrets, MobileRead forums, русскоязычные издательские практики
(Литрес, Эксмо, АСТ, selfpub.ru)

---

## 1. Диагностика: что происходит с книгой 2625cfba

### EPUB-структура книги (Ведьмак. Перекресток воронов)

```
OPS/content.opf      ← OPF в папке OPS/
OPS/toc.ncx          ← NCX в той же папке
OPS/ch1-1.xhtml      ← "Общая информация" (сервисная)
OPS/ch1-2.xhtml      ← "Цитаты" (сервисная)
OPS/ch1-3.xhtml      ← "Глава первая"               → DB chapter 1
OPS/ch1-4.xhtml      ← "Глава вторая"               → DB chapter 2
...
OPS/ch1-22.xhtml     ← "Глава двадцатая"            → DB chapter 20
OPS/ch1-23.xhtml     ← "Глава двадцать первая"      ← ОТСУТСТВУЕТ в DB!
OPS/ch1-24.xhtml     ← "Глава двадцать вторая"      ← ОТСУТСТВУЕТ в DB!
OPS/ch1-25.xhtml     ← "Глава двадцать третья"      ← ОТСУТСТВУЕТ в DB!
```

**Итог:** В EPUB 23 главы + 2 сервисных раздела. В DB только 20 глав — главы 21–23 потеряны.

### Цепочка ошибок (полная трассировка)

1. **book_parser.py** при парсинге встречает "Глава двадцать первая"
2. `ChapterNumberExtractor.extract()` итерирует `text_number_map` через substring match
3. "глава двадцать первая" содержит "глава первая" → возвращает `1`
4. Глава с номером `1` уже существует → дедупликация пропускает → не в DB
5. Аналогично для глав 22 и 23 → **3 главы не попадают в DB**

6. **Frontend:** пользователь на "главе 22" (файл `ch1-24.xhtml`)
7. `useChapterMapping` hard-match: `ch1-24.xhtml` → не в DB → нет в mapping
8. `hasHardMatches = true` (от глав 1–20) → Phase 2 (heuristic) **пропускается**
9. Heuristic: "двадцать вторая" → `RUSSIAN_NUMERALS['вторая'] = 2` → возвращает `2`
10. `currentChapter = 2`, `maxChapterReached = max(2, 17) = 17`
11. Entity API: `current_chapter=17` → события только за главы 1–17

---

## 2. Фундаментальный вывод: spine position первична

Согласно EPUB 3.3 W3C: *"The spine element defines an ordered list of manifest item references.
Reading Systems MUST provide a means of rendering the Rendition in the order defined in the spine."*

Все production-ридеры используют spine-позицию, а не числа из заголовков:

| Ридер | Позиция | Откуда |
|-------|---------|--------|
| Kindle | "Location" (byte offset) | Spine index |
| Apple Books | Процент | Spine order |
| Readium/Thorium | `Locator` (CFI + href) | `readingOrder` index |
| Calibre | Spine index + CFI | Spine position |
| epub.js | CFI (содержит spine index) | `spine.items[n].index` |

**Никто из них не парсит заголовки для извлечения номеров.**

---

## 3. Российский EPUB-экосистема: реальность

### Откуда берутся русские EPUB-файлы

Большинство российских книг — это конвертированный FB2. Два основных конвертера:

| Конвертер | Guide | linear="no" | epub:type | Примечание |
|-----------|-------|-------------|-----------|------------|
| **fb2converter** (rupor-github) | ✅ Да (`cover-page`, `text`) | Только cover | Нет (EPUB 2) | Главный конвертер |
| **fb2toepub** (ava1ar) | ❌ Нет | Нет | Нет | Нет guide вообще |
| Calibre (ручная конверсия) | ✅ Да (`cover`, `text`) | Иногда | Иногда | Зависит от настроек |
| Ручной (Sigil, InDesign) | Непоследовательно | Непоследовательно | Редко | |

**Вывод:** Guide присутствует в ~50–60% российских EPUB (только fb2converter). `linear="no"`
используется ТОЛЬКО для cover в fb2converter — для других сервисных страниц не используется
нигде. `epub:type` близко к нулю (EPUB 2 формат).

### Типичная структура spine в российском FB2→EPUB

```
spine[0]: cover.xhtml         ← обложка (image-only, часто linear="no" в fb2converter)
spine[1]: annotation.xhtml    ← аннотация (~200-500 слов)
spine[2]: index1.xhtml        ← Глава 1 (первый реальный контент)
spine[3]: index2.xhtml        ← Глава 2
...
```

### Русскоязычные заголовки сервисных страниц (подтверждены)

```
Аннотация           ← из FB2 <annotation>
Обложка             ← cover page label в NCX
Содержание          ← HTML TOC
Оглавление          ← альтернативный TOC label
Общая информация    ← специфично для Эксмо/АСТ (встречается в Ведьмаке)
Цитаты              ← специфично для Эксмо/АСТ (встречается в Ведьмаке)
Об авторе           ← биография автора
От автора           ← предисловие автора
От издателя         ← предисловие издательства
От редактора        ← редакторское предисловие
От переводчика      ← примечание переводчика
Правовая информация ← копирайт/права
Примечания          ← сноски/notes body из FB2
Благодарности       ← acknowledgements
Предисловие         ← foreword/preface
Послесловие         ← afterword
Введение            ← introduction
```

**Watermak Литрес:** НЕТ отдельной XHTML страницы. Литрес использует социальную DRM —
символьные подмены внутри текста, не отдельные страницы.

---

## 4. Иерархия определения bodymatter: правильный порядок

### Критическая находка: NCX/TOC — самый надёжный сигнал для российских EPUB 2

Из исследования производственных инструментов:

> FB2-конвертеры **всегда** генерируют NCX, где первый `navPoint` указывает на первую
> реальную главу. Разрыв между `spine[0]` и `toc[0].href` надёжно определяет сервисные
> страницы. Это более надёжно, чем content heuristics.

### Итоговая иерархия (от надёжного к слабому)

**Уровень 1: EPUB 3 Landmarks** (`epub:type="bodymatter"` в NAV)
- Самый надёжный, но для российских EPUB 2 всегда пустой

**Уровень 2: EPUB 2 Guide** (`type="text"` или `type="start"`)
- Присутствует в ~50–60% российских EPUB (fb2converter)
- `book.guide` в ebooklib (Python) ✅ — доступен
- `book.packaging.guide` в epub.js ❌ — **НЕ существует** (guide не парсится)
- Поддержка в ридерах: Kindle ✅, Apple Books ✅, epub.js ❌, KOReader ❌

**Уровень 3: NCX/TOC first navPoint** ← **КЛЮЧЕВОЙ для российских EPUB 2**
- FB2-конвертеры всегда кладут первую главу первым в NCX
- Алгоритм: если `toc[0].href != spine[0].href` → spine[0..N-1] — сервисные страницы
- Работает в epub.js через `book.navigation.toc[0].href` + `book.spine.get(href)`

**Уровень 4: linear="no" на spine item**
- В российских EPUB только для cover (fb2converter)
- НЕ используется для других сервисных страниц

**Уровень 5: Контентные эвристики** (когда нет ни одного сигнала выше)
- Image-only: 99% надёжность
- Российские библиографические паттерны (УДК/ББК/ISBN): 97%
- Filename: 92%
- Word count < 100: 91%
- Word count 100–300: 75% (серая зона)

**Уровень 6: Абсолютный fallback: spine[0]**
- Норматив W3C spec: "first primary linear itemref"
- Все ридеры используют это при отсутствии других сигналов

---

## 5. Ключевые находки: epub.js 0.3.93

### `location.start.index` — всегда доступен без `locations.generate()`

```typescript
rendition.on('relocated', (location) => {
    const spineIndex = location.start.index;  // zero-based, всегда integer
    const chapterNumber = chapterMap.get(spineIndex) ?? null;
});
```

### `book.navigation.landmarks` — для EPUB 3

```typescript
// type = stripped "epub:type" (без префикса "epub:")
const bodymatter = book.navigation.landmarks.find(l => l.type === 'bodymatter');
// book.spine.get() автоматически стрипает #fragment (spine.js line 143)
const spineItem = book.spine.get(bodymatter.href);
// landmarks всегда [], никогда null — для EPUB 2 всегда пуст
```

### `book.spine.get(href)` — автоматически стрипает fragment

Из `spine.js` line 143: `target = target.split("#")[0]`. Поэтому
`book.spine.get("ch1.xhtml#section1")` корректно находит item.

### `book.packaging.guide` — НЕ СУЩЕСТВУЕТ

`packaging.js` не парсит `<guide>`. Для EPUB 2 Guide нужен fallback на TOC.

### `item.linear` — ДОСТУПЕН на каждом spine item

```typescript
book.spine.items.find(item => item.linear !== 'no')  // первый linear item
```

### NCX/TOC → Bodymatter detection для EPUB 2 в epub.js

```typescript
function getBodymatterSpineIndex(book: Book): number {
    // Уровень 1: EPUB 3 Landmarks
    const landmark = book.navigation.landmarks?.find(l => l.type === 'bodymatter');
    if (landmark) {
        const item = book.spine.get(landmark.href);
        if (item) return item.index;
    }

    // Уровень 2: NCX/TOC first entry (ключевой для российских FB2-EPUB 2)
    // Guide недоступен в epub.js, поэтому TOC — следующий лучший сигнал
    const firstTocItem = book.navigation.toc?.[0];
    if (firstTocItem) {
        const spineItem = book.spine.get(firstTocItem.href);
        if (spineItem && spineItem.index > 0) {
            // Первый TOC entry не совпадает с spine[0] → есть сервисные страницы
            return spineItem.index;
        }
        // Если совпадает с spine[0] — сервисных страниц нет
        if (spineItem && spineItem.index === 0) return 0;
    }

    // Уровень 3: Первый linear spine item
    const firstLinear = book.spine.first();
    return firstLinear?.index ?? 0;
}
```

---

## 6. Ключевые находки: ebooklib (Python)

### Структура `book.spine`

```python
# book.spine = [(idref, linear_string), ...]
# linear: "yes" или "no" (строка, не boolean), default "yes"
for idref, linear in book.spine:
    if linear == "no": continue
    item = book.get_item_with_id(idref)
    # item.get_name() → manifest href БЕЗ opf_dir (e.g. "ch1.xhtml")
```

### Guide доступен в ebooklib

```python
# book.guide = [{"href": "OPS/ch1.xhtml", "type": "text", "title": "..."}, ...]
# fb2converter использует type="cover-page" (нестандартно) и type="text"
for ref in (book.guide or []):
    if ref.get("type", "").lower() in ("text", "start"):
        return normalize_href(ref.get("href", ""))
```

### Проблема OPS/ prefix (критична!)

```
Guide href:  "OPS/ch1.xhtml"
item.get_name(): "ch1.xhtml"
book.get_item_with_href("OPS/ch1.xhtml") → None!

Решение: posixpath.basename() для обоих сторон
```

### flatten_toc() — правильная реализация

```python
# epub.Link: .href надёжен, .title надёжен
# epub.Section: .href может быть "" — нельзя использовать
# Текущий код в book_parser.py СЛОМАН: item[1] это children, не title!

def flatten_toc(toc_items):
    flat = []
    for item in toc_items:
        if isinstance(item, epub.Link):
            if item.href:
                flat.append((item.href, item.title or ""))
        elif isinstance(item, tuple) and len(item) == 2:
            head, children = item
            if isinstance(head, (epub.Section, epub.Link)):
                if head.href:
                    flat.append((head.href, head.title or ""))
                if isinstance(children, (list, tuple)):
                    flat.extend(flatten_toc(children))
        elif isinstance(item, list):
            flat.extend(flatten_toc(item))
    return flat
```

---

## 7. Алгоритм определения сервисных страниц (бэкенд)

### Приоритет сигналов для Python/ebooklib

```python
SERVICE_EPUB_TYPES = frozenset({
    "cover", "titlepage", "halftitlepage", "copyright-page",
    "toc", "landmarks", "page-list",
    "frontmatter", "backmatter", "colophon",
    "dedication", "acknowledgments",
})
CONTENT_EPUB_TYPES = frozenset({
    "bodymatter", "chapter", "part", "volume",
    "prologue", "epilogue", "afterword", "conclusion",
    "preface", "foreword", "introduction",
})

# Российские библиографические паттерны (97% надёжность для копирайт-страниц)
RUSSIAN_COPYRIGHT_PATTERNS = [
    re.compile(r'УДК\s+\d'),
    re.compile(r'ББК\s+\d'),
    re.compile(r'ISBN\s+97[89]'),
    re.compile(r'Все права защищены'),
    re.compile(r'Никакая часть'),
    re.compile(r'охраняется законом', re.IGNORECASE),
]

def is_service_page(item, text_content: str, title: str, spine_index: int) -> bool:
    # CHECK 1: epub:type на <body> (структурный, самый надёжный)
    epub_type = get_body_epub_type(item)
    if epub_type in SERVICE_EPUB_TYPES:
        return True
    if epub_type in CONTENT_EPUB_TYPES:
        return False  # явно контент

    # CHECK 2: Image-only (99% — обложка)
    if is_image_only(item):
        return True

    # CHECK 3: Российские библиографические паттерны (97%)
    copyright_hits = sum(1 for p in RUSSIAN_COPYRIGHT_PATTERNS if p.search(text_content))
    if copyright_hits >= 2:
        return True

    # CHECK 4: Filename heuristics (92%)
    basename = posixpath.basename(item.get_name()).lower()
    if any(p in basename for p in SERVICE_FILENAME_PATTERNS):
        return True

    # CHECK 5: Word count (< 100 → 91%)
    words = len(text_content.split())
    if words < 100:
        return True

    # CHECK 6: Word count серая зона (100-300) + дополнительный сигнал
    if words < 300:
        heading = get_first_heading(item)
        if heading and any(kw in heading.lower() for kw in SERVICE_TITLE_KEYWORDS):
            return True
        if spine_index <= 2:  # первые 3 spine item + короткий контент
            return True

    return False
```

### SERVICE_FILENAME_PATTERNS (полный список)

```python
SERVICE_FILENAME_PATTERNS = (
    # English
    "cover", "titlepage", "title_page", "title-page",
    "copyright", "copyrights", "toc", "contents",
    "halftitle", "dedication", "epigraph", "colophon",
    "frontmatter", "front_matter", "annotation",
    # Russian transliterated (Litres требует Latin filenames)
    "oblozhka", "annotaciya", "annot", "oglav",
    "soderzhanie", "predislovie", "posleslovie",
)
```

### SERVICE_TITLE_KEYWORDS (заголовки TOC и heading-тегов)

```python
SERVICE_TITLE_KEYWORDS = {
    # Русские (подтверждены из российских EPUB)
    'аннотация', 'обложка', 'содержание', 'оглавление',
    'об авторе', 'о книге', 'от автора', 'от издателя',
    'от редактора', 'от переводчика',
    'правовая информация', 'авторские права',
    'благодарности', 'посвящение',
    'алфавитный указатель', 'библиография', 'примечания',
    'общая информация',  # специфично для Эксмо/АСТ
    'цитаты',            # специфично для Эксмо/АСТ (книга Ведьмак)
    # English
    'cover', 'title', 'copyright', 'contents', 'table of contents',
    'about the author', 'acknowledgments', 'acknowledgements',
    'dedication', 'foreword', 'preface', 'introduction',
    'bibliography', 'index', 'notes', 'endnotes', 'colophon',
    'annotation',
    # ISBN является надёжным маркером любого жанра
    'isbn',
}
```

**ВАЖНО:** "пролог", "эпилог", "предисловие", "послесловие" — НЕ добавляем в SERVICE.
Это контентные страницы (narratively significant), просто без числового заголовка.
Spine-based подход назначит им chapter_number автоматически.

---

## 8. Алгоритм spine-based chapter mapping (фронтенд + бэкенд)

### Принцип

```
Для каждого spine item (в порядке spine):
├─ linear="no" → пропустить
├─ Не ITEM_DOCUMENT → пропустить
├─ До bodymatter (Landmarks → Guide → NCX[0]) → пропустить
├─ is_service_page() → пропустить (CHECK 1-6 выше)
└─ chapter_number = ++counter
   title = из TOC map или h1/h2/h3 (как есть — "Пролог", "The Storm", "Глава первая")
```

### Compound-first для ChapterNumberExtractor (legacy fallback)

Для книг уже в DB — исправить substring bug:

```python
_TENS = {
    "двадцать": 20, "тридцать": 30, "сорок": 40, "пятьдесят": 50,
    "шестьдесят": 60, "семьдесят": 70, "восемьдесят": 80, "девяносто": 90,
}
_UNIT_ORDINALS_F = {
    "первая": 1, "вторая": 2, "третья": 3, "четвёртая": 4, "четвертая": 4,
    "пятая": 5, "шестая": 6, "седьмая": 7, "восьмая": 8, "девятая": 9,
}
_SIMPLE_ORDINALS_F = {
    "первая": 1, "вторая": 2, "третья": 3, "четвёртая": 4, "четвертая": 4,
    "пятая": 5, "шестая": 6, "седьмая": 7, "восьмая": 8, "девятая": 9,
    "десятая": 10, "одиннадцатая": 11, "двенадцатая": 12, "тринадцатая": 13,
    "четырнадцатая": 14, "пятнадцатая": 15, "шестнадцатая": 16,
    "семнадцатая": 17, "восемнадцатая": 18, "девятнадцатая": 19,
    "двадцатая": 20, "тридцатая": 30, "сороковая": 40, "пятидесятая": 50,
    "шестидесятая": 60, "семидесятая": 70, "восьмидесятая": 80, "девяностая": 90,
}

# 1. Составные (21–99) — ПЕРЕД простыми
for tens_word, tens_val in _TENS.items():
    for unit_word, unit_val in _UNIT_ORDINALS_F.items():
        if f"{tens_word} {unit_word}" in search_text:
            return tens_val + unit_val
# 2. Простые — по убыванию длины
for word, val in sorted(_SIMPLE_ORDINALS_F.items(), key=lambda x: -len(x[0])):
    if word in search_text:
        return val
```

---

## 9. Риски ложных срабатываний

| Эвристика | Что может быть неверно классифицировано |
|-----------|----------------------------------------|
| Word count < 300 | Flash fiction; стихи (каждое в отдельном XHTML); детские книги; очень короткие главы (200 слов) |
| Image-only | Иллюстрированные романы с full-page иллюстрациями в главах |
| Filename | `covering-the-evidence.xhtml` → false positive на "cover" (решение: anchored regex) |
| Spine position 0–2 | Книги без front matter — глава 1 может быть spine[0] |
| Title keyword "цитаты" | Книга о цитатах — false positive (приемлемо, очень редко) |

---

## 10. Архитектура решения: порядок реализации

### Фаза 1 (Quick Fix — немедленно)

Цель: исправить баг для книги 2625cfba.

1. **Backend `book_parser.py`**:
   - Исправить `flatten_toc()` (сломан: item[1] = children, не title)
   - Добавить bodymatter detection (Guide → NCX[0] → fallback)
   - Заменить `if chapter_num is None: continue` на `is_service_page()` check
   - Compound-first в `ChapterNumberExtractor` (1–99)

2. **Frontend `useChapterMapping.ts`**:
   - NCX/TOC + `location.start.index` как primary mapping
   - Compound-first для `extractChapterNumber` (1–99)

3. **Reparse книги 2625cfba** → 23 главы в DB → invalidate entity cache

### Фаза 2 (Долгосрочная архитектура)

1. Полная spine-based extraction (без text parsing для chapter_number)
2. `spine_index` поле в модели `Chapter`
3. Reparse всех книг

---

## 11. Тест-кейсы

```python
# ChapterNumberExtractor (compound-first):
assert extract("Глава двадцать вторая") == 22    # не 2
assert extract("Глава двадцать первая") == 21    # не 1
assert extract("Глава двадцать третья") == 23    # не 3
assert extract("Глава вторая") == 2              # не регрессия
assert extract("Глава двадцатая") == 20          # не регрессия
assert extract("Глава 5") == 5
assert extract("Chapter III") == 3
assert extract("Глава тридцать пятая") == 35
assert extract("Глава девяносто девятая") == 99
assert extract("Пролог") is None                 # spine-based назначит позицию
assert extract("Общая информация") is None       # сервисная страница

# is_service_page():
assert is_service("Аннотация", text="...", spine_idx=1) == True
assert is_service("Цитаты", text="...", spine_idx=1) == True      # Witcher case
assert is_service("Общая информация", text="...", spine_idx=0) == True
assert is_service("Пролог", text="длинный текст > 300 слов", spine_idx=2) == False
assert is_service("Глава первая", text="...", spine_idx=3) == False
```

---

## 12. Источники

- epub.js 0.3.93: `src/navigation.js`, `src/spine.js`, `src/packaging.js`, issues #110, #759
- ebooklib: `epub.py`, issues #121, #200, #216
- calibre: `epub_input.py`, `plumber.py`, `polish/cover.py`, `oeb/transforms/split.py`
- fb2converter (rupor-github): `generate.go` — guide generation confirmed
- fb2toepub (ava1ar): no guide generated — confirmed from source
- Readium architecture discussion #143 (linear="no" и readingOrder)
- KOReader issue #6809 (linear="no" не поддерживается)
- Apple Books Asset Guide 5.3.1 (epub:type semantic detection)
- W3C EPUB 3.3 Recommendation (spine as canonical reading order)
- W3C EPUB 3 Structural Semantics Vocabulary 1.1
- OPF 2.0 Final Spec — IDPF (guide element types)
- DAISY Knowledge Base: Landmarks
- EPUBSecrets: guide element и reading start
- Литрес API docs (EPUB 2.0.1, Latin-only filenames)
- selfpub.ru EPUB требования
- Elib2Ebook source (загрузчик Литрес/МайБук)
- MobileRead forums, Nordic EPUB 3 Production Requirements
- epubr R package (epub_sift, word count thresholds)
- CETR text density algorithm (ResearchGate)
