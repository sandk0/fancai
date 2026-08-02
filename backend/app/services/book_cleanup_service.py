"""
Сервис полной очистки AI-данных книги при переобработке.

Удаляет описания, сущности (с CASCADE на mentions, relationships, events),
сбрасывает флаги chapters и book, удаляет файлы аватарок и изображений с диска.

Используется в crud.py reprocess endpoint перед повторной обработкой.
Транзакция управляется вызывающим кодом -- внутри используется flush(), не commit().
"""

import logging
from pathlib import Path
from typing import Any, cast
from uuid import UUID

from sqlalchemy import CursorResult, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.chapter import Chapter
from app.models.description import Description
from app.models.entity import Entity
from app.models.image import GeneratedImage

logger = logging.getLogger(__name__)


def _delete_files(file_paths: list[str]) -> int:
    """
    Удаляет файлы с диска. Не бросает исключений при отсутствии файлов.

    Args:
        file_paths: Список абсолютных путей к файлам.

    Returns:
        Количество успешно удалённых файлов.
    """
    deleted = 0
    for path_str in file_paths:
        try:
            p = Path(path_str)
            p.unlink(missing_ok=True)
            deleted += 1
        except Exception as e:
            logger.warning(f"Не удалось удалить файл {path_str}: {e}")
    return deleted


async def cleanup_book_data(db: AsyncSession, book_id: UUID) -> dict[str, Any]:
    """
    Полная очистка AI-данных книги перед переобработкой.

    Порядок операций:
    1. Получить chapter_ids для книги
    2. Собрать пути аватарок сущностей и сгенерированных изображений
    3. DELETE descriptions (каскадно удалит description_entities и generated_images записи)
    4. DELETE entities (каскадно удалит entity_mentions, entity_relationships, entity_events)
    5. UPDATE chapters -- сброс флагов парсинга
    6. UPDATE book -- сброс флагов описаний
    7. flush (не commit -- транзакция управляется вызывающим кодом)
    8. Удалить файлы с диска

    Args:
        db: AsyncSession (транзакция управляется вызывающим кодом)
        book_id: UUID книги

    Returns:
        dict с количеством удалённых записей и файлов.
    """
    result: dict[str, Any] = {
        "descriptions_deleted": 0,
        "entities_deleted": 0,
        "chapters_reset": 0,
        "book_reset": False,
        "files_deleted": 0,
    }

    # 1. Получить chapter_ids для книги
    chapter_ids_result = await db.execute(
        select(Chapter.id).where(Chapter.book_id == book_id)
    )
    chapter_ids: list[UUID] = list(chapter_ids_result.scalars().all())

    # 2. Собрать пути аватарок сущностей
    avatar_result = await db.execute(
        select(Entity.master_portrait_url).where(
            Entity.book_id == book_id,
            Entity.master_portrait_url.isnot(None),
        )
    )
    # Пустые пути отсеиваем здесь же: SQL-фильтр снимает только NULL,
    # а удалению файла пустая строка всё равно ничего не даёт.
    avatar_paths: list[str] = [p for p in avatar_result.scalars().all() if p]

    # Собрать пути сгенерированных изображений (только если есть chapters)
    image_paths: list[str] = []
    if chapter_ids:
        image_result = await db.execute(
            select(GeneratedImage.local_path).where(
                GeneratedImage.description_id.in_(
                    select(Description.id).where(
                        Description.chapter_id.in_(chapter_ids)
                    )
                ),
                GeneratedImage.local_path.isnot(None),
            )
        )
        image_paths = [p for p in image_result.scalars().all() if p]

    all_file_paths = avatar_paths + image_paths

    # 3. DELETE descriptions (только если есть chapters)
    if chapter_ids:
        desc_result = await db.execute(
            delete(Description).where(Description.chapter_id.in_(chapter_ids))
        )
        result["descriptions_deleted"] = cast(CursorResult, desc_result).rowcount

    # 4. DELETE entities (CASCADE удалит mentions, relationships, events, description_entities)
    entity_result = await db.execute(delete(Entity).where(Entity.book_id == book_id))
    result["entities_deleted"] = cast(CursorResult, entity_result).rowcount

    # 5. UPDATE chapters -- сброс флагов парсинга
    if chapter_ids:
        await db.execute(
            update(Chapter)
            .where(Chapter.id.in_(chapter_ids))
            .values(
                is_description_parsed=False,
                descriptions_found=0,
                parsing_progress=0,
                parsing_error=None,
                parse_attempts=0,
            )
        )
    result["chapters_reset"] = len(chapter_ids)

    # 6. UPDATE book -- сброс флагов описаний
    await db.execute(
        update(Book)
        .where(Book.id == book_id)
        .values(
            descriptions_extracted=False,
            descriptions_processing_error=None,
        )
    )
    result["book_reset"] = True

    # 7. Flush (не commit)
    await db.flush()

    # 8. Удалить файлы с диска
    if all_file_paths:
        _delete_files(all_file_paths)
    result["files_deleted"] = len(all_file_paths)

    logger.info(
        f"Очистка данных книги {book_id}: "
        f"описаний={result['descriptions_deleted']}, "
        f"сущностей={result['entities_deleted']}, "
        f"глав сброшено={result['chapters_reset']}, "
        f"файлов удалено={result['files_deleted']}"
    )

    return result
