# Промпт для Claude Opus 4.6: Исправить извлечение глав из EPUB

**Дата:** 26 февраля 2026
**Модель:** claude-opus-4-6
**Связанный отчёт:** `docs/reports/2026-02-26-epub-chapter-mapping-research.md`

---

## Проблема

Книга "Ведьмак. Перекресток воронов" (`2625cfba-5865-4a28-b233-a0dc4b34d0af`).
EPUB содержит 23 главы + 2 сервисные страницы. В DB только 20 глав.
Пользователь на "Главе двадцать второй" — блок "По главам" у Геральта показывает события
только до 17-й главы. Причина: два взаимосвязанных бага в бэкенде и фронтенде.

---

## Обязательное чтение перед началом

1. **`docs/reports/2026-02-26-epub-chapter-mapping-research.md`** — полный технический отчёт,
   прочти его ПОЛНОСТЬЮ. В нём — все архитектурные решения, данные из исходников epub.js,
   ebooklib, calibre, fb2converter, российская специфика EPUB.

2. **`backend/app/services/book_parser.py`** — прочти полностью перед любыми изменениями.
   Найди: класс `ChapterNumberExtractor`, методы `_flatten_toc`, `_extract_chapters_from_toc`,
   `_extract_chapters_from_spine`, dataclass/model `BookChapter`.

3. **`frontend/src/hooks/epub/useChapterMapping.ts`** — прочти полностью. Найди:
   `RUSSIAN_NUMERALS`, `extractChapterNumber`, `normalizeHref`, `getChapterNumberByLocation`,
   текущую сигнатуру хука `useChapterMapping(toc, chapters)`.

4. **`frontend/src/hooks/epub/useChapterManagement.ts`** — прочти полностью. Найди как
   вызывается `useChapterMapping` и как используется `getChapterNumberByLocation`.

5. Найди существующие тесты: `backend/tests/` и `frontend/src/hooks/epub/__tests__/`
   (или аналогичные пути). Понять что уже покрыто перед написанием новых тестов.

---

## Архитектурные принципы

### Spine position первична — text parsing крайний fallback

`chapter_number` = порядковая позиция среди контентных spine items ПОСЛЕ bodymatter.
Это соответствует W3C EPUB 3.3 spec. Работает для любых книг:
- С нумерацией: "Глава первая" → chapter 1
- Без нумерации: "Пролог" → chapter 1, "The Storm" → chapter 4
- Русские составные: "Глава двадцать вторая" → chapter 22

### Иерархия: bodymatter start detection

```
1. EPUB 3 Landmarks → epub:type="bodymatter" в NAV
   (для российских EPUB 2 всегда пусто — но проверять обязательно)

2. EPUB 2 Guide → type="text" или type="start"
   ВАЖНО: доступен ТОЛЬКО в ebooklib (Python)
   epub.js НЕ парсит <guide> — book.packaging.guide НЕ существует

3. NCX/TOC first entry ← КЛЮЧЕВОЙ для российских FB2→EPUB 2
   Алгоритм: если toc[0].href != spine[0] → spine[0..N-1] сервисные
   Почему работает: fb2converter всегда кладёт первую главу первым в NCX

4. Первый linear spine item (spine.first() в epub.js)

5. spine[0] — абсолютный fallback
```

### Иерархия: service page detection (6 уровней)

```
1. epub:type на <body> → SERVICE_EPUB_TYPES/CONTENT_EPUB_TYPES  [структурный, самый надёжный]
2. Image-only: нет текста + есть img                            [99%, обложка]
3. Российские паттерны: УДК/ББК/ISBN ≥2 совпадений             [97%, копирайт]
4. Filename: cover, titlepage, annotation, toc...               [92%]
5. Word count < 100 слов                                        [91%]
6. Word count 100–300 + (заголовок из SERVICE_TITLE_KEYWORDS    [75%, серая зона]
                          ИЛИ spine_idx ≤ 2)
→ Всё остальное = контент, chapter_number = ++counter
```

**НЕ сервисные страницы (контент):** "Пролог", "Эпилог", "Предисловие", "Послесловие",
"Введение" — spine-based подход назначает им chapter_number автоматически.

---

## План работ (порядок критичен — есть зависимости)

### Фаза 0: Разведка (без изменений кода)

