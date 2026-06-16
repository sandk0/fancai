"""Test that GeminiDirectExtractor routes structured calls via get_ai_provider()."""

import pytest
from unittest.mock import AsyncMock, patch

from app.services.gemini_extractor import GeminiDirectExtractor, GeminiConfig


@pytest.mark.asyncio
async def test_extractor_routes_structured_via_provider():
    """Extractor must route _call_gemini_with_retry through get_ai_provider()."""
    mock_return = {
        "descriptions": [],
        "entities": [],
        "relationships": [],
    }
    with patch("app.services.gemini_extractor.get_ai_provider") as gp:
        gp.return_value.generate_structured = AsyncMock(return_value=mock_return)
        extractor = GeminiDirectExtractor(GeminiConfig())
        await extractor._call_gemini_with_retry("эталонный русский чанк про Геральта")

    assert gp.return_value.generate_structured.await_count >= 1
    _, kwargs = gp.return_value.generate_structured.call_args
    # schema_class must be passed as a Pydantic class, not a dict
    assert isinstance(kwargs["schema_class"], type)
