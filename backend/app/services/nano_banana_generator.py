"""NanoBananaGenerator — генерация иллюстраций через Gemini (gemini-3.1-flash-image).

Тонкий слой: готовый английский промпт → bytes. Prompt-инженерия (перевод RU→EN,
genre-стили, SFW) остаётся в ImagenPromptEngineer/ImagenService.
"""

import logging
from typing import Optional

from app.core.config import settings
from app.core.gemini_client import get_gemini_client

logger = logging.getLogger(__name__)


class NanoBananaGenerator:
    def __init__(self):
        self._client = get_gemini_client()

    async def generate(
        self,
        prompt: str,
        aspect_ratio: str = "4:3",
        image_size: str = "1K",
        model: Optional[str] = None,
    ) -> bytes:
        return await self._client.generate_image(
            prompt=prompt,
            model=model or settings.GEMINI_IMAGE_MODEL,
            aspect_ratio=aspect_ratio,
            image_size=image_size,
        )
