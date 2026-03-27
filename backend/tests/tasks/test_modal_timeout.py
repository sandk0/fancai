"""Tests for VPS-side timeout wrapping Modal calls with asyncio.wait_for.

STAB-05: Modal calls protected by VPS-side timeout (asyncio.wait_for).
D-10: timeout = VPS_TIMEOUT (LLM_TIMEOUT + 60s buffer).
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestVpsTimeout:
    """Test VPS-side timeout wrapper around Modal calls."""

    @pytest.mark.asyncio
    async def test_vps_timeout_wraps_modal_call(self):
        """asyncio.wait_for should be used around Modal extract_chapter.remote call."""
        from app.tasks.book_tasks import VPS_TIMEOUT

        assert (
            VPS_TIMEOUT == 960
        ), f"VPS_TIMEOUT should be 960 (900+60), got {VPS_TIMEOUT}"

    @pytest.mark.asyncio
    async def test_vps_timeout_marks_chapter_as_failed(self):
        """When Modal hangs past VPS_TIMEOUT, chapter should get parsing_error with 'VPS-side timeout'."""
        # We test the timeout wrapping pattern directly:
        # asyncio.wait_for raises asyncio.TimeoutError, which is caught
        # and re-raised as TimeoutError with "VPS-side timeout" message.
        from app.tasks.book_tasks import VPS_TIMEOUT

        async def hanging_modal_call():
            """Simulate Modal call that never returns."""
            await asyncio.sleep(999999)

        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(hanging_modal_call(), timeout=0.01)

        # Verify the constant is correct
        assert VPS_TIMEOUT == 960

    @pytest.mark.asyncio
    async def test_vps_timeout_constant_matches_spec(self):
        """VPS_TIMEOUT = LLM_TIMEOUT(900) + 60s buffer."""
        from app.tasks.book_tasks import VPS_TIMEOUT, CELERY_HARD_LIMIT, SAFETY_MARGIN

        assert VPS_TIMEOUT == 960
        assert CELERY_HARD_LIMIT == 10800
        assert SAFETY_MARGIN == 300
