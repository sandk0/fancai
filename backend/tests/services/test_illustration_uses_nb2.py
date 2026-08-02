"""Task A3.2: IllustrationService routes image generation through NanoBananaGenerator."""

import pytest
from unittest.mock import AsyncMock, patch
from app.services.illustration_service import IllustrationService


@pytest.mark.asyncio
async def test_illustration_generate_with_retry_uses_nano_banana():
    svc = IllustrationService()
    svc._available = True
    with patch("app.services.illustration_service.NanoBananaGenerator") as NB:
        NB.return_value.generate = AsyncMock(return_value=b"PNGDATA")
        svc._nano = NB.return_value
        out = await svc._generate_with_retry("a castle, book illustration", "4:3")
    assert out == b"PNGDATA"
