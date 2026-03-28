"""Batch grouping: VPS-side chapter grouping for sub-batch processing.

BATCH-01: Groups chapters into sub-batches by token budget.
Oversized chapters (>32K estimated tokens) are routed to sequential processing.
"""

from __future__ import annotations

import json
from typing import Any

# Sub-batch constants (D-03, D-04, D-07)
OVERSIZED_THRESHOLD_TOKENS = 32000  # D-07: chapter > 32K tokens -> sequential
BATCH_TOKEN_BUDGET = 128000  # D-03: max_model_len / 2
BATCH_MAX_CHAPTERS = 12  # D-04: max chapters per batch
BATCH_MIN_CHAPTERS = 2  # D-04: min chapters for a valid batch


def estimate_tokens(text: str) -> int:
    """Token estimation: len(text) // 2 for Russian text (D-02).

    Heuristic: Russian characters average ~2 bytes per token in most LLM tokenizers.
    This is intentionally simple -- good enough for routing decisions.
    """
    return len(text) // 2


def group_chapters_into_batches(
    chapters: list[Any],
) -> tuple[list[list[Any]], list[Any]]:
    """Group chapters into sub-batches + separate oversized chapters (D-01, D-05).

    Sequential grouping: chapters are added to a batch while the sum of estimated
    tokens < BATCH_TOKEN_BUDGET and len(batch) < BATCH_MAX_CHAPTERS.
    Oversized chapters (>OVERSIZED_THRESHOLD_TOKENS) go to a separate list.
    Remainder < BATCH_MIN_CHAPTERS is moved to oversized.

    Args:
        chapters: list of objects with a `content` attribute (chapter text string).

    Returns:
        (batches: list[list[chapter]], oversized: list[chapter])
    """
    if not chapters:
        return [], []

    batches: list[list[Any]] = []
    oversized: list[Any] = []

    current_batch: list[Any] = []
    current_tokens = 0

    for ch in chapters:
        tokens = estimate_tokens(ch.content or "")

        # Oversized -> sequential
        if tokens > OVERSIZED_THRESHOLD_TOKENS:
            oversized.append(ch)
            continue

        # Check if adding this chapter would exceed budget or max chapters
        if (
            current_tokens + tokens > BATCH_TOKEN_BUDGET
            or len(current_batch) >= BATCH_MAX_CHAPTERS
        ):
            # Finalize current batch
            if len(current_batch) >= BATCH_MIN_CHAPTERS:
                batches.append(current_batch)
            else:
                oversized.extend(current_batch)
            current_batch = []
            current_tokens = 0

        current_batch.append(ch)
        current_tokens += tokens

    # Finalize last batch
    if current_batch:
        if len(current_batch) >= BATCH_MIN_CHAPTERS:
            batches.append(current_batch)
        else:
            oversized.extend(current_batch)

    return batches, oversized


def process_batch_outputs(
    request_outputs: list[Any],
    *,
    batch_size: int,
    inference_ms: int,
    cold_start_ms: int,
    is_cold_start: bool,
) -> list[dict]:
    """Process vLLM batch chat outputs into per-item results (D-11).

    Pure function extractable for testing without Modal/vLLM dependencies.
    Used by LLMExtractor.extract_chapters_batch() on Modal side.

    Args:
        request_outputs: list of vLLM RequestOutput objects.
        batch_size: number of chapters in the batch.
        inference_ms: total inference time in milliseconds.
        cold_start_ms: cold start time (0 if warm).
        is_cold_start: whether this is the first call after container start.

    Returns:
        list[dict]: per-item results with chapter_idx, result, metrics, truncated_text.
    """
    if not request_outputs:
        return []

    results: list[dict] = []

    for idx, req_output in enumerate(request_outputs):
        output = req_output.outputs[0]
        item_metrics = {
            "cold_start_ms": cold_start_ms,
            "inference_ms": inference_ms,
            "finish_reason": output.finish_reason,
            "is_cold_start": is_cold_start,
            "batch_size": batch_size,
        }

        if output.finish_reason == "length":
            results.append(
                {
                    "result": None,
                    "truncated_text": output.text[:500],
                    "metrics": item_metrics,
                    "chapter_idx": idx,
                }
            )
        else:
            parsed = json.loads(output.text)
            results.append(
                {
                    "result": parsed,
                    "metrics": item_metrics,
                    "chapter_idx": idx,
                }
            )

    return results
