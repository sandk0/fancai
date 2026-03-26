"""
NER Service — Entity extraction via GLiNER2.

Replaces LLM for NER task: extracts characters, locations, artifacts, organizations
from chapter text using a local GLiNER2 model (205M params, DeBERTa backbone).

Architecture:
- NERService: lazy singleton, loads GLiNER2 model on first call
- TextChunker: splits long chapters into DeBERTa-safe chunks with sentence-level overlap
- NERAdapter: converts raw GLiNER2 entities into ExtractedEntity/ChapterAnalysisResult
- deduplicate_overlap_entities: removes duplicates from chunk overlap zones

Created: 2026-03-24 (Phase 30)
"""

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from razdel import sentenize

from app.schemas.extraction import (
    ChapterAnalysisResult,
    ExtractedEntity,
)

logger = logging.getLogger(__name__)


# ============================================================================
# TextChunker — sentence-level chunking with DeBERTa token counting
# ============================================================================


@dataclass
class TextChunk:
    """A chunk of text with character offsets into the original text."""

    text: str
    start_offset: int  # Character offset in original text
    end_offset: int
    token_count: int


class TextChunker:
    """
    Splits chapter text into chunks sized for DeBERTa (max 512 tokens).

    Uses razdel.sentenize() for Russian sentence splitting and a DeBERTa
    tokenizer for accurate token counting. Chunks overlap by N sentences
    to avoid splitting entities at boundaries.
    """

    @staticmethod
    def chunk_text(
        text: str,
        tokenizer: Any,
        max_tokens: int = 384,
        overlap_sentences: int = 2,
    ) -> List[TextChunk]:
        """
        Split text into token-safe chunks with sentence-level overlap.

        Args:
            text: Chapter text to chunk.
            tokenizer: HuggingFace tokenizer with .encode() method.
            max_tokens: Maximum tokens per chunk (default 384 of 512 max).
            overlap_sentences: Number of sentences to repeat at chunk boundaries.

        Returns:
            List of TextChunk with character offsets into original text.
        """
        if not text or not text.strip():
            return []

        # Sentence splitting via razdel
        sentences = list(sentenize(text))
        if not sentences:
            return []

        # Count tokens per sentence
        sent_tokens = []
        for sent in sentences:
            token_ids = tokenizer.encode(sent.text, add_special_tokens=False)
            sent_tokens.append(len(token_ids))

        # Check if entire text fits in one chunk (D-09)
        total_tokens = sum(sent_tokens)
        if total_tokens <= max_tokens:
            return [
                TextChunk(
                    text=text[sentences[0].start : sentences[-1].stop],
                    start_offset=sentences[0].start,
                    end_offset=sentences[-1].stop,
                    token_count=total_tokens,
                )
            ]

        # Build chunks greedily by sentences
        chunks: List[TextChunk] = []
        i = 0  # Current sentence index

        while i < len(sentences):
            chunk_token_count = 0
            j = i

            # Add sentences until we exceed max_tokens
            while (
                j < len(sentences) and chunk_token_count + sent_tokens[j] <= max_tokens
            ):
                chunk_token_count += sent_tokens[j]
                j += 1

            # Ensure at least one sentence per chunk
            if j == i:
                j = i + 1
                chunk_token_count = sent_tokens[i]

            # Build chunk from sentences[i:j]
            chunk_sents = sentences[i:j]
            chunk_text = text[chunk_sents[0].start : chunk_sents[-1].stop]
            chunks.append(
                TextChunk(
                    text=chunk_text,
                    start_offset=chunk_sents[0].start,
                    end_offset=chunk_sents[-1].stop,
                    token_count=chunk_token_count,
                )
            )

            # Next chunk starts with overlap: go back overlap_sentences from end
            next_start = max(j - overlap_sentences, i + 1)
            i = next_start

        return chunks


# ============================================================================
# Deduplication for overlap zones
# ============================================================================


