"""
Tests for Circuit Breaker integration in OpenRouter client.

Tests:
1. After 5 consecutive httpx.TimeoutException, generate_text() raises CircuitBreakerError without HTTP request
2. After recovery_timeout, circuit breaker transitions to half-open and allows a probe request
3. JSONDecodeError does NOT increase failure count - CB stays closed
4. ValidationError does NOT increase failure count - CB stays closed
5. ConnectionError and OSError increase failure count (network errors)
6. generate_image() is also protected by circuit breaker - raises CircuitBreakerError when open
7. Prometheus Gauge circuit_breaker_state is updated when transitioning to open state
"""

import json
from time import monotonic
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.core.openrouter_client import (
    OpenRouterClient,
    openrouter_breaker,
    openrouter_image_breaker,
    CircuitBreakerError,
    CIRCUIT_BREAKER_EXCEPTIONS,
)
from app.monitoring.metrics import circuit_breaker_state


def _reset_breaker() -> None:
    """Reset circuit breaker state before each test."""
    for breaker in (openrouter_breaker, openrouter_image_breaker):
        breaker._failure_count = 0
        breaker._state = "closed"
        breaker._opened = monotonic()
        breaker._last_failure = None


def _make_client() -> OpenRouterClient:
    """Create a test client instance."""
    return OpenRouterClient(api_key="test-key", timeout=10)


