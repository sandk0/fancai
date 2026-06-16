"""Task A3.2: ImagenService routes image generation through NanoBananaGenerator."""

import pytest
from unittest.mock import AsyncMock, patch
from app.services.imagen_generator import ImagenService


@pytest.mark.asyncio
async def test_imagen_generate_with_retry_uses_nano_banana():
    svc = ImagenService()
    svc._available = True
    with patch("app.services.imagen_generator.NanoBananaGenerator") as NB:
        NB.return_value.generate = AsyncMock(return_value=b"PNGDATA")
        svc._nano = NB.return_value
        out = await svc._generate_with_retry("a castle, book illustration", "4:3")
    assert out == b"PNGDATA"
