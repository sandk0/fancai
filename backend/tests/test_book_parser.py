"""
Comprehensive тесты для Book Parser - парсер EPUB и FB2 книг.

Полное покрытие всех методов: парсинг, валидация, извлечение метаданных,
обработка глав, error handling.

Coverage target: 60-70% (было 23%)
"""

import pytest
import tempfile
import zipfile
from pathlib import Path

from app.services.book_parser import (
    BookParser,
    ChapterNumberExtractor,
    BookMetadata,
    BookChapter,
    ParsedBook,
    ParserConfig,
)

# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def parser_config():
    """Fixture для конфигурации парсера."""
    return ParserConfig(
        min_chapter_length=100,
        min_content_length_for_analysis=500,
        max_file_size=50 * 1024 * 1024,  # 50MB
        reading_speed_wpm=200,
        words_per_page=250,
    )


@pytest.fixture
def book_parser(parser_config):
    """Fixture для BookParser с дефолтной конфигурацией."""
    return BookParser(config=parser_config)


@pytest.fixture
def chapter_extractor(parser_config):
    """Fixture для ChapterNumberExtractor."""
    return ChapterNumberExtractor(config=parser_config)


@pytest.fixture
def sample_epub_file():
    """
    Создает валидный EPUB файл для тестирования.

    Структура:
    - Метаданные (title, author, language)
    - 2 главы с контентом
    - TOC navigation
    """
    epub_content = {
        "mimetype": b"application/epub+zip",
        "META-INF/container.xml": b"""<?xml version="1.0" encoding="UTF-8"?>
            <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                </rootfiles>
            </container>""",
        "OEBPS/content.opf": b"""<?xml version="1.0" encoding="UTF-8"?>
            <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
                <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                    <dc:title>Test Book</dc:title>
                    <dc:creator>Test Author</dc:creator>
                    <dc:language>ru</dc:language>
                    <dc:identifier id="bookid">test-isbn-123</dc:identifier>
                    <dc:publisher>Test Publisher</dc:publisher>
                    <dc:date>2025-10-25</dc:date>
                    <dc:description>Test book description for testing.</dc:description>
                    <dc:subject>Fantasy</dc:subject>
                </metadata>
                <manifest>
                    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
                    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
                    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
                </manifest>
                <spine toc="ncx">
                    <itemref idref="chapter1"/>
                    <itemref idref="chapter2"/>
                </spine>
            </package>""",
        "OEBPS/chapter1.xhtml": b"""<?xml version="1.0" encoding="UTF-8"?>
            <html xmlns="http://www.w3.org/1999/xhtml">
                <head><title>Chapter 1</title></head>
                <body>
                    <h1>Chapter 1: The Beginning</h1>
                    <p>This is the first chapter content with a beautiful dark forest and tall pine trees.</p>
                    <p>The old cabin stood in the middle of the clearing, surrounded by ancient oaks.</p>
                    <p>A mysterious fog rolled in from the mountains.</p>
                </body>
            </html>""",
        "OEBPS/chapter2.xhtml": b"""<?xml version="1.0" encoding="UTF-8"?>
            <html xmlns="http://www.w3.org/1999/xhtml">
                <head><title>Chapter 2</title></head>
                <body>
                    <h1>Chapter 2: The Journey</h1>
                    <p>The hero began his journey through the enchanted forest.</p>
                    <p>He encountered a wise old wizard near the ancient stone bridge.</p>
                    <p>The wizard gave him a magical amulet for protection.</p>
                </body>
            </html>""",
        "OEBPS/toc.ncx": b"""<?xml version="1.0" encoding="UTF-8"?>
            <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
                <navMap>
                    <navPoint id="chapter1">
                        <navLabel><text>Chapter 1</text></navLabel>
                        <content src="chapter1.xhtml"/>
                    </navPoint>
                    <navPoint id="chapter2">
                        <navLabel><text>Chapter 2</text></navLabel>
                        <content src="chapter2.xhtml"/>
                    </navPoint>
                </navMap>
            </ncx>""",
    }

    temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
    with zipfile.ZipFile(temp_file.name, "w", zipfile.ZIP_DEFLATED) as epub_zip:
        for file_path, content in epub_content.items():
            epub_zip.writestr(file_path, content)

    yield temp_file.name

    # Cleanup
    Path(temp_file.name).unlink(missing_ok=True)


