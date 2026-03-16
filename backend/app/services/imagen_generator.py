"""
OpenRouter FLUX.2 Klein 4B Image Generator.

Использует OpenRouter FLUX.2 Klein 4B (мигрирован в Plan 03-03).
Использует единый openrouter_client.py для всех AI-вызовов.

Features:
- Автоматический перевод RU -> EN через OpenRouter generate_text()
- NSFW-защита через суффикс "SFW, safe for work" в промпте
- Type-specific style templates (location, character, atmosphere)
- Genre-aware styling
- Кэширование переводов в Redis
- Tenacity-based retry через обёртку openrouter_client

Created: 2025-12-13
Updated: 2026-03-01 - Мигрирован на OpenRouter FLUX.2 Klein 4B (Plan 03-03)
"""

import os
import hashlib
import time
import base64
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from app.models.description import DescriptionType
import logging

from app.core.retry import (
    retry_image_generation,
    ImageGenerationError,
    RateLimitError,
    TimeoutError as RetryTimeoutError,
)
from app.core.openrouter_client import get_openrouter_client
from app.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Датаклассы
# ---------------------------------------------------------------------------


@dataclass
class ImageGenerationResult:
    """Результат генерации изображения."""

    success: bool
    image_url: Optional[str] = None
    image_data: Optional[bytes] = None
    local_path: Optional[str] = None
    error_message: Optional[str] = None
    generation_time_seconds: Optional[float] = None
    model_used: Optional[str] = None
    prompt_used: Optional[str] = None


# ---------------------------------------------------------------------------
# PromptTranslator
# ---------------------------------------------------------------------------


class PromptTranslator:
    """
    Переводит русские описания на английский для FLUX.2.

    Использует OpenRouter generate_text() (вместо google-genai SDK).
    Системный промпт содержит инструкцию SFW — обеспечивает NSFW-защиту на уровне перевода.
    """

    TRANSLATION_SYSTEM_PROMPT = (
        "You are a translator specializing in visual descriptions for AI image generation. "
        "Translate the following Russian text to English for use in an image generation prompt. "
        "Focus ONLY on visual elements (appearance, colors, textures, lighting, mood). "
        "Use vivid, descriptive adjectives. Include technical art terms where appropriate. "
        "Keep the translation under 150 words. Do NOT add interpretations. "
        "The result must be SFW (safe for work) and appropriate for all audiences."
    )

    def __init__(self):
        self._client = get_openrouter_client()
        self._redis = None

    async def _get_redis(self):
        """Lazy-инициализация Redis клиента."""
        if self._redis is None:
            try:
                import redis.asyncio as aioredis

                self._redis = await aioredis.from_url(settings.REDIS_URL)
            except Exception as e:
                logger.warning(f"Failed to connect to Redis for translation cache: {e}")
                return None
        return self._redis

    async def translate(self, russian_text: str) -> str:
        """
        Переводит русское описание на английский.

        Args:
            russian_text: Русское визуальное описание

        Returns:
            Английский перевод, оптимизированный для генерации изображений.
            При ошибке возвращает оригинальный текст.
        """
        # Кэш-ключ по хэшу текста
        hash_key = hashlib.md5(
            russian_text.encode(), usedforsecurity=False
        ).hexdigest()[:16]
        cache_key = f"translation:{hash_key}"

        # Проверяем Redis cache
        redis = await self._get_redis()
        if redis:
            try:
                cached = await redis.get(cache_key)
                if cached:
                    logger.debug(f"Translation cache hit (Redis): {cache_key}")
                    return cached.decode("utf-8")
            except Exception as e:
                logger.warning(f"Redis cache read error: {e}")

        try:
            translation = await self._client.generate_text(
                prompt=russian_text,
                system_prompt=self.TRANSLATION_SYSTEM_PROMPT,
                temperature=0.1,
            )

            # Кэшируем в Redis (7 дней)
            if redis:
                try:
                    await redis.setex(cache_key, 604800, translation)
                    logger.debug(f"Cached translation (Redis): {cache_key}")
                except Exception as e:
                    logger.warning(f"Redis cache write error: {e}")

            logger.debug(f"Translated: {russian_text[:50]}... → {translation[:50]}...")
            return translation

        except Exception as e:
            logger.error(f"Translation failed: {e}")
            return russian_text