**Шаг 0.1** — Прочти все 5 файлов из "Обязательное чтение".

**Шаг 0.2** — Найди и прочти существующие тесты:
```bash
find backend/tests -name "*.py" | xargs grep -l "chapter\|parser\|book_parser" 2>/dev/null
find frontend/src -name "*.test.*" | xargs grep -l "chapter\|mapping" 2>/dev/null
```

**Шаг 0.3** — Выясни сигнатуру `useChapterMapping` и все места её вызова:
```bash
grep -rn "useChapterMapping" frontend/src/
```

**Шаг 0.4** — Проверь как `ChapterNumberExtractor` используется вне `book_parser.py`:
```bash
grep -rn "ChapterNumberExtractor\|chapter_extractor" backend/
```

**Шаг 0.5** — Проверь структуру `BookChapter` / модели `Chapter` в DB:
```bash
grep -rn "class BookChapter\|class Chapter" backend/
# Найди Alembic миграции чтобы понять текущую схему
```

---

### Фаза 1: Backend tests (TDD — сначала тесты)

Создай или расширь файл тестов (найди правильный путь на шаге 0.2).

**Шаг 1.1 — Тесты для `_flatten_toc()`**

```python
from unittest.mock import MagicMock
from ebooklib import epub

def make_link(href, title):
    link = epub.Link(href, title, href)
    return link

def make_section(title, href=""):
    section = epub.Section(title, href)
    return section

# Тест 1: простые Link items
toc = [make_link("ch1.xhtml", "Глава 1"), make_link("ch2.xhtml", "Глава 2")]
result = flatten_toc(toc)
assert result == [("ch1.xhtml", "Глава 1"), ("ch2.xhtml", "Глава 2")]

# Тест 2: (Section, [Link...]) — title из Section.title, НЕ из item[1]
toc = [(make_section("Часть I", "part1.xhtml"), [make_link("ch1.xhtml", "Глава 1")])]
result = flatten_toc(toc)
assert ("part1.xhtml", "Часть I") in result
assert ("ch1.xhtml", "Глава 1") in result

# Тест 3: Section с пустым href — не добавляется, но дети добавляются
toc = [(make_section("Группа", ""), [make_link("ch1.xhtml", "Глава 1")])]
result = flatten_toc(toc)
hrefs = [r[0] for r in result]
assert "" not in hrefs
assert "ch1.xhtml" in hrefs
```

**Шаг 1.2 — Тесты для `ChapterNumberExtractor` (compound-first)**

```python
# Составные (регрессионные — ДОЛЖНЫ пройти после фикса)
assert extract("Глава двадцать вторая") == 22   # было: 2
assert extract("Глава двадцать первая") == 21   # было: 1
assert extract("Глава двадцать третья") == 23   # было: 3
assert extract("Глава тридцать пятая") == 35
assert extract("Глава девяносто девятая") == 99

# Простые (не регрессия — должны продолжать работать)
assert extract("Глава вторая") == 2
assert extract("Глава двадцатая") == 20
assert extract("Глава 5") == 5
assert extract("Chapter III") == 3
assert extract("глава ПЕРВАЯ") == 1             # case insensitive

# Без числа — None (spine-based назначит позицию)
assert extract("Пролог") is None
assert extract("Общая информация") is None
assert extract("The Storm") is None
```

**Шаг 1.3 — Тесты для `_is_service_page()`**

```python
# Должны быть сервисными:
assert is_service(title="Аннотация", text="краткое описание", spine_idx=1)
assert is_service(title="Обложка", text="", spine_idx=0)            # image-only
assert is_service(title="Цитаты", text="короткий", spine_idx=1)     # Witcher
assert is_service(title="Общая информация", text="инфо", spine_idx=0) # Witcher
assert is_service(title="ch", text="УДК 821.162\nББК 84(4Пол)\nISBN 978-5-699-90001\nВсе права защищены", spine_idx=2)

# НЕ должны быть сервисными:
assert not is_service(title="Пролог", text="а" * 400, spine_idx=2)   # длинный текст
assert not is_service(title="Глава первая", text="а" * 600, spine_idx=3)
assert not is_service(title="The Storm", text="а" * 500, spine_idx=4)
```

**Шаг 1.4 — Тесты для `_get_bodymatter_basename()`**