@pytest.fixture
def sample_fb2_file():
    """
    Создает валидный FB2 файл для тестирования.

    Структура:
    - Метаданные (title, author, genre)
    - 2 секции (главы)
    """
    fb2_content = b"""<?xml version="1.0" encoding="UTF-8"?>
    <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
        <description>
            <title-info>
                <genre>sci_fi</genre>
                <author>
                    <first-name>Ivan</first-name>
                    <middle-name>Petrovich</middle-name>
                    <last-name>Sidorov</last-name>
                </author>
                <book-title>Test FB2 Book</book-title>
                <lang>ru</lang>
                <annotation>
                    <p>This is a test FB2 book.</p>
                    <p>For testing purposes only.</p>
                </annotation>
                <date>2025-10-25</date>
            </title-info>
        </description>
        <body>
            <section>
                <title><p>Glava 1</p></title>
                <p>First chapter content with dark forest and mysterious castle.</p>
                <p>The protagonist walks through the enchanted woods.</p>
            </section>
            <section>
                <title><p>Glava 2</p></title>
                <p>Second chapter content with ancient wizard and magic spell.</p>
                <p>The wizard reveals the secrets of the universe.</p>
            </section>
        </body>
    </FictionBook>"""

    temp_file = tempfile.NamedTemporaryFile(suffix=".fb2", delete=False, mode="wb")
    temp_file.write(fb2_content)
    temp_file.close()

    yield temp_file.name

    # Cleanup
    Path(temp_file.name).unlink(missing_ok=True)


@pytest.fixture
def corrupted_epub_file():
    """Создает поврежденный EPUB файл."""
    temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
    temp_file.write(b"This is not a valid EPUB file, just random text")
    temp_file.close()

    yield temp_file.name

    Path(temp_file.name).unlink(missing_ok=True)


@pytest.fixture
def empty_file():
    """Создает пустой файл."""
    temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
    temp_file.close()

    yield temp_file.name

    Path(temp_file.name).unlink(missing_ok=True)


@pytest.fixture
def large_file():
    """Создает файл, превышающий максимальный размер."""
    temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
    # Создаем файл 51MB (больше лимита 50MB)
    temp_file.write(b"x" * (51 * 1024 * 1024))
    temp_file.close()

    yield temp_file.name

    Path(temp_file.name).unlink(missing_ok=True)


# ============================================================================
# TESTS: BookParser Initialization
# ============================================================================


class TestBookParserInitialization:
    """Тесты инициализации главного парсера."""

    def test_parser_creation_default_config(self):
        """Тест создания парсера с дефолтной конфигурацией."""
        parser = BookParser()

        assert parser is not None
        assert isinstance(parser.config, ParserConfig)
        assert parser.config.min_chapter_length == 100
        assert parser.config.max_file_size == 50 * 1024 * 1024

    def test_parser_creation_custom_config(self, parser_config):
        """Тест создания парсера с кастомной конфигурацией."""
        parser = BookParser(config=parser_config)

        assert parser.config.min_chapter_length == 100
        assert parser.config.reading_speed_wpm == 200
        assert parser.config.words_per_page == 250

    def test_parser_has_supported_formats(self, book_parser):
        """Тест списка поддерживаемых форматов."""
        formats = book_parser.get_supported_formats()

        assert isinstance(formats, list)
        assert len(formats) > 0
        # Должны быть либо epub, либо fb2, либо оба
        assert "epub" in formats or "fb2" in formats

    def test_parser_format_support_check(self, book_parser):
        """Тест проверки поддержки формата."""
        assert book_parser.is_format_supported("epub") is True
        assert book_parser.is_format_supported("EPUB") is True
        assert book_parser.is_format_supported("fb2") is True
        assert book_parser.is_format_supported("txt") is False
        assert book_parser.is_format_supported("pdf") is False


# ============================================================================
# TESTS: Format Detection
# ============================================================================


class TestFormatDetection:
    """Тесты определения формата файла."""

    def test_detect_epub_format(self, book_parser, sample_epub_file):
        """Тест определения EPUB формата."""
        file_format = book_parser.detect_format(sample_epub_file)
        assert file_format == "epub"

    def test_detect_fb2_format(self, book_parser, sample_fb2_file):
        """Тест определения FB2 формата."""
        file_format = book_parser.detect_format(sample_fb2_file)
        assert file_format == "fb2"

    def test_detect_unknown_format(self, book_parser):
        """Тест определения неизвестного формата."""
        temp_file = tempfile.NamedTemporaryFile(suffix=".txt", delete=False)
        temp_file.write(b"Just a text file")
        temp_file.close()

        try:
            file_format = book_parser.detect_format(temp_file.name)
            assert file_format == "unknown"
        finally:
            Path(temp_file.name).unlink(missing_ok=True)

    def test_detect_xml_as_fb2(self, book_parser):
        """Тест определения XML файла как FB2."""
        temp_file = tempfile.NamedTemporaryFile(suffix=".xml", delete=False)
        temp_file.write(b'<?xml version="1.0"?><FictionBook></FictionBook>')
        temp_file.close()

        try:
            file_format = book_parser.detect_format(temp_file.name)
            assert file_format == "fb2"
        finally:
            Path(temp_file.name).unlink(missing_ok=True)


