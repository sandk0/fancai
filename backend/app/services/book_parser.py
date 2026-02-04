"""
Профессиональный парсер книг EPUB и FB2 для fancai.

Использует встроенный Table of Contents (TOC) для надёжного определения структуры книги.
"""

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import aiofiles
from bs4 import BeautifulSoup

# Библиотеки для парсинга
try:
    import ebooklib
    from ebooklib import epub

    EBOOKLIB_AVAILABLE = True
except ImportError:
    EBOOKLIB_AVAILABLE = False

try:
    from lxml import etree, html  # noqa: F401

    LXML_AVAILABLE = True
except ImportError:
    LXML_AVAILABLE = False


logger = logging.getLogger(__name__)


# ============================================================================
# DATA MODELS
# ============================================================================


@dataclass
class BookMetadata:
    """Метаданные книги."""

    title: str
    author: str = ""
    language: str = "ru"
    genre: str = "other"
    description: str = ""
    isbn: str = ""
    publisher: str = ""
    publish_date: str = ""
    cover_image_data: Optional[bytes] = None
    cover_image_type: str = ""


@dataclass
class BookChapter:
    """Глава книги."""

    number: int
    title: str
    content: str
    html_content: str = ""
    word_count: int = 0
    file_path: str = ""  # Internal EPUB path (href) for exact mapping

    def __post_init__(self):
        """Автоматический подсчёт слов если не указан."""
        if self.word_count == 0 and self.content:
            self.word_count = len(self.content.split())


