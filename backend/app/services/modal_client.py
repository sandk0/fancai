"""Modal client — конвертер ответов и lazy-ссылки на развёрнутые классы."""

import logging
from typing import Any, Dict

from app.models.description import DescriptionType
from app.schemas.extraction import (
    ChapterAnalysisResult,
    ExtractedDescription,
    ExtractedEntity,
    ExtractedRelationship,
)

logger = logging.getLogger(__name__)

# Условный импорт — Modal SDK не нужен для тестов и локальной разработки
try:
    import modal

    MODAL_AVAILABLE = True
except ImportError:
    modal = None  # type: ignore
    MODAL_AVAILABLE = False

# Маппинг строки типа описания → enum
_DESCRIPTION_TYPE_MAP = {dt.value: dt for dt in DescriptionType}


def get_llm_extractor():
    """Lazy-ссылка на развёрнутый Modal LLMExtractor."""
    if not MODAL_AVAILABLE:
        raise RuntimeError("Modal SDK not installed")
    cls = modal.Cls.from_name("fancai-pipeline", "LLMExtractor")
    return cls()


def get_image_generator():
    """Lazy-ссылка на развёрнутый Modal ImageGenerator."""
    if not MODAL_AVAILABLE:
        raise RuntimeError("Modal SDK not installed")
    cls = modal.Cls.from_name("fancai-pipeline", "ImageGenerator")
    return cls()


def modal_response_to_chapter_result(
    modal_json: Dict[str, Any],
) -> ChapterAnalysisResult:
    """Конвертация JSON-ответа Modal LLM в ChapterAnalysisResult.

    Modal LLM возвращает JSON, соответствующий ModalExtractionResponse.
    Эта функция конвертирует его в существующую структуру dataclass'ов,
    используемую ConsistencyManager, book_tasks и остальным pipeline.
    """
    entities = [
        ExtractedEntity(
            name=e.get("name", ""),
            type=e.get("type", "character"),
            visual_summary=e.get("visual_summary", ""),
            aliases=e.get("aliases", []),
            confidence=e.get("confidence", 0.0),
            importance=e.get("importance", 0),
            first_mention_offset=e.get("first_mention_offset"),
            chapter_event_action=e.get("chapter_event_action"),
            chapter_event_inner=e.get("chapter_event_inner"),
        )
        for e in modal_json.get("entities", [])
    ]

    descriptions = [
        ExtractedDescription(
            content=d.get("content", ""),
            description_type=_DESCRIPTION_TYPE_MAP.get(
                d.get("type", "location"), DescriptionType.LOCATION
            ),
            confidence=d.get("confidence", 0.0),
            entities=[{"name": name} for name in d.get("entities", [])],
            position=d.get("text_offset", 0) or 0,
        )
        for d in modal_json.get("descriptions", [])
    ]

    relationships = [
        ExtractedRelationship(
            source=r.get("source", ""),
            target=r.get("target", ""),
            type=r.get("type", ""),
            weight=r.get("weight", 0.5),
            context=r.get("context", ""),
        )
        for r in modal_json.get("relationships", [])
    ]

    return ChapterAnalysisResult(
        descriptions=descriptions,
        entities=entities,
        relationships=relationships,
    )