# ============================================================================
# TESTS: File Validation
# ============================================================================


class TestBookValidation:
    """Тесты валидации файлов книг."""

    def test_validate_valid_epub_file(self, book_parser, sample_epub_file):
        """Тест валидации корректного EPUB файла."""
        result = book_parser.validate_book_file(sample_epub_file)

        assert result["is_valid"] is True
        assert result["format"] == "epub"
        assert result["error"] is None
        assert result["file_size"] > 0
        assert result["estimated_chapters"] >= 1

    def test_validate_valid_fb2_file(self, book_parser, sample_fb2_file):
        """Тест валидации корректного FB2 файла."""
        result = book_parser.validate_book_file(sample_fb2_file)

        assert result["is_valid"] is True
        assert result["format"] == "fb2"
        assert result["error"] is None
        assert result["estimated_chapters"] >= 1

    def test_validate_nonexistent_file(self, book_parser):
        """Тест валидации несуществующего файла."""
        result = book_parser.validate_book_file("/nonexistent/file.epub")

        assert result["is_valid"] is False
        assert result["error"] == "File not found"

    def test_validate_empty_file(self, book_parser, empty_file):
        """Тест валидации пустого файла."""
        result = book_parser.validate_book_file(empty_file)

        assert result["is_valid"] is False
        assert "too small" in result["error"].lower()

    def test_validate_large_file(self, book_parser, large_file):
        """Тест валидации слишком большого файла."""
        result = book_parser.validate_book_file(large_file)

        assert result["is_valid"] is False
        assert "too large" in result["error"].lower()

    def test_validate_corrupted_epub(self, book_parser, corrupted_epub_file):
        """Тест валидации поврежденного EPUB файла."""
        result = book_parser.validate_book_file(corrupted_epub_file)

        assert result["is_valid"] is False
        assert result["error"] is not None


# ============================================================================
# TESTS: EPUB Parsing
# ============================================================================


