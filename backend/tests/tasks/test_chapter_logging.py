"""Tests for structured chapter logging and modal_client updates (OBS-02, D-08).

Tests:
1. _log_chapter_result success with 9 fields
2. _log_chapter_result error with error_type
3. modal_response_to_chapter_result new format
4. modal_response_to_chapter_result old format (backward compat)
5. extract_modal_metrics present
6. extract_modal_metrics absent (backward compat)
"""

from unittest.mock import patch, MagicMock

import pytest


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


class TestExtractModalResult:
    """Tests for extract_modal_result and extract_modal_metrics."""

    def test_extract_modal_result_new_format(self):
        """Test 3: {"result": {...}} extracts result."""
        from app.services.modal_client import extract_modal_result

        modal_json = {
            "result": {
                "entities": [{"name": "Alice"}],
                "descriptions": [],
                "relationships": [],
            },
            "metrics": {"cold_start_ms": 0, "inference_ms": 5000},
        }
        result = extract_modal_result(modal_json)
        assert result == modal_json["result"]
        assert result["entities"][0]["name"] == "Alice"

    def test_extract_modal_result_old_format(self):
        """Test 4: {"entities": [...]} returns entire dict (backward compat)."""
        from app.services.modal_client import extract_modal_result

        modal_json = {
            "entities": [{"name": "Bob"}],
            "descriptions": [{"content": "A room"}],
            "relationships": [],
        }
        result = extract_modal_result(modal_json)
        assert result is modal_json
        assert result["entities"][0]["name"] == "Bob"

    def test_extract_modal_metrics_present(self):
        """Test 5: {"metrics": {...}} extracts metrics."""
        from app.services.modal_client import extract_modal_metrics

        modal_json = {
            "result": {"entities": []},
            "metrics": {
                "cold_start_ms": 12000,
                "inference_ms": 8500,
                "finish_reason": "stop",
                "is_cold_start": True,
            },
        }
        metrics = extract_modal_metrics(modal_json)
        assert metrics["cold_start_ms"] == 12000
        assert metrics["inference_ms"] == 8500
        assert metrics["finish_reason"] == "stop"
        assert metrics["is_cold_start"] is True

    def test_extract_modal_metrics_absent(self):
        """Test 6: {} when no metrics (backward compat)."""
        from app.services.modal_client import extract_modal_metrics

        modal_json = {"entities": [{"name": "Charlie"}]}
        metrics = extract_modal_metrics(modal_json)
        assert metrics == {}


class TestModalResponseConversion:
    """Tests for modal_response_to_chapter_result with new format."""

    def test_new_format_with_result_wrapper(self):
        """modal_response_to_chapter_result reads from result wrapper."""
        from app.services.modal_client import modal_response_to_chapter_result

        modal_json = {
            "result": {
                "entities": [{"name": "Alice", "type": "character", "confidence": 0.9}],
                "descriptions": [
                    {
                        "content": "A dark room",
                        "type": "location",
                        "confidence": 0.8,
                        "entities": ["Alice"],
                    }
                ],
                "relationships": [],
            },
            "metrics": {"finish_reason": "stop"},
        }
        result = modal_response_to_chapter_result(modal_json)
        assert len(result.entities) == 1
        assert result.entities[0].name == "Alice"
        assert len(result.descriptions) == 1
        assert result.descriptions[0].content == "A dark room"

    def test_old_format_still_works(self):
        """modal_response_to_chapter_result works with old format."""
        from app.services.modal_client import modal_response_to_chapter_result

        modal_json = {
            "entities": [{"name": "Bob", "type": "character", "confidence": 0.85}],
            "descriptions": [],
            "relationships": [],
        }
        result = modal_response_to_chapter_result(modal_json)
        assert len(result.entities) == 1
        assert result.entities[0].name == "Bob"