# ---------------------------------------------------------------------------
# ImagenPromptEngineer
# ---------------------------------------------------------------------------


class ImagenPromptEngineer:
    """
    Создаёт оптимизированные английские промпты для FLUX.2.

    Включает type-specific templates и genre-aware styling.
    """

    _BASE_STYLE_TEMPLATES = {
        DescriptionType.LOCATION: {
            "prefix": "Detailed book illustration of",
            "base_style": "atmospheric lighting, rich vibrant colors, detailed environment",
            "suffix": "professional artwork, high quality, suitable for book illustration",
        },
        DescriptionType.CHARACTER: {
            "prefix": "Character portrait illustration of",
            "base_style": "detailed facial features, expressive eyes, period-appropriate attire",
            "suffix": "professional character design, artistic rendering, book illustration quality",
        },
        DescriptionType.ATMOSPHERE: {
            "prefix": "Atmospheric scene depicting",
            "base_style": "cinematic lighting, emotional ambiance, dramatic composition",
            "suffix": "evocative artwork, impressionistic style, book illustration",
        },
        DescriptionType.OBJECT: {
            "prefix": "Detailed illustration of",
            "base_style": "clear focus, artistic presentation, rich textures",
            "suffix": "still life quality, professional artwork",
        },
        DescriptionType.ACTION: {
            "prefix": "Dynamic scene of",
            "base_style": "captured motion, dramatic lighting, energy and movement",
            "suffix": "cinematic moment, book illustration style",
        },
    }

    _GENRE_TYPE_OVERRIDES = {
        "fantasy": {
            DescriptionType.LOCATION: "ethereal glow, magical atmosphere, enchanted forest tones",
            DescriptionType.CHARACTER: "fantasy armor, mystical aura, otherworldly features",
            DescriptionType.ATMOSPHERE: "magical particles, fantasy sky, arcane energy",
        },
        "science_fiction": {
            DescriptionType.LOCATION: "holographic displays, neon lighting, cyberpunk architecture",
            DescriptionType.CHARACTER: "futuristic outfit, tech accessories, LED accents",
            DescriptionType.ATMOSPHERE: "digital rain, sci-fi haze, starfield backdrop",
        },
        "detective": {
            DescriptionType.LOCATION: "film noir shadows, venetian blinds light, 1940s decor",
            DescriptionType.CHARACTER: "trench coat, fedora, smoky atmosphere",
            DescriptionType.ATMOSPHERE: "rainy night, streetlamp glow, mysterious silhouettes",
        },
        "romance": {
            DescriptionType.LOCATION: "golden hour lighting, blooming flowers, intimate setting",
            DescriptionType.CHARACTER: "elegant attire, soft gaze, romantic aura",
            DescriptionType.ATMOSPHERE: "sunset hues, bokeh hearts, dreamy softness",
        },
        "horror": {
            DescriptionType.LOCATION: "ominous shadows, fog, dilapidated structures",
            DescriptionType.CHARACTER: "unsettling features, pale skin, haunted eyes",
            DescriptionType.ATMOSPHERE: "blood moon, creeping mist, dread",
        },
        "thriller": {
            DescriptionType.LOCATION: "urban night, rain-slicked streets, surveillance",
            DescriptionType.CHARACTER: "intense expression, tactical gear, tension",
            DescriptionType.ATMOSPHERE: "electric tension, flickering lights, paranoia",
        },
        "historical": {
            DescriptionType.LOCATION: "period architecture, antique furnishings, sepia warmth",
            DescriptionType.CHARACTER: "historical costume, refined posture, classical beauty",
            DescriptionType.ATMOSPHERE: "candlelight, vintage patina, old masters style",
        },
    }

    GENRE_STYLES = {
        "fantasy": "fantasy art, magical atmosphere, ethereal lighting, vibrant colors, enchanted environment",
        "detective": "noir style, dramatic shadows, moody atmosphere, 1940s film aesthetic, urban mystery",
        "science_fiction": "futuristic aesthetic, technological elements, sci-fi lighting, neon accents, cyberpunk influences",
        "historical": "period-accurate details, classical painting style, oil painting texture, museum quality",
        "romance": "soft warm lighting, romantic mood, pastel colors, soft focus bokeh, intimate atmosphere",
        "thriller": "high contrast lighting, suspenseful mood, dark tones, urban environment, cinematic tension",
        "horror": "dark atmosphere, ominous shadows, unsettling mood, desaturated colors, gothic elements",
        "classic": "classical book illustration, timeless elegance, traditional artwork, literary style",
        "other": "professional book illustration, balanced lighting, artistic rendering",
        "adventure": "epic scale, dramatic vistas, saturated colors, sense of journey, exploration",
        "children": "bright cheerful colors, simplified shapes, friendly style, storybook illustration",
        "mystery": "atmospheric fog, hidden details, muted colors, enigmatic mood",
    }

    def __init__(self, translator: PromptTranslator):
        self.translator = translator

    def _get_style_for_type_and_genre(
        self, description_type: DescriptionType, genre: Optional[str] = None
    ) -> str:
        """Возвращает стиль для типа описания + жанра."""
        base = self._BASE_STYLE_TEMPLATES.get(
            description_type, self._BASE_STYLE_TEMPLATES[DescriptionType.LOCATION]
        )["base_style"]

        if genre and genre.lower() in self._GENRE_TYPE_OVERRIDES:
            genre_overrides = self._GENRE_TYPE_OVERRIDES[genre.lower()]
            if description_type in genre_overrides:
                return f"{base}, {genre_overrides[description_type]}"

        return base

    async def create_prompt(
        self,
        description: str,
        description_type: DescriptionType,
        genre: Optional[str] = None,
        custom_style: Optional[str] = None,
    ) -> str:
        """
        Создаёт оптимизированный английский промпт для FLUX.2.

        Args:
            description: Оригинальное русское описание
            description_type: Тип описания
            genre: Жанр книги для стилизации
            custom_style: Дополнительные инструкции стиля

        Returns:
            Оптимизированный английский промпт с NSFW-суффиксом (max ~450 tokens)
        """
        # Переводим RU -> EN
        translated = await self.translator.translate(description)

        # Добавляем SFW суффикс для NSFW-защиты
        # FLUX.2 не имеет встроенного safety filter (в отличие от Imagen 4)
        safe_translated = f"{translated}. SFW, safe for work, appropriate content"

        # Берём base template по типу
        template = self._BASE_STYLE_TEMPLATES.get(
            description_type, self._BASE_STYLE_TEMPLATES[DescriptionType.LOCATION]
        )

        # Динамический стиль по типу + жанру
        dynamic_style = self._get_style_for_type_and_genre(description_type, genre)

        # Собираем промпт
        prompt_parts = [
            template["prefix"],
            safe_translated,
            dynamic_style,
        ]

        # Глобальный стиль жанра (дополнительное усиление)
        if genre and genre.lower() in self.GENRE_STYLES:
            prompt_parts.append(self.GENRE_STYLES[genre.lower()])

        # Кастомный стиль
        if custom_style:
            prompt_parts.append(custom_style)

        prompt_parts.append(template["suffix"])

        prompt = ", ".join(prompt_parts)

        # Ограничение длины (~480 tokens ≈ 1800 chars)
        if len(prompt) > 1800:
            prompt = prompt[:1800].rsplit(",", 1)[0]

        logger.debug(f"Created FLUX prompt ({len(prompt)} chars): {prompt[:100]}...")
        return prompt