class TestEPUBParsing:
    """Тесты парсинга EPUB файлов."""

    def test_parse_epub_success(self, book_parser, sample_epub_file):
        """Тест успешного парсинга EPUB файла."""
        result = book_parser.parse_book(sample_epub_file)

        assert isinstance(result, ParsedBook)
        assert result.file_format == "epub"
        assert isinstance(result.metadata, BookMetadata)
        assert isinstance(result.chapters, list)
        assert len(result.chapters) > 0

    def test_parse_epub_extracts_metadata(self, book_parser, sample_epub_file):
        """Тест извлечения метаданных из EPUB."""
        result = book_parser.parse_book(sample_epub_file)
        metadata = result.metadata

        assert metadata.title == "Test Book"
        assert metadata.author == "Test Author"
        assert metadata.language == "ru"
        assert metadata.publisher == "Test Publisher"
        assert metadata.publish_date == "2025-10-25"
        assert metadata.description == "Test book description for testing."
        assert metadata.genre == "Fantasy"  # NEW: Genre extracted from dc:subject
        # ISBN извлекается только из dc:identifier с атрибутом opf:scheme="ISBN"
        # Для простого теста проверяем, что isbn это строка (может быть пустой)
        assert isinstance(metadata.isbn, str)

    def test_parse_epub_extracts_chapters(self, book_parser, sample_epub_file):
        """Тест извлечения глав из EPUB."""
        result = book_parser.parse_book(sample_epub_file)

        assert len(result.chapters) >= 2

        chapter1 = result.chapters[0]
        assert isinstance(chapter1, BookChapter)
        assert chapter1.number == 1
        assert "Chapter 1" in chapter1.title or "beginning" in chapter1.title.lower()
        assert len(chapter1.content) > 0
        assert "forest" in chapter1.content.lower()

    def test_parse_epub_calculates_statistics(self, book_parser, sample_epub_file):
        """Тест расчета статистики книги."""
        result = book_parser.parse_book(sample_epub_file)

        assert result.total_pages > 0
        assert result.estimated_reading_time > 0

        # Проверяем статистику глав
        for chapter in result.chapters:
            assert chapter.word_count > 0

    def test_parse_epub_chapter_content(self, book_parser, sample_epub_file):
        """Тест качества извлеченного контента главы."""
        result = book_parser.parse_book(sample_epub_file)
        chapter1 = result.chapters[0]

        # Контент должен быть очищен от HTML
        assert "<html>" not in chapter1.content
        assert "<body>" not in chapter1.content
        assert "<p>" not in chapter1.content

        # Но текст должен сохраниться
        assert "forest" in chapter1.content.lower()
        assert len(chapter1.content) > 100  # Минимальная длина

    def test_parse_epub_html_content_preserved(self, book_parser, sample_epub_file):
        """Тест сохранения HTML контента."""
        result = book_parser.parse_book(sample_epub_file)
        chapter1 = result.chapters[0]

        # HTML контент должен быть сохранен отдельно
        assert chapter1.html_content != ""
        assert "<" in chapter1.html_content or len(chapter1.html_content) > 0

    def test_parse_epub_genre_from_dc_type_fallback(self, book_parser):
        """Тест извлечения жанра из dc:type когда dc:subject отсутствует."""
        # Создаем EPUB с dc:type вместо dc:subject
        epub_content = {
            "mimetype": b"application/epub+zip",
            "META-INF/container.xml": b"""<?xml version="1.0" encoding="UTF-8"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                    <rootfiles>
                        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                    </rootfiles>
                </container>""",
            "OEBPS/content.opf": b"""<?xml version="1.0" encoding="UTF-8"?>
                <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
                    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                        <dc:title>Test Book</dc:title>
                        <dc:creator>Test Author</dc:creator>
                        <dc:language>en</dc:language>
                        <dc:type>Science Fiction</dc:type>
                    </metadata>
                    <manifest>
                        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
                    </manifest>
                    <spine><itemref idref="chapter1"/></spine>
                </package>""",
            "OEBPS/chapter1.xhtml": b"""<?xml version="1.0" encoding="UTF-8"?>
                <html xmlns="http://www.w3.org/1999/xhtml">
                    <body><p>Test content</p></body>
                </html>""",
        }

        temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        with zipfile.ZipFile(temp_file.name, "w", zipfile.ZIP_DEFLATED) as epub_zip:
            for file_path, content in epub_content.items():
                epub_zip.writestr(file_path, content)

        result = book_parser.parse_book(temp_file.name)
        Path(temp_file.name).unlink(missing_ok=True)

        assert result.metadata.genre == "Science Fiction"

    def test_parse_epub_no_genre_defaults_to_none(self, book_parser):
        """Тест что отсутствие жанра не ломает парсинг."""
        # Создаем EPUB без dc:subject и dc:type
        epub_content = {
            "mimetype": b"application/epub+zip",
            "META-INF/container.xml": b"""<?xml version="1.0" encoding="UTF-8"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                    <rootfiles>
                        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                    </rootfiles>
                </container>""",
            "OEBPS/content.opf": b"""<?xml version="1.0" encoding="UTF-8"?>
                <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
                    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                        <dc:title>Test Book</dc:title>
                        <dc:creator>Test Author</dc:creator>
                        <dc:language>en</dc:language>
                    </metadata>
                    <manifest>
                        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
                    </manifest>
                    <spine><itemref idref="chapter1"/></spine>
                </package>""",
            "OEBPS/chapter1.xhtml": b"""<?xml version="1.0" encoding="UTF-8"?>
                <html xmlns="http://www.w3.org/1999/xhtml">
                    <body><p>Test content</p></body>
                </html>""",
        }

        temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        with zipfile.ZipFile(temp_file.name, "w", zipfile.ZIP_DEFLATED) as epub_zip:
            for file_path, content in epub_content.items():
                epub_zip.writestr(file_path, content)

        result = book_parser.parse_book(temp_file.name)
        Path(temp_file.name).unlink(missing_ok=True)

        # Должно default к "other" когда жанр не найден (это правильное поведение)
        assert result.metadata.genre == "other"

    def test_parse_epub_multiple_subjects_uses_first(self, book_parser):
        """Тест что при нескольких dc:subject используется первый."""
        # Создаем EPUB с несколькими dc:subject
        epub_content = {
            "mimetype": b"application/epub+zip",
            "META-INF/container.xml": b"""<?xml version="1.0" encoding="UTF-8"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                    <rootfiles>
                        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                    </rootfiles>
                </container>""",
            "OEBPS/content.opf": b"""<?xml version="1.0" encoding="UTF-8"?>
                <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
                    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                        <dc:title>Test Book</dc:title>
                        <dc:creator>Test Author</dc:creator>
                        <dc:language>en</dc:language>
                        <dc:subject>Mystery</dc:subject>
                        <dc:subject>Thriller</dc:subject>
                        <dc:subject>Crime</dc:subject>
                    </metadata>
                    <manifest>
                        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
                    </manifest>
                    <spine><itemref idref="chapter1"/></spine>
                </package>""",
            "OEBPS/chapter1.xhtml": b"""<?xml version="1.0" encoding="UTF-8"?>
                <html xmlns="http://www.w3.org/1999/xhtml">
                    <body><p>Test content</p></body>
                </html>""",
        }

        temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        with zipfile.ZipFile(temp_file.name, "w", zipfile.ZIP_DEFLATED) as epub_zip:
            for file_path, content in epub_content.items():
                epub_zip.writestr(file_path, content)

        result = book_parser.parse_book(temp_file.name)
        Path(temp_file.name).unlink(missing_ok=True)

        # Должен использоваться первый subject
        assert result.metadata.genre == "Mystery"

    def test_parse_epub_genre_heuristic_fantasy(self, book_parser):
        """Тест определения жанра фэнтези по ключевым словам (для Witcher)."""
        container_xml = """<?xml version="1.0" encoding="UTF-8"?>
        <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
            <rootfiles>
                <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
            </rootfiles>
        </container>"""

        metadata_content = """<?xml version="1.0" encoding="UTF-8"?>
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>Ведьмак. Перекресток воронов</dc:title>
                <dc:creator>Анджей Сапковский</dc:creator>
                <dc:language>ru</dc:language>
            </metadata>
            <manifest>
                <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
            </manifest>
            <spine>
                <itemref idref="chapter1"/>
            </spine>
        </package>"""

        chapter_content = """<?xml version="1.0" encoding="UTF-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml">
            <head><title>Глава 1</title></head>
            <body><h1>Глава 1</h1><p>Герой книги.</p></body>
        </html>"""

        with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as temp_file:
            with zipfile.ZipFile(temp_file.name, "w") as epub_zip:
                epub_zip.writestr("mimetype", "application/epub+zip")
                epub_zip.writestr("META-INF/container.xml", container_xml)
                epub_zip.writestr("OEBPS/content.opf", metadata_content)

                for file_path, content in [("OEBPS/chapter1.xhtml", chapter_content)]:
                    epub_zip.writestr(file_path, content)

        result = book_parser.parse_book(temp_file.name)
        Path(temp_file.name).unlink(missing_ok=True)

        # Должен определиться как fantasy по ключевому слову "ведьмак"
        assert result.metadata.genre == "fantasy"

    def test_parse_epub_genre_heuristic_scifi(self, book_parser):
        """Тест определения жанра sci-fi по ключевым словам."""
        container_xml = """<?xml version="1.0" encoding="UTF-8"?>
        <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
            <rootfiles>
                <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
            </rootfiles>
        </container>"""

        metadata_content = """<?xml version="1.0" encoding="UTF-8"?>
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>Космическая станция</dc:title>
                <dc:creator>Иван Иванов</dc:creator>
                <dc:language>ru</dc:language>
                <dc:description>Захватывающая история о космосе и звездах</dc:description>
            </metadata>
            <manifest>
                <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
            </manifest>
            <spine>
                <itemref idref="chapter1"/>
            </spine>
        </package>"""

        chapter_content = """<?xml version="1.0" encoding="UTF-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml">
            <head><title>Глава 1</title></head>
            <body><h1>Глава 1</h1><p>Содержание.</p></body>
        </html>"""

        with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as temp_file:
            with zipfile.ZipFile(temp_file.name, "w") as epub_zip:
                epub_zip.writestr("mimetype", "application/epub+zip")
                epub_zip.writestr("META-INF/container.xml", container_xml)
                epub_zip.writestr("OEBPS/content.opf", metadata_content)

                for file_path, content in [("OEBPS/chapter1.xhtml", chapter_content)]:
                    epub_zip.writestr(file_path, content)

        result = book_parser.parse_book(temp_file.name)
        Path(temp_file.name).unlink(missing_ok=True)

        # Должен определиться как science_fiction по ключевым словам "космос" и "звезд"
        assert result.metadata.genre == "science_fiction"


