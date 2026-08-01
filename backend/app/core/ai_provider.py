"""Провайдер-абстракция AI-вызовов.

Protocol с сигнатурами, идентичными существующему OpenRouterClient,
чтобы GeminiClient был drop-in заменой. usage логируется внутри реализаций
(в llm_usage_log), не возвращается.
"""

from typing import Optional, Protocol, Type, runtime_checkable

from pydantic import BaseModel


@runtime_checkable
class AIProvider(Protocol):
    async def generate_text(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
    ) -> str: ...

    async def generate_structured(
        self,
        prompt: str,
        schema_class: Type[BaseModel],
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
    ) -> dict: ...

    async def generate_image(
        self,
        prompt: str,
        model: Optional[str] = None,
        aspect_ratio: str = "4:3",
        image_size: str = "1K",
    ) -> bytes: ...
