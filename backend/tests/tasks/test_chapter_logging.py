"""Tests for structured chapter logging (OBS-02).

Tests:
1. _log_chapter_result success with 9 fields
2. _log_chapter_result error with error_type

Тесты конвертеров Modal удалены вместе с самим Modal-пайплайном (Волна 2).
"""

from unittest.mock import patch, MagicMock


class TestLogChapterResult:
    """Tests for _log_chapter_result structured logging helper."""

    def test_log_chapter_result_success(self):
        """Test 1: logger.bind() called with 9 fields on success."""
        from app.tasks.book_tasks import _log_chapter_result

        mock_logger = MagicMock()
        mock_bound = MagicMock()
        mock_logger.bind.return_value = mock_bound

        with patch("app.tasks.book_tasks.logger", mock_logger):
            _log_chapter_result(
                chapter_id="ch-1",
                book_id="book-1",
                duration_ms=5000,
                result_type="success",
                error_type=None,
                metrics={
                    "finish_reason": "stop",
                    "cold_start_ms": 12000,
                    "inference_ms": 8500,
                    "is_cold_start": True,
                },
            )

        mock_logger.bind.assert_called_once()
        call_kwargs = mock_logger.bind.call_args[1]

        # Verify all 9 fields present
        assert call_kwargs["chapter_id"] == "ch-1"
        assert call_kwargs["book_id"] == "book-1"
        assert call_kwargs["duration_ms"] == 5000
        assert call_kwargs["result_type"] == "success"
        assert call_kwargs["error_type"] is None
        assert call_kwargs["finish_reason"] == "stop"
        assert call_kwargs["cold_start_ms"] == 12000
        assert call_kwargs["inference_ms"] == 8500
        assert call_kwargs["is_cold_start"] is True

        mock_bound.info.assert_called_once_with("chapter_processed")

    def test_log_chapter_result_error(self):
        """Test 2: error_type passed through on error."""
        from app.tasks.book_tasks import _log_chapter_result

        mock_logger = MagicMock()
        mock_bound = MagicMock()
        mock_logger.bind.return_value = mock_bound

        with patch("app.tasks.book_tasks.logger", mock_logger):
            _log_chapter_result(
                chapter_id="ch-2",
                book_id="book-2",
                duration_ms=960000,
                result_type="error",
                error_type="timeout",
                metrics=None,
            )

        call_kwargs = mock_logger.bind.call_args[1]
        assert call_kwargs["error_type"] == "timeout"
        assert call_kwargs["result_type"] == "error"
        # No metrics -> defaults
        assert call_kwargs["finish_reason"] is None
        assert call_kwargs["cold_start_ms"] == 0
        assert call_kwargs["inference_ms"] == 0
        assert call_kwargs["is_cold_start"] is False
