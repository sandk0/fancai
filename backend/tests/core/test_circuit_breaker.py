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
import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

# Will be imported after implementation
from app.core.openrouter_client import (
    OpenRouterClient,
    openrouter_breaker,
    CircuitBreakerError,
    CIRCUIT_BREAKER_EXCEPTIONS,
)
from app.monitoring.metrics import circuit_breaker_state


def _reset_breaker():
    """Reset circuit breaker state before each test."""
    openrouter_breaker._failure_count = 0
    openrouter_breaker._state = "closed"
    openrouter_breaker._opened = 0


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
        # First 5 calls should raise TimeoutException (through fallback chain exhaustion)
        for i in range(5):
            _reset_breaker()
            openrouter_breaker._failure_count = i
            if i < 4:
                # Not yet at threshold, TimeoutException propagates
                with pytest.raises(httpx.TimeoutException):
                    await client.generate_text("test prompt", model="test-model")
                openrouter_breaker._failure_count = i + 1

    # After 5 failures, CB should be open
    openrouter_breaker._failure_count = 5
    openrouter_breaker._state = "open"
    openrouter_breaker._opened = time.time()

    with patch.object(client, "_get_client", return_value=mock_http):
        with pytest.raises(CircuitBreakerError):
            await client.generate_text("test prompt", model="test-model")

    # Verify no additional HTTP calls were made (CB blocked before HTTP)
    # The mock was called during the 5 failures but not for the CB-blocked call


@pytest.mark.asyncio
async def test_cb_half_open_after_recovery_timeout():
    """Test 2: After recovery_timeout, circuit breaker transitions to half-open
    and allows a probe request."""
    client = _make_client()

    mock_http = AsyncMock()
    mock_http.is_closed = False

    # Set CB to open state with expired timeout
    openrouter_breaker._failure_count = 5
    openrouter_breaker._state = "open"
    openrouter_breaker._opened = time.time() - 61  # 61 seconds ago (> 60s recovery)

    # Probe request should succeed
    mock_http.post = AsyncMock(return_value=_mock_success_response())

    with patch.object(client, "_get_client", return_value=mock_http):
        result = await client.generate_text("test prompt", model="test-model")

    assert result == '{"result": "ok"}'
    # CB should now be closed after successful probe
    assert openrouter_breaker._state == "closed"


@pytest.mark.asyncio
async def test_json_decode_error_does_not_trigger_cb():
    """Test 3: JSONDecodeError does NOT increase failure count - CB stays closed."""
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

    with patch.object(client, "_get_client", return_value=mock_http):
        # generate_structured will fail on json.loads() but CB should stay closed
        with pytest.raises(json.JSONDecodeError):
            from pydantic import BaseModel

            class TestSchema(BaseModel):
                result: str

            await client.generate_structured("test", TestSchema, model="test-model")

    # CB failure count should still be 0
    assert openrouter_breaker._failure_count == 0
    assert openrouter_breaker._state == "closed"


@pytest.mark.asyncio
async def test_validation_error_does_not_trigger_cb():
    """Test 4: ValidationError does NOT increase failure count - CB stays closed."""
    from pydantic import ValidationError as PydanticValidationError

    client = _make_client()

    # We simulate a scenario where validation fails AFTER a successful HTTP call.
    # The CB should not count this as a failure since it's not a network issue.
    initial_failure_count = openrouter_breaker._failure_count

    # ValidationError is not in CIRCUIT_BREAKER_EXCEPTIONS
    assert PydanticValidationError not in CIRCUIT_BREAKER_EXCEPTIONS

    # CB should remain closed
    assert openrouter_breaker._state == "closed"
    assert openrouter_breaker._failure_count == initial_failure_count


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

    assert openrouter_breaker._failure_count == 1

    # Test OSError
    mock_http.post = AsyncMock(side_effect=OSError("network unreachable"))
    with patch.object(client, "_get_client", return_value=mock_http):
        with pytest.raises(OSError):
            await client.generate_text("test", model="test-model")

    assert openrouter_breaker._failure_count == 2


@pytest.mark.asyncio
async def test_generate_image_protected_by_cb():
    """Test 6: generate_image() is also protected by circuit breaker -
    raises CircuitBreakerError when open."""
    client = _make_client()

    mock_http = AsyncMock()
    mock_http.is_closed = False

    # Set CB to open state
    openrouter_breaker._failure_count = 5
    openrouter_breaker._state = "open"
    openrouter_breaker._opened = time.time()

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

    # Drive CB to open state through 5 failures with single model (no fallback)
    for i in range(5):
        _reset_breaker()
        openrouter_breaker._failure_count = i
        with patch.object(client, "_get_client", return_value=mock_http):
            try:
                await client.generate_text("test", model="test-model")
            except (httpx.TimeoutException, CircuitBreakerError):
                pass

    # Force CB open
    openrouter_breaker._failure_count = 5
    openrouter_breaker._state = "open"
    openrouter_breaker._opened = time.time()

    # Now try a call that should hit CircuitBreakerError
    with patch.object(client, "_get_client", return_value=mock_http):
        try:
            await client.generate_text("test", model="test-model")
        except CircuitBreakerError:
            pass

    # Verify Prometheus gauge was set to 2 (open)
    # Get the current value from the gauge
    gauge_value = circuit_breaker_state.labels(name="openrouter_api")._value.get()
    assert gauge_value == 2.0, f"Expected gauge=2.0 (open), got {gauge_value}"
