"""Tests for batch extraction logic.

BATCH-02: extract_chapters_batch per-item processing.
Tests the pure output-processing logic without Modal/vLLM dependencies.
"""

import json
from dataclasses import dataclass, field

import pytest

from app.services.batch_grouping import process_batch_outputs


@dataclass
class MockOutput:
    text: str = ""
    finish_reason: str = "stop"


@dataclass
class MockRequestOutput:
    outputs: list = field(default_factory=list)


def make_request_output(
    result_dict: dict | None = None, finish_reason: str = "stop"
) -> MockRequestOutput:
    """Create a mock vLLM RequestOutput."""
    if result_dict is not None:
        text = json.dumps(result_dict)
    else:
        text = '{"partial": "truncated...'
    return MockRequestOutput(
        outputs=[MockOutput(text=text, finish_reason=finish_reason)]
    )


class TestExtractChaptersBatchReturnsPerItem:
    """Batch extraction returns per-item results with chapter_idx."""

    def test_extract_chapters_batch_returns_per_item(self):
        """3 chapters -> 3 results, each with chapter_idx, result, metrics."""
        outputs = [
            make_request_output({"entities": [{"name": "Alice"}]}),
            make_request_output({"entities": [{"name": "Bob"}]}),
            make_request_output({"entities": [{"name": "Charlie"}]}),
        ]
        results = process_batch_outputs(
            outputs,
            batch_size=3,
            inference_ms=1000,
            cold_start_ms=500,
            is_cold_start=True,
        )
        assert len(results) == 3
        for i, r in enumerate(results):
            assert r["chapter_idx"] == i
            assert r["result"] is not None
            assert "metrics" in r

    def test_partial_truncation(self):
        """One item finish_reason='length' -> result=None + truncated_text, others parsed."""
        outputs = [
            make_request_output({"entities": [{"name": "Alice"}]}),
            make_request_output(None, finish_reason="length"),
            make_request_output({"entities": [{"name": "Charlie"}]}),
        ]
        results = process_batch_outputs(
            outputs,
            batch_size=3,
            inference_ms=1000,
            cold_start_ms=0,
            is_cold_start=False,
        )
        assert results[0]["result"] is not None
        assert results[1]["result"] is None
        assert "truncated_text" in results[1]
        assert results[2]["result"] is not None

    def test_empty_chapters_returns_empty(self):
        """Empty outputs -> []."""
        results = process_batch_outputs(
            [],
            batch_size=0,
            inference_ms=0,
            cold_start_ms=0,
            is_cold_start=False,
        )
        assert results == []

    def test_batch_size_in_metrics(self):
        """metrics.batch_size == len(chapters)."""
        outputs = [
            make_request_output({"entities": []}),
            make_request_output({"entities": []}),
        ]
        results = process_batch_outputs(
            outputs,
            batch_size=2,
            inference_ms=500,
            cold_start_ms=0,
            is_cold_start=False,
        )
        for r in results:
            assert r["metrics"]["batch_size"] == 2


class TestColdStartTracking:
    """Cold start tracking in batch metrics."""

    def test_cold_start_metrics(self):
        """First call has is_cold_start=True, cold_start_ms > 0."""
        outputs = [make_request_output({"entities": []})]
        results = process_batch_outputs(
            outputs,
            batch_size=1,
            inference_ms=500,
            cold_start_ms=800,
            is_cold_start=True,
        )
        assert results[0]["metrics"]["is_cold_start"] is True
        assert results[0]["metrics"]["cold_start_ms"] == 800

    def test_warm_start_metrics(self):
        """Subsequent call has is_cold_start=False, cold_start_ms=0."""
        outputs = [make_request_output({"entities": []})]
        results = process_batch_outputs(
            outputs,
            batch_size=1,
            inference_ms=500,
            cold_start_ms=0,
            is_cold_start=False,
        )
        assert results[0]["metrics"]["is_cold_start"] is False
        assert results[0]["metrics"]["cold_start_ms"] == 0
