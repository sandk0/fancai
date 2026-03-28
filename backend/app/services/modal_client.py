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


async def is_modal_enabled(db) -> bool:
    """Проверка: Modal SDK доступен И feature flag включён."""
    if not MODAL_AVAILABLE:
        return False
    from app.services.feature_flag_manager import FeatureFlagManager

    flag_mgr = FeatureFlagManager(db)
    await flag_mgr.initialize()
    return await flag_mgr.is_enabled("USE_MODAL_PIPELINE", default=False)


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


def extract_modal_metrics(modal_json: Dict[str, Any]) -> Dict[str, Any]:
    """Extract metrics from Modal response (backward compatible with D-08).

    New format: {"result": {...}, "metrics": {"cold_start_ms": ..., ...}}
    Old format: {"entities": [...], ...} -> no metrics -> {}
    """
    return modal_json.get("metrics", {})


def extract_modal_result(modal_json: Dict[str, Any]) -> Dict[str, Any]:
    """Extract result from Modal response (backward compatible).

    New format: {"result": {...}, "metrics": {...}}
    Old format: {"entities": [...], "descriptions": [...], ...}
    """
    result = modal_json.get("result")
    if result is not None:
        return result
    # Backward compat: old format -- entire dict is the result
    if "entities" in modal_json or "descriptions" in modal_json:
        return modal_json
    return modal_json


def modal_response_to_chapter_result(
    modal_json: Dict[str, Any],
) -> ChapterAnalysisResult:
    """Конвертация JSON-ответа Modal LLM в ChapterAnalysisResult.

    Modal LLM возвращает JSON, соответствующий ModalExtractionResponse.
    Эта функция конвертирует его в существующую структуру dataclass'ов,
    используемую ConsistencyManager, book_tasks и остальным pipeline.

    Supports both new format {"result": {...}, "metrics": {...}}
    and old format {"entities": [...], ...} via extract_modal_result (D-08).
    """
    result_data = extract_modal_result(modal_json)

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
        for e in result_data.get("entities", [])
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
            source="modal",
        )
        for d in result_data.get("descriptions", [])
    ]

    relationships = [
        ExtractedRelationship(
            source=r.get("source", ""),
            target=r.get("target", ""),
            type=r.get("type", ""),
            weight=r.get("weight", 0.5),
            context=r.get("context", ""),
        )
        for r in result_data.get("relationships", [])
    ]

    return ChapterAnalysisResult(
        descriptions=descriptions,
        entities=entities,
        relationships=relationships,
    )


def process_batch_results(
    batch_results: list[dict],
    batch_chapters: list,
) -> tuple[list[tuple], list]:
    """Process batch extraction results, separating successful from failed (D-18).

    Args:
        batch_results: [{result, metrics, chapter_idx, truncated_text?}] from extract_chapters_batch
        batch_chapters: original Chapter objects in same order

    Returns:
        (successful: [(chapter, result_dict)], failed: [chapter])
        result_dict contains: analysis (ChapterAnalysisResult), metrics, raw_result
    """
    successful: list[tuple] = []
    failed: list = []

    for item in batch_results:
        ch = batch_chapters[item["chapter_idx"]]
        if item["result"] is None:
            # Truncated or failed -> retry individual
            failed.append(ch)
        else:
            chapter_result = modal_response_to_chapter_result(
                {"result": item["result"], "metrics": item["metrics"]}
            )
            successful.append(
                (
                    ch,
                    {
                        "analysis": chapter_result,
                        "metrics": item["metrics"],
                        "raw_result": item["result"],
                    },
                )
            )

    return successful, failed