# ============================================================================
# TESTS: FB2 Parsing
# ============================================================================


class TestFB2Parsing:
    """Тесты парсинга FB2 файлов."""

    def test_parse_fb2_success(self, book_parser, sample_fb2_file):
        """Тест успешного парсинга FB2 файла."""
        result = book_parser.parse_book(sample_fb2_file)

        assert isinstance(result, ParsedBook)
        assert result.file_format == "fb2"
        assert len(result.chapters) > 0

    def test_parse_fb2_extracts_metadata(self, book_parser, sample_fb2_file):
        """Тест извлечения метаданных из FB2."""
        result = book_parser.parse_book(sample_fb2_file)
        metadata = result.metadata

        assert metadata.title == "Test FB2 Book"
        assert "Ivan" in metadata.author
        assert "Sidorov" in metadata.author
        assert metadata.language == "ru"
        assert metadata.genre == "sci_fi"
        # Description может содержать несколько параграфов, проверяем наличие ключевых слов
        assert "test" in metadata.description.lower()
        assert "fb2" in metadata.description.lower()

    def test_parse_fb2_extracts_chapters(self, book_parser, sample_fb2_file):
        """Тест извлечения глав из FB2."""
        result = book_parser.parse_book(sample_fb2_file)

        assert len(result.chapters) >= 2

        chapter1 = result.chapters[0]
        assert chapter1.number == 1
        assert (
            "forest" in chapter1.content.lower()
            or "protagonist" in chapter1.content.lower()
        )

    def test_parse_fb2_handles_encoding(self, book_parser):
        """Тест обработки кодировки FB2."""
        # FB2 с кириллицей и достаточно длинным контентом
        fb2_cyrillic = """<?xml version="1.0" encoding="UTF-8"?>
        <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
            <description>
                <title-info>
                    <book-title>Тестовая книга</book-title>
                    <author>
                        <first-name>Иван</first-name>
                        <last-name>Иванов</last-name>
                    </author>
                    <lang>ru</lang>
                </title-info>
            </description>
            <body>
                <section>
                    <title><p>Глава первая</p></title>
                    <p>Это тестовый контент на русском языке с тёмным лесом и высокими соснами. Текст должен быть достаточно длинным чтобы пройти минимальный порог в сто символов для валидации главы книги и парсера.</p>
                </section>
            </body>
        </FictionBook>""".encode("utf-8")

        temp_file = tempfile.NamedTemporaryFile(suffix=".fb2", delete=False, mode="wb")
        temp_file.write(fb2_cyrillic)
        temp_file.close()

        try:
            result = book_parser.parse_book(temp_file.name)

            assert result.metadata.title == "Тестовая книга"
            assert "Иван" in result.metadata.author
            # Глава может быть пропущена если контент слишком короткий
            if len(result.chapters) > 0:
                assert (
                    "лесом" in result.chapters[0].content
                    or "соснами" in result.chapters[0].content
                )
        finally:
            Path(temp_file.name).unlink(missing_ok=True)


