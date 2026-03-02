"""
Description Extraction Service — централизованная бизнес-логика для работы с описаниями.

Этот сервис инкапсулирует всю бизнес-логику работы с описаниями:
- Извлечение описаний из глав через LLM (Gemini)
- Кэширование результатов в Redis
- Batch-загрузка описаний для нескольких глав
- Построение response объектов для API

Usage:
    from app.services.description_extraction_service import (
        DescriptionExtractionService,
        get_description_service,
    )

    service = DescriptionExtractionService(db)
    result = await service.extract_for_chapter(chapter)
"""

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union
from uuid import UUID
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from loguru import logger

from app.models.description import Description, DescriptionType
from app.models.chapter import Chapter
from app.core.cache import cache_manager, DistributedLock
from app.services.gemini_extractor import gemini_extractor, ExtractedDescription
from app.schemas.responses import DescriptionResponse
from app.schemas.responses.descriptions import (
    ChapterMinimalInfo,
    DescriptionsAnalysis,
    ChapterDescriptionsResponse,
    ChapterDescriptionsResult,
    BatchDescriptionsResponse,
)


class DescriptionServiceError(Exception):
    """Base exception for DescriptionExtractionService."""

    pass


class DescriptionNotFoundError(DescriptionServiceError):
    def __init__(self, description_id: UUID):
        self.description_id = description_id
        super().__init__(f"Description {description_id} not found")


class ExtractionTimeoutError(DescriptionServiceError):
    def __init__(self, chapter_id: UUID, timeout_seconds: float):
        self.chapter_id = chapter_id
        self.timeout_seconds = timeout_seconds
        super().__init__(
            f"Extraction timeout ({timeout_seconds}s) for chapter {chapter_id}"
        )


class ExtractionLockError(DescriptionServiceError):
    def __init__(self, chapter_id: UUID):
        self.chapter_id = chapter_id
        super().__init__(f"Extraction already in progress for chapter {chapter_id}")


class LLMUnavailableError(DescriptionServiceError):
    def __init__(self):
        super().__init__("LLM processor unavailable. Check OPENROUTER_API_KEY.")


@dataclass
class ExtractionResult:
    descriptions: List[Description]
    chapter_id: UUID
    extraction_time_ms: float


@dataclass
class ChapterDescriptions:
    chapter_id: UUID
    descriptions: List[Description]
    by_type: Dict[str, int]


