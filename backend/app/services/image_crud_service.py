"""
Image CRUD Service — операции с GeneratedImage в БД.

Централизует:
- Проверку доступа к изображениям
- CRUD операции с GeneratedImage
- Статистику изображений
"""

import os
from typing import Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from loguru import logger

from app.models.image import GeneratedImage
from app.models.description import Description
from app.models.chapter import Chapter
from app.models.book import Book


def _unlink_quietly(path: Optional[str]) -> None:
    """Удаляет файл, не роняя вызывающего: строка в БД уже согласована."""
    if not path:
        return
    try:
        os.unlink(path)
    except OSError:
        # Файла нет или ФС отказала: строка в БД уже удалена, откатывать нечего
        pass


class ImageNotFoundError(Exception):
    def __init__(self, image_id: UUID):
        self.image_id = image_id
        super().__init__(f"Image {image_id} not found")


class ImageAccessDeniedError(Exception):
    def __init__(self, image_id: UUID, user_id: UUID):
        self.image_id = image_id
        self.user_id = user_id
        super().__init__(f"Access denied to image {image_id} for user {user_id}")


class ImageAlreadyExistsError(Exception):
    def __init__(self, description_id: UUID):
        self.description_id = description_id
        super().__init__(f"Image already exists for description {description_id}")