# ---------------------------------------------------------------------------
# ImagenService — основной сервис генерации изображений
# ---------------------------------------------------------------------------


class ImagenService:
    """
    Основной сервис генерации изображений через OpenRouter FLUX.2 Klein 4B.

    Мигрирован с Google Imagen на OpenRouter FLUX.2 Klein (Plan 03-03).
    """

    def __init__(self):
        self._client = None
        self._translator: Optional[PromptTranslator] = None
        self._prompt_engineer: Optional[ImagenPromptEngineer] = None
        self._available = False
        self._model = settings.OPENROUTER_IMAGE_MODEL

        self._initialize()

    def _initialize(self):
        """Инициализирует компоненты сервиса."""
        if not settings.OPENROUTER_API_KEY:
            logger.warning("No OPENROUTER_API_KEY — ImagenService disabled")
            return

        try:
            self._client = get_openrouter_client()
            self._translator = PromptTranslator()
            self._prompt_engineer = ImagenPromptEngineer(self._translator)
            self._available = True
            logger.info(
                f"ImagenService initialized (OpenRouter FLUX.2, model: {self._model})"
            )
        except Exception as e:
            logger.error(f"Failed to initialize ImagenService: {e}")

    def is_available(self) -> bool:
        """Проверяет доступность сервиса."""
        return self._available

    @retry_image_generation
    async def _generate_with_retry(self, prompt: str, aspect_ratio: str) -> bytes:
        """
        OpenRouter FLUX.2 вызов с retry.

        Retry только HTTP-вызов генерации — cache check и prompt engineering
        НЕ повторяются. Retryable: RuntimeError (missing choices),
        ConnectionError, RateLimitError, TimeoutError.
        Non-retryable: ValueError (400 Bad Request).
        """
        return await self._client.generate_image(
            prompt=prompt,
            model=settings.OPENROUTER_IMAGE_MODEL,
            aspect_ratio=aspect_ratio,
            image_size="1K",
        )

    async def generate_image(
        self,
        description: str,
        description_type: str = "location",
        genre: Optional[str] = None,
        custom_style: Optional[str] = None,
        aspect_ratio: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        seed: Optional[int] = None,
    ) -> ImageGenerationResult:
        """
        Генерирует изображение по русскому описанию.

        Args:
            description: Русское визуальное описание
            description_type: Тип (location, character, atmosphere, object, action)
            genre: Жанр книги для стилизации
            custom_style: Дополнительные инструкции стиля
            aspect_ratio: Соотношение сторон (default: 4:3)
            reference_image_urls: Не используется (совместимость API)
            seed: Не используется (совместимость API)

        Returns:
            ImageGenerationResult с данными изображения или ошибкой
        """
        if not self._available:
            return ImageGenerationResult(
                success=False,
                error_message="ImagenService не доступен. Проверьте OPENROUTER_API_KEY.",
            )

        start_time = time.time()

        try:
            # Конвертируем тип в enum
            try:
                desc_type = DescriptionType(description_type.lower())
            except ValueError:
                desc_type = DescriptionType.LOCATION

            # Semantic caching: проверяем Redis
            effective_aspect = aspect_ratio or "4:3"
            cache_key = f"imagen:cache:{hashlib.md5((description + effective_aspect).encode()).hexdigest()}"

            redis_client = None
            try:
                import redis.asyncio as aioredis

                redis_client = await aioredis.from_url(settings.REDIS_URL)
                cached_url = await redis_client.get(cache_key)

                if cached_url:
                    cached_url_str = cached_url.decode("utf-8")
                    logger.info(
                        f"Semantic Cache HIT for prompt. URL: {cached_url_str[:30]}..."
                    )
                    return ImageGenerationResult(
                        success=True,
                        image_url=cached_url_str,
                        generation_time_seconds=0.0,
                        model_used="cache",
                        prompt_used=description,
                    )
            except Exception as cache_e:
                logger.warning(f"Cache check failed: {cache_e}")
            finally:
                if redis_client is not None:
                    try:
                        await redis_client.close()
                    except Exception:
                        pass

            # Создаём оптимизированный промпт (с переводом и SFW суффиксом)
            prompt = await self._prompt_engineer.create_prompt(
                description=description,
                description_type=desc_type,
                genre=genre,
                custom_style=custom_style,
            )

            # Генерируем изображение через OpenRouter FLUX.2 (с серверным retry)
            image_bytes = await self._generate_with_retry(prompt, effective_aspect)

            # Создаём data URL из bytes
            image_base64 = base64.b64encode(image_bytes).decode("utf-8")
            image_url = f"data:image/png;base64,{image_base64}"

            # Сохраняем локально
            local_path = await self._save_image(image_bytes, prompt)

            # Кэшируем результат в Redis
            await self._cache_result(cache_key, image_url)

            generation_time = time.time() - start_time

            logger.info(
                f"Image generated in {generation_time:.2f}s via OpenRouter FLUX.2"
            )

            return ImageGenerationResult(
                success=True,
                image_url=image_url,
                image_data=image_bytes,
                local_path=local_path,
                generation_time_seconds=generation_time,
                model_used=settings.OPENROUTER_IMAGE_MODEL,
                prompt_used=prompt,
            )

        except ValueError as e:
            # Non-retryable (400 Bad Request) — НЕ retry-ился
            error_msg = str(e)
            logger.error(f"Image generation failed (non-retryable): {error_msg}")
            return ImageGenerationResult(
                success=False,
                error_message=f"Image generation failed: {error_msg}",
            )
        except Exception as e:
            # Retry exhausted или другая ошибка
            error_msg = str(e)
            logger.error(f"Image generation failed after retries: {error_msg}")
            return ImageGenerationResult(
                success=False,
                error_message=f"Image generation failed: {error_msg}",
            )

    async def _cache_result(self, cache_key: str, url: str) -> None:
        """Кэширует результат генерации в Redis."""
        try:
            import redis.asyncio as aioredis

            redis_client = await aioredis.from_url(settings.REDIS_URL)
            try:
                await redis_client.setex(cache_key, 604800, url)  # 7 дней
                logger.debug(f"Cached image result: {cache_key[:32]}...")
            finally:
                await redis_client.close()
        except Exception as e:
            logger.warning(f"Cache write failed: {e}")

    async def _save_image(self, image_data: bytes, prompt: str) -> str:
        """
        Сохраняет изображение в локальное хранилище.

        Args:
            image_data: Байты изображения
            prompt: Промпт (для имени файла)

        Returns:
            Путь к сохранённому файлу
        """
        images_dir = Path("/app/storage/generated_images")
        images_dir.mkdir(parents=True, exist_ok=True)

        prompt_hash = hashlib.md5(prompt.encode(), usedforsecurity=False).hexdigest()[
            :8
        ]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"flux_{timestamp}_{prompt_hash}.png"

        file_path = images_dir / filename

        import aiofiles

        async with aiofiles.open(file_path, "wb") as f:
            await f.write(image_data)

        logger.debug(f"Image saved: {file_path}")
        return str(file_path)

    async def preview_prompt(
        self,
        description: str,
        description_type: str = "location",
        genre: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Предварительный просмотр промпта без генерации изображения.

        Полезно для отладки и тестирования промптов.
        """
        if not self._prompt_engineer:
            return {"error": "Service not available"}

        try:
            desc_type = DescriptionType(description_type.lower())
        except ValueError:
            desc_type = DescriptionType.LOCATION

        english_prompt = await self._prompt_engineer.create_prompt(
            description=description, description_type=desc_type, genre=genre
        )

        return {
            "original_russian": description,
            "english_prompt": english_prompt,
            "char_count": len(english_prompt),
            "estimated_tokens": len(english_prompt) // 4,
            "description_type": description_type,
            "genre": genre,
        }

    def get_status(self) -> Dict[str, Any]:
        """Возвращает статус сервиса."""
        return {
            "available": self._available,
            "has_api_key": bool(settings.OPENROUTER_API_KEY),
            "model": settings.OPENROUTER_IMAGE_MODEL,
            "aspect_ratio": "4:3",
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_imagen_service: Optional[ImagenService] = None


def get_imagen_service() -> ImagenService:
    """Возвращает singleton экземпляр ImagenService."""
    global _imagen_service
    if _imagen_service is None:
        _imagen_service = ImagenService()
    return _imagen_service