```python
# Тест Guide: возвращает basename из guide type="text"
# Тест NCX: если guide нет, возвращает toc[0] basename когда toc[0] != spine[0]
# Тест NCX совпадение: если toc[0] == spine[0], возвращает None (нет сервисных)
# Тест empty: если нет ничего, возвращает None
```

---

### Фаза 2: Backend implementation (строго в этом порядке)

**Шаг 2.1 — Добавить константы на уровне модуля** (до всех методов)

Добавь в начало файла (или в класс, если другие константы там):

```python
import re
import posixpath
import urllib.parse

SERVICE_EPUB_TYPES = frozenset({
    "cover", "titlepage", "halftitlepage", "copyright-page",
    "toc", "landmarks", "page-list",
    "frontmatter", "backmatter", "colophon", "dedication", "acknowledgments",
})
CONTENT_EPUB_TYPES = frozenset({
    "bodymatter", "chapter", "part", "volume",
    "prologue", "epilogue", "afterword", "conclusion",
    "preface", "foreword", "introduction",
})
SERVICE_FILENAME_PATTERNS = (
    # English
    "cover", "titlepage", "title_page", "title-page",
    "copyright", "copyrights", "toc", "contents",
    "halftitle", "dedication", "epigraph", "colophon",
    "frontmatter", "front_matter", "annotation",
    # Russian transliterated (Litres требует Latin filenames)
    "annotaciya", "oblozhka", "oglav", "soderzhanie",
)
SERVICE_TITLE_KEYWORDS = frozenset({
    # Русские (подтверждены из российских EPUB — Литрес, Эксмо, АСТ)
    "аннотация", "обложка", "содержание", "оглавление",
    "об авторе", "о книге", "от автора", "от издателя",
    "от редактора", "от переводчика",
    "правовая информация", "авторские права",
    "благодарности", "посвящение",
    "алфавитный указатель", "библиография", "примечания",
    "общая информация",  # Эксмо/АСТ (книга Ведьмак)
    "цитаты",            # Эксмо/АСТ (книга Ведьмак)
    "isbn",
    # English
    "cover", "title page", "copyright", "contents", "table of contents",
    "about the author", "acknowledgments", "acknowledgements",
    "dedication", "foreword", "preface", "bibliography", "index", "notes",
    "annotation", "colophon",
})
RUSSIAN_COPYRIGHT_PATTERNS = [
    re.compile(r"УДК\s+\d"),
    re.compile(r"ББК\s+\d"),
    re.compile(r"ISBN\s+97[89]"),
    re.compile(r"Все права защищены"),
    re.compile(r"Никакая часть"),
    re.compile(r"охраняется законом", re.IGNORECASE),
]
```

**Шаг 2.2 — Добавить `_normalize_href()` helper** (нет зависимостей)

```python
@staticmethod
def _normalize_href(href: str) -> str:
    """
    Нормализует EPUB href для сравнения между guide/TOC и spine items.
    Проблема: guide хранит "OPS/ch1.xhtml", item.get_name() = "ch1.xhtml"
    Решение: сравниваем только basename.
    """
    href = urllib.parse.unquote(href).split("#")[0]
    return posixpath.basename(href)
```

**Шаг 2.3 — Исправить `_flatten_toc()`** (зависит от: ничего нового)

Замени ЦЕЛИКОМ текущую реализацию. Смотри правильную реализацию из отчёта раздел 6.
Ключевые принципы:
- `epub.Link` — всегда имеет надёжный `.href` и `.title`
- `epub.Section` — `.href` может быть `""` (пустая строка), `.title` надёжен
- `item[1]` в tuple `(Section, list)` — это **список детей**, НЕ title
- Рекурсия обязательна для вложенных структур

**Шаг 2.4 — Добавить вспомогательные методы** (зависят от: шаг 2.1)

```python
def _get_body_epub_type(self, item) -> Optional[str]:
    """Читает epub:type с <body> элемента."""
    try:
        soup = BeautifulSoup(item.get_content(), "html.parser")
        body = soup.find("body")
        if body:
            val = body.get("epub:type", "")
            return val.strip().split()[0] if val else None
    except Exception:
        pass
    return None

def _is_image_only(self, item) -> bool:
    """True если страница содержит только изображение и нет текста (обложка)."""
    try:
        soup = BeautifulSoup(item.get_content(), "html.parser")
        body = soup.find("body")
        if not body:
            return False
        text = body.get_text(strip=True)
        images = body.find_all(["img", "image"])
        paragraphs = [p for p in body.find_all("p") if p.get_text(strip=True)]
        return not text and len(images) >= 1 and not paragraphs
    except Exception:
        return False
```