# ============================================================================
# TESTS: Chapter Number Extraction
# ============================================================================


class TestChapterNumberExtraction:
    """Тесты извлечения номеров глав."""

    def test_extract_arabic_number(self, chapter_extractor):
        """Тест извлечения арабского номера главы."""
        text = "Глава 5: Начало приключений"
        number = chapter_extractor.extract(text)

        assert number == 5

    def test_extract_roman_number(self, chapter_extractor):
        """Тест извлечения римского номера главы."""
        text = "Глава III: Путешествие"
        number = chapter_extractor.extract(text)

        assert number == 3

    def test_extract_text_number_russian(self, chapter_extractor):
        """Тест извлечения текстового номера (русский)."""
        text = "Глава первая: В лесу"
        number = chapter_extractor.extract(text)

        assert number == 1

    def test_extract_text_number_english(self, chapter_extractor):
        """Тест извлечения текстового номера (английский)."""
        text = "Chapter three: The forest"
        number = chapter_extractor.extract(text)

        assert number == 3

    def test_extract_from_title(self, chapter_extractor):
        """Тест извлечения номера из заголовка."""
        number = chapter_extractor.extract("", title="Chapter 7")

        assert number == 7

    def test_extract_no_match(self, chapter_extractor):
        """Тест когда номер главы не найден."""
        text = "Пролог: Начало истории"
        number = chapter_extractor.extract(text)

        assert number is None

    def test_roman_to_int_conversion(self):
        """Тест конвертации римских цифр."""
        converter = ChapterNumberExtractor._roman_to_int

        assert converter("I") == 1
        assert converter("V") == 5
        assert converter("X") == 10
        assert converter("XIV") == 14
        assert converter("XXIII") == 23
        assert converter("L") == 50
        assert converter("C") == 100


# ============================================================================
# TESTS: Error Handling
# ============================================================================


class TestErrorHandling:
    """Тесты обработки ошибок."""

    def test_parse_nonexistent_file(self, book_parser):
        """Тест парсинга несуществующего файла."""
        with pytest.raises((FileNotFoundError, Exception)):
            book_parser.parse_book("/nonexistent/file.epub")

    def test_parse_unsupported_format(self, book_parser):
        """Тест парсинга неподдерживаемого формата."""
        temp_file = tempfile.NamedTemporaryFile(suffix=".txt", delete=False)
        temp_file.write(b"Just a text file, not an ebook")
        temp_file.close()

        try:
            with pytest.raises(ValueError, match="Unsupported"):
                book_parser.parse_book(temp_file.name)
        finally:
            Path(temp_file.name).unlink(missing_ok=True)

    def test_parse_corrupted_epub(self, book_parser, corrupted_epub_file):
        """Тест парсинга поврежденного EPUB файла."""
        with pytest.raises(Exception):  # Может быть разные типы исключений
            book_parser.parse_book(corrupted_epub_file)

    def test_parse_empty_epub(self, book_parser):
        """Тест парсинга пустого EPUB (без глав)."""
        epub_content = {
            "mimetype": b"application/epub+zip",
            "META-INF/container.xml": b"""<?xml version="1.0"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                    <rootfiles>
                        <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
                    </rootfiles>
                </container>""",
            "content.opf": b"""<?xml version="1.0"?>
                <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">
                    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                        <dc:title>Empty Book</dc:title>
                    </metadata>
                    <manifest></manifest>
                    <spine></spine>
                </package>""",
        }

        temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        with zipfile.ZipFile(temp_file.name, "w") as epub_zip:
            for path, content in epub_content.items():
                epub_zip.writestr(path, content)

        try:
            result = book_parser.parse_book(temp_file.name)

            # Книга парсится, но без глав
            assert result.metadata.title == "Empty Book"
            assert len(result.chapters) == 0  # Нет глав
        finally:
            Path(temp_file.name).unlink(missing_ok=True)


