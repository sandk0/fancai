"""Таблица цен Gemini API + расчёт стоимости из usage_metadata.

Цены $/1M токенов (Standard tier), verified по ai.google.dev/gemini-api/docs/pricing (2026-08-01).
Изображения — $/картинку по разрешению.
"""

# $/1M токенов: in / out / cached_in
PRICING: dict[str, dict[str, float]] = {
    "gemini-3.6-flash": {"in": 1.50, "out": 7.50, "cached_in": 0.15},
    "gemini-3.5-flash": {"in": 1.50, "out": 9.00, "cached_in": 0.15},
    "gemini-3.5-flash-lite": {"in": 0.30, "out": 2.50, "cached_in": 0.03},
    "gemini-3.1-flash-lite": {"in": 0.25, "out": 1.50, "cached_in": 0.025},
    "gemini-2.5-flash": {"in": 0.30, "out": 2.50, "cached_in": 0.03},
    "gemini-2.5-flash-lite": {"in": 0.10, "out": 0.40, "cached_in": 0.01},
}

# $/картинку по разрешению
IMAGE_PRICING: dict[str, dict[str, float]] = {
    "gemini-3.1-flash-image": {"0.5K": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151},
    "gemini-2.5-flash-image": {"1K": 0.039},
    "gemini-3-pro-image": {"1K": 0.134, "2K": 0.134, "4K": 0.24},
}


def compute_cost(
    model: str, in_tokens: int, out_tokens: int, cached: int = 0, thoughts: int = 0
) -> float:
    """Стоимость текстового вызова в USD. Неизвестная модель → 0.0 (без падения).

    thoughts: thinking-токены (thoughts_token_count) — Gemini выставляет их отдельно
    и тарифицирует по ставке output.
    """
    p = PRICING.get(model)
    if p is None:
        return 0.0
    billable_in = max(in_tokens - cached, 0)
    return (
        billable_in * p["in"]
        + cached * p["cached_in"]
        + (out_tokens + thoughts) * p["out"]
    ) / 1_000_000


def compute_image_cost(model: str, resolution: str = "1K") -> float:
    """Стоимость генерации картинки в USD. Неизвестная модель/разрешение → 0.0."""
    return IMAGE_PRICING.get(model, {}).get(resolution, 0.0)