**Шаг 2.5 — Добавить `_is_service_page()`** (зависит от: шаги 2.1, 2.2, 2.4)

```python
def _is_service_page(
    self, item, text_content: str, title: str, spine_idx: int
) -> bool:
    """
    Определяет является ли spine item сервисной страницей.
    Иерархия от надёжного к слабому — см. отчёт раздел 3.
    """
    # 1. epub:type на <body> — структурный, самый надёжный
    epub_type = self._get_body_epub_type(item)
    if epub_type and epub_type in SERVICE_EPUB_TYPES:
        return True
    if epub_type and epub_type in CONTENT_EPUB_TYPES:
        return False  # явно контент, дальше не проверяем

    # 2. Image-only (99% — обложка)
    if self._is_image_only(item):
        return True

    # 3. Российские библиографические паттерны (97% — копирайт страница)
    copyright_hits = sum(
        1 for p in RUSSIAN_COPYRIGHT_PATTERNS if p.search(text_content)
    )
    if copyright_hits >= 2:
        return True

    # 4. Filename patterns (92%)
    basename = posixpath.basename(item.get_name()).lower()
    if any(pat in basename for pat in SERVICE_FILENAME_PATTERNS):
        return True

    words = len(text_content.split())

    # 5. Word count < 100 (91%)
    if words < 100:
        return True

    # 6. Серая зона 100–300 слов + дополнительный сигнал (75%)
    if words < 300:
        title_lower = title.lower()
        if any(kw in title_lower for kw in SERVICE_TITLE_KEYWORDS):
            return True
        if spine_idx <= 2:
            # Первые 3 spine items + короткий контент → сервисная
            return True

    return False
```

**Шаг 2.6 — Добавить `_get_bodymatter_basename()`** (зависит от: шаги 2.2, 2.3)

```python
def _get_bodymatter_basename(self, book) -> Optional[str]:
    """
    Возвращает basename первого файла основного контента (bodymatter).
    Всё до него в spine — сервисные страницы.
    Возвращает None если bodymatter начинается с spine[0].

    Иерархия:
    1. EPUB 3 Landmarks (epub:type="bodymatter")
    2. EPUB 2 Guide (type="text" или "start") — доступен в ebooklib
    3. NCX/TOC first entry — ключевой для российских FB2-EPUB
    """
    # Уровень 1: EPUB 3 Landmarks
    for nav_item in book.get_items_of_type(ebooklib.ITEM_NAVIGATION):
        try:
            soup = BeautifulSoup(nav_item.get_content(), "html.parser")
            for nav_el in soup.find_all("nav"):
                if "landmarks" in nav_el.get("epub:type", ""):
                    for a in nav_el.find_all("a"):
                        if "bodymatter" in a.get("epub:type", ""):
                            href = a.get("href", "")
                            if href:
                                logger.info(f"Bodymatter from landmarks: {href}")
                                return self._normalize_href(href)
        except Exception:
            continue

    # Уровень 2: EPUB 2 Guide
    # fb2converter генерирует guide с type="cover-page" и type="text"
    # fb2toepub — НЕ генерирует guide
    for ref in (book.guide or []):
        ref_type = ref.get("type", "").lower()
        # Проверяем "text" и "start" (Amazon alias)
        # НЕ "cover-page" — это обложка, не начало контента
        if ref_type in ("text", "start"):
            href = ref.get("href", "")
            if href:
                logger.info(f"Bodymatter from guide type={ref_type!r}: {href}")
                return self._normalize_href(href)

    # Уровень 3: NCX/TOC first entry
    # Почему работает: FB2-конвертеры всегда кладут первую главу первым в NCX.
    # Если toc[0] != spine[0] — все spine items до toc[0] сервисные.
    toc_flat = self._flatten_toc(book.toc)
    if toc_flat:
        first_toc_href, _ = toc_flat[0]
        first_toc_basename = self._normalize_href(first_toc_href)
        for spine_idx, (idref, _) in enumerate(book.spine):
            item = book.get_item_with_id(idref)
            if item and self._normalize_href(item.get_name()) == first_toc_basename:
                if spine_idx > 0:
                    logger.info(
                        f"Bodymatter from TOC[0]: {first_toc_href} "
                        f"(spine_idx={spine_idx})"
                    )
                    return first_toc_basename
                else:
                    # TOC[0] == spine[0] → нет сервисных страниц перед контентом
                    return None

    return None  # включаем все spine items
```

