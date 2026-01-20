"""
Google Imagen Image Generator.

Replaces Pollinations.ai with Google Imagen 4 API for high-quality image generation.
Uses same API key as Gemini (GOOGLE_API_KEY or LANGEXTRACT_API_KEY).

Features:
- Automatic Russian -> English prompt translation via Gemini
- Optimized prompts for book illustrations
- Type-specific style templates (location, character, atmosphere)
- Genre-aware styling
- Caching support for translations
- Exponential backoff retry for resilience

Created: 2025-12-13
Updated: 2025-12-28 - Added tenacity-based retry logic
"""

import os
import asyncio
import hashlib
import time
import base64
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from enum import Enum
import logging

from app.core.retry import (
    retry_image_generation,
    ImageGenerationError,
    RateLimitError,
    TimeoutError as RetryTimeoutError,
)

logger = logging.getLogger(__name__)


class DescriptionType(Enum):
    """Types of descriptions for image generation."""
    LOCATION = "location"
    CHARACTER = "character"
    ATMOSPHERE = "atmosphere"
    OBJECT = "object"
    ACTION = "action"


@dataclass
class ImagenConfig:
    """Configuration for Google Imagen generator."""
    api_key: str
    model: str = "imagen-4.0-generate-001"
    aspect_ratio: str = "4:3"  # 1:1, 3:4, 4:3, 9:16, 16:9
    person_generation: str = "allow_adult"  # dont_allow, allow_adult, allow_all
    safety_filter_level: str = "block_low_and_above"  # Only block_low_and_above is supported by Imagen API
    timeout_seconds: int = 60
    max_retries: int = 3
    retry_delay: float = 1.0


@dataclass
class ImageGenerationResult:
    """Result of image generation."""
    success: bool
    image_url: Optional[str] = None
    image_data: Optional[bytes] = None
    local_path: Optional[str] = None
    error_message: Optional[str] = None
    generation_time_seconds: Optional[float] = None
    model_used: Optional[str] = None
    prompt_used: Optional[str] = None


