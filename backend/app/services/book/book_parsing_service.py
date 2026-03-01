"""
Сервис для управления парсингом книг и LLM обработкой.

Ответственности:
- Извлечение описаний из глав с помощью LLM (Gemini)
- Управление прогрессом парсинга
- Маппинг жанров (перенесено из BookService)
- Интеграция с Celery tasks для асинхронного парсинга

Single Responsibility Principle:
Сервис отвечает ТОЛЬКО за парсинг и LLM обработку.
Не занимается CRUD операциями книг или статистикой.
"""

from typing import List, Optional, Dict, Any, TYPE_CHECKING
from uuid import UUID
import logging
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ...models.book import Book
from ...models.chapter import Chapter

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from .book_service import BookService


class BookParsingService:
    """Сервис для управления парсингом и LLM обработкой книг."""

    def __init__(self, book_service: Optional["BookService"] = None):
        """
        Инициализация сервиса парсинга.

        Args:
            book_service: Опциональная зависимость от BookService (Dependency Injection)
        """
        # Lazy import для избежания circular dependency
        if book_service is None:
            from .book_service import book_service as default_service

            self.book_service = default_service
        else:
            self.book_service = book_service

    async def extract_chapter_descriptions(
        self, db: AsyncSession, chapter_id: UUID
    ) -> List[Dict[str, Any]]:
        """
        Извлекает описания из главы с помощью LLM (on-demand).

        После удаления NLP системы описания не сохраняются в БД,
        а извлекаются по запросу через LangExtract/Gemini API.

        Args:
            db: Сессия базы данных
            chapter_id: ID главы

        Returns:
            Список словарей с описаниями (не модели Description)

        Raises:
            ValueError: Если глава не найдена
        """
        from ...services.gemini_extractor import gemini_extractor

        result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
        chapter = result.scalar_one_or_none()
        if not chapter:
            raise ValueError(f"Chapter {chapter_id} not found")

        if not gemini_extractor.is_available():
            logger.warning("Gemini extractor not available, returning empty list")
            return []

        try:
            descriptions = await gemini_extractor.extract_descriptions(
                text=chapter.content, chapter_id=str(chapter_id)
            )
            converted: List[Dict[str, Any]] = []
            for d in descriptions:
                if hasattr(d, "to_dict"):
                    converted.append(d.to_dict())
                elif isinstance(d, dict):
                    converted.append(d)
            return converted
        except Exception as e:
            logger.error(f"Error extracting descriptions for chapter {chapter_id}: {e}")
            return []

    async def get_book_descriptions(
        self,
        db: AsyncSession,
        book_id: UUID,
        description_type: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Получает описания из всех глав книги (on-demand через LLM).

        После удаления NLP системы описания извлекаются по запросу.

        Args:
            db: Сессия базы данных
            book_id: ID книги
            description_type: Фильтр по типу описания (location, character, atmosphere)
            limit: Максимальное количество описаний

        Returns:
            Список описаний в виде словарей
        """
        from ...services.gemini_extractor import gemini_extractor
        from sqlalchemy.orm import selectinload

        chapters_result = await db.execute(
            select(Chapter)
            .where(Chapter.book_id == book_id)
            .options(selectinload(Chapter.descriptions))
            .order_by(Chapter.chapter_number)
        )
        chapters = chapters_result.scalars().all()

        if not chapters:
            return []

        if not gemini_extractor.is_available():
            logger.warning("Gemini extractor not available")
            return []

        all_descriptions: List[Dict[str, Any]] = []
        for idx, chapter in enumerate(chapters):
            if len(all_descriptions) >= limit:
                break

            # Rate limiting: delay between LLM calls (skip first call)
            if idx > 0:
                await asyncio.sleep(0.5)  # 500ms delay to avoid API rate limits

            try:
                descriptions = await gemini_extractor.extract_descriptions(
                    text=chapter.content, chapter_id=str(chapter.id)
                )

                for desc in descriptions:
                    if hasattr(desc, "to_dict"):
                        desc_dict = desc.to_dict()
                    elif isinstance(desc, dict):
                        desc_dict = desc
                    else:
                        continue
                    if description_type and desc_dict.get("type") != description_type:
                        continue
                    all_descriptions.append(desc_dict)
                    if len(all_descriptions) >= limit:
                        break
            except Exception as e:
                logger.error(
                    f"Error extracting descriptions for chapter {chapter.id}: {e}"
                )
                continue

        all_descriptions.sort(key=lambda x: x.get("priority_score", 0), reverse=True)
        return all_descriptions[:limit]

    async def get_parsing_status(self, db: AsyncSession, book_id: UUID) -> dict:
        """
        Получает статус парсинга книги.

        После удаления NLP системы возвращает упрощенный статус.

        Args:
            db: Сессия базы данных
            book_id: ID книги

        Returns:
            Словарь со статусом:
            - total_chapters: Всего глав
            - llm_available: Доступен ли LLM процессор

        Raises:
            ValueError: Если книга не найдена
        """
        from sqlalchemy import func
        from ...services.gemini_extractor import gemini_extractor

        result = await db.execute(select(Book).where(Book.id == book_id))
        book = result.scalar_one_or_none()

        if not book:
            raise ValueError(f"Book with id {book_id} not found")

        total_chapters_result = await db.execute(
            select(func.count(Chapter.id)).where(Chapter.book_id == book_id)
        )
        total_chapters = total_chapters_result.scalar() or 0

        llm_available = gemini_extractor.is_available()

        return {
            "total_chapters": total_chapters,
            "llm_available": llm_available,
            "extraction_mode": "on_demand",
            "message": "Descriptions are extracted on-demand via Gemini API",
        }


# Глобальный экземпляр сервиса (для обратной совместимости)
book_parsing_service = BookParsingService()