class DescriptionExtractionService:
    """Service for description extraction and management."""

    LLM_EXTRACTION_TIMEOUT = 30.0
    LOCK_TTL = 45
    CACHE_TTL = 3600

    def __init__(self, db: AsyncSession):
        self.db = db

    async def extract_for_chapter(
        self,
        chapter: Chapter,
        delete_existing: bool = True,
    ) -> ExtractionResult:
        if not gemini_extractor.is_available():
            raise LLMUnavailableError()

        # Capture scalar ID before try block — after rollback() ORM objects are expired
        # and accessing .id triggers MissingGreenlet in async context
        chapter_id = chapter.id
        lock_key = f"llm_extract_lock:chapter:{chapter_id}"

        async with DistributedLock(
            cache_manager, lock_key, ttl=self.LOCK_TTL, renewal_interval=20
        ) as lock_acquired:
            if not lock_acquired:
                raise ExtractionLockError(chapter_id)

            start_time = datetime.now(timezone.utc)

            try:
                logger.info(f"🔄 Starting LLM extraction for chapter {chapter_id}")

                try:
                    result = await asyncio.wait_for(
                        gemini_extractor.extract_descriptions(chapter.content),
                        timeout=self.LLM_EXTRACTION_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    await self.db.rollback()
                    raise ExtractionTimeoutError(
                        chapter_id, self.LLM_EXTRACTION_TIMEOUT
                    )

                descriptions_data = result if result else []

                if delete_existing:
                    await self._delete_chapter_descriptions(chapter_id)

                descriptions = []
                for position, desc_data in enumerate(descriptions_data):
                    desc = self._create_description_from_data(
                        chapter_id=chapter_id, desc_data=desc_data, position=position
                    )
                    self.db.add(desc)
                    descriptions.append(desc)

                chapter.descriptions_found = len(descriptions)
                chapter.is_description_parsed = True
                chapter.parsed_at = datetime.now(timezone.utc)

                await self.db.commit()

                for desc in descriptions:
                    await self.db.refresh(desc)

                extraction_time_ms = (
                    datetime.now(timezone.utc) - start_time
                ).total_seconds() * 1000

                logger.info(
                    f"✅ LLM extraction complete for chapter {chapter_id}: "
                    f"{len(descriptions)} descriptions in {extraction_time_ms:.0f}ms"
                )

                return ExtractionResult(
                    descriptions=descriptions,
                    chapter_id=chapter_id,
                    extraction_time_ms=extraction_time_ms,
                )

            except ExtractionTimeoutError:
                raise
            except Exception:
                await self.db.rollback()
                raise

    async def get_chapter_descriptions(
        self,
        chapter_id: UUID,
        use_cache: bool = True,
        book_id: Optional[UUID] = None,
        chapter_number: Optional[int] = None,
    ) -> List[Description]:
        if use_cache and book_id and chapter_number:
            cache_key = self._get_cache_key(book_id, chapter_number)
            cached = await cache_manager.get(cache_key)
            if cached:
                logger.debug(f"🎯 Cache HIT for chapter {chapter_number}")
                return cached

        result = await self.db.execute(
            select(Description)
            .where(Description.chapter_id == chapter_id)
            .order_by(Description.position_in_chapter)
        )
        return list(result.scalars().all())

    async def get_by_id(
        self,
        description_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Optional[Description]:
        from app.models.book import Book

        if user_id:
            result = await self.db.execute(
                select(Description)
                .join(Chapter, Description.chapter_id == Chapter.id)
                .join(Book, Chapter.book_id == Book.id)
                .where(Description.id == description_id)
                .where(Book.user_id == user_id)
            )
        else:
            result = await self.db.execute(
                select(Description).where(Description.id == description_id)
            )

        return result.scalar_one_or_none()

    async def get_batch(
        self,
        chapter_ids: List[UUID],
    ) -> Dict[UUID, List[Description]]:
        if not chapter_ids:
            return {}

        logger.debug(f"🗄️ Batch loading descriptions for {len(chapter_ids)} chapters")

        result = await self.db.execute(
            select(Description)
            .where(Description.chapter_id.in_(chapter_ids))
            .order_by(Description.chapter_id, Description.position_in_chapter)
        )
        all_descriptions = result.scalars().all()

        descriptions_by_chapter: Dict[UUID, List[Description]] = {}
        for desc in all_descriptions:
            if desc.chapter_id not in descriptions_by_chapter:
                descriptions_by_chapter[desc.chapter_id] = []
            descriptions_by_chapter[desc.chapter_id].append(desc)

        logger.debug(
            f"🗄️ Loaded {len(all_descriptions)} descriptions for "
            f"{len(descriptions_by_chapter)} chapters"
        )

        return descriptions_by_chapter

    async def invalidate_cache(
        self,
        book_id: UUID,
        chapter_number: int,
    ) -> None:
        cache_key = self._get_cache_key(book_id, chapter_number)
        await cache_manager.delete(cache_key)
        logger.debug(f"🗑️ Invalidated cache: {cache_key}")

    async def cache_response(
        self,
        book_id: UUID,
        chapter_number: int,
        response_data: dict,
    ) -> None:
        cache_key = self._get_cache_key(book_id, chapter_number)
        try:
            await cache_manager.set(cache_key, response_data, ttl=self.CACHE_TTL)
            logger.debug(f"💾 Cached descriptions for chapter {chapter_number}")
        except Exception as e:
            logger.warning(f"Failed to cache descriptions: {e}")

    async def _delete_chapter_descriptions(self, chapter_id: UUID) -> int:
        result = await self.db.execute(
            select(Description).where(Description.chapter_id == chapter_id)
        )
        descriptions = result.scalars().all()

        for desc in descriptions:
            await self.db.delete(desc)

        return len(descriptions)

    def _create_description_from_data(
        self,
        chapter_id: UUID,
        desc_data: Union[ExtractedDescription, Dict[str, Any]],
        position: int,
    ) -> Description:
        if isinstance(desc_data, dict):
            desc_dict = desc_data
        elif hasattr(desc_data, "to_dict"):
            desc_dict = desc_data.to_dict()
        else:
            desc_dict = {"content": str(desc_data)}

        type_str = desc_dict.get("type", "location")
        try:
            desc_type = DescriptionType(type_str)
        except ValueError:
            desc_type = DescriptionType.LOCATION

        content = desc_dict.get("content", "")

        return Description(
            chapter_id=chapter_id,
            type=desc_type,
            content=content,
            confidence_score=desc_dict.get("confidence_score", 0.8),
            priority_score=desc_dict.get("priority_score", 0.5),
            position_in_chapter=position,
            word_count=desc_dict.get("word_count", len(content.split())),
        )

    @staticmethod
    def _get_cache_key(book_id: UUID, chapter_number: int) -> str:
        return f"descriptions:book:{book_id}:chapter:{chapter_number}"

    @staticmethod
    def group_by_type(descriptions: List[Description]) -> Dict[str, int]:
        by_type: Dict[str, int] = {}
        for desc in descriptions:
            type_value = desc.type.value if desc.type else "location"
            by_type[type_value] = by_type.get(type_value, 0) + 1
        return by_type

    def build_description_response(self, desc: Description) -> DescriptionResponse:
        return DescriptionResponse(
            id=desc.id,
            chapter_id=desc.chapter_id,
            type=desc.type,
            content=desc.content,
            context=desc.context or "",
            confidence_score=desc.confidence_score,
            priority_score=desc.priority_score,
            position_in_chapter=desc.position_in_chapter,
            word_count=desc.word_count,
            is_suitable_for_generation=desc.is_suitable_for_generation,
            image_generated=desc.image_generated,
            created_at=desc.created_at,
            updated_at=desc.updated_at,
        )

    def build_chapter_response(
        self,
        chapter: Chapter,
        descriptions: List[Description],
        processing_time_seconds: Optional[float] = None,
    ) -> ChapterDescriptionsResponse:
        chapter_info = ChapterMinimalInfo(
            id=chapter.id,
            number=chapter.chapter_number,
            title=chapter.title or f"Глава {chapter.chapter_number}",
            word_count=chapter.word_count,
        )

        by_type = self.group_by_type(descriptions)
        desc_responses = [self.build_description_response(d) for d in descriptions]

        nlp_analysis = DescriptionsAnalysis(
            total_descriptions=len(descriptions),
            by_type=by_type,
            descriptions=desc_responses,
            processing_time_seconds=processing_time_seconds,
        )

        return ChapterDescriptionsResponse(
            chapter_info=chapter_info,
            nlp_analysis=nlp_analysis,
        )

    def build_empty_chapter_response(
        self, chapter: Chapter
    ) -> ChapterDescriptionsResponse:
        chapter_info = ChapterMinimalInfo(
            id=chapter.id,
            number=chapter.chapter_number,
            title=chapter.title or f"Глава {chapter.chapter_number}",
            word_count=chapter.word_count,
        )
        return ChapterDescriptionsResponse(
            chapter_info=chapter_info,
            nlp_analysis=DescriptionsAnalysis(
                total_descriptions=0,
                by_type={},
                descriptions=[],
            ),
        )

    async def get_cached_response(
        self,
        book_id: UUID,
        chapter_number: int,
    ) -> Optional[ChapterDescriptionsResponse]:
        cache_key = self._get_cache_key(book_id, chapter_number)
        cached = await cache_manager.get(cache_key)
        if cached:
            logger.debug(f"🎯 Redis cache HIT for chapter {chapter_number}")
            try:
                return ChapterDescriptionsResponse(**cached)
            except Exception as e:
                logger.warning(f"Failed to parse cached descriptions: {e}")
        return None

    async def get_chapter_with_response(
        self,
        chapter: Chapter,
        book_id: UUID,
        use_cache: bool = True,
    ) -> ChapterDescriptionsResponse:
        if use_cache:
            cached = await self.get_cached_response(book_id, chapter.chapter_number)
            if cached:
                return cached

        descriptions = await self.get_chapter_descriptions(chapter.id, use_cache=False)
        response = self.build_chapter_response(chapter, descriptions)

        if descriptions:
            await self.cache_response(
                book_id, chapter.chapter_number, response.model_dump(mode="json")
            )

        return response

    async def get_batch_with_response(
        self,
        book_id: UUID,
        chapter_numbers: List[int],
        chapters_by_number: Dict[int, Chapter],
    ) -> BatchDescriptionsResponse:
        results: List[ChapterDescriptionsResult] = []
        chapters_to_fetch: List[int] = []
        chapter_ids_to_fetch: List[UUID] = []
        chapters_to_cache_service_page: List[Chapter] = []

        for chapter_number in chapter_numbers:
            cached = await self.get_cached_response(book_id, chapter_number)
            if cached:
                results.append(
                    ChapterDescriptionsResult(
                        chapter_number=chapter_number,
                        success=True,
                        data=cached,
                    )
                )
                continue

            chapter = chapters_by_number.get(chapter_number)
            if not chapter:
                results.append(
                    ChapterDescriptionsResult(
                        chapter_number=chapter_number,
                        success=False,
                        error=f"Chapter {chapter_number} not found",
                    )
                )
                continue

            is_service_page = chapter.check_is_service_page()

            if chapter.is_service_page is None:
                chapter.is_service_page = is_service_page
                chapters_to_cache_service_page.append(chapter)

            if is_service_page:
                results.append(
                    ChapterDescriptionsResult(
                        chapter_number=chapter_number,
                        success=True,
                        data=self.build_empty_chapter_response(chapter),
                    )
                )
                continue

            chapters_to_fetch.append(chapter_number)
            chapter_ids_to_fetch.append(chapter.id)

        descriptions_by_chapter = await self.get_batch(chapter_ids_to_fetch)

        for chapter_number in chapters_to_fetch:
            chapter = chapters_by_number[chapter_number]
            descriptions = descriptions_by_chapter.get(chapter.id, [])

            response = self.build_chapter_response(chapter, descriptions)

            results.append(
                ChapterDescriptionsResult(
                    chapter_number=chapter_number,
                    success=True,
                    data=response,
                )
            )

            if descriptions:
                await self.cache_response(
                    book_id, chapter_number, response.model_dump(mode="json")
                )

        chapter_order = {num: idx for idx, num in enumerate(chapter_numbers)}
        results.sort(key=lambda r: chapter_order.get(r.chapter_number, 999))

        if chapters_to_cache_service_page:
            await self.db.commit()
            logger.debug(
                f"📝 Cached is_service_page for {len(chapters_to_cache_service_page)} chapters"
            )

        total_descriptions = sum(
            r.data.nlp_analysis.total_descriptions
            for r in results
            if r.success and r.data
        )
        success_count = sum(1 for r in results if r.success)

        logger.info(
            f"✅ Batch complete: {success_count}/{len(chapter_numbers)} chapters, "
            f"{total_descriptions} total descriptions"
        )

        return BatchDescriptionsResponse(
            book_id=book_id,
            chapters=results,
            total_requested=len(chapter_numbers),
            total_success=success_count,
            total_descriptions=total_descriptions,
        )

    async def check_has_descriptions(self, chapter_id: UUID) -> bool:
        result = await self.db.execute(
            select(Description).where(Description.chapter_id == chapter_id).limit(1)
        )
        return result.scalar_one_or_none() is not None

    def is_llm_available(self) -> bool:
        return gemini_extractor.is_available()


async def get_description_service(db: AsyncSession) -> DescriptionExtractionService:
    return DescriptionExtractionService(db)
