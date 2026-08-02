"""GeminiClient — прямой клиент Gemini API (google-genai), drop-in для OpenRouterClient.

Сигнатуры идентичны OpenRouterClient: generate_text→str, generate_structured→dict,
generate_image→bytes. usage пишется в llm_usage_log (как в openrouter_client).
"""

import json
import logging
from typing import Optional, Type

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.core.config import settings
from app.core.gemini_pricing import compute_cost, compute_image_cost

logger = logging.getLogger(__name__)


async def _log_usage_to_db(
    model: str,
    service: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    cost: float,
) -> None:
    """Запись usage в llm_usage_log; вызывается через await, ошибки проглатывает.

    Раньше отпускалась в asyncio.create_task, но Celery-таски выполняются через
    run_async -> asyncio.run, который на выходе отменяет незавершённые задачи:
    на коротких путях (генерация изображения) запись терялась целиком.
    """
    try:
        from app.core.database import AsyncSessionLocal
        from app.models.llm_usage_log import LlmUsageLog

        async with AsyncSessionLocal() as session:
            session.add(
                LlmUsageLog(
                    model=model,
                    service=service,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cost_dollars=cost,
                    request_id=None,
                )
            )
            await session.commit()
    except Exception as e:
        logger.warning(f"[Gemini] usage log failed: {e}")


class GeminiClient:
    """Прямой клиент Gemini через google-genai (async via client.aio)."""

    def __init__(
        self,
        api_key: str = "",
        *,
        vertexai: bool = False,
        project: str = "",
        location: str = "",
    ):
        if vertexai:
            self._client = genai.Client(
                vertexai=True, project=project, location=location
            )
        else:
            self._client = genai.Client(api_key=api_key)

    async def _log(self, model: str, resp_usage, cost: float) -> None:
        # Запись ждём, а не отпускаем в create_task: Celery-таски выполняются
        # через run_async -> asyncio.run, который на выходе отменяет все
        # незавершённые задачи. Fire-and-forget терял usage целиком на коротких
        # путях вроде генерации изображения. Ошибки внутри проглатываются, так
        # что учёт не может уронить основной вызов.
        await _log_usage_to_db(
            model=model,
            service=None,
            prompt_tokens=getattr(resp_usage, "prompt_token_count", 0) or 0,
            completion_tokens=getattr(resp_usage, "candidates_token_count", 0) or 0,
            cost=cost,
        )

    async def generate_text(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
    ) -> str:
        model = model or settings.GEMINI_EXTRACTION_MODEL
        # temperature в поколении 3.x deprecated и игнорируется; в следующих —
        # HTTP 400, поэтому параметр не передаётся вовсе.
        config = types.GenerateContentConfig(system_instruction=system_prompt)
        resp = await self._client.aio.models.generate_content(
            model=model, contents=prompt, config=config
        )
        um = resp.usage_metadata
        cost = compute_cost(
            model,
            getattr(um, "prompt_token_count", 0) or 0,
            getattr(um, "candidates_token_count", 0) or 0,
            cached=getattr(um, "cached_content_token_count", 0) or 0,
            thoughts=getattr(um, "thoughts_token_count", 0) or 0,
        )
        await self._log(model, um, cost)
        return resp.text or ""

    async def generate_structured(
        self,
        prompt: str,
        schema_class: Type[BaseModel],
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
    ) -> dict:
        model = model or settings.GEMINI_EXTRACTION_MODEL
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema_class,
            system_instruction=system_prompt,
            thinking_config=types.ThinkingConfig(thinking_level="medium"),
        )
        resp = await self._client.aio.models.generate_content(
            model=model, contents=prompt, config=config
        )
        um = resp.usage_metadata
        cost = compute_cost(
            model,
            getattr(um, "prompt_token_count", 0) or 0,
            getattr(um, "candidates_token_count", 0) or 0,
            cached=getattr(um, "cached_content_token_count", 0) or 0,
            thoughts=getattr(um, "thoughts_token_count", 0) or 0,
        )
        await self._log(model, um, cost)
        if not resp.text:
            raise RuntimeError(
                f"Gemini ({model}) returned empty/blocked structured response"
            )
        return json.loads(resp.text)

    async def generate_image(
        self,
        prompt: str,
        model: Optional[str] = None,
        aspect_ratio: str = "4:3",
        image_size: str = "1K",
    ) -> bytes:
        model = model or settings.GEMINI_IMAGE_MODEL
        # aspect_ratio и image_size обязаны уходить в image_config: без него SDK
        # генерирует в дефолтном соотношении (16:9), а compute_image_cost ниже
        # считает цену по ЗАПРОШЕННОМУ размеру — расхождение было бы молчаливым.
        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(
                aspect_ratio=aspect_ratio, image_size=image_size
            ),
        )
        resp = await self._client.aio.models.generate_content(
            model=model, contents=prompt, config=config
        )
        if not resp.candidates:
            raise RuntimeError(
                f"Gemini image model {model} returned no candidates (likely safety-blocked)"
            )
        content = resp.candidates[0].content
        if content is None or not content.parts:
            raise RuntimeError(
                f"Gemini image model {model} returned a candidate without content parts"
            )
        for part in content.parts:
            inline = getattr(part, "inline_data", None)
            if inline and inline.data:
                await _log_usage_to_db(
                    model=model,
                    service="image",
                    prompt_tokens=0,
                    completion_tokens=0,
                    cost=compute_image_cost(model, image_size),
                )
                return inline.data
        raise RuntimeError(f"Gemini image model {model} вернул ответ без image-данных")

    async def close(self) -> None:
        """Совместимость с интерфейсом OpenRouterClient (no-op для google-genai)."""
        return None


_client: Optional[GeminiClient] = None


def get_gemini_client() -> GeminiClient:
    """Singleton GeminiClient. Backend по settings.GEMINI_BACKEND (developer|vertex)."""
    global _client
    if _client is None:
        if settings.GEMINI_BACKEND == "vertex":
            _client = GeminiClient(
                vertexai=True,
                project=settings.GCP_PROJECT,
                location=settings.GCP_LOCATION,
            )
        else:
            _client = GeminiClient(api_key=settings.GEMINI_API_KEY)
    return _client