**Шаг 2.7 — Исправить `ChapterNumberExtractor.extract()`** (независимо от шагов 2.1–2.6)

Найди существующий метод `extract()`. Замени логику textual matching на compound-first.
**Не трогай Arabic numerals (`\d+`) и Roman numerals — только textual (русские словесные) блок.**

```python
# Добавить как class-level или module-level константы:
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

# В методе extract(), в блоке textual matching:
# 1. Составные (21–99) — ОБЯЗАТЕЛЬНО перед простыми
for tens_word, tens_val in _TENS.items():
    for unit_word, unit_val in _UNIT_ORDINALS_F.items():
        if f"{tens_word} {unit_word}" in search_text:
            return tens_val + unit_val

# 2. Простые (1–20, 30, 40...) — по убыванию длины (prevents "первая" matching before "одиннадцатая")
for word, val in sorted(_SIMPLE_ORDINALS_F.items(), key=lambda x: -len(x[0])):
    if word in search_text:
        return val
```

**Шаг 2.8 — Заменить логику присвоения `chapter_number`** (зависит от: все шаги 2.x)

Найди метод(ы) `_extract_chapters_from_toc()` и/или `_extract_chapters_from_spine()`.
Перед рефакторингом убедись, что понимаешь какой из них primary path.

Ключевое изменение — заменить:
```python
# БЫЛО (сломано):
chapter_num = self.chapter_extractor.extract(content, title)
if chapter_num is None:
    logger.debug(f"Skipping non-chapter: {title}")
    continue
```

На:
```python
# СТАЛО: spine-based sequential counting

# В начале метода (один раз):
bodymatter_basename = self._get_bodymatter_basename(book)
bodymatter_reached = (bodymatter_basename is None)
# Строим map TOC basename→title для получения заголовков
toc_title_map = {
    self._normalize_href(href): title
    for href, title in self._flatten_toc(book.toc)
}

# В основном цикле по spine:
for spine_idx, (idref, linear) in enumerate(book.spine):
    if linear == "no":
        continue
    item = book.get_item_with_id(idref)
    if not item or item.get_type() != ebooklib.ITEM_DOCUMENT:
        continue

    item_basename = posixpath.basename(item.get_name())

    # Пропускаем до bodymatter
    if not bodymatter_reached:
        if item_basename == bodymatter_basename:
            bodymatter_reached = True
        else:
            continue

    # Извлекаем текст (используй существующий метод)
    text_content, html_content = self._extract_text_from_item(item)

    # Заголовок: из TOC map, потом из h1/h2/h3, потом filename
    title = (
        toc_title_map.get(item_basename)
        or self._extract_first_heading(html_content)  # найди/создай этот helper
        or item_basename
    )

    # Определяем сервисная ли страница
    if self._is_service_page(item, text_content, title, spine_idx):
        logger.debug(f"Skipping service page: {title!r} ({item.get_name()})")
        continue

    # chapter_number = sequential position, НЕ из заголовка
    chapter_num = len(chapters) + 1
    # title хранится как-есть: "Пролог", "Глава двадцать первая", "The Storm"
    chapters.append(self._make_chapter(chapter_num, title, text_content, html_content, item))
```

**ВАЖНО:** `BookChapter` dataclass **не меняй** — это сломает DB/миграции.
Только логика присвоения `number` и `title`.

---

### Фаза 3: Frontend tests (TDD)

**Шаг 3.1** — Найди или создай файл тестов для `useChapterMapping`.

**Шаг 3.2 — Тесты для `extractChapterNumber`**