class ImageCRUDService:
    """Service for GeneratedImage CRUD operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(
        self,
        image_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Optional[GeneratedImage]:
        if user_id:
            result = await self.db.execute(
                select(GeneratedImage)
                .join(Description, GeneratedImage.description_id == Description.id)
                .join(Chapter, Description.chapter_id == Chapter.id)
                .join(Book, Chapter.book_id == Book.id)
                .where(GeneratedImage.id == image_id)
                .where(Book.user_id == user_id)
            )
        else:
            result = await self.db.execute(
                select(GeneratedImage).where(GeneratedImage.id == image_id)
            )
        return result.scalar_one_or_none()

    async def get_by_description(
        self,
        description_id: UUID,
    ) -> Optional[GeneratedImage]:
        result = await self.db.execute(
            select(GeneratedImage).where(
                GeneratedImage.description_id == description_id
            )
        )
        return result.scalar_one_or_none()

    async def exists_for_description(self, description_id: UUID) -> bool:
        result = await self.db.execute(
            select(GeneratedImage.id)
            .where(GeneratedImage.description_id == description_id)
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def get_for_book(
        self,
        book_id: UUID,
        user_id: UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Tuple[GeneratedImage, Description, Chapter]]:
        result = await self.db.execute(
            select(GeneratedImage, Description, Chapter)
            .join(Description, GeneratedImage.description_id == Description.id)
            .join(Chapter, Description.chapter_id == Chapter.id)
            .join(Book, Chapter.book_id == Book.id)
            .where(Book.id == book_id)
            .where(Book.user_id == user_id)
            .order_by(GeneratedImage.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        return [(row[0], row[1], row[2]) for row in result.all()]

    async def create(
        self,
        description_id: UUID,
        user_id: UUID,
        image_url: Optional[str],
        local_path: Optional[str],
        prompt_used: str,
        generation_time_seconds: Optional[float] = None,
        service_used: str = "imagen",
        chapter_id: Optional[UUID] = None,
    ) -> GeneratedImage:
        image = GeneratedImage(
            description_id=description_id,
            user_id=user_id,
            chapter_id=chapter_id,
            service_used=service_used,
            status="completed",
            image_url=image_url,
            local_path=local_path,
            prompt_used=prompt_used,
            generation_time_seconds=generation_time_seconds,
        )
        self.db.add(image)
        await self.db.commit()
        await self.db.refresh(image)
        logger.debug(
            f"Created GeneratedImage {image.id} for description {description_id}"
        )
        return image

    async def delete(
        self,
        image_id: UUID,
        user_id: UUID,
    ) -> bool:
        image = await self.get_by_id(image_id, user_id)
        if not image:
            return False

        await self.db.delete(image)
        await self.db.commit()
        logger.debug(f"Deleted GeneratedImage {image_id}")
        return True

    async def get_user_stats(
        self,
        user_id: UUID,
    ) -> Dict[str, object]:
        total_query = await self.db.execute(
            select(func.count(GeneratedImage.id))
            .join(Description, GeneratedImage.description_id == Description.id)
            .join(Chapter, Description.chapter_id == Chapter.id)
            .join(Book, Chapter.book_id == Book.id)
            .where(Book.user_id == user_id)
        )
        total = total_query.scalar() or 0

        by_type_query = await self.db.execute(
            select(Description.type, func.count(GeneratedImage.id))
            .join(Description, GeneratedImage.description_id == Description.id)
            .join(Chapter, Description.chapter_id == Chapter.id)
            .join(Book, Chapter.book_id == Book.id)
            .where(Book.user_id == user_id)
            .group_by(Description.type)
        )
        by_type = {
            row[0].value if row[0] else "unknown": row[1] for row in by_type_query.all()
        }

        return {"total": total, "by_type": by_type}

    async def get_batch_existing(
        self,
        description_ids: List[UUID],
    ) -> Dict[UUID, GeneratedImage]:
        if not description_ids:
            return {}

        result = await self.db.execute(
            select(GeneratedImage).where(
                GeneratedImage.description_id.in_(description_ids)
            )
        )
        return {img.description_id: img for img in result.scalars().all()}

    async def get_by_local_path(self, local_path: str) -> Optional[GeneratedImage]:
        result = await self.db.execute(
            select(GeneratedImage).where(GeneratedImage.local_path == local_path)
        )
        return result.scalar_one_or_none()

    async def get_by_image_url(self, image_url: str) -> Optional[GeneratedImage]:
        result = await self.db.execute(
            select(GeneratedImage).where(GeneratedImage.image_url == image_url)
        )
        return result.scalar_one_or_none()

    def verify_ownership(self, image: GeneratedImage, user_id: UUID) -> bool:
        return image.user_id == user_id

    async def get_image_with_relations(
        self,
        description_id: UUID,
        user_id: UUID,
    ) -> Optional[Tuple[GeneratedImage, Description, Chapter]]:
        result = await self.db.execute(
            select(GeneratedImage, Description, Chapter)
            .join(Description, GeneratedImage.description_id == Description.id)
            .join(Chapter, Description.chapter_id == Chapter.id)
            .join(Book, Chapter.book_id == Book.id)
            .where(Description.id == description_id)
            .where(Book.user_id == user_id)
        )
        row = result.first()
        if not row:
            return None
        return (row[0], row[1], row[2])

    async def get_user_full_stats(
        self, user_id: UUID
    ) -> Dict[str, int | Dict[str, int]]:
        images_count = await self.db.execute(
            select(func.count(GeneratedImage.id))
            .join(Description, GeneratedImage.description_id == Description.id)
            .join(Chapter, Description.chapter_id == Chapter.id)
            .join(Book, Chapter.book_id == Book.id)
            .where(Book.user_id == user_id)
        )
        total_images: int = images_count.scalar() or 0

        descriptions_count = await self.db.execute(
            select(func.count(Description.id))
            .join(Chapter, Description.chapter_id == Chapter.id)
            .join(Book, Chapter.book_id == Book.id)
            .where(Book.user_id == user_id)
        )
        total_descriptions: int = descriptions_count.scalar() or 0

        by_type_query = await self.db.execute(
            select(Description.type, func.count(GeneratedImage.id))
            .join(GeneratedImage, GeneratedImage.description_id == Description.id)
            .join(Chapter, Description.chapter_id == Chapter.id)
            .join(Book, Chapter.book_id == Book.id)
            .where(Book.user_id == user_id)
            .group_by(Description.type)
        )
        images_by_type: Dict[str, int] = {
            row[0].value if row[0] else "unknown": row[1] for row in by_type_query.all()
        }

        return {
            "total_images": total_images,
            "total_descriptions": total_descriptions,
            "images_by_type": images_by_type,
        }

    async def delete_with_file(self, image_id: UUID, user_id: UUID) -> bool:
        image = await self.get_by_id(image_id, user_id)
        if not image:
            return False

        local_path = image.local_path

        await self.db.delete(image)
        await self.db.commit()

        # Файл удаляем только после успешного коммита: иначе при провале записи
        # строка останется в БД, а файла по её пути уже не будет.
        _unlink_quietly(local_path)

        logger.debug(f"Deleted GeneratedImage {image_id} with file")
        return True

    async def update_after_regeneration(
        self,
        image: GeneratedImage,
        image_url: Optional[str],
        local_path: Optional[str],
        prompt_used: str,
        generation_time_seconds: Optional[float],
    ) -> GeneratedImage:
        old_path = image.local_path

        image.image_url = image_url
        image.local_path = local_path
        image.prompt_used = prompt_used
        image.generation_time_seconds = generation_time_seconds

        await self.db.commit()
        await self.db.refresh(image)

        # Старый файл удаляем только после успешного коммита. Раньше unlink шёл
        # первым, и на cache hit (IllustrationService отдаёт data-URI и local_path=None)
        # commit падал на VARCHAR(2000), rollback возвращал прежний путь в БД —
        # а файла по нему уже не было. Тихая потеря изображения.
        if old_path and old_path != local_path:
            _unlink_quietly(old_path)

        return image

    async def get_admin_stats(self) -> Dict[str, object]:
        total_result = await self.db.execute(select(func.count(GeneratedImage.id)))
        total_count = total_result.scalar() or 0

        type_stats = await self.db.execute(
            select(Description.type, func.count(GeneratedImage.id))
            .join(GeneratedImage, GeneratedImage.description_id == Description.id)
            .group_by(Description.type)
        )
        type_distribution = {
            row[0].value if row[0] else "unknown": row[1] for row in type_stats.all()
        }

        avg_time_result = await self.db.execute(
            select(func.avg(GeneratedImage.generation_time_seconds)).where(
                GeneratedImage.generation_time_seconds.is_not(None)
            )
        )
        avg_time = avg_time_result.scalar() or 0

        return {
            "total_images": total_count,
            "type_distribution": type_distribution,
            "avg_generation_time": round(float(avg_time), 2),
        }

    async def get_description_with_access_check(
        self,
        description_id: UUID,
        user_id: UUID,
    ) -> Optional[Description]:
        result = await self.db.execute(
            select(Description)
            .join(Chapter)
            .join(Book)
            .where(Description.id == description_id)
            .where(Book.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_chapter_with_access_check(
        self,
        chapter_id: UUID,
        user_id: UUID,
    ) -> Optional[Chapter]:
        result = await self.db.execute(
            select(Chapter)
            .join(Book)
            .where(Chapter.id == chapter_id)
            .where(Book.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_chapter_descriptions(
        self,
        chapter_id: UUID,
        description_types: Optional[List] = None,
    ) -> List[Description]:
        query = select(Description).where(Description.chapter_id == chapter_id)

        if description_types:
            query = query.where(Description.type.in_(description_types))

        result = await self.db.execute(
            query.order_by(Description.priority_score.desc())
        )
        return list(result.scalars().all())

    async def get_book_for_chapter(self, chapter_id: UUID) -> Optional[Book]:
        from app.models.chapter import Chapter as ChapterModel

        result = await self.db.execute(
            select(Book)
            .join(ChapterModel, Book.id == ChapterModel.book_id)
            .where(ChapterModel.id == chapter_id)
        )
        return result.scalar_one_or_none()


async def get_image_crud_service(db: AsyncSession) -> ImageCRUDService:
    return ImageCRUDService(db)