def _mock_success_response(content: str = '{"result": "ok"}') -> MagicMock:
    """Create a mock successful httpx.Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.001},
        "id": "test-req-id",
    }
    return resp


def _mock_image_response() -> MagicMock:
    """Create a mock image response."""
    import base64

    fake_image = base64.b64encode(b"fake-png-data").decode()
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {
        "choices": [
            {
                "message": {
                    "images": [
                        {"image_url": {"url": f"data:image/png;base64,{fake_image}"}}
                    ]
                }
            }
        ],
        "usage": {"prompt_tokens": 5, "completion_tokens": 0, "cost": 0.01},
        "id": "test-img-req",
    }
    return resp


@pytest.fixture(autouse=True)
def reset_cb():
    """Reset circuit breaker before each test."""
    _reset_breaker()
    yield
    _reset_breaker()


@pytest.mark.asyncio
async def test_cb_opens_after_5_timeouts():
    """Test 1: After 5 consecutive httpx.TimeoutException, generate_text() raises
    CircuitBreakerError without making an HTTP request."""
    client = _make_client()

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
    mock_http.is_closed = False

    with patch.object(client, "_get_client", return_value=mock_http):
        # With model="test-model" (single model, no fallback chain),
        # each call goes through _post_with_breaker once.
        # After 5 failures, CB opens.
        for i in range(5):
            with pytest.raises(httpx.TimeoutException):
                await client.generate_text("test prompt", model="test-model")

        assert openrouter_breaker.state == "open"
        assert openrouter_breaker.failure_count == 5

        # 6th call should raise CircuitBreakerError without HTTP request
        call_count_before = mock_http.post.call_count
        with pytest.raises(CircuitBreakerError):
            await client.generate_text("test prompt", model="test-model")

        # No additional HTTP calls were made (CB blocked before HTTP)
        assert mock_http.post.call_count == call_count_before


@pytest.mark.asyncio
async def test_cb_half_open_after_recovery_timeout():
    """Test 2: After recovery_timeout, circuit breaker transitions to half-open
    and allows a probe request."""
    client = _make_client()

    mock_http = AsyncMock()
    mock_http.is_closed = False

    # Set CB to open state with expired timeout (uses monotonic clock)
    openrouter_breaker._failure_count = 5
    openrouter_breaker._state = "open"
    openrouter_breaker._opened = monotonic() - 61  # 61 seconds ago (> 60s recovery)

    # Probe request should succeed
    mock_http.post = AsyncMock(return_value=_mock_success_response())

    with patch.object(client, "_get_client", return_value=mock_http):
        result = await client.generate_text("test prompt", model="test-model")

    assert result == '{"result": "ok"}'
    # CB should now be closed after successful probe
    assert openrouter_breaker.state == "closed"


@pytest.mark.asyncio
async def test_json_decode_error_does_not_trigger_cb():
    """Test 3: JSONDecodeError does NOT increase failure count -- CB stays closed."""
    client = _make_client()

    # Mock response that returns invalid JSON for structured endpoint
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.status_code = 200
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": "not valid json {"}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        "id": "test",
    }

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(return_value=mock_resp)
    mock_http.is_closed = False

    from pydantic import BaseModel

    class TestSchema(BaseModel):
        result: str

    with patch.object(client, "_get_client", return_value=mock_http):
        # generate_structured will fail on json.loads() but CB should stay closed
        with pytest.raises(json.JSONDecodeError):
            await client.generate_structured("test", TestSchema, model="test-model")

    # CB failure count should still be 0
    assert openrouter_breaker.failure_count == 0
    assert openrouter_breaker.state == "closed"


@pytest.mark.asyncio
async def test_validation_error_does_not_trigger_cb():
    """Test 4: ValidationError does NOT increase failure count -- CB stays closed."""
    from pydantic import ValidationError as PydanticValidationError

    # Verify ValidationError is not in CIRCUIT_BREAKER_EXCEPTIONS
    assert PydanticValidationError not in CIRCUIT_BREAKER_EXCEPTIONS

    # Verify JSONDecodeError is also not in the exception list
    assert json.JSONDecodeError not in CIRCUIT_BREAKER_EXCEPTIONS

    # Only network errors are in the list
    assert httpx.HTTPStatusError in CIRCUIT_BREAKER_EXCEPTIONS
    assert httpx.TimeoutException in CIRCUIT_BREAKER_EXCEPTIONS
    assert ConnectionError in CIRCUIT_BREAKER_EXCEPTIONS
    assert OSError in CIRCUIT_BREAKER_EXCEPTIONS

    # CB should remain closed
    assert openrouter_breaker.state == "closed"
    assert openrouter_breaker.failure_count == 0


@pytest.mark.asyncio
async def test_connection_and_os_errors_increase_failure_count():
    """Test 5: ConnectionError and OSError increase failure count (network errors)."""
    client = _make_client()

    mock_http = AsyncMock()
    mock_http.is_closed = False

    # Test ConnectionError
    mock_http.post = AsyncMock(side_effect=ConnectionError("connection refused"))
    with patch.object(client, "_get_client", return_value=mock_http):
        with pytest.raises(ConnectionError):
            await client.generate_text("test", model="test-model")

    assert openrouter_breaker.failure_count == 1

    # Test OSError
    mock_http.post = AsyncMock(side_effect=OSError("network unreachable"))
    with patch.object(client, "_get_client", return_value=mock_http):
        with pytest.raises(OSError):
            await client.generate_text("test", model="test-model")

    assert openrouter_breaker.failure_count == 2


@pytest.mark.asyncio
async def test_generate_image_protected_by_cb():
    """Test 6: generate_image() is also protected by circuit breaker --
    raises CircuitBreakerError when open."""
    client = _make_client()

    mock_http = AsyncMock()
    mock_http.is_closed = False

    # Set image CB to open state (uses monotonic clock)
    # generate_image uses openrouter_image_breaker (separate from LLM breaker)
    openrouter_image_breaker._failure_count = 5
    openrouter_image_breaker._state = "open"
    openrouter_image_breaker._opened = monotonic()

    with patch.object(client, "_get_client", return_value=mock_http):
        with pytest.raises(CircuitBreakerError):
            await client.generate_image("a beautiful landscape")

    # No HTTP calls should have been made
    mock_http.post.assert_not_called()


@pytest.mark.asyncio
async def test_prometheus_gauge_updated_on_open():
    """Test 7: Prometheus Gauge circuit_breaker_state is updated
    when transitioning to open state."""
    client = _make_client()

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
    mock_http.is_closed = False

    with patch.object(client, "_get_client", return_value=mock_http):
        # Drive CB to open state through 5 failures with single model (no fallback)
        for _ in range(5):
            with pytest.raises(httpx.TimeoutException):
                await client.generate_text("test", model="test-model")

        assert openrouter_breaker.state == "open"

        # Now try a call that should hit CircuitBreakerError
        with pytest.raises(CircuitBreakerError):
            await client.generate_text("test", model="test-model")

    # Verify Prometheus gauge was set to 2 (open)
    gauge_value = circuit_breaker_state.labels(name="openrouter_api")._value.get()
    assert gauge_value == 2.0, f"Expected gauge=2.0 (open), got {gauge_value}"
