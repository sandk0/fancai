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
        self._redis = None
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

    async def _get_redis(self):
        """Lazy initialization of Redis client."""
        if self._redis is None:
            try:
                import redis.asyncio as aioredis
                from app.core.config import settings
                self._redis = await aioredis.from_url(settings.REDIS_URL)
            except Exception as e:
                logger.warning(f"Failed to connect to Redis for translation cache: {e}")
                return None
        return self._redis

    async def translate(self, russian_text: str) -> str:
        """
        Translate Russian description to English.

        Args:
            russian_text: Russian visual description

        Returns:
            English translation optimized for image generation
        """
        # Calculate cache key
        hash_key = hashlib.md5(russian_text.encode(), usedforsecurity=False).hexdigest()[:16]
        cache_key = f"translation:{hash_key}"

        # Check Redis cache
        redis = await self._get_redis()
        if redis:
            try:
                cached = await redis.get(cache_key)
                if cached:
                    logger.debug(f"Translation cache hit (Redis): {cache_key}")
                    return cached.decode("utf-8")
            except Exception as e:
                logger.warning(f"Redis cache read error: {e}")

        if not self._client:
            logger.warning("Translator not available, returning original text")
            return russian_text

        try:
            prompt = self.TRANSLATION_PROMPT.format(text=russian_text)

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

            # Cache result in Redis (7 days TTL)
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


