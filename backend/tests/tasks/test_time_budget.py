"""Tests for per-book time budget check.

STAB-06: Per-book time budget check prevents exceeding Celery hard limit.
D-12: Skip remaining chapters when remaining time < VPS_TIMEOUT.
"""

import time
import pytest
from unittest.mock import patch

from app.tasks.book_tasks import (
    CELERY_HARD_LIMIT,
    SAFETY_MARGIN,
    VPS_TIMEOUT,
    check_time_budget,
)


class TestTimeBudget:
    """Test per-book time budget check before each chapter."""

    def test_budget_check_skips_chapter_when_exhausted(self):
        """When remaining time < VPS_TIMEOUT, should raise TimeoutError."""
        # Simulate 10000s elapsed out of 10800s hard limit
        # remaining = 10800 - 10000 - 300 = 500s < VPS_TIMEOUT (960s) -> skip
        task_start = time.monotonic() - 10000

        with pytest.raises(TimeoutError) as exc_info:
            check_time_budget(task_start, chapter_idx=5)

        assert "Time budget exhausted" in str(exc_info.value)

    def test_budget_check_allows_chapter_when_sufficient(self):
        """When remaining time > VPS_TIMEOUT, should pass without error."""
        # Simulate 100s elapsed -> remaining = 10800 - 100 - 300 = 10400s > 960s -> OK
        task_start = time.monotonic() - 100

        # Should not raise
        check_time_budget(task_start, chapter_idx=1)

    def test_budget_safety_margin_300s(self):
        """SAFETY_MARGIN should be 300s (5 minutes)."""
        assert SAFETY_MARGIN == 300

    def test_budget_check_at_boundary(self):
        """At exact boundary (remaining == VPS_TIMEOUT), should skip (conservative)."""
        # remaining = CELERY_HARD_LIMIT - elapsed - SAFETY_MARGIN = VPS_TIMEOUT
        # -> elapsed = CELERY_HARD_LIMIT - SAFETY_MARGIN - VPS_TIMEOUT = 10800 - 300 - 960 = 9540
        task_start = time.monotonic() - 9540

        with pytest.raises(TimeoutError):
            check_time_budget(task_start, chapter_idx=10)
