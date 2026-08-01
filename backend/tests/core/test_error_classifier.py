"""
Tests for ErrorClassifier — pipeline error classification (OBS-01).

Tests classify_error() mapping for all 5 error types:
timeout, json_error, provider_error, cancelled, truncated.

Моки исключений Modal SDK убраны вместе с Modal-пайплайном: классификатор
провайдер-нейтрален и опирается только на стандартные исключения.
"""

import asyncio
import json


class TestErrorClassifier:
    """Tests for classify_error() and error type constants."""

    def test_classify_asyncio_timeout_error(self):
        """asyncio.TimeoutError -> 'timeout'."""
        from app.core.error_classifier import classify_error

        assert classify_error(asyncio.TimeoutError()) == "timeout"

    def test_classify_builtin_timeout_error(self):
        """TimeoutError (builtin) -> 'timeout'."""
        from app.core.error_classifier import classify_error

        assert classify_error(TimeoutError("timed out")) == "timeout"

    def test_classify_json_decode_error(self):
        """JSONDecodeError -> 'json_error'."""
        from app.core.error_classifier import classify_error

        exc = json.JSONDecodeError("Expecting value", "{bad", 1)
        assert classify_error(exc) == "json_error"

    def test_classify_cancelled_error(self):
        """asyncio.CancelledError -> 'cancelled'.

        CancelledError наследует BaseException, поэтому проверяется отдельно
        от общих веток — иначе он провалился бы в provider_error.
        """
        from app.core.error_classifier import classify_error

        assert classify_error(asyncio.CancelledError()) == "cancelled"

    def test_classify_runtime_error_fallback(self):
        """RuntimeError (unknown) -> 'provider_error' (fallback)."""
        from app.core.error_classifier import classify_error

        assert classify_error(RuntimeError("boom")) == "provider_error"

    def test_classify_value_error_fallback(self):
        """ValueError -> 'provider_error' (fallback)."""
        from app.core.error_classifier import classify_error

        assert classify_error(ValueError("bad value")) == "provider_error"

    def test_json_error_wins_over_value_error(self):
        """JSONDecodeError наследует ValueError — приоритет у json_error."""
        from app.core.error_classifier import classify_error

        exc = json.JSONDecodeError("Expecting value", "{bad", 1)
        assert isinstance(exc, ValueError)
        assert classify_error(exc) == "json_error"

    def test_no_modal_error_type_remains(self):
        """После удаления Modal значение 'modal_error' больше не выдаётся."""
        from app.core.error_classifier import VALID_ERROR_TYPES

        assert "modal_error" not in VALID_ERROR_TYPES

    def test_valid_error_types_has_5_elements(self):
        """VALID_ERROR_TYPES contains exactly 5 elements."""
        from app.core.error_classifier import VALID_ERROR_TYPES

        assert len(VALID_ERROR_TYPES) == 5

    def test_error_type_truncated_constant(self):
        """ERROR_TYPE_TRUNCATED == 'truncated'."""
        from app.core.error_classifier import ERROR_TYPE_TRUNCATED

        assert ERROR_TYPE_TRUNCATED == "truncated"

    def test_all_constants_in_valid_set(self):
        """All ERROR_TYPE_* constants are in VALID_ERROR_TYPES."""
        from app.core.error_classifier import (
            ERROR_TYPE_TIMEOUT,
            ERROR_TYPE_JSON_ERROR,
            ERROR_TYPE_PROVIDER_ERROR,
            ERROR_TYPE_CANCELLED,
            ERROR_TYPE_TRUNCATED,
            VALID_ERROR_TYPES,
        )

        assert ERROR_TYPE_TIMEOUT in VALID_ERROR_TYPES
        assert ERROR_TYPE_JSON_ERROR in VALID_ERROR_TYPES
        assert ERROR_TYPE_PROVIDER_ERROR in VALID_ERROR_TYPES
        assert ERROR_TYPE_CANCELLED in VALID_ERROR_TYPES
        assert ERROR_TYPE_TRUNCATED in VALID_ERROR_TYPES