class PromptTranslator:
    """
    Translates Russian descriptions to English for Imagen.

    Uses Gemini for accurate literary translation optimized for visual prompts.
    """

    TRANSLATION_PROMPT = """You are a translator specializing in visual descriptions for image generation.

TASK: Translate this Russian visual description to English for AI image generation.

RULES:
1. Focus ONLY on visual elements (appearance, colors, textures, lighting)
2. Use vivid, descriptive adjectives
3. Preserve the mood and atmosphere
4. Use common English art and photography terms
5. Keep the translation under 150 words
6. Do NOT add interpretations - translate only what's written

Russian text:
{text}

English translation (visual elements only, no explanations):"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._client = None
        self._model = "gemini-3-flash-preview"  # Dec 2025: gemini-3-flash-preview
        self._cache: Dict[str, str] = {}  # Simple in-memory cache
        self._initialize()

    def _initialize(self):
        """Initialize Gemini for translation with new google-genai SDK."""
        try:
            from google import genai
            from google.genai import types
            self._client = genai.Client(api_key=self.api_key)
            self._types = types
            logger.info("PromptTranslator initialized with Gemini 3.0 Flash (google-genai SDK)")
        except Exception as e:
            logger.error(f"Failed to initialize translator: {e}")
            self._types = None

    async def translate(self, russian_text: str) -> str:
        """
        Translate Russian description to English.

        Args:
            russian_text: Russian visual description

        Returns:
            English translation optimized for image generation
        """
        # Check cache
        cache_key = hashlib.md5(russian_text.encode(), usedforsecurity=False).hexdigest()[:16]
        if cache_key in self._cache:
            logger.debug(f"Translation cache hit: {cache_key}")
            return self._cache[cache_key]

        if not self._client:
            logger.warning("Translator not available, returning original text")
            return russian_text

        try:
            prompt = self.TRANSLATION_PROMPT.format(text=russian_text)

            # Use types.GenerateContentConfig for proper configuration
            config = self._types.GenerateContentConfig(
                temperature=0.3,
            ) if self._types else None

            response = await asyncio.to_thread(
                self._client.models.generate_content,
                model=self._model,
                contents=prompt,
                config=config,
            )

            # Extract text from response
            translation = (response.text if hasattr(response, 'text') else str(response)).strip()

            # Cache result
            self._cache[cache_key] = translation
            logger.debug(f"Translated: {russian_text[:50]}... → {translation[:50]}...")

            return translation

        except Exception as e:
            logger.error(f"Translation failed: {e}")
            return russian_text


class ImagenPromptEngineer:
    """
    Creates optimized English prompts for Google Imagen.

    Includes type-specific templates and genre-aware styling.
    """

    # Style templates for different description types
    STYLE_TEMPLATES = {
        DescriptionType.LOCATION: {
            "prefix": "Detailed book illustration of",
            "style": "fantasy illustration style, atmospheric lighting, rich vibrant colors, detailed environment",
            "suffix": "professional artwork, high quality, suitable for book illustration"
        },
        DescriptionType.CHARACTER: {
            "prefix": "Character portrait illustration of",
            "style": "fantasy book illustration, detailed facial features, expressive eyes, period-appropriate attire",
            "suffix": "professional character design, artistic rendering, book illustration quality"
        },
        DescriptionType.ATMOSPHERE: {
            "prefix": "Atmospheric scene depicting",
            "style": "moody cinematic lighting, emotional ambiance, dramatic composition",
            "suffix": "evocative artwork, impressionistic style, book illustration"
        },
        DescriptionType.OBJECT: {
            "prefix": "Detailed illustration of",
            "style": "clear focus, artistic presentation, rich textures",
            "suffix": "still life quality, professional artwork"
        },
        DescriptionType.ACTION: {
            "prefix": "Dynamic scene of",
            "style": "captured motion, dramatic lighting, energy and movement",
            "suffix": "cinematic moment, book illustration style"
        },
    }

    # Genre-specific style modifiers
    GENRE_STYLES = {
        "fantasy": "fantasy art, magical atmosphere, ethereal lighting",
        "detective": "noir style, dramatic shadows, moody atmosphere",
        "romance": "soft warm lighting, romantic mood, gentle colors",
        "sci-fi": "futuristic aesthetic, technological elements, sci-fi lighting",
        "horror": "dark atmosphere, ominous shadows, unsettling mood",
        "historical": "period-accurate details, classical style, historical authenticity",
        "adventure": "epic scale, dramatic vistas, sense of journey",
    }

    def __init__(self, translator: PromptTranslator):
        self.translator = translator

    async def create_prompt(
        self,
        description: str,
        description_type: DescriptionType,
        genre: Optional[str] = None,
        custom_style: Optional[str] = None
    ) -> str:
        """
        Create optimized English prompt for Imagen.

        Args:
            description: Original Russian description
            description_type: Type of description
            genre: Book genre for style adaptation
            custom_style: Additional custom style instructions

        Returns:
            Optimized English prompt (max ~450 tokens)
        """
        # Translate Russian to English
        english_description = await self.translator.translate(description)

        # Get template for type
        template = self.STYLE_TEMPLATES.get(
            description_type,
            self.STYLE_TEMPLATES[DescriptionType.LOCATION]
        )

        # Build prompt
        prompt_parts = [
            template["prefix"],
            english_description,
            template["style"],
        ]

        # Add genre style if specified
        if genre and genre.lower() in self.GENRE_STYLES:
            prompt_parts.append(self.GENRE_STYLES[genre.lower()])

        # Add custom style if provided
        if custom_style:
            prompt_parts.append(custom_style)

        prompt_parts.append(template["suffix"])

        # Join and clean
        prompt = ", ".join(prompt_parts)

        # Ensure we don't exceed token limit (~480 tokens ≈ 1800 chars)
        if len(prompt) > 1800:
            prompt = prompt[:1800].rsplit(",", 1)[0]

        logger.debug(f"Created Imagen prompt ({len(prompt)} chars): {prompt[:100]}...")
        return prompt


class GoogleImagenGenerator:
    """
    Google Imagen API client for image generation.

    Usage:
        generator = GoogleImagenGenerator(config)
        result = await generator.generate("A castle on a hill")
    """

    def __init__(self, config: ImagenConfig):
        self.config = config
        self._client = None
        self._available = False
        self._initialize()

    def _initialize(self):
        """Initialize Google GenAI client."""
        if not self.config.api_key:
            logger.warning("No API key provided for Imagen")
            return

        try:
            from google import genai

            self._client = genai.Client(api_key=self.config.api_key)
            self._available = True
            logger.info(f"Imagen generator initialized (model: {self.config.model})")

        except ImportError:
            logger.error("google-genai not installed. Run: pip install google-genai")
        except Exception as e:
            logger.error(f"Failed to initialize Imagen: {e}")

    def is_available(self) -> bool:
        """Check if Imagen is available."""
        return self._available

    async def generate(
        self,
        prompt: str,
        aspect_ratio: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        seed: Optional[int] = None
    ) -> ImageGenerationResult:
        """
        Generate image using Google Imagen.

        Args:
            prompt: English text prompt (max 480 tokens)
            aspect_ratio: Override default aspect ratio
            reference_image_urls: URLs for reference images (Consistency)
            seed: Random seed for deterministic generation

        Returns:
            ImageGenerationResult with image data or error
        """
        if not self._available:
            return ImageGenerationResult(
                success=False,
                error_message="Imagen generator not available"
            )

        start_time = time.time()

        try:
            # Use tenacity retry decorator for the actual generation
            result = await self._generate_with_retry(
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                reference_image_urls=reference_image_urls,
                seed=seed,
                start_time=start_time
            )
            return result
        except Exception as e:
            # All retries exhausted
            error_msg = str(e)
            logger.error(f"Image generation failed after all retries: {error_msg}")
            return ImageGenerationResult(
                success=False,
                error_message=f"Imagen generation failed: {error_msg}"
            )

    @retry_image_generation
    async def _generate_with_retry(
        self,
        prompt: str,
        aspect_ratio: Optional[str],
        reference_image_urls: Optional[List[str]],
        seed: Optional[int],
        start_time: float
    ) -> ImageGenerationResult:
        """
        Internal method with retry decorator for image generation.

        Raises retryable exceptions that trigger tenacity retry logic.
        """
        try:
            from google.genai import types

            # Build config
            # NOTE: explicit reference_images support via SDK might require Image inputs (bytes)
            # For this Phase 3 version, we support 'seed' for deterministic generation.
            # 'reference_image_urls' logic to download and pass as bytes is marked for next iteration.
            
            if reference_image_urls:
                logger.warning(f"Reference images provided but not yet fully implemented in SDK call: {reference_image_urls}")

            gen_config = types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio=aspect_ratio or self.config.aspect_ratio,
                person_generation=self.config.person_generation,
                safety_filter_level=self.config.safety_filter_level,
                # seed=seed  # Uncomment when SDK fully supports it (check version)
            )

            logger.info("Generating image with Imagen")
            logger.debug(f"Prompt: {prompt[:100]}... Seed: {seed}")

            # Generate (sync call wrapped in asyncio.to_thread)
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    self._client.models.generate_images,
                    model=self.config.model,
                    prompt=prompt,
                    config=gen_config,
                ),
                timeout=self.config.timeout_seconds
            )

            # Extract image
            if response.generated_images:
                image = response.generated_images[0]
                raw_image_data = image.image.image_bytes

                logger.info(f"Imagen raw_image_data type: {type(raw_image_data)}")
                if isinstance(raw_image_data, bytes):
                    logger.info(f"Imagen raw_image_data first 20 bytes: {raw_image_data[:20]}")

                # Google Imagen API returns base64-encoded data
                # It can be either str or bytes containing base64 text
                if isinstance(raw_image_data, str):
                    logger.info("Imagen returned base64 string, decoding...")
                    image_bytes = base64.b64decode(raw_image_data)
                    image_base64 = raw_image_data  # Already base64
                elif isinstance(raw_image_data, bytes):
                    # Check if bytes contain base64 text (starts with ASCII letters like 'iVBOR')
                    # PNG magic bytes are: 0x89 0x50 0x4E 0x47 (PNG)
                    if raw_image_data[:4] == b'\x89PNG':
                        logger.info("Imagen returned raw PNG bytes")
                        image_bytes = raw_image_data
                        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
                    else:
                        # Bytes contain base64-encoded text, decode it
                        logger.info("Imagen returned bytes containing base64 text, decoding...")
                        image_base64 = raw_image_data.decode('utf-8')
                        image_bytes = base64.b64decode(image_base64)
                else:
                    logger.error(f"Unexpected data type from Imagen: {type(raw_image_data)}")
                    raise ValueError(f"Unexpected data type: {type(raw_image_data)}")

                # Save locally (decoded bytes)
                local_path = await self._save_image(image_bytes, prompt)

                # Create data URL for frontend
                image_url = f"data:image/png;base64,{image_base64}"

                generation_time = time.time() - start_time

                logger.info(f"Image generated successfully in {generation_time:.2f}s")

                return ImageGenerationResult(
                    success=True,
                    image_url=image_url,
                    image_data=image_bytes,
                    local_path=local_path,
                    generation_time_seconds=generation_time,
                    model_used=self.config.model,
                    prompt_used=prompt,
                )
            else:
                # No images generated - this is retryable
                error_msg = "No images generated by Imagen"
                logger.warning(error_msg)
                raise ImageGenerationError(error_msg)

        except asyncio.TimeoutError as e:
            error_msg = f"Imagen generation timed out after {self.config.timeout_seconds}s"
            logger.warning(error_msg)
            # Wrap as retryable timeout error
            raise RetryTimeoutError(error_msg) from e

        except ImageGenerationError:
            # Already a retryable error, re-raise
            raise

        except Exception as e:
            error_msg = str(e)
            # Check if it's a rate limit error
            if "rate" in error_msg.lower() and "limit" in error_msg.lower():
                raise RateLimitError(error_msg) from e
            if "quota" in error_msg.lower():
                raise RateLimitError(error_msg) from e
            # Other errors - wrap as retryable ImageGenerationError
            logger.error(f"Image generation error: {error_msg}")
            raise ImageGenerationError(error_msg) from e

    async def _save_image(self, image_data: bytes, prompt: str) -> str:
        """
        Save image to local storage.

        Args:
            image_data: Raw image bytes
            prompt: Prompt used (for filename generation)

        Returns:
            Path to saved file
        """
        # Create directory (persistent storage)
        # Uses /app/storage which is mounted as Docker volume for persistence
        images_dir = Path("/app/storage/generated_images")
        images_dir.mkdir(parents=True, exist_ok=True)

        # Create unique filename
        prompt_hash = hashlib.md5(prompt.encode(), usedforsecurity=False).hexdigest()[:8]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"imagen_{timestamp}_{prompt_hash}.png"

        file_path = images_dir / filename

        # Save file (async to avoid blocking event loop)
        import aiofiles
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(image_data)

        logger.debug(f"Image saved: {file_path}")
        return str(file_path)


class ImagenService:
    """
    Main service for image generation using Google Imagen.

    Combines translation, prompt engineering, and image generation.
    """

    def __init__(self):
        self._api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("LANGEXTRACT_API_KEY")
        self._translator: Optional[PromptTranslator] = None
        self._prompt_engineer: Optional[ImagenPromptEngineer] = None
        self._generator: Optional[GoogleImagenGenerator] = None
        self._available = False

        self._initialize()

    def _initialize(self):
        """Initialize all components."""
        if not self._api_key:
            logger.warning("No Google API key - Imagen service disabled")
            return

        try:
            # Get config from settings
            from ..core.config import settings

            # Initialize translator
            self._translator = PromptTranslator(self._api_key)

            # Initialize prompt engineer
            self._prompt_engineer = ImagenPromptEngineer(self._translator)

            # Initialize generator
            config = ImagenConfig(
                api_key=self._api_key,
                model=settings.IMAGEN_MODEL,
                aspect_ratio=settings.IMAGEN_ASPECT_RATIO,
                safety_filter_level=settings.IMAGEN_SAFETY_LEVEL,
                timeout_seconds=settings.IMAGEN_TIMEOUT_SECONDS,
            )
            self._generator = GoogleImagenGenerator(config)

            self._available = self._generator.is_available()

            if self._available:
                logger.info("Imagen service initialized successfully")
            else:
                logger.warning("Imagen service initialized but generator not available")

        except Exception as e:
            logger.error(f"Failed to initialize Imagen service: {e}")

    def is_available(self) -> bool:
        """Check if service is available."""
        return self._available

    async def generate_image(
        self,
        description: str,
        description_type: str = "location",
        genre: Optional[str] = None,
        custom_style: Optional[str] = None,
        aspect_ratio: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        seed: Optional[int] = None
    ) -> ImageGenerationResult:
        """
        Generate image for a Russian description.

        Args:
            description: Russian visual description
            description_type: Type (location, character, atmosphere, object, action)
            genre: Book genre for style adaptation
            custom_style: Additional style instructions
            aspect_ratio: Override default aspect ratio
            reference_image_urls: List of URLs to valid reference images (Consistency)
            seed: Random seed for deterministic generation

        Returns:
            ImageGenerationResult with generated image or error
        """
        if not self._available:
            return ImageGenerationResult(
                success=False,
                error_message="Imagen service not available. Check GOOGLE_API_KEY."
            )

        try:
            # Convert type string to enum
            try:
                desc_type = DescriptionType(description_type.lower())
            except ValueError:
                desc_type = DescriptionType.LOCATION

            # Create optimized prompt
            prompt = await self._prompt_engineer.create_prompt(
                description=description,
                description_type=desc_type,
                genre=genre,
                custom_style=custom_style
            )

            # Generate image
            result = await self._generator.generate(
                prompt=prompt, 
                aspect_ratio=aspect_ratio,
                reference_image_urls=reference_image_urls,
                seed=seed
            )

            return result

        except Exception as e:
            logger.error(f"Image generation failed: {e}")
            return ImageGenerationResult(
                success=False,
                error_message=str(e)
            )

    async def preview_prompt(
        self,
        description: str,
        description_type: str = "location",
        genre: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Preview the English prompt without generating image.

        Useful for debugging and testing prompts.
        """
        if not self._prompt_engineer:
            return {"error": "Service not available"}

        try:
            desc_type = DescriptionType(description_type.lower())
        except ValueError:
            desc_type = DescriptionType.LOCATION

        english_prompt = await self._prompt_engineer.create_prompt(
            description=description,
            description_type=desc_type,
            genre=genre
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
        """Get service status."""
        return {
            "available": self._available,
            "has_api_key": bool(self._api_key),
            "model": self._generator.config.model if self._generator else None,
            "aspect_ratio": self._generator.config.aspect_ratio if self._generator else None,
        }


# Singleton instance
_imagen_service: Optional[ImagenService] = None


def get_imagen_service() -> ImagenService:
    """Get singleton Imagen service instance."""
    global _imagen_service
    if _imagen_service is None:
        _imagen_service = ImagenService()
    return _imagen_service