def deduplicate_overlap_entities(
    all_entities: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Deduplicate entities from chunk overlap zones.

    Two entities with the same (start, end, name.casefold()) are considered
    duplicates. The one with higher confidence is kept.

    Args:
        all_entities: Raw entity dicts with text, start, end, confidence, label.

    Returns:
        Deduplicated list of entity dicts.
    """
    best: Dict[Tuple[int, int, str], Dict[str, Any]] = {}
    for entity in all_entities:
        key = (entity["start"], entity["end"], entity["text"].casefold())
        if key not in best or entity["confidence"] > best[key]["confidence"]:
            best[key] = entity
    return list(best.values())


# ============================================================================
# NERAdapter — raw GLiNER2 entities -> ExtractedEntity/ChapterAnalysisResult
# ============================================================================


# GLiNER2 label -> EntityType mapping (D-10)
LABEL_MAP = {
    "person": "character",
    "location": "location",
    "artifact": "object",
    "organization": "object",  # EntityType enum has no 'organization'
}


class NERAdapter:
    """
    Converts raw GLiNER2 entity dicts into ExtractedEntity objects
    and ChapterAnalysisResult for backward compatibility with ConsistencyManager.
    """

    @staticmethod
    def adapt_to_chapter_result(
        raw_entities: List[Dict[str, Any]],
        chunk_offsets: List[Tuple[int, int]],
    ) -> ChapterAnalysisResult:
        """
        Convert raw NER entities into a ChapterAnalysisResult.

        Performs:
        1. Offset recalculation (entity.start + chunk.start_offset)
        2. Label mapping (person->character, etc.)
        3. Short name filtering (< 2 chars, D-12)
        4. Mention aggregation (casefold name grouping, D-13)
        5. Default field population (D-11)

        Args:
            raw_entities: Dicts with text, start, end, confidence, label.
                          Offsets are already chapter-level (adjusted before calling).
            chunk_offsets: List of (start_offset, end_offset) for each chunk.

        Returns:
            ChapterAnalysisResult with entities, empty descriptions and relationships (D-14).
        """
        # Filter short names (D-12)
        filtered = [e for e in raw_entities if len(e.get("text", "")) >= 2]

        # Map labels
        for entity in filtered:
            entity["mapped_type"] = LABEL_MAP.get(entity.get("label", ""), "object")

        # Aggregate mentions by casefold name (D-13)
        aggregated: Dict[str, Dict[str, Any]] = {}
        for entity in filtered:
            key = entity["text"].casefold()
            if key not in aggregated:
                aggregated[key] = {
                    "name": entity["text"],  # Keep first occurrence's form
                    "type": entity["mapped_type"],
                    "offsets": [entity["start"]],
                    "confidences": [entity["confidence"]],
                }
            else:
                aggregated[key]["offsets"].append(entity["start"])
                aggregated[key]["confidences"].append(entity["confidence"])

        # Build ExtractedEntity list
        entities: List[ExtractedEntity] = []
        for data in aggregated.values():
            entities.append(
                ExtractedEntity(
                    name=data["name"],
                    type=data["type"],
                    visual_summary="",  # D-11: empty, Phase 33 enriches
                    aliases=[],  # D-11
                    confidence=sum(data["confidences"]) / len(data["confidences"]),
                    importance=5,  # D-11
                    first_mention_offset=min(data["offsets"]),
                    chapter_event_action=None,  # D-11
                    chapter_event_inner=None,  # D-11
                )
            )

        return ChapterAnalysisResult(
            descriptions=[],  # D-14: NER does not extract descriptions
            entities=entities,
            relationships=[],  # D-14: NER does not extract relationships
        )


# ============================================================================
# NERService — lazy singleton with GLiNER2 model
# ============================================================================


class NERService:
    """
    Entity extraction service using GLiNER2 (205M params, DeBERTa backbone).

    Loads the model lazily on first use and persists it between calls (~800MB RAM).
    Thread-safe via threading.Lock.
    """

    def __init__(self) -> None:
        self._model: Any = None
        self._tokenizer: Any = None
        self._loaded = False
        self._lock = threading.Lock()

    def _ensure_loaded(self) -> None:
        """Load GLiNER2 model and tokenizer if not already loaded."""
        if self._loaded:
            return

        with self._lock:
            if self._loaded:
                return

            import os
            from pathlib import Path

            import torch
            from gliner import GLiNER as GLiNER2
            from huggingface_hub import snapshot_download
            from transformers import AutoTokenizer

            MODEL_ID = "fastino/gliner2-base-v1"
            CACHE_DIR = "/models"

            logger.info(f"Loading GLiNER2 model ({MODEL_ID})...")
            start = time.time()

            # Download model and fix config filename mismatch:
            # fastino/gliner2-base-v1 ships config.json, but gliner
            # library expects gliner_config.json
            model_dir = Path(
                snapshot_download(
                    repo_id=MODEL_ID,
                    cache_dir=CACHE_DIR,
                )
            )
            gliner_cfg = model_dir / "gliner_config.json"
            if not gliner_cfg.exists() and (model_dir / "config.json").exists():
                os.symlink("config.json", str(gliner_cfg))

            with torch.no_grad():
                self._model = GLiNER2.from_pretrained(
                    str(model_dir),
                    cache_dir=CACHE_DIR,
                )

            self._tokenizer = AutoTokenizer.from_pretrained(
                MODEL_ID,
                cache_dir=CACHE_DIR,
            )

            self._loaded = True
            duration = time.time() - start
            logger.info(f"GLiNER2 model loaded in {duration:.1f}s")

    def extract_entities(
        self,
        text: str,
        labels: List[str],
        threshold: float = 0.4,
    ) -> List[Dict[str, Any]]:
        """
        Extract entities from text using GLiNER2.

        Args:
            text: Input text.
            labels: Entity type labels (e.g. ["person", "location"]).
            threshold: Confidence threshold for extraction.

        Returns:
            List of dicts with text, start, end, confidence, label.
        """
        self._ensure_loaded()
        raw_entities = self._model.predict_entities(
            text,
            labels,
            threshold=threshold,
        )
        # Normalize GLiNER2 output format
        result = []
        for e in raw_entities:
            result.append(
                {
                    "text": e.get("text", e.get("word", "")),
                    "start": e.get("start", 0),
                    "end": e.get("end", 0),
                    "confidence": e.get("score", e.get("confidence", 0.0)),
                    "label": e.get("label", ""),
                }
            )
        return result

    def extract_chapter(
        self,
        text: str,
        settings_manager: Any = None,
    ) -> ChapterAnalysisResult:
        """
        Full pipeline: chunk text -> extract entities -> dedup -> adapt.

        This is a synchronous method (PyTorch inference). Call via
        asyncio.to_thread() from async contexts.

        Args:
            text: Full chapter text.
            settings_manager: Optional SettingsManager for labels/threshold.
                             Uses sync wrapper for async get_setting.

        Returns:
            ChapterAnalysisResult compatible with ConsistencyManager.
        """
        from app.monitoring.metrics import (
            record_ner_chapter_duration,
            record_ner_chunk_duration,
            record_ner_chunks,
            record_ner_entities,
        )

        chapter_start = time.time()
        self._ensure_loaded()

        # Get labels and threshold from settings (D-04)
        labels = ["person", "location", "artifact", "organization"]
        threshold = 0.4

        if settings_manager is not None:
            import asyncio

            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # We're in asyncio.to_thread — use new event loop
                    import concurrent.futures

                    with concurrent.futures.ThreadPoolExecutor() as pool:
                        custom_labels = asyncio.run(
                            settings_manager.get_setting(
                                "ner", "labels", default=labels
                            )
                        )
                        custom_threshold = asyncio.run(
                            settings_manager.get_setting(
                                "ner", "threshold", default=threshold
                            )
                        )
                else:
                    custom_labels = loop.run_until_complete(
                        settings_manager.get_setting("ner", "labels", default=labels)
                    )
                    custom_threshold = loop.run_until_complete(
                        settings_manager.get_setting(
                            "ner", "threshold", default=threshold
                        )
                    )
                if custom_labels is not None:
                    labels = custom_labels
                if custom_threshold is not None:
                    threshold = float(custom_threshold)
            except Exception as e:
                logger.warning(f"Failed to get NER settings, using defaults: {e}")

        # 1. Chunk text
        chunks = TextChunker.chunk_text(
            text, self._tokenizer, max_tokens=384, overlap_sentences=2
        )
        record_ner_chunks(len(chunks))

        # 2. Extract entities from each chunk with offset adjustment
        all_entities: List[Dict[str, Any]] = []
        chunk_offsets: List[Tuple[int, int]] = []

        for chunk in chunks:
            chunk_start = time.time()
            raw = self.extract_entities(chunk.text, labels, threshold)

            # Adjust offsets to chapter-level
            for entity in raw:
                entity["start"] += chunk.start_offset
                entity["end"] += chunk.start_offset

            all_entities.extend(raw)
            chunk_offsets.append((chunk.start_offset, chunk.end_offset))

            chunk_duration = time.time() - chunk_start
            record_ner_chunk_duration(chunk_duration)

        # 3. Deduplicate overlap zone entities
        deduped = deduplicate_overlap_entities(all_entities)

        # 4. Adapt to ChapterAnalysisResult
        result = NERAdapter.adapt_to_chapter_result(deduped, chunk_offsets)

        # 5. Record metrics (D-05)
        chapter_duration = time.time() - chapter_start
        record_ner_chapter_duration(chapter_duration)
        for entity in result.entities:
            record_ner_entities(entity.type, 1)

        logger.info(
            "NER extraction complete",
            extra={
                "entities_count": len(result.entities),
                "chunks_count": len(chunks),
                "duration": f"{chapter_duration:.2f}s",
            },
        )

        return result


# ============================================================================
# Singleton — thread-safe lazy initialization (pattern: get_gemini_extractor)
# ============================================================================

_ner_service: Optional[NERService] = None
_ner_service_lock = threading.Lock()


def get_ner_service() -> NERService:
    """Get or create the NERService singleton (thread-safe)."""
    global _ner_service
    if _ner_service is None:
        with _ner_service_lock:
            if _ner_service is None:
                _ner_service = NERService()
    return _ner_service
