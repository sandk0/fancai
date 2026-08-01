"""
Генерация иллюстраций через Gemini (Nano Banana 2).

Изображение генерирует `NanoBananaGenerator` → `GeminiClient.generate_image()`
(модель `settings.GEMINI_IMAGE_MODEL`). Перевод RU→EN идёт через провайдера
из `get_ai_provider()`, то есть тем же флагом `AI_PROVIDER`, что и остальные
текстовые вызовы.

Имена `ImagenService`, `ImagenPromptEngineer`, префикс ключа кэша `imagen:cache:`
и префикс имени файла `flux_` остались от предыдущих провайдеров (Google Imagen,
затем OpenRouter FLUX.2 Klein). Переименование — отдельная задача: 71 упоминание
в 12 файлах плюс совместимость по уже сохранённым `local_path`.

Features:
- Автоматический перевод RU -> EN через generate_text() активного провайдера
- NSFW-защита через суффикс "SFW, safe for work" в промпте
- Type-specific style templates (location, character, atmosphere)
- Genre-aware styling
- Кэширование переводов в Redis
- Tenacity-based retry через `app.core.retry.retry_image_generation`

Created: 2025-12-13
Updated: 2026-08-02 - docstring приведён к коду: путь Gemini/Vertex, не OpenRouter
"""

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
)
from app.core.ai_provider_factory import get_ai_provider
from app.services.nano_banana_generator import NanoBananaGenerator
from app.core.config import settings

logger = logging.getLogger(__name__)


