"""
LLM-based Entity Deduplication Service.

Uses Gemini to identify semantic duplicates among entities:
- "Гарри Поттер" ↔ "Поттер" ↔ "Мальчик-который-выжил"
- "Геральт" ↔ "Белый Волк" ↔ "Ведьмак"

EC-1.2: LLM Entity Alias Merging
"""

import logging
from collections import defaultdict
from typing import Dict, List, Optional
from uuid import UUID
from dataclasses import dataclass

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.entity import Entity
from app.models.entity_mention import EntityMention
from app.models.chapter import Chapter
from app.core.retry import retry_llm_extraction
from app.monitoring.metrics import record_llm_request, record_llm_error
from app.core.openrouter_client import get_openrouter_client

logger = logging.getLogger(__name__)


class EntityForAnalysis(BaseModel):
    id: str
    name: str
    type: str
    visual_summary: Optional[str] = None
    aliases: List[str] = Field(default_factory=list)
    importance: int = 5
    chapters: List[int] = Field(default_factory=list)


class MergeGroup(BaseModel):
    master_id: str = Field(description="ID сущности, которая должна стать главной")
    duplicate_ids: List[str] = Field(
        description="ID сущностей-дубликатов для объединения"
    )
    confidence: float = Field(
        description="Уверенность в том, что это дубликаты (0.0-1.0)"
    )
    reason: str = Field(description="Причина объединения")


class DeduplicationResponse(BaseModel):
    merge_groups: List[MergeGroup] = Field(default_factory=list)
    no_duplicates_found: bool = False


DEDUPLICATION_PROMPT = """Ты — эксперт по анализу литературных персонажей и сущностей.

ЗАДАЧА: Проанализируй список сущностей из книги и найди ДУБЛИКАТЫ — сущности, которые относятся к ОДНОМУ И ТОМУ ЖЕ персонажу/месту/объекту.

КРИТЕРИИ ДУБЛИКАТОВ:
1. Полное имя vs сокращённое: "Гарри Поттер" = "Гарри" = "Поттер"
2. Прозвища и титулы: "Геральт" = "Белый Волк" = "Ведьмак"
3. Разные формы имени: "Иван Петрович" = "Ваня" = "Иванушка"
4. Переводы/транслитерации: "Aragorn" = "Арагорн"
5. Описательные имена: "Старый волшебник" = "Дамблдор" (если контекст visual_summary совпадает)

НЕ ДУБЛИКАТЫ:
- Разные персонажи с похожими именами
- Родственники (отец/сын с одинаковой фамилией)
- Локации с похожими названиями но в разных местах

ФОРМАТ ОТВЕТА: JSON с merge_groups. Для каждой группы укажи:
- master_id: ID сущности с наиболее полным именем/описанием
- duplicate_ids: IDs дубликатов
- confidence: 0.7-1.0 (выше = уверенней)
- reason: краткое объяснение

СУЩНОСТИ ДЛЯ АНАЛИЗА:
{entities_json}

Если дубликатов нет, верни: {{"merge_groups": [], "no_duplicates_found": true}}
"""