```typescript
// Compound-first:
expect(extractChapterNumber("Глава двадцать вторая")).toBe(22);  // не 2!
expect(extractChapterNumber("Глава двадцать первая")).toBe(21);  // не 1!
expect(extractChapterNumber("Глава двадцать третья")).toBe(23);  // не 3!
expect(extractChapterNumber("Глава тридцать пятая")).toBe(35);
expect(extractChapterNumber("Глава девяносто девятая")).toBe(99);
// Не регрессия:
expect(extractChapterNumber("Глава вторая")).toBe(2);
expect(extractChapterNumber("Глава двадцатая")).toBe(20);
expect(extractChapterNumber("глава ПЕРВАЯ")).toBe(1);  // case insensitive
// Без числа:
expect(extractChapterNumber("Пролог")).toBeNull();
expect(extractChapterNumber("The Storm")).toBeNull();
```

**Шаг 3.3 — Тесты для `getBodymatterSpineIndex`** (мок book)

```typescript
// Тест с landmarks:
const bookWithLandmarks = mockBook({
    landmarks: [{ type: 'bodymatter', href: 'ch1.xhtml' }],
    spine: [{ index: 0, href: 'cover.xhtml' }, { index: 1, href: 'ch1.xhtml' }],
});
expect(getBodymatterSpineIndex(bookWithLandmarks)).toBe(1);

// Тест с NCX gap (российский FB2-EPUB):
const bookWithTocGap = mockBook({
    landmarks: [],
    toc: [{ href: 'ch1.xhtml', label: 'Глава 1', subitems: [] }],
    spine: [
        { index: 0, href: 'cover.xhtml' },
        { index: 1, href: 'annotation.xhtml' },
        { index: 2, href: 'ch1.xhtml' },
    ],
});
expect(getBodymatterSpineIndex(bookWithTocGap)).toBe(2);

// Тест без gap — TOC совпадает с spine[0]:
const bookNoCover = mockBook({
    landmarks: [],
    toc: [{ href: 'ch1.xhtml', label: 'Глава 1', subitems: [] }],
    spine: [{ index: 0, href: 'ch1.xhtml' }],
});
expect(getBodymatterSpineIndex(bookNoCover)).toBe(0);
```

---

### Фаза 4: Frontend implementation (строго в этом порядке)

**Шаг 4.1 — Добавить `getBodymatterSpineIndex()`** (новая функция, нет конфликтов)

Добавь как standalone функцию (не хук) в `useChapterMapping.ts`.

```typescript
function getBodymatterSpineIndex(book: Book): number {
    // Уровень 1: EPUB 3 Landmarks (epub:type="bodymatter")
    // book.navigation.landmarks всегда [], никогда null (для EPUB 2 всегда пусто)
    const landmark = book.navigation.landmarks?.find(l => l.type === 'bodymatter');
    if (landmark) {
        // book.spine.get() автоматически стрипает #fragment (spine.js line 143)
        const item = book.spine.get(landmark.href);
        if (item) return item.index;
    }

    // Уровень 2: NCX/TOC first entry
    // epub.js НЕ парсит <guide> — book.packaging.guide НЕ существует
    // NCX — лучший доступный fallback для российских FB2-EPUB 2
    const firstTocItem = book.navigation.toc?.[0];
    if (firstTocItem) {
        const spineItem = book.spine.get(firstTocItem.href);
        if (spineItem) {
            if (spineItem.index > 0) {
                // TOC начинается не с spine[0] → сервисные страницы перед ним
                return spineItem.index;
            }
            // spineItem.index === 0 → нет сервисных страниц
            return 0;
        }
    }

    // Уровень 3: Первый linear spine item
    return book.spine.first()?.index ?? 0;
}
```

**Шаг 4.2 — Добавить `buildSpineChapterMap()`** (зависит от: шаг 4.1)

```typescript
function buildSpineChapterMap(book: Book): Map<number, number> {
    const bodymatterIdx = getBodymatterSpineIndex(book);
    const chapterMap = new Map<number, number>(); // spineIndex → chapterNumber
    const seenIndices = new Set<number>();
    let chapterNumber = 0;

    // Flatten TOC: включаем и Section и Link items (дедупликация по spineIndex)
    const allTocItems = flattenToc(book.navigation.toc);

    for (const tocItem of allTocItems) {
        const spineItem = book.spine.get(tocItem.href);
        if (!spineItem) continue;
        if (spineItem.index < bodymatterIdx) continue;  // до bodymatter
        if (seenIndices.has(spineItem.index)) continue; // дедупликация
        seenIndices.add(spineItem.index);
        chapterMap.set(spineItem.index, ++chapterNumber);
    }

    // Fallback: pure spine если TOC пустой или ничего не нашли
    if (chapterMap.size === 0) {
        book.spine.each((item: any) => {
            if (item.index >= bodymatterIdx) {
                chapterMap.set(item.index, chapterMap.size + 1);
            }
        });
    }

    return chapterMap;
}
```