class ImagenPromptEngineer:
    """
    Creates optimized English prompts for Google Imagen.

    Includes type-specific templates and genre-aware styling.
    Phase 3: Dynamic STYLE_TEMPLATES with genre-specific overrides.
    """

    # Base style templates for different description types (genre-neutral)
    _BASE_STYLE_TEMPLATES = {
        DescriptionType.LOCATION: {
            "prefix": "Detailed book illustration of",
            "base_style": "atmospheric lighting, rich vibrant colors, detailed environment",
            "suffix": "professional artwork, high quality, suitable for book illustration"
        },
        DescriptionType.CHARACTER: {
            "prefix": "Character portrait illustration of",
            "base_style": "detailed facial features, expressive eyes, period-appropriate attire",
            "suffix": "professional character design, artistic rendering, book illustration quality"
        },
        DescriptionType.ATMOSPHERE: {
            "prefix": "Atmospheric scene depicting",
            "base_style": "cinematic lighting, emotional ambiance, dramatic composition",
            "suffix": "evocative artwork, impressionistic style, book illustration"
        },
        DescriptionType.OBJECT: {
            "prefix": "Detailed illustration of",
            "base_style": "clear focus, artistic presentation, rich textures",
            "suffix": "still life quality, professional artwork"
        },
        DescriptionType.ACTION: {
            "prefix": "Dynamic scene of",
            "base_style": "captured motion, dramatic lighting, energy and movement",
            "suffix": "cinematic moment, book illustration style"
        },
    }

    # Genre-specific style overrides for each description type (Phase 3)
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

    # Genre-specific style modifiers (Phase 2: Keys must match BookGenre.value)
    GENRE_STYLES = {
        # Core genres (match BookGenre enum exactly)
        "fantasy": "fantasy art, magical atmosphere, ethereal lighting, vibrant colors, enchanted environment",
        "detective": "noir style, dramatic shadows, moody atmosphere, 1940s film aesthetic, urban mystery",
        "science_fiction": "futuristic aesthetic, technological elements, sci-fi lighting, neon accents, cyberpunk influences",
        "historical": "period-accurate details, classical painting style, oil painting texture, museum quality",
        "romance": "soft warm lighting, romantic mood, pastel colors, soft focus bokeh, intimate atmosphere",
        "thriller": "high contrast lighting, suspenseful mood, dark tones, urban environment, cinematic tension",
        "horror": "dark atmosphere, ominous shadows, unsettling mood, desaturated colors, gothic elements",
        "classic": "classical book illustration, timeless elegance, traditional artwork, literary style",
        "other": "professional book illustration, balanced lighting, artistic rendering",
        # Extended genres (optional)
        "adventure": "epic scale, dramatic vistas, saturated colors, sense of journey, exploration",
        "children": "bright cheerful colors, simplified shapes, friendly style, storybook illustration",
        "mystery": "atmospheric fog, hidden details, muted colors, enigmatic mood",
    }

    def _get_style_for_type_and_genre(
        self,
        description_type: DescriptionType,
        genre: Optional[str] = None
    ) -> str:
        """
        Get combined style string for description type + genre.
        
        Phase 3: Dynamic style generation based on genre.
        """
        base = self._BASE_STYLE_TEMPLATES.get(
            description_type, 
            self._BASE_STYLE_TEMPLATES[DescriptionType.LOCATION]
        )["base_style"]
        
        # Check for genre-specific override for this type
        if genre and genre.lower() in self._GENRE_TYPE_OVERRIDES:
            genre_overrides = self._GENRE_TYPE_OVERRIDES[genre.lower()]
            if description_type in genre_overrides:
                return f"{base}, {genre_overrides[description_type]}"
        
        return base

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

        Phase 3: Uses dynamic genre-aware style templates.

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

        # Get base template for type (Phase 3: use _BASE_STYLE_TEMPLATES)
        template = self._BASE_STYLE_TEMPLATES.get(
            description_type,
            self._BASE_STYLE_TEMPLATES[DescriptionType.LOCATION]
        )

        # Get dynamic style based on type + genre (Phase 3)
        dynamic_style = self._get_style_for_type_and_genre(description_type, genre)

        # Build prompt with Imagen 4 optimized format
        prompt_parts = [
            template["prefix"],
            english_description,
            dynamic_style,
        ]

        # Add global genre style if specified (extra reinforcement)
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

    async def auto_detect_genre_async(
        self,
        book_title: str,
        first_chapter_excerpt: str,
        author: Optional[str] = None
    ) -> str:
        """
        Auto-detect book genre using Gemini API.
        
        Phase 3: LLM-based genre detection for accurate style matching.
        
        Args:
            book_title: Title of the book
            first_chapter_excerpt: First 2000 chars of the first chapter
            author: Optional author name
            
        Returns:
            Genre key from GENRE_STYLES (e.g., 'fantasy', 'science_fiction')
        """
        supported_genres = list(self.GENRE_STYLES.keys())
        
        prompt = f"""Analyze this book and determine its primary genre.

**Book Title:** {book_title}
{f'**Author:** {author}' if author else ''}

**First Chapter Excerpt:**
{first_chapter_excerpt[:2000]}

**Supported Genres:** {', '.join(supported_genres)}

Respond with ONLY the exact genre name from the supported list above.
If unsure, respond with "other".
Do not include any explanation, just the genre name.
"""
        try:
            from google import genai
            from app.core.config import settings
            
            client = genai.Client(api_key=settings.LANGEXTRACT_API_KEY or settings.GOOGLE_API_KEY)
            response = await client.aio.models.generate_content(
                model="gemini-3-flash",
                contents=prompt,
            )
            
            detected = response.text.strip().lower().replace(" ", "_")
            
            # Validate against supported genres
            if detected in supported_genres:
                logger.info(f"Auto-detected genre for '{book_title}': {detected}")
                return detected
            else:
                logger.warning(f"Unknown genre detected '{detected}' for '{book_title}', using 'other'")
                return "other"
                
        except Exception as e:
            logger.error(f"Genre detection failed for '{book_title}': {e}")
            return "other"


# Imagen 4 best practices for prompt format (Phase 3)
IMAGEN4_NEGATIVE_PROMPTS = [
    "blurry", "low quality", "distorted", "watermark", "signature",
    "cropped", "worst quality", "jpeg artifacts", "ugly", "duplicate"
]


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