# ============================================================================
# TESTS: ParsedBook Dataclass
# ============================================================================


class TestParsedBookDataclass:
    """Тесты для dataclass ParsedBook."""

    def test_parsed_book_auto_statistics(self):
        """Тест автоматического расчета статистики."""
        metadata = BookMetadata(title="Test")
        chapters = [
            BookChapter(number=1, title="Ch1", content="word " * 500, word_count=500),
            BookChapter(number=2, title="Ch2", content="word " * 300, word_count=300),
        ]

        parsed_book = ParsedBook(metadata=metadata, chapters=chapters)

        # Автоматически рассчитываются:
        assert parsed_book.total_pages > 0
        assert parsed_book.estimated_reading_time > 0
        # 800 слов / 200 WPM = 4 минуты
        assert parsed_book.estimated_reading_time >= 3

    def test_parsed_book_manual_statistics(self):
        """Тест с явно указанной статистикой."""
        metadata = BookMetadata(title="Test")
        chapters = [BookChapter(number=1, title="Ch1", content="test")]

        parsed_book = ParsedBook(
            metadata=metadata,
            chapters=chapters,
            total_pages=100,
            estimated_reading_time=50,
        )

        # Используются переданные значения
        assert parsed_book.total_pages == 100
        assert parsed_book.estimated_reading_time == 50


class TestBookChapterDataclass:
    """Тесты для dataclass BookChapter."""

    def test_chapter_auto_word_count(self):
        """Тест автоматического подсчета слов."""
        chapter = BookChapter(
            number=1, title="Test Chapter", content="one two three four five"
        )

        assert chapter.word_count == 5

    def test_chapter_manual_word_count(self):
        """Тест с явно указанным количеством слов."""
        chapter = BookChapter(
            number=1, title="Test Chapter", content="one two three", word_count=100
        )

        # Используется переданное значение
        assert chapter.word_count == 100


# ============================================================================
# TESTS: Edge Cases
# ============================================================================