**Шаг 4.3 — Обновить сигнатуру `useChapterMapping`** (ОСТОРОЖНО — breaking change)

Текущая сигнатура: `useChapterMapping(toc, chapters)`.
Новая сигнатура: `useChapterMapping(toc, chapters, book?)` — `book` опциональный.

Перед изменением проверь все места вызова (шаг 0.3). Обнови вызовы в
`useChapterManagement.ts` — передай `book: epubBook` (он там доступен).

**Шаг 4.4 — Обновить `extractChapterNumber`** (зависит от: шаг 2.7 аналог для TS)

Добавь `TENS` и `UNIT_ORDINALS` константы. Замени цикл по `RUSSIAN_NUMERALS` на compound-first:

```typescript
const TENS: Record<string, number> = {
    'двадцать': 20, 'тридцать': 30, 'сорок': 40, 'пятьдесят': 50,
    'шестьдесят': 60, 'семьдесят': 70, 'восемьдесят': 80, 'девяносто': 90,
};
const UNIT_ORDINALS: Record<string, number> = {
    'первая': 1, 'вторая': 2, 'третья': 3, 'четвёртая': 4, 'четвертая': 4,
    'пятая': 5, 'шестая': 6, 'седьмая': 7, 'восьмая': 8, 'девятая': 9,
};

function extractChapterNumber(title: string): number | null {
    const lower = title.toLowerCase();

    // 1. Составные (21–99) — ПЕРВЫМИ (иначе "вторая" → 2 вместо 22)
    for (const [tens, tensVal] of Object.entries(TENS)) {
        for (const [unit, unitVal] of Object.entries(UNIT_ORDINALS)) {
            if (lower.includes(`${tens} ${unit}`)) return tensVal + unitVal;
        }
    }

    // 2. Простые (1–20, 30...) — по убыванию длины
    const sorted = Object.entries(RUSSIAN_NUMERALS)
        .sort((a, b) => b[0].length - a[0].length);
    for (const [word, num] of sorted) {
        if (lower.includes(word)) return num;
    }

    return null;
}
```

**Шаг 4.5 — Обновить `getChapterNumberByLocation`** (зависит от: шаги 4.1–4.4)

Обнови приоритетную цепочку внутри хука:

```typescript
// Приоритет 1: spine-based map по location.start.index (самый надёжный)
const spineIndex = location?.start?.index;
if (typeof spineIndex === 'number' && spineChapterMap.size > 0) {
    const ch = spineChapterMap.get(spineIndex);
    if (ch != null) return ch;
}

// Приоритет 2: существующий hard-match по file_path (сохранить как есть!)
// Это compatibility layer для книг уже в DB
// ... (оставь текущую логику Phase 1 hard-match)

// Приоритет 3: compound-first text matching (legacy для старых DB записей)
// ... (оставь Phase 2 heuristic, но замени extractChapterNumber на compound-first)

// Приоритет 4: spine arithmetic fallback
const bodymatterIdx = getBodymatterSpineIndex(book);
if (typeof spineIndex === 'number') {
    return Math.max(1, spineIndex - bodymatterIdx + 1);
}

return 1;
```

---

### Фаза 5: Запуск тестов

**Шаг 5.1** — Backend:
```bash
cd backend && pytest -v -k "chapter or parser or flatten_toc or service_page"
```

**Шаг 5.2** — Frontend:
```bash
cd frontend && npm test -- --testPathPattern="useChapterMapping"
```

**Шаг 5.3** — Full test suites:
```bash
cd backend && pytest -v
cd frontend && npm test
```

Все тесты должны пройти перед переходом к Фазе 6.

---

### Фаза 6: Reparse книги 2625cfba

**Шаг 6.1** — Найди endpoint или Celery task для повторного парсинга:
```bash
grep -rn "reparse\|re_parse\|parse_book\|trigger_parsing" backend/app/
```