@dataclass
class ParsedBook:
    """Результат парсинга книги."""

    metadata: BookMetadata
    chapters: List[BookChapter]
    total_pages: int = 0
    estimated_reading_time: int = 0  # в минутах
    file_format: str = ""

    def __post_init__(self):
        """Автоматический расчёт статистики."""
        if not self.total_pages or not self.estimated_reading_time:
            total_words = sum(ch.word_count for ch in self.chapters)
            if not self.estimated_reading_time:
                self.estimated_reading_time = max(1, total_words // 200)  # 200 WPM
            if not self.total_pages:
                self.total_pages = max(1, total_words // 250)  # 250 слов/страницу


@dataclass
class ParserConfig:
    """Конфигурация парсера."""

    # Минимальная длина контента главы (символов)
    min_chapter_length: int = 100

    # Минимальная длина контента для анализа (символов)
    min_content_length_for_analysis: int = 500

    # Максимальный размер файла (байт)
    max_file_size: int = 50 * 1024 * 1024  # 50MB

    # Минимальный размер файла (байт)
    min_file_size: int = 1024  # 1KB

    # Скорость чтения (слов в минуту)
    reading_speed_wpm: int = 200

    # Слов на страницу
    words_per_page: int = 250

    # Использовать TOC если доступен
    prefer_toc: bool = True

    # Паттерны для определения номера главы
    chapter_patterns: List[str] = field(
        default_factory=lambda: [
            r"глава\s+(\d+)",  # Глава 1
            r"chapter\s+(\d+)",  # Chapter 1
            r"глава\s+([ivxlcdm]+)",  # Глава III (римские)
        ]
    )

    # Текстовые номера глав (русский)
    text_number_map: Dict[str, int] = field(
        default_factory=lambda: {
            "первая": 1,
            "вторая": 2,
            "третья": 3,
            "четвертая": 4,
            "четвёртая": 4,
            "пятая": 5,
            "шестая": 6,
            "седьмая": 7,
            "восьмая": 8,
            "девятая": 9,
            "десятая": 10,
            "одиннадцатая": 11,
            "двенадцатая": 12,
            "тринадцатая": 13,
            "четырнадцатая": 14,
            "пятнадцатая": 15,
            "шестнадцатая": 16,
            "семнадцатая": 17,
            "восемнадцатая": 18,
            "девятнадцатая": 19,
            "двадцатая": 20,
            "one": 1,
            "two": 2,
            "three": 3,
            "four": 4,
            "five": 5,
            "six": 6,
            "seven": 7,
            "eight": 8,
            "nine": 9,
            "ten": 10,
        }
    )


# ============================================================================
# CHAPTER NUMBER EXTRACTOR
# ============================================================================


class ChapterNumberExtractor:
    """Извлекает номера глав из текста."""

    def __init__(self, config: ParserConfig):
        self.config = config

    def extract(self, text: str, title: str = "") -> Optional[int]:
        """
        Извлекает номер главы из текста или заголовка.

        Примеры:
            "Глава 1" -> 1
            "Глава первая" -> 1
            "Chapter III" -> 3
        """
        search_text = (title + " " + text[:500]).lower()

        # Пробуем паттерны по порядку
        for pattern in self.config.chapter_patterns:
            match = re.search(pattern, search_text)
            if match:
                number_str = match.group(1)
                # Проверяем римские цифры
                if re.match(r"^[ivxlcdm]+$", number_str):
                    return self._roman_to_int(number_str)
                # Иначе арабские
                try:
                    return int(number_str)
                except ValueError:
                    continue

        # Пробуем текстовые номера
        for text_num, num in self.config.text_number_map.items():
            if (
                f"глава {text_num}" in search_text
                or f"chapter {text_num}" in search_text
            ):
                return num

        return None

    @staticmethod
    def _roman_to_int(roman: str) -> int:
        """Конвертирует римские цифры в арабские."""
        roman_values = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
        result = 0
        prev_value = 0

        for char in reversed(roman.lower()):
            value = roman_values.get(char, 0)
            if value < prev_value:
                result -= value
            else:
                result += value
            prev_value = value

        return result


# ============================================================================
# EPUB PARSER
# ============================================================================


class EPUBParser:
    """Парсер EPUB файлов с использованием TOC."""

    def __init__(self, config: ParserConfig):
        self.config = config
        self.chapter_extractor = ChapterNumberExtractor(config)

    def parse(self, file_path: str) -> ParsedBook:
        """Парсит EPUB файл."""
        if not EBOOKLIB_AVAILABLE:
            raise ImportError("ebooklib is required for EPUB parsing")

        try:
            book = epub.read_epub(file_path)

            metadata = self._extract_metadata(book)
            chapters = self._extract_chapters(book)

            return ParsedBook(metadata=metadata, chapters=chapters, file_format="epub")

        except Exception as e:
            logger.error(f"Error parsing EPUB: {e}", exc_info=True)
            raise Exception(f"Error parsing EPUB file: {str(e)}")

    def _extract_metadata(self, book) -> BookMetadata:
        """Извлекает метаданные из EPUB."""
        metadata = BookMetadata(title="Unknown")

        try:
            # Заголовок
            title = book.get_metadata("DC", "title")
            if title:
                metadata.title = title[0][0]

            # Автор
            creators = book.get_metadata("DC", "creator")
            if creators:
                metadata.author = creators[0][0]

            # Язык
            languages = book.get_metadata("DC", "language")
            if languages:
                metadata.language = languages[0][0]

            # Описание
            descriptions = book.get_metadata("DC", "description")
            if descriptions:
                metadata.description = descriptions[0][0]

            # Жанр (Genre)
            # Пробуем извлечь из dc:subject (основной источник)
            subjects = book.get_metadata("DC", "subject")
            if subjects:
                metadata.genre = subjects[0][0]

            # Fallback: пробуем dc:type если subject не найден
            if not metadata.genre or metadata.genre == "other":
                types = book.get_metadata("DC", "type")
                if types:
                    metadata.genre = types[0][0]

            # Fallback 2: эвристика по ключевым словам (если метаданных нет)
            if not metadata.genre or metadata.genre == "other":
                metadata.genre = self._guess_genre_from_text(
                    title=metadata.title or "",
                    description=metadata.description or "",
                    author=metadata.author or "",
                )

            # ISBN
            identifiers = book.get_metadata("DC", "identifier")
            for identifier in identifiers:
                if "isbn" in str(identifier[1]).lower():
                    metadata.isbn = identifier[0]
                    break

            # Издатель
            publishers = book.get_metadata("DC", "publisher")
            if publishers:
                metadata.publisher = publishers[0][0]

            # Дата публикации
            dates = book.get_metadata("DC", "date")
            if dates:
                metadata.publish_date = dates[0][0]

            # Обложка
            self._extract_cover(book, metadata)

        except Exception as e:
            logger.warning(f"Error extracting EPUB metadata: {e}")

        return metadata

    def _extract_cover(self, book, metadata: BookMetadata):
        """Извлекает обложку книги."""
        # Пробуем найти по типу ITEM_COVER
        for item in book.get_items():
            if item.get_type() == ebooklib.ITEM_COVER:
                metadata.cover_image_data = item.get_content()
                metadata.cover_image_type = item.media_type
                return

        # Ищем по имени среди изображений
        for item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
            name = item.get_name().lower()
            if "cover" in name:
                metadata.cover_image_data = item.get_content()
                metadata.cover_image_type = item.media_type or "image/jpeg"
                return

        # Берём первое изображение
        images = list(book.get_items_of_type(ebooklib.ITEM_IMAGE))
        if images:
            metadata.cover_image_data = images[0].get_content()
            metadata.cover_image_type = images[0].media_type or "image/jpeg"

    def _guess_genre_from_text(self, title: str, description: str, author: str) -> str:
        """
        Определяет жанр книги по ключевым словам в названии, описании и авторе.

        Args:
            title: Название книги
            description: Описание книги
            author: Автор книги

        Returns:
            Предполагаемый жанр или "other" если не удалось определить
        """
        # Объединяем весь текст для анализа
        text = f"{title} {description} {author}".lower()

        # Словарь ключевых слов для каждого жанра (русский + английский)
        genre_keywords = {
            "fantasy": [
                "фантаз",
                "fantasy",
                "магия",
                "magic",
                "волшебн",
                "ведьмак",
                "witcher",
                "дракон",
                "dragon",
                "эльф",
                "elf",
                "гном",
                "dwarf",
                "орк",
                "orc",
                "маг",
                "wizard",
                "колдун",
                "sorcerer",
                "заклинание",
                "spell",
            ],
            "science_fiction": [
                "фантасти",
                "science fiction",
                "sci-fi",
                "космос",
                "space",
                "робот",
                "robot",
                "киберпанк",
                "cyberpunk",
                "будущее",
                "future",
                "звезд",
                "star",
                "галактик",
                "galactic",
                "андроид",
                "android",
                "космическ",
                "cosmic",
            ],
            "detective": [
                "детектив",
                "detective",
                "расследован",
                "investigation",
                "убийство",
                "murder",
                "преступлен",
                "crime",
                "полиц",
                "police",
                "инспектор",
                "inspector",
                "тайна",
                "mystery",
                "загадк",
                "puzzle",
                "следствие",
                "inquiry",
            ],
            "romance": [
                "роман",
                "romance",
                "любов",
                "love",
                "страст",
                "passion",
                "сердце",
                "heart",
                "чувств",
                "feeling",
                "отношен",
                "relationship",
                "свадьб",
                "wedding",
            ],
            "thriller": [
                "триллер",
                "thriller",
                "саспенс",
                "suspense",
                "напряжен",
                "tension",
                "опасност",
                "danger",
                "погон",
                "chase",
                "шпион",
                "spy",
            ],
            "horror": [
                "ужас",
                "horror",
                "страх",
                "fear",
                "кошмар",
                "nightmare",
                "монстр",
                "monster",
                "вампир",
                "vampire",
                "зомби",
                "zombie",
                "призрак",
                "ghost",
            ],
            "historical": [
                "истори",
                "historical",
                "век",
                "century",
                "война",
                "war",
                "империя",
                "empire",
                "королев",
                "king",
                "царь",
                "tsar",
                "рыцар",
                "knight",
            ],
            "adventure": [
                "приключен",
                "adventure",
                "путешеств",
                "journey",
                "поход",
                "expedition",
                "остров",
                "island",
                "сокровищ",
                "treasure",
                "пират",
                "pirate",
            ],
        }

        # Подсчитываем совпадения для каждого жанра
        genre_scores = {}
        for genre, keywords in genre_keywords.items():
            score = sum(1 for keyword in keywords if keyword in text)
            if score > 0:
                genre_scores[genre] = score

        # Возвращаем жанр с максимальным score
        if genre_scores:
            best_genre = max(genre_scores, key=genre_scores.get)
            logger.info(
                f"Detected genre '{best_genre}' from text analysis (score: {genre_scores[best_genre]})"
            )
            return best_genre

        # Если ничего не нашли - возвращаем "other"
        logger.info("Could not detect genre from text, defaulting to 'other'")
        return "other"

    def _extract_chapters(self, book) -> List[BookChapter]:
        """
        Извлекает главы из EPUB.

        СТРАТЕГИЯ:
        1. Пробуем использовать TOC (Table of Contents) - самый надёжный способ
        2. Если TOC пустой - используем spine с умной эвристикой
        """
        chapters = []

        # Стратегия 1: Используем TOC
        if self.config.prefer_toc:
            chapters = self._extract_chapters_from_toc(book)
            if chapters:
                logger.info(f"✅ Extracted {len(chapters)} chapters from TOC")
                return chapters
            logger.info("📋 TOC is empty or invalid, falling back to spine analysis")

        # Стратегия 2: Анализируем spine
        chapters = self._extract_chapters_from_spine(book)
        logger.info(f"✅ Extracted {len(chapters)} chapters from spine")

        return chapters

    def _extract_chapters_from_toc(self, book) -> List[BookChapter]:
        """Извлекает главы используя встроенный TOC."""
        chapters = []

        try:
            toc = book.toc
            if not toc:
                return []

            # TOC может быть вложенным, обходим рекурсивно
            flat_toc = self._flatten_toc(toc)

            logger.info(f"📚 Found {len(flat_toc)} items in TOC")

            for idx, (link, title) in enumerate(flat_toc, start=1):
                try:
                    # Получаем контент по ссылке
                    content, html_content = self._get_content_by_link(book, link)

                    if not content or len(content) < self.config.min_chapter_length:
                        logger.debug(f"⏭️  Skipping short TOC item: {title}")
                        continue

                    # Пытаемся извлечь номер главы
                    chapter_num = self.chapter_extractor.extract(content, title)

                    # Если номер не найден, это НЕ глава - пропускаем
                    if chapter_num is None:
                        logger.debug(f"⏭️  Skipping non-chapter TOC item: {title}")
                        continue

                    chapter = BookChapter(
                        number=chapter_num,
                        title=title,
                        content=content,
                        html_content=html_content,
                        file_path=link.split("#")[0],  # Store internal href
                    )

                    chapters.append(chapter)
                    logger.debug(f"✅ Chapter {chapter_num}: {title[:50]}")

                except Exception as e:
                    logger.warning(f"⚠️  Error processing TOC item {title}: {e}")
                    continue

            # Сортируем по номерам
            chapters.sort(key=lambda ch: ch.number)

        except Exception as e:
            logger.error(f"❌ Error extracting chapters from TOC: {e}")
            return []

        return chapters

    def _flatten_toc(self, toc, depth=0) -> List[Tuple[str, str]]:
        """Рекурсивно обходит вложенный TOC и возвращает плоский список."""
        flat = []

        for item in toc:
            if isinstance(item, tuple):
                # Это (Section, Title) или (Link, Title)
                if hasattr(item[0], "href"):
                    # ebooklib.Link
                    flat.append((item[0].href, item[1]))
                elif isinstance(item[0], list):
                    # Вложенная секция
                    flat.extend(self._flatten_toc(item[0], depth + 1))
            elif isinstance(item, list):
                # Вложенный список
                flat.extend(self._flatten_toc(item, depth + 1))
            elif hasattr(item, "href"):
                # ebooklib.Link
                flat.append((item.href, getattr(item, "title", "Untitled")))

        return flat

    def _get_content_by_link(self, book, link: str) -> Tuple[str, str]:
        """Получает контент по ссылке из TOC."""
        # Убираем якорь из ссылки
        file_name = link.split("#")[0]

        # Ищем item по имени файла
        for item in book.get_items():
            if item.get_name() == file_name or item.get_name().endswith(file_name):
                return self._extract_text_from_item(item)

        return "", ""

    def _extract_chapters_from_spine(self, book) -> List[BookChapter]:
        """Извлекает главы из spine с умной фильтрацией."""
        chapters: List[BookChapter] = []

        try:
            spine = book.spine
            logger.info(f"📚 EPUB spine has {len(spine)} items")

            for spine_index, spine_item in enumerate(spine):
                try:
                    item_id = spine_item[0]
                    item = book.get_item_with_id(item_id)

                    if not item or item.get_type() != ebooklib.ITEM_DOCUMENT:
                        continue

                    text_content, html_content = self._extract_text_from_item(item)

                    # Пропускаем короткий контент
                    if len(text_content) < self.config.min_chapter_length:
                        logger.debug(f"⏭️  Skipping short content: {item.get_name()}")
                        continue

                    # Извлекаем заголовок
                    title = self._extract_title_from_html(html_content)
                    if not title:
                        title = text_content.split("\n")[0].strip()[:100]

                    # Извлекаем номер главы
                    chapter_num = self.chapter_extractor.extract(text_content, title)

                    # Если номер не найден, вероятно это не глава
                    if chapter_num is None:
                        # Проверяем эвристику: достаточно ли длинный контент?
                        if (
                            len(text_content)
                            < self.config.min_content_length_for_analysis
                        ):
                            logger.debug(f"⏭️  Skipping non-chapter: {title[:50]}")
                            continue
                        # Используем порядковый номер
                        chapter_num = len(chapters) + 1

                    chapter = BookChapter(
                        number=chapter_num,
                        title=title,
                        content=text_content,
                        html_content=html_content,
                        file_path=item.get_name(),  # Store internal href
                    )

                    chapters.append(chapter)
                    logger.debug(f"✅ Chapter {chapter_num}: {title[:50]}")

                except Exception as e:
                    logger.warning(f"⚠️  Error processing spine item: {e}")
                    continue

            # Сортируем по номерам
            chapters.sort(key=lambda ch: ch.number)

        except Exception as e:
            logger.error(f"❌ Error extracting chapters from spine: {e}")

        return chapters

    def _extract_text_from_item(self, item) -> Tuple[str, str]:
        """Извлекает текст и HTML из item."""
        try:
            content = item.get_content().decode("utf-8", errors="ignore")
            soup = BeautifulSoup(content, "html.parser")

            # Удаляем скрипты и стили
            for tag in soup(["script", "style"]):
                tag.decompose()

            # Получаем чистый текст
            text_content = soup.get_text()
            text_content = re.sub(r"\s+", " ", text_content).strip()

            return text_content, content

        except Exception as e:
            logger.warning(f"Error extracting text from item: {e}")
            return "", ""

    def _extract_title_from_html(self, html_content: str) -> str:
        """Извлекает заголовок из HTML."""
        try:
            soup = BeautifulSoup(html_content, "html.parser")
            for tag in ["h1", "h2", "h3", "title"]:
                title_tag = soup.find(tag)
                if title_tag:
                    title = title_tag.get_text().strip()
                    if title:
                        return title
        except Exception as e:
            logger.warning(f"Error extracting chapter title: {e}")
        return ""


# ============================================================================
# FB2 PARSER
# ============================================================================


class FB2Parser:
    """Парсер FB2 файлов."""

    def __init__(self, config: ParserConfig):
        self.config = config
        self.namespaces = {"fb": "http://www.gribuser.ru/xml/fictionbook/2.0"}

    async def parse(self, file_path: str) -> ParsedBook:
        """Парсит FB2 файл."""
        if not LXML_AVAILABLE:
            raise ImportError("lxml is required for FB2 parsing")

        try:
            # Читаем FB2 файл (async to avoid blocking event loop)
            async with aiofiles.open(file_path, "rb") as f:
                content = await f.read()

            # Парсим XML
            try:
                root = etree.fromstring(content)
            except etree.XMLSyntaxError:
                # Пробуем исправить некорректный XML
                content_str = content.decode("utf-8", errors="ignore")
                content_str = re.sub(r"<\?xml[^>]*\?>", "", content_str)
                root = etree.fromstring(content_str.encode("utf-8"))

            metadata = self._extract_metadata(root)
            chapters = self._extract_chapters(root)

            return ParsedBook(metadata=metadata, chapters=chapters, file_format="fb2")

        except Exception as e:
            logger.error(f"Error parsing FB2: {e}", exc_info=True)
            raise Exception(f"Error parsing FB2 file: {str(e)}")

    def _extract_metadata(self, root) -> BookMetadata:
        """Извлекает метаданные из FB2."""
        metadata = BookMetadata(title="Unknown")

        try:
            # Заголовок
            title_elem = root.find(".//fb:book-title", self.namespaces)
            if title_elem is not None and title_elem.text:
                metadata.title = title_elem.text.strip()

            # Автор
            author_elems = root.findall(".//fb:author", self.namespaces)
            if author_elems:
                author_parts = []
                for author in author_elems[:1]:
                    first_name = author.find(".//fb:first-name", self.namespaces)
                    last_name = author.find(".//fb:last-name", self.namespaces)
                    middle_name = author.find(".//fb:middle-name", self.namespaces)

                    if first_name is not None and first_name.text:
                        author_parts.append(first_name.text.strip())
                    if middle_name is not None and middle_name.text:
                        author_parts.append(middle_name.text.strip())
                    if last_name is not None and last_name.text:
                        author_parts.append(last_name.text.strip())

                if author_parts:
                    metadata.author = " ".join(author_parts)

            # Жанр
            genre_elem = root.find(".//fb:genre", self.namespaces)
            if genre_elem is not None and genre_elem.text:
                metadata.genre = genre_elem.text.strip()

            # Язык
            lang_elem = root.find(".//fb:lang", self.namespaces)
            if lang_elem is not None and lang_elem.text:
                metadata.language = lang_elem.text.strip()

            # Описание
            annotation_elem = root.find(".//fb:annotation", self.namespaces)
            if annotation_elem is not None:
                paragraphs = annotation_elem.findall(".//fb:p", self.namespaces)
                if paragraphs:
                    description_parts = [p.text.strip() for p in paragraphs if p.text]
                    metadata.description = " ".join(description_parts)

            # Дата публикации
            date_elem = root.find(".//fb:date", self.namespaces)
            if date_elem is not None and date_elem.text:
                metadata.publish_date = date_elem.text.strip()

        except Exception as e:
            logger.warning(f"Error extracting FB2 metadata: {e}")

        return metadata

    def _extract_chapters(self, root) -> List[BookChapter]:
        """Извлекает главы из FB2."""
        chapters = []

        try:
            sections = root.findall(".//fb:section", self.namespaces)

            chapter_number = 1
            for section in sections:
                # Извлекаем заголовок
                title = ""
                title_elem = section.find(".//fb:title", self.namespaces)
                if title_elem is not None:
                    title_parts = [
                        p.text.strip()
                        for p in title_elem.findall(".//fb:p", self.namespaces)
                        if p.text
                    ]
                    if title_parts:
                        title = " ".join(title_parts)

                if not title:
                    title = f"Глава {chapter_number}"

                # Извлекаем содержимое
                content_parts = []
                paragraphs = section.findall(".//fb:p", self.namespaces)

                for p in paragraphs:
                    # Пропускаем параграфы из заголовков
                    if p.getparent().tag.endswith("title"):
                        continue
                    if p.text:
                        content_parts.append(p.text.strip())

                content = " ".join(content_parts)
                content = re.sub(r"\s+", " ", content).strip()

                # Пропускаем слишком короткие секции
                if len(content) < self.config.min_chapter_length:
                    continue

                chapter = BookChapter(
                    number=chapter_number, title=title, content=content, html_content=""
                )

                chapters.append(chapter)
                chapter_number += 1

        except Exception as e:
            logger.warning(f"Error extracting FB2 chapters: {e}")

        return chapters


# ============================================================================
# MAIN BOOK PARSER
# ============================================================================


class BookParser:
    """Главный класс для парсинга книг."""

    def __init__(self, config: Optional[ParserConfig] = None):
        """Инициализация парсера."""
        self.config = config or ParserConfig()

        self.supported_formats = []
        if EBOOKLIB_AVAILABLE:
            self.supported_formats.append("epub")
        if LXML_AVAILABLE:
            self.supported_formats.append("fb2")

        self.epub_parser = EPUBParser(self.config) if EBOOKLIB_AVAILABLE else None
        self.fb2_parser = FB2Parser(self.config) if LXML_AVAILABLE else None

    def is_format_supported(self, file_format: str) -> bool:
        """Проверяет поддержку формата."""
        return file_format.lower() in self.supported_formats

    def get_supported_formats(self) -> List[str]:
        """Возвращает список поддерживаемых форматов."""
        return self.supported_formats.copy()

    async def detect_format(self, file_path: str) -> str:
        """Определяет формат файла книги."""
        path_obj = Path(file_path)
        extension = path_obj.suffix.lower()

        if extension == ".epub":
            return "epub"
        elif extension == ".fb2":
            return "fb2"
        elif extension == ".xml":
            # Проверяем, не является ли XML файлом FB2
            try:
                async with aiofiles.open(file_path, "rb") as f:
                    content = await f.read(1000)
                    if b"FictionBook" in content:
                        return "fb2"
            except (OSError, IOError) as e:
                logger.warning(f"Error reading file for format detection: {e}")

        return "unknown"

    async def parse_book(self, file_path: str) -> ParsedBook:
        """
        Парсит книгу и извлекает её содержимое.

        Args:
            file_path: Путь к файлу книги

        Returns:
            Объект ParsedBook с содержимым книги

        Raises:
            ValueError: Если формат не поддерживается
            Exception: При ошибках парсинга
        """
        file_format = await self.detect_format(file_path)

        if file_format == "epub":
            if not self.epub_parser:
                raise ImportError("ebooklib is required for EPUB parsing")
            # EPUBParser.parse is synchronous (uses ebooklib which is sync)
            return self.epub_parser.parse(file_path)

        elif file_format == "fb2":
            if not self.fb2_parser:
                raise ImportError("lxml is required for FB2 parsing")
            return await self.fb2_parser.parse(file_path)

        else:
            raise ValueError(f"Unsupported book format: {file_format}")

    async def validate_book_file(self, file_path: str) -> Dict[str, Any]:
        """
        Валидирует файл книги.

        Args:
            file_path: Путь к файлу

        Returns:
            Словарь с результатами валидации
        """
        result = {
            "is_valid": False,
            "format": "unknown",
            "error": None,
            "file_size": 0,
            "estimated_chapters": 0,
        }

        try:
            if not os.path.exists(file_path):
                result["error"] = "File not found"
                return result

            file_size = os.path.getsize(file_path)
            result["file_size"] = file_size

            # Проверяем размер файла
            if file_size > self.config.max_file_size:
                result["error"] = (
                    f"File too large (max {self.config.max_file_size // (1024 * 1024)}MB)"
                )
                return result

            if file_size < self.config.min_file_size:
                result["error"] = "File too small"
                return result

            file_format = await self.detect_format(file_path)
            result["format"] = file_format

            if not self.is_format_supported(file_format):
                result["error"] = f"Unsupported format: {file_format}"
                return result

            # Пробуем парсить для проверки валидности
            try:
                parsed_book = await self.parse_book(file_path)
                result["is_valid"] = True
                result["estimated_chapters"] = len(parsed_book.chapters)
            except Exception as e:
                result["error"] = f"Parse error: {str(e)}"
                return result

        except Exception as e:
            result["error"] = f"Validation error: {str(e)}"

        return result


# Глобальный экземпляр парсера
book_parser = BookParser()
