"""Tests for book status semantics: descriptions_extracted, WebSocket status, push notification guard.

STAB-01: descriptions_extracted=True only when 0 failed chapters.
D-01: Failed chapters check BEFORE setting descriptions_extracted.
D-02: WebSocket publishes "completed_with_errors" on partial failures.
D-03: descriptions_processing_error preserves failure message.
D-04: Push notification NOT sent on partial failures.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


def _make_book(book_id=None, user_id=None):
    """Create a mock Book object with required attributes."""
    book = MagicMock()
    book.id = book_id or uuid4()
    book.user_id = user_id or uuid4()
    book.title = "Test Book"
    book.is_processing = True
    book.is_parsed = False
    book.parsing_progress = 0
    book.descriptions_extracted = None
    book.descriptions_processing_error = None
    return book


def _make_failed_chapters_result(failed_chapters: list):
    """Create mock DB result for failed chapters query.

    Args:
        failed_chapters: list of (chapter_number, parsing_error) tuples
    """
    mock_result = MagicMock()
    mock_result.fetchall.return_value = failed_chapters
    return mock_result


class TestBookStatusSemantics:
    """Test that book completion sets correct statuses based on failed chapters."""

    @pytest.mark.asyncio
    async def test_all_chapters_success_sets_extracted_true(self):
        """When 0 chapters failed, descriptions_extracted should be True."""
        from app.tasks.book_tasks import _finalize_book_status

        book = _make_book()
        db = AsyncMock()
        # No failed chapters
        db.execute.return_value = _make_failed_chapters_result([])

        with patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch("app.tasks.book_tasks.push_notification_service") as mock_push:
            mock_push.send_book_ready_notification = AsyncMock()

            await _finalize_book_status(db, book, total_chapters=10)

        assert book.descriptions_extracted is True
        assert book.descriptions_processing_error is None

    @pytest.mark.asyncio
    async def test_partial_failure_sets_extracted_false(self):
        """When some chapters failed, descriptions_extracted should be False."""
        from app.tasks.book_tasks import _finalize_book_status

        book = _make_book()
        db = AsyncMock()
        # 2 failed chapters
        failed = [(3, "VPS-side timeout"), (7, "JSON parse error")]
        db.execute.return_value = _make_failed_chapters_result(failed)

        with patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch("app.tasks.book_tasks.push_notification_service") as mock_push:
            mock_push.send_book_ready_notification = AsyncMock()

            await _finalize_book_status(db, book, total_chapters=10)

        assert book.descriptions_extracted is False
        assert book.descriptions_processing_error is not None
        assert "2" in book.descriptions_processing_error  # contains count

    @pytest.mark.asyncio
    async def test_partial_failure_publishes_completed_with_errors(self):
        """WebSocket should publish status='completed_with_errors' with failure details."""
        from app.tasks.book_tasks import _finalize_book_status

        book = _make_book()
        db = AsyncMock()
        failed = [(3, "VPS-side timeout"), (7, "JSON parse error")]
        db.execute.return_value = _make_failed_chapters_result(failed)

        with patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ) as mock_ws, patch(
            "app.tasks.book_tasks.push_notification_service"
        ) as mock_push:
            mock_push.send_book_ready_notification = AsyncMock()

            await _finalize_book_status(db, book, total_chapters=10)

        mock_ws.assert_called_once()
        call_kwargs = mock_ws.call_args
        # Check keyword arguments
        assert call_kwargs.kwargs.get("status") == "completed_with_errors" or (
            call_kwargs[1].get("status") == "completed_with_errors"
        )

        # Check chapters_failed and failed_chapter_numbers are included
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        assert kwargs.get("chapters_failed") == 2
        assert kwargs.get("failed_chapter_numbers") == [3, 7]

    @pytest.mark.asyncio
    async def test_push_notification_not_sent_on_partial_failure(self):
        """Push notification should NOT be sent when there are failed chapters."""
        from app.tasks.book_tasks import _finalize_book_status

        book = _make_book()
        db = AsyncMock()
        failed = [(3, "VPS-side timeout")]
        db.execute.return_value = _make_failed_chapters_result(failed)

        with patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch("app.tasks.book_tasks.push_notification_service") as mock_push:
            mock_push.send_book_ready_notification = AsyncMock()

            await _finalize_book_status(db, book, total_chapters=10)

        mock_push.send_book_ready_notification.assert_not_called()

    @pytest.mark.asyncio
    async def test_push_notification_sent_on_full_success(self):
        """Push notification should be sent when 0 chapters failed."""
        from app.tasks.book_tasks import _finalize_book_status

        book = _make_book()
        db = AsyncMock()
        db.execute.return_value = _make_failed_chapters_result([])

        with patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ), patch("app.tasks.book_tasks.push_notification_service") as mock_push:
            mock_push.send_book_ready_notification = AsyncMock()

            await _finalize_book_status(db, book, total_chapters=10)

        mock_push.send_book_ready_notification.assert_called_once()

    @pytest.mark.asyncio
    async def test_full_success_publishes_completed_status(self):
        """WebSocket should publish status='completed' on full success."""
        from app.tasks.book_tasks import _finalize_book_status

        book = _make_book()
        db = AsyncMock()
        db.execute.return_value = _make_failed_chapters_result([])

        with patch(
            "app.tasks.book_tasks.publish_book_progress", new_callable=AsyncMock
        ) as mock_ws, patch(
            "app.tasks.book_tasks.push_notification_service"
        ) as mock_push:
            mock_push.send_book_ready_notification = AsyncMock()

            await _finalize_book_status(db, book, total_chapters=10)

        mock_ws.assert_called_once()
        kwargs = (
            mock_ws.call_args.kwargs
            if mock_ws.call_args.kwargs
            else mock_ws.call_args[1]
        )
        assert kwargs.get("status") == "completed"


class TestPubsubKwargs:
    """Test that publish_book_progress passes extra kwargs to data dict."""

    @pytest.mark.asyncio
    async def test_pubsub_passes_extra_kwargs(self):
        """publish_book_progress should include extra kwargs in published data."""
        import json
        from app.core.pubsub import publish_book_progress

        mock_redis = AsyncMock()
        mock_redis.publish = AsyncMock(return_value=1)
        mock_redis.aclose = AsyncMock()

        with patch(
            "redis.asyncio.from_url",
            new_callable=AsyncMock,
            return_value=mock_redis,
        ):
            await publish_book_progress(
                book_id="test-id",
                progress=100,
                chapter=10,
                total_chapters=10,
                status="completed_with_errors",
                message="Test",
                chapters_failed=2,
                failed_chapter_numbers=[3, 7],
            )

        # Verify published JSON includes extra kwargs
        call_args = mock_redis.publish.call_args
        assert call_args is not None, "redis.publish was not called"
        published_data = json.loads(call_args[0][1])
        assert published_data["chapters_failed"] == 2
        assert published_data["failed_chapter_numbers"] == [3, 7]
        assert published_data["status"] == "completed_with_errors"
