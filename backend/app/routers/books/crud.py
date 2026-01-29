"""
Core CRUD operations для работы с книгами.

Этот модуль содержит базовые операции создания, чтения и удаления книг:
- Загрузка новых книг
- Получение списка книг пользователя
- Получение деталей конкретной книги
- Получение файлов книг (EPUB для epub.js)
- Получение обложек книг
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import tempfile
import os
from pathlib import Path
import shutil
from uuid import uuid4

import aiofiles

from ...core.database import get_database_session
from ...core.auth import get_current_active_user
from ...core.dependencies import get_user_book
from ...core.cache import cache_manager, cache_key, CACHE_TTL
from ...core.logging import logger
from ...core.exceptions import (
    InvalidFileFormatException,
    FileTooLargeException,
    NoFilenameProvidedException,
    FileReadException,
    BookProcessingException,
    BookListFetchException,
    BookFetchException,
    BookFileNotFoundException,
    BookRetrievalException,
    CoverImageNotFoundException,
    CoverFetchException,
)
from ...services.book_parser import BookParser
from ...services.book import BookService
from ...services.book.book_progress_service import BookProgressService
from ...core.container import (
    get_book_parser_dep,
    get_book_service_dep,
    get_book_progress_service_dep,
)
from ...models.book import Book
from ...models.user import User
from ...core.tasks import process_book_task
from ...schemas.responses import (
    BookListResponse,
    BookDetailResponse,
    BookUploadResponse,
    BookSummary,
)


router = APIRouter()


@router.post("/upload", response_model=BookUploadResponse)
async def upload_book(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    parser: BookParser = Depends(get_book_parser_dep),
    book_svc: BookService = Depends(get_book_service_dep),
) -> BookUploadResponse:
    """
    Загружает книгу, парсит её и сохраняет в базе данных.

    Args:
        file: Загруженный файл книги
        current_user: Текущий аутентифицированный пользователь
        db: Сессия базы данных

    Returns:
        Информация о загруженной и обработанной книге

    Raises:
        HTTPException: 400 если файл невалидный
    """
    logger.info(
        "Book upload request received",
        user_email=current_user.email,
        filename=file.filename,
        content_type=file.content_type,
    )

    # Валидируем файл
    if not file.filename:
        raise NoFilenameProvidedException()

    file_extension = Path(file.filename).suffix.lower()
    if file_extension not in [".epub", ".fb2"]:
        raise InvalidFileFormatException(file_extension, [".epub", ".fb2"])

    try:
        file_content = await file.read()
        file_size = len(file_content)
        logger.debug("File read successfully", file_size=file_size)
    except Exception as e:
        logger.error("Failed to read file", error=str(e))
        raise FileReadException(str(e))

    if file_size > 50 * 1024 * 1024:
        raise FileTooLargeException(50)

    # Создаем временный файл для парсинга (async write to avoid blocking)
    temp_file = tempfile.NamedTemporaryFile(suffix=file_extension, delete=False)
    temp_file_path = temp_file.name
    temp_file.close()

    async with aiofiles.open(temp_file_path, "wb") as f:
        await f.write(file_content)

    try:
        logger.debug("Parsing book", temp_file_path=temp_file_path)
        # Парсим книгу (используем DI)
        parsed_book = await parser.parse_book(temp_file_path)
        logger.info("Book parsed successfully", title=parsed_book.metadata.title)

        # Создаем постоянное хранилище для файла
        storage_dir = Path("/app/storage/books")
        storage_dir.mkdir(parents=True, exist_ok=True)

        permanent_path = storage_dir / f"{uuid4()}{file_extension}"
        shutil.move(temp_file_path, permanent_path)
        logger.debug("File moved to permanent storage", path=str(permanent_path))

        # Сохраняем книгу в базе данных (используем DI)
        logger.debug("Creating book in database")
        book = await book_svc.create_book_from_upload(
            db=db,
            user_id=current_user.id,
            file_path=str(permanent_path),
            original_filename=file.filename,
            parsed_book=parsed_book,
        )
        await db.refresh(book)  # FIX: Refresh object to avoid greenlet_spawn error
        logger.info("Book created in database", book_id=str(book.id))

        # ИЗМЕНЕНО: Убран автозапуск обработки описаний
        # Книга сразу готова к чтению (без описаний)
        # Обработка описаний запускается вручную через POST /books/{id}/process-descriptions
        book.is_processing = False
        book.is_parsed = True
        book.parsing_progress = 100
        book.descriptions_extracted = False
        await db.commit()
        await db.refresh(book)
        logger.info("Book ready for reading (no descriptions)", book_id=str(book.id))

        # КРИТИЧЕСКИ ВАЖНО: Инвалидируем кэш списка книг пользователя
        # чтобы новая книга сразу появилась в библиотеке
        try:
            logger.debug("Invalidating book list cache", user_id=str(current_user.id))
            # Используем pattern-based deletion для удаления ВСЕХ вариантов пагинации
            # Это намного эффективнее чем цикл с 30 итерациями
            pattern = f"user:{current_user.id}:books:*"
            deleted_count = await cache_manager.delete_pattern(pattern)
            logger.debug("Book list cache invalidated", keys_deleted=deleted_count)
        except Exception as e:
            logger.warning("Failed to invalidate cache", error=str(e))
            # Не критичная ошибка, продолжаем

        # Создаем ответ в правильном формате согласно BookUploadResponse схеме
        book_response = BookDetailResponse(
            id=book.id,
            user_id=book.user_id,
            title=book.title,
            author=book.author,
            genre=book.genre,
            language=book.language,
            file_path=book.file_path,
            file_format=book.file_format,
            file_size=book.file_size,
            cover_image=book.cover_image,
            description=book.description,
            book_metadata=book.book_metadata,
            total_pages=book.total_pages,
            estimated_reading_time=book.estimated_reading_time,
            is_parsed=book.is_parsed,
            is_processing=book.is_processing if hasattr(book, 'is_processing') else True,
            parsing_progress=book.parsing_progress,
            parsing_error=book.parsing_error,
            created_at=book.created_at,
            updated_at=book.updated_at,
            last_accessed=book.last_accessed,
            # Computed fields для frontend
            estimated_reading_time_hours=round(book.estimated_reading_time / 60, 1),
            file_size_mb=round(file_size / (1024 * 1024), 2),
            has_cover=bool(book.cover_image),
        )

        return BookUploadResponse(
            book=book_response,
            task_id=None,  # Больше не запускаем автообработку
            message=f"Книга '{book.title}' загружена. Запустите обработку описаний вручную.",
        )

    except Exception as e:
        logger.error("Book processing failed", error=str(e), exc_info=True)
        # Удаляем временный файл в случае ошибки
        try:
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
        except OSError:
            pass

        raise BookProcessingException(str(e))


@router.get("/", response_model=BookListResponse)
async def get_user_books(
    skip: int = 0,
    limit: int = 50,
    sort_by: str = "created_desc",
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
    book_progress_svc: BookProgressService = Depends(get_book_progress_service_dep),
) -> BookListResponse:
    """
    Получает список книг пользователя.

    Args:
        skip: Количество записей для пропуска
        limit: Максимальное количество записей
        sort_by: Тип сортировки (created_desc, created_asc, title_asc, title_desc,
                 author_asc, author_desc, accessed_desc). По умолчанию: created_desc
        db: Сессия базы данных
        current_user: Текущий пользователь

    Returns:
        Список книг пользователя с пагинацией

    Cache:
        TTL: 10 seconds (frequently updated - parsing status changes)
        Key: user:{user_id}:books:skip:{skip}:limit:{limit}:sort:{sort_by}
    """
    logger.debug(
        "Books request started",
        user_id=str(current_user.id),
        sort_by=sort_by,
        skip=skip,
        limit=limit,
    )

    cache_key_str = cache_key(
        "user", current_user.id, "books", f"skip:{skip}", f"limit:{limit}", f"sort:{sort_by}"
    )
    cached_result = await cache_manager.get(cache_key_str)
    if cached_result is not None:
        try:
            return BookListResponse.model_validate(cached_result)
        except Exception:
            await cache_manager.delete(cache_key_str)

    try:
        books_with_progress = await book_progress_svc.get_books_with_progress(
            db, current_user.id, skip, limit, sort_by
        )

        books_list: list[BookSummary] = []
        for book, progress_percent in books_with_progress:
            try:
                reading_time = book.estimated_reading_time or 0
                books_list.append(
                    BookSummary(
                        id=book.id,
                        title=book.title,
                        author=book.author or "Неизвестный автор",
                        genre=book.genre,
                        language=book.language,
                        description=book.description or "",
                        cover_image=book.cover_image,
                        file_format=book.file_format,
                        file_size=book.file_size,
                        total_pages=book.total_pages,
                        estimated_reading_time=reading_time,
                        estimated_reading_time_hours=round(reading_time / 60, 1) if reading_time > 0 else 0.0,
                        chapters_count=len(book.chapters) if hasattr(book, "chapters") and book.chapters else 0,
                        reading_progress_percent=round(progress_percent, 1),
                        has_cover=bool(book.cover_image),
                        is_parsed=book.is_parsed,
                        parsing_progress=book.parsing_progress,
                        is_processing=book.is_processing if hasattr(book, "is_processing") else not book.is_parsed,
                        created_at=book.created_at,
                        last_accessed=book.last_accessed,
                    )
                )
            except Exception as e:
                logger.warning("Error processing book", book_id=str(book.id), error=str(e))

        total_result = await db.execute(
            select(func.count(Book.id)).where(Book.user_id == current_user.id)
        )
        total_books = total_result.scalar() or 0

        response = BookListResponse(books=books_list, total=total_books, skip=skip, limit=limit)

        await cache_manager.set(cache_key_str, response.model_dump(mode="json"), ttl=CACHE_TTL["book_list"])

        return response

    except Exception as e:
        logger.error("Error fetching books", error=str(e))
        raise BookListFetchException(str(e))


@router.get("/{book_id}", response_model=BookDetailResponse)
async def get_book(
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> BookDetailResponse:
    """
    Получает информацию о конкретной книге.

    Args:
        book: Книга (автоматически получена через dependency)
        current_user: Текущий аутентифицированный пользователь
        db: Сессия базы данных

    Returns:
        Подробная информация о книге

    Raises:
        BookNotFoundException: Если книга не найдена
        BookAccessDeniedException: Если доступ запрещен

    Cache:
        TTL: 1 hour (rarely changes)
        Key: book:{book_id}:metadata
    """
    cache_key_str = cache_key("book", book.id, "metadata")
    cached_result = await cache_manager.get(cache_key_str)
    if cached_result is not None:
        try:
            return BookDetailResponse.model_validate(cached_result)
        except Exception:
            await cache_manager.delete(cache_key_str)

    try:
        progress_percent = await book.get_reading_progress_percent(db, current_user.id)

        current_chapter, current_page, current_position, reading_location_cfi = 1, 1, 0, None
        if book.reading_progress:
            progress = book.reading_progress[0]
            current_chapter = progress.current_chapter
            current_page = progress.current_page
            current_position = progress.current_position
            reading_location_cfi = progress.reading_location_cfi

        chapters_data = [
            {
                "id": str(ch.id),
                "number": ch.chapter_number,
                "title": ch.title,
                "word_count": ch.word_count,
                "estimated_reading_time_minutes": ch.estimated_reading_time,
                "is_description_parsed": ch.is_description_parsed,
                "descriptions_found": ch.descriptions_found,
            }
            for ch in sorted(book.chapters, key=lambda c: c.chapter_number)
        ]

        reading_time = book.estimated_reading_time or 0
        response = BookDetailResponse(
            id=book.id,
            user_id=book.user_id,
            title=book.title,
            author=book.author,
            genre=book.genre,
            language=book.language,
            file_path=book.file_path,
            file_format=book.file_format,
            file_size=book.file_size,
            cover_image=book.cover_image,
            description=book.description,
            book_metadata=book.book_metadata,
            total_pages=book.total_pages,
            estimated_reading_time=reading_time,
            is_parsed=book.is_parsed,
            is_processing=book.is_processing if hasattr(book, "is_processing") else not book.is_parsed,
            parsing_progress=book.parsing_progress,
            parsing_error=book.parsing_error,
            created_at=book.created_at,
            updated_at=book.updated_at,
            last_accessed=book.last_accessed,
            estimated_reading_time_hours=round(reading_time / 60, 1) if reading_time > 0 else 0.0,
            file_size_mb=round(book.file_size / (1024 * 1024), 2),
            has_cover=bool(book.cover_image),
            chapters=chapters_data,
            reading_progress={
                "current_chapter": current_chapter,
                "current_page": current_page,
                "current_position": current_position,
                "reading_location_cfi": reading_location_cfi,
                "progress_percent": round(progress_percent, 1),
            },
        )

        await cache_manager.set(cache_key_str, response.model_dump(mode="json"), ttl=CACHE_TTL["book_metadata"])

        return response

    except HTTPException:
        raise
    except Exception as e:
        raise BookFetchException(str(e))


@router.get("/{book_id}/file")
async def get_book_file(
    book: Book = Depends(get_user_book),
):
    """
    Возвращает EPUB файл для чтения в epub.js.

    Args:
        book: Книга (автоматически получена через dependency)

    Returns:
        FileResponse с EPUB файлом

    Raises:
        BookNotFoundException: Если книга не найдена
        BookAccessDeniedException: Если доступ запрещен
        BookFileNotFoundException: Если файл книги не найден на сервере
    """
    try:
        # Проверяем существование файла
        if not os.path.exists(book.file_path):
            raise BookFileNotFoundException(book.id)

        # Возвращаем файл
        return FileResponse(
            path=book.file_path,
            media_type="application/epub+zip",
            filename=f"{book.title}.epub",
        )

    except HTTPException:
        raise
    except Exception as e:
        raise BookRetrievalException(str(e))


@router.get("/{book_id}/cover")
async def get_book_cover(
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
):
    """
    Получает обложку книги.

    Args:
        book: Книга (автоматически получена через dependency с проверкой владельца)
        current_user: Текущий аутентифицированный пользователь

    Returns:
        Файл обложки книги

    Raises:
        BookNotFoundException: Если книга не найдена
        BookAccessDeniedException: Если доступ запрещен
        CoverImageNotFoundException: Если обложка не найдена
    """
    try:
        # Проверяем, есть ли обложка
        if not book.cover_image or not os.path.exists(book.cover_image):
            raise CoverImageNotFoundException(book.id)

        # Возвращаем файл обложки
        return FileResponse(
            path=book.cover_image,
            media_type="image/jpeg",
            filename=f"{book.title}_cover.jpg",
        )

    except HTTPException:
        raise
    except Exception as e:
        raise CoverFetchException(str(e))


@router.delete("/{book_id}", status_code=200)
async def delete_book(
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
    book_svc: BookService = Depends(get_book_service_dep),
) -> dict:
    """
    Удаляет книгу и все связанные данные (главы, описания, изображения, прогресс).

    Returns:
        dict: Сообщение об успешном удалении

    Raises:
        HTTPException: 404 если книга не найдена
    """
    success = await book_svc.delete_book(db, book.id, current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Book not found or already deleted")
    return {"message": f"Book '{book.title}' deleted successfully", "id": str(book.id)}


# ============================================================================
# ENDPOINTS ДЛЯ ОБРАБОТКИ ОПИСАНИЙ (ручной запуск)
# ============================================================================


@router.post("/{book_id}/process-descriptions")
async def process_book_descriptions(
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> dict:
    """
    Запускает обработку описаний для книги.
    
    Книга блокируется на время обработки (is_processing=True).
    Пользователь может отменить обработку через cancel-processing endpoint.
    
    Returns:
        dict: task_id и статус
        
    Raises:
        HTTPException: 409 если книга уже обрабатывается
    """
    if book.is_processing:
        raise HTTPException(
            status_code=409,
            detail="Книга уже обрабатывается. Дождитесь завершения или отмените."
        )
    
    # Блокируем книгу для обработки
    book.is_processing = True
    book.parsing_progress = 0
    book.descriptions_extracted = False
    book.descriptions_processing_error = None
    await db.commit()
    
    # Запускаем Celery task
    task_id = None
    try:
        logger.info("Starting description processing", book_id=str(book.id))
        task = process_book_task.delay(str(book.id))
        task_id = task.id if task else None
        
        # Store task_id in Redis for cancellation
        if task_id:
            import redis.asyncio as aioredis
            from app.core.config import settings
            try:
                redis_client = aioredis.from_url(settings.REDIS_URL)
                await redis_client.set(
                    f"book:task_id:{book.id}", 
                    task_id, 
                    ex=14400  # 4 hours TTL
                )
                await redis_client.close()
            except Exception as redis_err:
                logger.warning("Failed to store task_id in Redis", error=str(redis_err))
        
        logger.info("Description processing task started", 
                    book_id=str(book.id), task_id=task_id)
    except Exception as e:
        # Если Celery не доступен, откатываем состояние
        logger.error("Failed to start processing task", error=str(e))
        book.is_processing = False
        book.descriptions_processing_error = f"Ошибка запуска: {str(e)}"
        await db.commit()
        raise HTTPException(
            status_code=503,
            detail="Сервис обработки недоступен. Попробуйте позже."
        )
    
    return {
        "message": "Обработка описаний запущена",
        "task_id": task_id,
        "book_id": str(book.id),
    }


@router.post("/{book_id}/cancel-processing")
async def cancel_book_processing(
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> dict:
    """
    Отменяет обработку описаний.
    
    При отмене:
    - Celery task revoke'd через Redis
    - Книга разблокируется (is_processing=False)
    - descriptions_extracted остаётся False
    
    Returns:
        dict: Статус отмены
        
    Raises:
        HTTPException: 400 если книга не обрабатывается
    """
    import redis.asyncio as aioredis
    from celery.result import AsyncResult
    from app.core.celery_app import celery_app
    from app.core.config import settings
    
    if not book.is_processing:
        raise HTTPException(
            status_code=400,
            detail="Книга не обрабатывается"
        )
    
    # Получить task_id из Redis и отменить Celery task
    task_revoked = False
    try:
        redis_client = aioredis.from_url(settings.REDIS_URL)
        task_id_key = f"book:task_id:{book.id}"
        task_id = await redis_client.get(task_id_key)
        
        if task_id:
            task_id = task_id.decode() if isinstance(task_id, bytes) else task_id
            logger.info("Revoking Celery task", task_id=task_id, book_id=str(book.id))
            
            # Revoke task with terminate=True to interrupt immediately
            result = AsyncResult(task_id, app=celery_app)
            result.revoke(terminate=True, signal='SIGTERM')
            
            # Clear task_id from Redis
            await redis_client.delete(task_id_key)
            task_revoked = True
            
        await redis_client.close()
    except Exception as e:
        logger.warning("Failed to revoke Celery task", error=str(e))
    
    # Разблокируем книгу
    book.is_processing = False
    book.descriptions_extracted = False
    book.descriptions_processing_error = "Отменено пользователем"
    book.parsing_progress = 0
    await db.commit()
    
    # Публикуем отмену через WebSocket
    try:
        from app.core.pubsub import publish_book_progress
        await publish_book_progress(
            book_id=str(book.id),
            progress=0,
            chapter=0,
            total_chapters=0,
            status="cancelled",
            message="Обработка отменена пользователем"
        )
    except Exception as ws_err:
        logger.warning("Failed to publish cancellation", error=str(ws_err))
    
    logger.info("Processing cancelled by user", book_id=str(book.id), task_revoked=task_revoked)
    
    return {
        "message": "Обработка отменена",
        "book_id": str(book.id),
        "task_revoked": task_revoked,
    }


@router.post("/{book_id}/reprocess-descriptions")
async def reprocess_book_descriptions(
    book: Book = Depends(get_user_book),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> dict:
    """
    Переобработка описаний для уже обработанной книги.
    
    При переобработке:
    - Удаляются все существующие описания
    - Запускается новый процесс извлечения
    
    Returns:
        dict: task_id и статус
        
    Raises:
        HTTPException: 409 если книга уже обрабатывается
    """
    if book.is_processing:
        raise HTTPException(
            status_code=409,
            detail="Книга уже обрабатывается. Дождитесь завершения или отмените."
        )
    
    # TODO: Удалить существующие описания
    # from ...models.description import Description
    # await db.execute(delete(Description).where(Description.book_id == book.id))
    
    # Сбрасываем статус и блокируем
    book.is_processing = True
    book.parsing_progress = 0
    book.descriptions_extracted = False
    book.descriptions_processing_error = None
    await db.commit()
    
    # Запускаем Celery task
    task_id = None
    try:
        logger.info("Starting description reprocessing", book_id=str(book.id))
        task = process_book_task.delay(str(book.id))
        task_id = task.id if task else None
    except Exception as e:
        logger.error("Failed to start reprocessing task", error=str(e))
        book.is_processing = False
        book.descriptions_processing_error = f"Ошибка запуска: {str(e)}"
        await db.commit()
        raise HTTPException(
            status_code=503,
            detail="Сервис обработки недоступен. Попробуйте позже."
        )
    
    return {
        "message": "Переобработка описаний запущена",
        "task_id": task_id,
        "book_id": str(book.id),
    }