@dataclass
class EntityDeduplicationService:
    db: AsyncSession

    async def suggest_merges(self, book_id: UUID) -> DeduplicationResponse:
        logger.info(f"[EntityDedup] Analyzing entities for book_id={book_id}")

        # Distributed lock to prevent concurrent deduplication for same book
        from app.core.cache import cache_manager

        lock_key = f"entity:dedup:{book_id}"
        lock_acquired = await cache_manager.acquire_lock(lock_key, ttl=300)
        if not lock_acquired:
            from fastapi import HTTPException

            raise HTTPException(
                status_code=409,
                detail="Deduplication already in progress for this book",
            )

        try:
            entities = await self._load_entities(book_id)
            if len(entities) < 2:
                logger.info(
                    "[EntityDedup] Less than 2 entities, nothing to deduplicate"
                )
                return DeduplicationResponse(no_duplicates_found=True)

            # Load chapter numbers for each entity via mentions
            entity_chapters = await self._load_entity_chapters(book_id)

            entities_for_analysis = self._prepare_entities(entities, entity_chapters)

            try:
                response = await self._call_gemini(entities_for_analysis)
                logger.info(
                    f"[EntityDedup] Found {len(response.merge_groups)} merge groups"
                )
                return response
            except Exception as e:
                logger.exception(f"[EntityDedup] LLM call failed: {e}")
                record_llm_error("openrouter-dedup", type(e).__name__)
                return DeduplicationResponse(no_duplicates_found=True)
        finally:
            await cache_manager.release_lock(lock_key)

    async def _load_entities(self, book_id: UUID) -> List[Entity]:
        result = await self.db.execute(
            select(Entity)
            .where(Entity.book_id == book_id)
            .order_by(Entity.importance.desc())
        )
        return list(result.scalars().all())

    async def _load_entity_chapters(self, book_id: UUID) -> Dict[str, List[int]]:
        """Load chapter numbers where each entity is mentioned."""
        result = await self.db.execute(
            select(EntityMention.entity_id, Chapter.chapter_number)
            .join(Chapter, EntityMention.chapter_id == Chapter.id)
            .where(Chapter.book_id == book_id)
        )
        rows = result.all()

        entity_chapters: Dict[str, List[int]] = defaultdict(list)
        for entity_id, chapter_number in rows:
            entity_chapters[str(entity_id)].append(chapter_number)

        # Deduplicate and sort chapter numbers
        for entity_id in entity_chapters:
            entity_chapters[entity_id] = sorted(set(entity_chapters[entity_id]))

        return dict(entity_chapters)

    def _prepare_entities(
        self,
        entities: List[Entity],
        entity_chapters: Optional[Dict[str, List[int]]] = None,
    ) -> List[EntityForAnalysis]:
        entity_chapters = entity_chapters or {}
        result = []
        for e in entities:
            aliases = []
            if e.entity_metadata and isinstance(e.entity_metadata, dict):
                aliases = e.entity_metadata.get("aliases", [])

            result.append(
                EntityForAnalysis(
                    id=str(e.id),
                    name=e.name,
                    type=str(e.type),
                    visual_summary=e.visual_summary,
                    aliases=aliases,
                    importance=e.importance or 5,
                    chapters=entity_chapters.get(str(e.id), []),
                )
            )
        return result

    @retry_llm_extraction
    async def _call_gemini(
        self, entities: List[EntityForAnalysis]
    ) -> DeduplicationResponse:
        """
        Вызов OpenRouter API для дедупликации сущностей.

        Plan 03-02: Мигрирован с google-genai на OpenRouter generate_structured().
        DeduplicationResponse содержит вложенные Optional поля — _inline_defs корректно их обрабатывает.
        """
        import time

        client = get_openrouter_client()

        entities_json = "\n".join(
            [
                f'- ID: {e.id}, Name: "{e.name}", Type: {e.type}, '
                f"Aliases: {e.aliases}, Chapters: {e.chapters}, "
                f'Visual: "{e.visual_summary or "N/A"}", '
                f"Importance: {e.importance}"
                for e in entities
            ]
        )

        prompt = DEDUPLICATION_PROMPT.format(entities_json=entities_json)

        start_time = time.time()
        raw_dict = await client.generate_structured(
            prompt=prompt,
            schema_class=DeduplicationResponse,
            temperature=0.1,
        )
        duration = time.time() - start_time
        record_llm_request("openrouter-dedup", "success", duration)

        if not raw_dict:
            logger.warning("[EntityDedup] Empty response from OpenRouter")
            return DeduplicationResponse(no_duplicates_found=True)

        return DeduplicationResponse.model_validate(raw_dict)


def get_entity_deduplication_service(db: AsyncSession) -> EntityDeduplicationService:
    return EntityDeduplicationService(db=db)