def _gemini_credentials_present() -> bool:
    """Vertex аутентифицируется через ADC (нужен GCP_PROJECT), Developer — через ключ."""
    if settings.GEMINI_BACKEND == "vertex":
        return bool(settings.GCP_PROJECT)
    return bool(settings.GEMINI_API_KEY)


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
    Переводит русские описания на английский для промпта генератора изображений.

    Ходит в провайдера из `get_ai_provider()` (по флагу `AI_PROVIDER`; сейчас Gemini).
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
        self._client = get_ai_provider()
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
            stage_start = time.time()
            translation = await self._client.generate_text(
                prompt=russian_text,
                system_prompt=self.TRANSLATION_SYSTEM_PROMPT,
            )

            logger.info(
                "Translation complete",
                extra={
                    "pipeline_stage": "translation",
                    "duration": f"{time.time() - stage_start:.2f}s",
                },
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
            logger.error(
                "Translation failed, using original text",
                extra={
                    "pipeline_stage": "translation",
                    "duration": f"{time.time() - stage_start:.2f}s",
                    "error": str(e)[:200],
                },
            )
            return russian_text


# ---------------------------------------------------------------------------
# ImagenPromptEngineer
# ---------------------------------------------------------------------------


class ImagenPromptEngineer:
    """
    Создаёт оптимизированные английские промпты для генератора изображений.

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
        Создаёт оптимизированный английский промпт для генератора изображений.

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

        # Добавляем SFW суффикс для NSFW-защиты: полагаться только на safety
        # filter провайдера нельзя, состав фильтров у моделей различается
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
    Основной сервис генерации изображений: перевод промпта → генерация → сохранение.

    Генерирует через `NanoBananaGenerator` (Gemini Nano Banana 2, backend
    `GEMINI_BACKEND`), модель — `settings.GEMINI_IMAGE_MODEL`. Ни OpenRouter,
    ни Google Imagen на этом пути нет; имя класса историческое, см. docstring модуля.
    """

    def __init__(self):
        self._nano: Optional[NanoBananaGenerator] = None
        self._translator: Optional[PromptTranslator] = None
        self._prompt_engineer: Optional[ImagenPromptEngineer] = None
        self._available = False
        self._model = settings.GEMINI_IMAGE_MODEL

        self._initialize()

    def _initialize(self):
        """Инициализирует компоненты сервиса."""
        if not _gemini_credentials_present():
            logger.warning("No Gemini credentials — ImagenService disabled")
            return

        try:
            self._nano = NanoBananaGenerator()
            self._translator = PromptTranslator()
            self._prompt_engineer = ImagenPromptEngineer(self._translator)
            self._available = True
            logger.info(
                f"ImagenService initialized (Gemini Nano Banana 2, model: {self._model})"
            )
        except Exception as e:
            logger.error(f"Failed to initialize ImagenService: {e}")

    def is_available(self) -> bool:
        """Проверяет доступность сервиса."""
        return self._available

    @retry_image_generation
    async def _generate_with_retry(self, prompt: str, aspect_ratio: str) -> bytes:
        """
        Gemini Nano Banana 2 вызов с retry.

        Retry только HTTP-вызов генерации — cache check и prompt engineering
        НЕ повторяются. Retryable: RuntimeError (missing choices),
        ConnectionError, RateLimitError, TimeoutError.
        Non-retryable: ValueError (400 Bad Request).
        """
        return await self._nano.generate(
            prompt=prompt, aspect_ratio=aspect_ratio, image_size="1K"
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
                error_message="ImagenService не доступен. Проверьте Gemini credentials (GEMINI_API_KEY или GCP_PROJECT).",
            )

        start_time = time.time()

        try:
            # Конвертируем тип в enum
            try:
                desc_type = DescriptionType(description_type.lower())
            except ValueError:
                desc_type = DescriptionType.LOCATION

            # Stage 1: Redis cache check
            stage_start = time.time()
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
                        "Image pipeline: cache HIT",
                        extra={
                            "pipeline_stage": "cache_check",
                            "duration": f"{time.time() - stage_start:.2f}s",
                            "result": "hit",
                        },
                    )
                    return ImageGenerationResult(
                        success=True,
                        image_url=cached_url_str,
                        generation_time_seconds=0.0,
                        model_used="cache",
                        prompt_used=description,
                    )
            except Exception as cache_e:
                logger.warning(
                    f"Image pipeline: cache check failed: {cache_e}",
                    extra={
                        "pipeline_stage": "cache_check",
                        "duration": f"{time.time() - stage_start:.2f}s",
                    },
                )
            finally:
                if redis_client is not None:
                    try:
                        await redis_client.close()
                    except Exception:
                        pass

            logger.info(
                "Image pipeline: cache MISS",
                extra={
                    "pipeline_stage": "cache_check",
                    "duration": f"{time.time() - stage_start:.2f}s",
                    "result": "miss",
                },
            )

            # Stage 2: Prompt engineering (includes translation RU->EN)
            stage_start = time.time()
            prompt = await self._prompt_engineer.create_prompt(
                description=description,
                description_type=desc_type,
                genre=genre,
                custom_style=custom_style,
            )
            translation_duration = time.time() - stage_start
            logger.info(
                "Image pipeline: prompt ready",
                extra={
                    "pipeline_stage": "translation_and_prompt",
                    "duration": f"{translation_duration:.2f}s",
                    "prompt_preview": prompt[:100],
                },
            )

            # Stage 3: Image generation via Gemini Nano Banana 2 (with retry)
            stage_start = time.time()
            image_bytes = await self._generate_with_retry(prompt, effective_aspect)
            generation_duration = time.time() - stage_start
            logger.info(
                "Image pipeline: FLUX.2 generation complete",
                extra={
                    "pipeline_stage": "flux2_generation",
                    "duration": f"{generation_duration:.2f}s",
                    "image_size_bytes": len(image_bytes),
                },
            )

            # Stage 4: Post-processing (base64 + save + cache)
            stage_start = time.time()
            image_base64 = base64.b64encode(image_bytes).decode("utf-8")
            image_url = f"data:image/png;base64,{image_base64}"
            local_path = await self._save_image(image_bytes, prompt)
            await self._cache_result(cache_key, image_url)
            post_duration = time.time() - stage_start

            total_duration = time.time() - start_time
            logger.info(
                f"Image pipeline: SUCCESS in {total_duration:.2f}s",
                extra={
                    "pipeline_stage": "complete",
                    "total_duration": f"{total_duration:.2f}s",
                    "translation_duration": f"{translation_duration:.2f}s",
                    "generation_duration": f"{generation_duration:.2f}s",
                    "post_duration": f"{post_duration:.2f}s",
                },
            )

            return ImageGenerationResult(
                success=True,
                image_url=image_url,
                image_data=image_bytes,
                local_path=local_path,
                generation_time_seconds=total_duration,
                model_used=settings.GEMINI_IMAGE_MODEL,
                prompt_used=prompt,
            )

        except ValueError as e:
            error_msg = str(e)
            total_duration = time.time() - start_time
            logger.error(
                f"Image pipeline: FAILED (non-retryable) in {total_duration:.2f}s",
                extra={
                    "pipeline_stage": "error",
                    "error_type": "ValueError",
                    "error_message": error_msg[:200],
                    "total_duration": f"{total_duration:.2f}s",
                },
            )
            return ImageGenerationResult(
                success=False,
                error_message=f"Image generation failed: {error_msg}",
            )
        except Exception as e:
            total_duration = time.time() - start_time
            logger.error(
                f"Image pipeline: FAILED in {total_duration:.2f}s: {e}",
                extra={
                    "pipeline_stage": "error",
                    "error_type": type(e).__name__,
                    "error_message": str(e)[:200],
                    "total_duration": f"{total_duration:.2f}s",
                },
            )
            return ImageGenerationResult(
                success=False,
                error_message=f"Image generation error: {str(e)}",
                generation_time_seconds=total_duration,
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
            "has_api_key": _gemini_credentials_present(),
            "model": settings.GEMINI_IMAGE_MODEL,
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
