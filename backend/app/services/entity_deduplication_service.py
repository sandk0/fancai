"""
LLM-based Entity Deduplication Service.

Uses Gemini to identify semantic duplicates among entities:
- "Гарри Поттер" ↔ "Поттер" ↔ "Мальчик-который-выжил"
- "Геральт" ↔ "Белый Волк" ↔ "Ведьмак"

EC-1.2: LLM Entity Alias Merging
"""

import logging
from typing import List, Optional
from uuid import UUID
from dataclasses import dataclass

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.entity import Entity
from app.core.retry import retry_llm_extraction
from app.monitoring.metrics import record_llm_request, record_llm_error

logger = logging.getLogger(__name__)


class EntityForAnalysis(BaseModel):
    id: str
    name: str
    type: str
    visual_summary: Optional[str] = None
    aliases: List[str] = Field(default_factory=list)
    importance: int = 5


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

        entities = await self._load_entities(book_id)
        if len(entities) < 2:
            logger.info(f"[EntityDedup] Less than 2 entities, nothing to deduplicate")
            return DeduplicationResponse(no_duplicates_found=True)

        entities_for_analysis = self._prepare_entities(entities)

        try:
            response = await self._call_gemini(entities_for_analysis)
            logger.info(
                f"[EntityDedup] Found {len(response.merge_groups)} merge groups"
            )
            return response
        except Exception as e:
            logger.exception(f"[EntityDedup] LLM call failed: {e}")
            record_llm_error("deduplication", str(e))
            return DeduplicationResponse(no_duplicates_found=True)

    async def _load_entities(self, book_id: UUID) -> List[Entity]:
        result = await self.db.execute(
            select(Entity)
            .where(Entity.book_id == book_id)
            .order_by(Entity.importance.desc())
        )
        return list(result.scalars().all())

    def _prepare_entities(self, entities: List[Entity]) -> List[EntityForAnalysis]:
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
                )
            )
        return result

    @retry_llm_extraction
    async def _call_gemini(
        self, entities: List[EntityForAnalysis]
    ) -> DeduplicationResponse:
        import time
        import os
        import google.genai as genai
        from google.genai import types
        from app.core.config import settings

        api_key = settings.GOOGLE_API_KEY or os.getenv("LANGEXTRACT_API_KEY")
        client = genai.Client(api_key=api_key)

        entities_json = "\n".join(
            [
                f'- ID: {e.id}, Name: "{e.name}", Type: {e.type}, '
                f'Aliases: {e.aliases}, Visual: "{e.visual_summary or "N/A"}", '
                f"Importance: {e.importance}"
                for e in entities
            ]
        )

        prompt = DEDUPLICATION_PROMPT.format(entities_json=entities_json)

        start_time = time.time()
        response = await client.aio.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=DeduplicationResponse,
                temperature=0.1,
            ),
        )
        duration = time.time() - start_time
        record_llm_request("gemini-dedup", "success", duration)

        if not response.text:
            logger.warning("[EntityDedup] Empty response from Gemini")
            return DeduplicationResponse(no_duplicates_found=True)

        return DeduplicationResponse.model_validate_json(response.text)


def get_entity_deduplication_service(db: AsyncSession) -> EntityDeduplicationService:
    return EntityDeduplicationService(db=db)
