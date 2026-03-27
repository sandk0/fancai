"""
Tests for ErrorClassifier — pipeline error classification (OBS-01).

Tests classify_error() mapping for all 5 error types:
timeout, json_error, modal_error, cancelled, truncated.
Modal SDK exceptions mocked via classes with matching __name__.
"""

import asyncio
import json

import pytest


# Mock Modal SDK exceptions (not importing Modal — optional dependency)
class FunctionTimeoutError(Exception):
    pass


class RemoteError(Exception):
    pass


class InputCancellation(BaseException):
    pass


class TestErrorClassifier:
    """Tests for classify_error() and error type constants."""

    def test_classify_function_timeout_error(self):
        """Test 1: FunctionTimeoutError -> 'timeout'."""
        from app.core.error_classifier import classify_error

        exc = FunctionTimeoutError("Modal function timed out")
        assert classify_error(exc) == "timeout"

    def test_classify_asyncio_timeout_error(self):
        """Test 2: asyncio.TimeoutError -> 'timeout'."""
        from app.core.error_classifier import classify_error

        exc = asyncio.TimeoutError()
        assert classify_error(exc) == "timeout"

    def test_classify_builtin_timeout_error(self):
        """Test 3: TimeoutError (builtin) -> 'timeout'."""
        from app.core.error_classifier import classify_error

        exc = TimeoutError("connection timed out")
        assert classify_error(exc) == "timeout"

    def test_classify_json_decode_error(self):
        """Test 4: JSONDecodeError -> 'json_error'."""
        from app.core.error_classifier import classify_error

        exc = json.JSONDecodeError("Expecting value", "doc", 0)
        assert classify_error(exc) == "json_error"

    def test_classify_remote_error(self):
        """Test 5: RemoteError -> 'modal_error'."""
        from app.core.error_classifier import classify_error

        exc = RemoteError("Remote function crashed")
        assert classify_error(exc) == "modal_error"

    def test_classify_input_cancellation(self):
        """Test 6: InputCancellation -> 'cancelled'."""
        from app.core.error_classifier import classify_error

        exc = InputCancellation()
        assert classify_error(exc) == "cancelled"

    def test_classify_runtime_error_fallback(self):
        """Test 7: RuntimeError (unknown) -> 'modal_error' (fallback)."""
        from app.core.error_classifier import classify_error

        exc = RuntimeError("unknown error")
        assert classify_error(exc) == "modal_error"

    def test_classify_value_error_fallback(self):
        """Test 8: ValueError -> 'modal_error' (fallback)."""
        from app.core.error_classifier import classify_error

        exc = ValueError("bad value")
        assert classify_error(exc) == "modal_error"

    def test_valid_error_types_has_5_elements(self):
        """Test 9: VALID_ERROR_TYPES contains exactly 5 elements."""
        from app.core.error_classifier import VALID_ERROR_TYPES

        assert len(VALID_ERROR_TYPES) == 5

    def test_error_type_truncated_constant(self):
        """Test 10: ERROR_TYPE_TRUNCATED == 'truncated'."""
        from app.core.error_classifier import ERROR_TYPE_TRUNCATED

        assert ERROR_TYPE_TRUNCATED == "truncated"

    def test_all_constants_in_valid_set(self):
        """Test 11: All ERROR_TYPE_* constants are in VALID_ERROR_TYPES."""
        from app.core.error_classifier import (
            VALID_ERROR_TYPES,
            ERROR_TYPE_TIMEOUT,
            ERROR_TYPE_JSON_ERROR,
            ERROR_TYPE_MODAL_ERROR,
            ERROR_TYPE_CANCELLED,
            ERROR_TYPE_TRUNCATED,
        )

        assert ERROR_TYPE_TIMEOUT in VALID_ERROR_TYPES
        assert ERROR_TYPE_JSON_ERROR in VALID_ERROR_TYPES
        assert ERROR_TYPE_MODAL_ERROR in VALID_ERROR_TYPES
        assert ERROR_TYPE_CANCELLED in VALID_ERROR_TYPES
        assert ERROR_TYPE_TRUNCATED in VALID_ERROR_TYPES