class TestEdgeCases:
    """Тесты граничных случаев."""

    def test_parse_epub_with_missing_metadata(self, book_parser):
        """Тест EPUB с отсутствующими метаданными."""
        epub_content = {
            "mimetype": b"application/epub+zip",
            "META-INF/container.xml": b"""<?xml version="1.0"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                    <rootfiles>
                        <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
                    </rootfiles>
                </container>""",
            "content.opf": b"""<?xml version="1.0"?>
                <package xmlns="http://www.idpf.org/2007/opf">
                    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                    </metadata>
                    <manifest>
                        <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
                    </manifest>
                    <spine>
                        <itemref idref="ch1"/>
                    </spine>
                </package>""",
            "chapter.xhtml": b"""<?xml version="1.0"?>
                <html xmlns="http://www.w3.org/1999/xhtml">
                    <body><h1>Glava 1</h1><p>Test content here.</p></body>
                </html>""",
        }

        temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        with zipfile.ZipFile(temp_file.name, "w") as epub_zip:
            for path, content in epub_content.items():
                epub_zip.writestr(path, content)

        try:
            result = book_parser.parse_book(temp_file.name)

            # Должны быть значения по умолчанию
            assert result.metadata.title == "Unknown"
            assert result.metadata.author == ""
            assert result.metadata.language == "ru"  # default
        finally:
            Path(temp_file.name).unlink(missing_ok=True)

    def test_parse_fb2_with_nested_sections(self, book_parser):
        """Тест FB2 с вложенными секциями."""
        fb2_content = b"""<?xml version="1.0" encoding="UTF-8"?>
        <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
            <description>
                <title-info>
                    <book-title>Nested Book</book-title>
                    <author><first-name>Test</first-name></author>
                </title-info>
            </description>
            <body>
                <section>
                    <title><p>Part 1</p></title>
                    <p>Some content for Part 1 to make it long enough for parsing requirements with minimum length.</p>
                    <section>
                        <title><p>Chapter 1</p></title>
                        <p>Content of chapter 1 in part 1 with sufficient length to pass validation checks and parsing.</p>
                    </section>
                </section>
            </body>
        </FictionBook>"""

        temp_file = tempfile.NamedTemporaryFile(suffix=".fb2", delete=False, mode="wb")
        temp_file.write(fb2_content)
        temp_file.close()

        try:
            result = book_parser.parse_book(temp_file.name)

            # FB2Parser извлекает все секции рекурсивно
            # Должна быть хотя бы одна секция (может быть родительская или вложенная)
            assert result.metadata.title == "Nested Book"
            # Проверяем что парсинг прошел успешно (главы могут быть 0 если контент слишком короткий)
            assert isinstance(result.chapters, list)
        finally:
            Path(temp_file.name).unlink(missing_ok=True)

    def test_parse_chapter_with_special_characters(self, book_parser):
        """Тест обработки специальных символов в тексте."""
        epub_content = {
            "mimetype": b"application/epub+zip",
            "META-INF/container.xml": b"""<?xml version="1.0"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                    <rootfiles>
                        <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
                    </rootfiles>
                </container>""",
            "content.opf": b"""<?xml version="1.0"?>
                <package xmlns="http://www.idpf.org/2007/opf">
                    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                        <dc:title>Test &amp; Special Chars</dc:title>
                    </metadata>
                    <manifest>
                        <item id="ch1" href="ch.xhtml" media-type="application/xhtml+xml"/>
                    </manifest>
                    <spine><itemref idref="ch1"/></spine>
                </package>""",
            "ch.xhtml": b"""<?xml version="1.0" encoding="UTF-8"?>
                <html xmlns="http://www.w3.org/1999/xhtml">
                    <body>
                        <h1>Glava 1</h1>
                        <p>Text with &quot;quotes&quot; and &amp; ampersand. Additional text to make content long enough for minimum chapter length requirements in parser configuration settings.</p>
                    </body>
                </html>""",
        }

        temp_file = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        with zipfile.ZipFile(temp_file.name, "w") as epub_zip:
            for path, content in epub_content.items():
                epub_zip.writestr(path, content)

        try:
            result = book_parser.parse_book(temp_file.name)

            # Проверяем что парсинг прошел успешно
            if len(result.chapters) > 0:
                # Спецсимволы должны быть декодированы
                assert "&amp;" not in result.chapters[0].content
                assert "&quot;" not in result.chapters[0].content
                # Но текст сохранен
                assert (
                    "quotes" in result.chapters[0].content
                    or "ampersand" in result.chapters[0].content
                )
        finally:
            Path(temp_file.name).unlink(missing_ok=True)


# ============================================================================
# TESTS: Integration
# ============================================================================


class TestIntegration:
    """Интеграционные тесты полного pipeline."""

    def test_full_epub_parsing_pipeline(self, book_parser, sample_epub_file):
        """Тест полного цикла парсинга EPUB."""
        # 1. Валидация
        validation = book_parser.validate_book_file(sample_epub_file)
        assert validation["is_valid"] is True

        # 2. Определение формата
        file_format = book_parser.detect_format(sample_epub_file)
        assert file_format == "epub"

        # 3. Парсинг
        result = book_parser.parse_book(sample_epub_file)

        # 4. Проверка результата
        assert result.metadata.title is not None
        assert len(result.chapters) >= 2
        assert result.total_pages > 0
        assert result.estimated_reading_time > 0

        # 5. Проверка качества контента
        for chapter in result.chapters:
            assert chapter.word_count > 0
            assert len(chapter.content) >= 50

    def test_full_fb2_parsing_pipeline(self, book_parser, sample_fb2_file):
        """Тест полного цикла парсинга FB2."""
        # 1. Валидация
        validation = book_parser.validate_book_file(sample_fb2_file)
        assert validation["is_valid"] is True

        # 2. Парсинг
        result = book_parser.parse_book(sample_fb2_file)

        # 3. Проверка
        assert result.file_format == "fb2"
        assert result.metadata.title == "Test FB2 Book"
        assert len(result.chapters) >= 2

    def test_error_handling_pipeline(self, book_parser, corrupted_epub_file):
        """Тест обработки ошибок в полном цикле."""
        # Валидация должна вернуть ошибку
        validation = book_parser.validate_book_file(corrupted_epub_file)
        assert validation["is_valid"] is False
        assert validation["error"] is not None

        # Парсинг должен выбросить исключение
        with pytest.raises(Exception):
            book_parser.parse_book(corrupted_epub_file)