**Шаг 6.2** — Запусти reparse для книги `2625cfba-5865-4a28-b233-a0dc4b34d0af`.

**Шаг 6.3** — Проверь результат в production DB:
```bash
ssh root@77.246.106.109
docker exec bookreader_postgres_lite psql -U postgres bookreader_dev -c \
  "SELECT chapter_number, title, file_path
   FROM chapters
   WHERE book_id = '2625cfba-5865-4a28-b233-a0dc4b34d0af'
   ORDER BY chapter_number;"
```
Ожидаемый результат: **23 строки** (главы 1–23), включая:
- chapter 21 — "Глава двадцать первая" (ch1-23.xhtml)
- chapter 22 — "Глава двадцать вторая" (ch1-24.xhtml)
- chapter 23 — "Глава двадцать третья" (ch1-25.xhtml)

**Шаг 6.4** — Инвалидируй entity network cache для книги (найди в коде как это делается
через API или напрямую через Redis/TanStack Query invalidation).

---

## Что НЕ трогать

| Что | Почему |
|-----|--------|
| `EpubReader.tsx` | Hottest file (84 изменения) — не изменять напрямую |
| `entity_service.py` | Споилер-фри фильтрация `chapter_number <= current` работает корректно |
| `BookChapter` dataclass поля | Изменение полей → конфликт с DB схемой и миграциями |
| Alembic миграции | Не добавлять `spine_index` колонку — это Фаза 2 (следующая сессия) |
| `useProgressSync.ts` | Сохраняет `currentChapter` корректно |
| `useReaderPosition.ts` | Восстановление позиции не связано с chapter mapping |

---

## Потенциальные конфликты и как их избежать

**Конфликт 1: `_flatten_toc` вызывается из нескольких мест**
→ Исправь её ПЕРВОЙ (Шаг 2.3) — до того как добавляешь методы, которые её вызывают.

**Конфликт 2: Смена сигнатуры `useChapterMapping(toc, chapters)` → `(toc, chapters, book?)`**
→ Сделай `book` опциональным (`book?: Book`). Без книги spine-based map будет пустым,
поведение деградирует до старого (hard-match + compound-first). Обнови все вызовы.

**Конфликт 3: `ChapterNumberExtractor` используется в других местах**
→ Не меняй публичный API (метод `extract(title, content)`). Меняй только внутреннюю логику.
Проверь на шаге 0.4.

**Конфликт 4: Существующие главы 1–20 в DB с `file_path`**
→ Hard-match Phase 1 (по `file_path`) сохраняется как Приоритет 2. Для них spine map
может не совпадать (если spine positions отличаются от DB chapter_numbers), поэтому
hard-match остаётся важным fallback.

**Конфликт 5: `bodymatter_reached` и ранний `continue` в spine loop**
→ Если `_get_bodymatter_basename()` возвращает `None` — `bodymatter_reached = True` сразу,
то есть включаем все spine items. Проверь эту ветку отдельным тестом.

---

## Контекст: российская EPUB специфика

- **Большинство книг**: FB2 → EPUB 2 через fb2converter или fb2toepub
- **fb2converter**: генерирует `<guide>` с `type="cover-page"` и `type="text"` ✓
- **fb2toepub**: НЕ генерирует `<guide>` вообще → NCX fallback критичен
- **epub:type**: почти отсутствует (EPUB 2 формат, Литрес требует EPUB 2.0.1)
- **linear="no"**: только для cover в fb2converter, больше нигде не используется
- **Литрес watermark**: НЕТ отдельной XHTML страницы — социальная DRM на уровне символов
- **Типичные сервисные страницы**: обложка, аннотация, иногда copyright
- **Специфика Эксмо/АСТ** (серия Ведьмак): "Общая информация", "Цитаты" — нестандартные

---

## Соглашения проекта

```bash
cd frontend && npm test          # Frontend tests
cd backend && pytest -v          # Backend tests
docker compose up -d             # НЕ docker-compose (без дефиса)!
```

- Commits: `<type>(<scope>): <subject>` — feat, fix, refactor, test, chore
- Python: type hints обязательны, Pydantic validation
- TypeScript: functional components, TanStack Query, no direct fetch()
- Всегда запускай тесты перед завершением задачи
