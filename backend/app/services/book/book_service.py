"""
Основной сервис для работы с книгами - CRUD операции.

Ответственности:
- Создание книг из загруженных файлов
- Чтение списка книг пользователя
- Получение книги по ID
- Получение глав книги
- Удаление книг
- Сохранение обложек (вспомогательная функция)

Single Responsibility Principle:
Сервис отвечает ТОЛЬКО за базовые CRUD операции с книгами.
Вся логика прогресса, статистики и парсинга вынесена в отдельные сервисы.
"""

import os
from typing import List, Optional
from pathlib import Path
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, desc
from sqlalchemy.orm import selectinload, joinedload

from ...models.book import Book, ReadingProgress, BookGenre
from ...models.chapter import Chapter
from ...services.book_parser import ParsedBook
from ...core.cache import cache_manager


class BookService:
    """Сервис для базовых CRUD операций с книгами."""

    def __init__(self):
        """Инициализация сервиса книг."""
        from ...core.config import settings

        self.upload_directory = Path(settings.UPLOAD_DIRECTORY)
        self.upload_directory.mkdir(parents=True, exist_ok=True)

    async def create_book_from_upload(
        self,
        db: AsyncSession,
        user_id: UUID,
        file_path: str,
        original_filename: str,
        parsed_book: ParsedBook,
    ) -> Book:
        """
        Создает запись о книге в базе данных на основе загруженного файла.

        Args:
            db: Сессия базы данных
            user_id: ID пользователя-владельца
            file_path: Путь к загруженному файлу
            original_filename: Оригинальное название файла
            parsed_book: Результат парсинга книги

        Returns:
            Созданный объект Book
        """
        # Проверяем размер файла
        file_size = os.path.getsize(file_path)

        # Создаем запись о книге
        book = Book(
            user_id=user_id,
            title=parsed_book.metadata.title,
            author=parsed_book.metadata.author,
            genre=self._map_genre(parsed_book.metadata.genre),
            language=parsed_book.metadata.language,
            file_path=file_path,
            file_format=parsed_book.file_format,
            file_size=file_size,
            description=parsed_book.metadata.description,
            book_metadata={
                "isbn": parsed_book.metadata.isbn,
                "publisher": parsed_book.metadata.publisher,
                "publish_date": parsed_book.metadata.publish_date,
                "has_cover": parsed_book.metadata.cover_image_data is not None,
            },
            total_pages=parsed_book.total_pages,
            estimated_reading_time=parsed_book.estimated_reading_time,
            is_parsed=False,
            is_processing=True,  # Will be set to False when Celery task completes
            parsing_progress=0,
        )

        db.add(book)
        await db.flush()  # Получаем ID книги

        # Сохраняем обложку, если есть
        if parsed_book.metadata.cover_image_data:
            cover_path = await self._save_book_cover(
                book.id,
                parsed_book.metadata.cover_image_data,
                parsed_book.metadata.cover_image_type,
            )
            book.cover_image = str(cover_path)

        # Создаем главы
        for chapter_data in parsed_book.chapters:
            chapter = Chapter(
                book_id=book.id,
                chapter_number=chapter_data.number,
                title=chapter_data.title,
                content=chapter_data.content,
                html_content=chapter_data.html_content,
                word_count=chapter_data.word_count,
                estimated_reading_time=max(1, chapter_data.word_count // 200),
                file_path=chapter_data.file_path,  # Save strict mapping path
            )
            db.add(chapter)

        # Создаем прогресс чтения для пользователя
        reading_progress = ReadingProgress(
            user_id=user_id,
            book_id=book.id,
            current_chapter=1,
            current_page=1,
            current_position=0,
        )
        db.add(reading_progress)

        await db.commit()
        return book

    async def get_user_books(
        self,
        db: AsyncSession,
        user_id: UUID,
        skip: int = 0,
        limit: int = 50,
        sort_by: str = "created_desc",
    ) -> List[Book]:
        """
        Получает список книг пользователя БЕЗ прогресса чтения.

        Для получения книг С прогрессом используйте BookProgressService.get_books_with_progress()

        Args:
            db: Сессия базы данных
            user_id: ID пользователя
            skip: Количество записей для пропуска
            limit: Максимальное количество записей
            sort_by: Тип сортировки (created_desc, created_asc, title_asc, title_desc,
                     author_asc, author_desc, accessed_desc)

        Returns:
            Список книг пользователя
        """
        # Определяем порядок сортировки
        if sort_by == "created_asc":
            order_clause = Book.created_at.asc()
        elif sort_by == "title_asc":
            order_clause = Book.title.asc()
        elif sort_by == "title_desc":
            order_clause = Book.title.desc()
        elif sort_by == "author_asc":
            order_clause = Book.author.asc()
        elif sort_by == "author_desc":
            order_clause = Book.author.desc()
        elif sort_by == "accessed_desc":
            order_clause = desc(Book.last_accessed)
        else:  # created_desc - default
            order_clause = desc(Book.created_at)

        result = await db.execute(
            select(Book)
            .where(Book.user_id == user_id)
            .options(selectinload(Book.chapters))
            .options(selectinload(Book.reading_progress))
            .options(joinedload(Book.user))
            .order_by(order_clause)
            .offset(skip)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_book_by_id(
        self, db: AsyncSession, book_id: UUID, user_id: Optional[UUID] = None
    ) -> Optional[Book]:
        """
        Получает книгу по ID.

        Args:
            db: Сессия базы данных
            book_id: ID книги
            user_id: ID пользователя (для проверки доступа)

        Returns:
            Объект Book или None
        """
        query = (
            select(Book)
            .options(selectinload(Book.chapters))
            .options(selectinload(Book.reading_progress))
            .where(Book.id == book_id)
        )

        if user_id:
            query = query.where(Book.user_id == user_id)

        result = await db.execute(query)
        return result.scalar_one_or_none()

    async def get_book_chapters(
        self, db: AsyncSession, book_id: UUID, user_id: Optional[UUID] = None
    ) -> List[Chapter]:
        """
        Получает главы книги.

        Args:
            db: Сессия базы данных
            book_id: ID книги
            user_id: ID пользователя (для проверки доступа)

        Returns:
            Список глав
        """
        # Проверяем доступ к книге
        if user_id:
            book_check = await db.execute(
                select(Book.id).where(and_(Book.id == book_id, Book.user_id == user_id))
            )
            if not book_check.scalar_one_or_none():
                return []

        result = await db.execute(
            select(Chapter)
            .where(Chapter.book_id == book_id)
            .options(selectinload(Chapter.descriptions))
            .order_by(Chapter.chapter_number)
        )
        return result.scalars().all()

    async def get_chapter_by_number(
        self,
        db: AsyncSession,
        book_id: UUID,
        chapter_number: int,
        user_id: Optional[UUID] = None,
    ) -> Optional[Chapter]:
        """
        Получает главу по номеру.

        Args:
            db: Сессия базы данных
            book_id: ID книги
            chapter_number: Номер главы
            user_id: ID пользователя (для проверки доступа)

        Returns:
            Объект Chapter или None
        """
        # Проверяем доступ к книге
        if user_id:
            book_check = await db.execute(
                select(Book.id).where(and_(Book.id == book_id, Book.user_id == user_id))
            )
            if not book_check.scalar_one_or_none():
                return None

        result = await db.execute(
            select(Chapter)
            .where(
                and_(
                    Chapter.book_id == book_id, Chapter.chapter_number == chapter_number
                )
            )
            .options(selectinload(Chapter.descriptions))
        )
        return result.scalar_one_or_none()

    async def delete_book(self, db: AsyncSession, book_id: UUID, user_id: UUID) -> bool:
        """
        Удаляет книгу и все связанные данные.

        Args:
            db: Сессия базы данных
            book_id: ID книги
            user_id: ID пользователя (для проверки прав)

        Returns:
            True если книга успешно удалена
        """
        # Получаем книгу с проверкой прав доступа
        result = await db.execute(
            select(Book).where(and_(Book.id == book_id, Book.user_id == user_id))
        )
        book = result.scalar_one_or_none()

        if not book:
            return False

        # Удаляем файл книги
        try:
            if os.path.exists(book.file_path):
                os.remove(book.file_path)
        except Exception as e:
            print(f"Warning: Could not delete book file {book.file_path}: {e}")

        # Удаляем обложку
        try:
            if book.cover_image and os.path.exists(book.cover_image):
                os.remove(book.cover_image)
        except Exception as e:
            print(f"Warning: Could not delete cover image {book.cover_image}: {e}")

        # Удаляем запись из БД (cascade удалит связанные записи)
        await db.delete(book)
        await db.commit()

        # Очищаем кэш сессии чтобы последующие запросы видели удаление
        db.expire_all()

        # Invalidate all cache related to this book
        await cache_manager.delete_pattern(f"book:{book_id}:*")
        await cache_manager.delete_pattern(f"user:{user_id}:books:*")
        await cache_manager.delete_pattern(f"user:{user_id}:progress:{book_id}")

        return True

    def _map_genre(self, genre_string: str) -> str:
        """
        Маппит строку жанра в значение перечисления BookGenre.

        Args:
            genre_string: Строка жанра из метаданных

        Returns:
            Значение BookGenre
        """
        if not genre_string:
            return BookGenre.OTHER.value

        genre_lower = genre_string.lower()

        # Простой маппинг жанров
        genre_mapping = {
            "fantasy": BookGenre.FANTASY.value,
            "фэнтези": BookGenre.FANTASY.value,
            "detective": BookGenre.DETECTIVE.value,
            "детектив": BookGenre.DETECTIVE.value,
            "science_fiction": BookGenre.SCIFI.value,
            "sci-fi": BookGenre.SCIFI.value,
            "фантастика": BookGenre.SCIFI.value,
            "historical": BookGenre.HISTORICAL.value,
            "исторический": BookGenre.HISTORICAL.value,
            "romance": BookGenre.ROMANCE.value,
            "роман": BookGenre.ROMANCE.value,
            "любовный": BookGenre.ROMANCE.value,
            "thriller": BookGenre.THRILLER.value,
            "триллер": BookGenre.THRILLER.value,
            "horror": BookGenre.HORROR.value,
            "ужасы": BookGenre.HORROR.value,
            "classic": BookGenre.CLASSIC.value,
            "классика": BookGenre.CLASSIC.value,
        }

        for keyword, genre in genre_mapping.items():
            if keyword in genre_lower:
                return genre

        return BookGenre.OTHER.value

    async def _save_book_cover(
        self, book_id: UUID, image_data: bytes, content_type: str
    ) -> Path:
        """
        Сохраняет обложку книги.

        Args:
            book_id: ID книги
            image_data: Данные изображения
            content_type: MIME-тип изображения

        Returns:
            Путь к сохраненному файлу
        """
        # Определяем расширение файла
        extension = "jpg"
        if "png" in content_type:
            extension = "png"
        elif "webp" in content_type:
            extension = "webp"

        # Создаем директорию для обложек
        covers_dir = self.upload_directory / "covers"
        covers_dir.mkdir(exist_ok=True)

        # Путь к файлу обложки
        cover_path = covers_dir / f"{book_id}.{extension}"

        # Сохраняем файл (async to avoid blocking event loop)
        import aiofiles

        async with aiofiles.open(cover_path, "wb") as f:
            await f.write(image_data)

        return cover_path


# Глобальный экземпляр сервиса (для обратной совместимости)
book_service = BookService()
