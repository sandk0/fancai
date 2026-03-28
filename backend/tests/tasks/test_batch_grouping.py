"""Tests for batch grouping: token estimation, oversized routing, batch creation.

BATCH-01: Sub-batch vLLM processing infrastructure.
D-01..D-07: Grouping logic, token estimation, oversized routing.
"""

from dataclasses import dataclass

import pytest

from app.services.batch_grouping import (
    BATCH_MAX_CHAPTERS,
    BATCH_MIN_CHAPTERS,
    BATCH_TOKEN_BUDGET,
    OVERSIZED_THRESHOLD_TOKENS,
    estimate_tokens,
    group_chapters_into_batches,
)


@dataclass
class FakeChapter:
    content: str | None = None


class TestEstimateTokens:
    """Token estimation: len(text) // 2 for Russian text (D-02)."""

    def test_estimate_tokens(self):
        """100 chars -> 50 tokens."""
        assert estimate_tokens("a" * 100) == 50

    def test_estimate_tokens_empty(self):
        """Empty string -> 0 tokens."""
        assert estimate_tokens("") == 0

    def test_estimate_tokens_russian(self):
        """Russian text: same heuristic len//2."""
        text = "Привет мир" * 10  # 100 chars (each word 10 chars with space)
        assert estimate_tokens(text) == len(text) // 2


class TestGroupChaptersIntoBatches:
    """Grouping chapters into sub-batches with oversized routing."""

    def test_oversized_chapter_routed_to_sequential(self):
        """Chapter > 64000 chars (> 32K tokens) goes to oversized, not batches."""
        oversized_ch = FakeChapter(content="x" * 65000)
        normal_ch = FakeChapter(content="x" * 1000)
        batches, oversized = group_chapters_into_batches(
            [oversized_ch, normal_ch, normal_ch]
        )
        assert oversized_ch in oversized
        assert oversized_ch not in [ch for batch in batches for ch in batch]

    def test_normal_chapters_grouped(self):
        """6 chapters ~10K tokens each -> 1 batch (sum < 128K budget)."""
        chapters = [
            FakeChapter(content="x" * 20000) for _ in range(6)
        ]  # 10K tokens each
        batches, oversized = group_chapters_into_batches(chapters)
        assert len(batches) == 1
        assert len(batches[0]) == 6
        assert len(oversized) == 0

    def test_budget_splits_batches(self):
        """Chapters totaling >128K tokens -> 2+ batches."""
        # 10 chapters of 26K tokens each = 260K total -> at least 2 batches
        chapters = [FakeChapter(content="x" * 52000) for _ in range(10)]
        batches, oversized = group_chapters_into_batches(chapters)
        assert len(batches) >= 2
        assert len(oversized) == 0

    def test_max_chapters_per_batch(self):
        """15 chapters of 1K tokens -> split at BATCH_MAX_CHAPTERS=12."""
        chapters = [
            FakeChapter(content="x" * 2000) for _ in range(15)
        ]  # 1K tokens each
        batches, oversized = group_chapters_into_batches(chapters)
        assert len(batches[0]) <= BATCH_MAX_CHAPTERS
        assert sum(len(b) for b in batches) + len(oversized) == 15

    def test_small_remainder_goes_to_oversized(self):
        """Remainder of 1 chapter (< BATCH_MIN_CHAPTERS=2) -> oversized."""
        # 12 + 1 = 13 chapters. First 12 fill one batch, remainder 1 < min 2 -> oversized
        chapters = [
            FakeChapter(content="x" * 2000) for _ in range(13)
        ]  # 1K tokens each
        batches, oversized = group_chapters_into_batches(chapters)
        # First batch = 12, remainder = 1 -> oversized
        assert len(batches) == 1
        assert len(batches[0]) == 12
        assert len(oversized) == 1

    def test_sequential_order_preserved(self):
        """Chapters 1-10 distributed sequentially, not shuffled."""
        chapters = [FakeChapter(content=f"chapter_{i}" * 100) for i in range(10)]
        batches, oversized = group_chapters_into_batches(chapters)
        # Flatten batches and check order
        flat = [ch for batch in batches for ch in batch]
        for i, ch in enumerate(flat):
            assert ch is chapters[i]

    def test_all_oversized(self):
        """All chapters oversized -> batches empty, all in oversized."""
        chapters = [FakeChapter(content="x" * 65000) for _ in range(5)]
        batches, oversized = group_chapters_into_batches(chapters)
        assert len(batches) == 0
        assert len(oversized) == 5

    def test_empty_chapters(self):
        """Empty list -> empty batches, empty oversized."""
        batches, oversized = group_chapters_into_batches([])
        assert batches == []
        assert oversized == []


class TestConstants:
    """Verify batch grouping constants match plan spec."""

    def test_oversized_threshold(self):
        assert OVERSIZED_THRESHOLD_TOKENS == 32000

    def test_batch_token_budget(self):
        assert BATCH_TOKEN_BUDGET == 128000

    def test_batch_max_chapters(self):
        assert BATCH_MAX_CHAPTERS == 12

    def test_batch_min_chapters(self):
        assert BATCH_MIN_CHAPTERS == 2
