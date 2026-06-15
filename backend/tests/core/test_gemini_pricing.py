import pytest
from app.core.gemini_pricing import compute_cost, IMAGE_PRICING


def test_flash35_text_cost():
    # 1M input + 1M output на 3.5 Flash = $1.50 + $9.00
    assert round(compute_cost("gemini-3.5-flash", 1_000_000, 1_000_000), 2) == 10.50


def test_cached_input_discounted():
    # 1M input, из них 1M cached → $0.15 (cached rate), output 0
    assert (
        round(compute_cost("gemini-3.5-flash", 1_000_000, 0, cached=1_000_000), 4)
        == 0.15
    )


def test_lite_cheaper():
    assert round(compute_cost("gemini-3.1-flash-lite", 1_000_000, 0), 4) == 0.25


def test_unknown_model_returns_zero():
    assert compute_cost("unknown-model", 1000, 1000) == 0.0


def test_image_price_nb2_1k():
    assert IMAGE_PRICING["gemini-3.1-flash-image"]["1K"] == 0.067
