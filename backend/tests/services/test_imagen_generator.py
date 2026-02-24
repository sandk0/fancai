"""
Comprehensive tests for Google Imagen Image Generator.

Tests cover:
1. Successful image generation
2. API error handling (timeout, rate limit, safety filters)
3. Translation functionality
4. Prompt engineering
5. Base64 encoding/decoding
6. File saving
7. Retry logic
8. Configuration management
9. Service availability
10. Edge cases

Coverage target: >70%
"""

import pytest
import asyncio
import base64
from unittest.mock import MagicMock, patch, mock_open

from app.services.imagen_generator import (
    GoogleImagenGenerator,
    ImagenConfig,
    ImageGenerationResult,
    PromptTranslator,
    ImagenPromptEngineer,
    ImagenService,
    DescriptionType,
    get_imagen_service,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_genai():
    """Mock google.genai module."""
    with patch("app.services.imagen_generator.genai") as mock:
        yield mock


@pytest.fixture
def sample_imagen_config():
    """Sample Imagen configuration."""
    return ImagenConfig(
        api_key="test_api_key_imagen_12345",
        model="imagen-4.0-generate-001",
        aspect_ratio="4:3",
        person_generation="allow_adult",
        safety_filter_level="block_low_and_above",
        timeout_seconds=60,
        max_retries=3,
        retry_delay=1.0,
    )


@pytest.fixture
def sample_russian_text():
    """Sample Russian description."""
    return "Старый замок возвышался на холме, окруженный густым лесом. Серые каменные стены, величественные башни."


@pytest.fixture
def sample_english_translation():
    """Sample English translation."""
    return "An old castle stood on a hill, surrounded by dense forest. Gray stone walls, majestic towers."


@pytest.fixture
def sample_image_bytes():
    """Sample image bytes (PNG header)."""
    # PNG header: 89 50 4E 47 0D 0A 1A 0A
    return b"\x89PNG\r\n\x1a\n" + b"fake_image_data" * 100


# =============================================================================
# GoogleImagenGenerator Tests
# =============================================================================


class TestGoogleImagenGenerator:
    """Tests for GoogleImagenGenerator class."""

    def test_initialization_success(self, sample_imagen_config, mock_genai):
        """Test successful initialization."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        # Act
        generator = GoogleImagenGenerator(sample_imagen_config)

        # Assert
        assert generator.is_available() is True
        assert generator.config.api_key == "test_api_key_imagen_12345"
        mock_genai.Client.assert_called_once_with(api_key="test_api_key_imagen_12345")

    def test_initialization_no_api_key(self):
        """Test initialization without API key."""
        # Arrange
        config = ImagenConfig(api_key=None)

        # Act
        generator = GoogleImagenGenerator(config)

        # Assert
        assert generator.is_available() is False

    def test_initialization_import_error(self, sample_imagen_config):
        """Test initialization handles import errors."""
        # Arrange
        with patch(
            "app.services.imagen_generator.genai",
            side_effect=ImportError("Module not found"),
        ):
            # Act
            generator = GoogleImagenGenerator(sample_imagen_config)

            # Assert
            assert generator.is_available() is False

    @pytest.mark.asyncio
    async def test_generate_success_with_base64_string(
        self, sample_imagen_config, sample_image_bytes, mock_genai
    ):
        """Test successful image generation with base64 string response."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        # Mock successful response with base64 string
        mock_image = MagicMock()
        image_base64 = base64.b64encode(sample_image_bytes).decode("utf-8")
        mock_image.image.image_bytes = image_base64  # String format

        mock_response = MagicMock()
        mock_response.generated_images = [mock_image]

        async def mock_generate(*args, **kwargs):
            return mock_response

        with patch("asyncio.to_thread", side_effect=mock_generate):
            with patch("asyncio.wait_for", side_effect=lambda coro, timeout: coro):
                with patch("aiofiles.open", mock_open()):
                    generator = GoogleImagenGenerator(sample_imagen_config)

                    # Act
                    result = await generator.generate("A beautiful castle")

        # Assert
        assert result.success is True
        assert result.image_url is not None
        assert result.image_url.startswith("data:image/png;base64,")
        assert result.image_data is not None
        assert result.local_path is not None

    @pytest.mark.asyncio
    async def test_generate_success_with_raw_png_bytes(
        self, sample_imagen_config, sample_image_bytes, mock_genai
    ):
        """Test successful image generation with raw PNG bytes response."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        # Mock successful response with raw PNG bytes
        mock_image = MagicMock()
        mock_image.image.image_bytes = sample_image_bytes  # Raw PNG bytes

        mock_response = MagicMock()
        mock_response.generated_images = [mock_image]

        async def mock_generate(*args, **kwargs):
            return mock_response

        with patch("asyncio.to_thread", side_effect=mock_generate):
            with patch("asyncio.wait_for", side_effect=lambda coro, timeout: coro):
                with patch("aiofiles.open", mock_open()):
                    generator = GoogleImagenGenerator(sample_imagen_config)

                    # Act
                    result = await generator.generate("A castle scene")

        # Assert
        assert result.success is True
        assert result.image_data == sample_image_bytes

    @pytest.mark.asyncio
    async def test_generate_success_with_base64_bytes(
        self, sample_imagen_config, sample_image_bytes, mock_genai
    ):
        """Test successful image generation with base64-encoded bytes response."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        # Mock successful response with base64 bytes (not PNG header)
        mock_image = MagicMock()
        image_base64_bytes = base64.b64encode(sample_image_bytes)
        mock_image.image.image_bytes = (
            image_base64_bytes  # Bytes containing base64 text
        )

        mock_response = MagicMock()
        mock_response.generated_images = [mock_image]

        async def mock_generate(*args, **kwargs):
            return mock_response

        with patch("asyncio.to_thread", side_effect=mock_generate):
            with patch("asyncio.wait_for", side_effect=lambda coro, timeout: coro):
                with patch("aiofiles.open", mock_open()):
                    generator = GoogleImagenGenerator(sample_imagen_config)

                    # Act
                    result = await generator.generate("Test prompt")

        # Assert
        assert result.success is True
        assert result.image_data == sample_image_bytes

    @pytest.mark.asyncio
    async def test_generate_not_available(self, sample_imagen_config):
        """Test generation when service is not available."""
        # Arrange
        config = ImagenConfig(api_key=None)
        generator = GoogleImagenGenerator(config)

        # Act
        result = await generator.generate("Test prompt")

        # Assert
        assert result.success is False
        assert "not available" in result.error_message

    @pytest.mark.asyncio
    async def test_generate_timeout(self, sample_imagen_config, mock_genai):
        """Test handling of timeout during generation."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        async def raise_timeout(*args, **kwargs):
            raise asyncio.TimeoutError()

        with patch("asyncio.wait_for", side_effect=raise_timeout):
            generator = GoogleImagenGenerator(sample_imagen_config)

            # Act
            result = await generator.generate("Test prompt")

        # Assert
        assert result.success is False
        assert "timed out" in result.error_message

    @pytest.mark.asyncio
    async def test_generate_no_images_in_response(
        self, sample_imagen_config, mock_genai
    ):
        """Test handling when API returns no images."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        # Mock response with empty images
        mock_response = MagicMock()
        mock_response.generated_images = []

        async def mock_generate(*args, **kwargs):
            return mock_response

        with patch("asyncio.to_thread", side_effect=mock_generate):
            with patch("asyncio.wait_for", side_effect=lambda coro, timeout: coro):
                generator = GoogleImagenGenerator(sample_imagen_config)
                generator.config.max_retries = 1  # Reduce retries for speed

                # Act
                result = await generator.generate("Test prompt")

        # Assert
        assert result.success is False
        assert "No images generated" in result.error_message

    @pytest.mark.asyncio
    async def test_generate_api_error(self, sample_imagen_config, mock_genai):
        """Test handling of API errors."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        async def raise_error(*args, **kwargs):
            raise Exception("API Error: Safety filter triggered")

        with patch("asyncio.to_thread", side_effect=raise_error):
            with patch("asyncio.wait_for", side_effect=lambda coro, timeout: coro):
                generator = GoogleImagenGenerator(sample_imagen_config)
                generator.config.max_retries = 1

                # Act
                result = await generator.generate("Test prompt")

        # Assert
        assert result.success is False
        assert "failed" in result.error_message.lower()

    @pytest.mark.asyncio
    async def test_generate_retry_logic(
        self, sample_imagen_config, sample_image_bytes, mock_genai
    ):
        """Test retry logic on temporary failures."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        call_count = 0

        async def generate_with_retry(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Temporary error")

            # Second call succeeds
            mock_image = MagicMock()
            mock_image.image.image_bytes = sample_image_bytes
            mock_response = MagicMock()
            mock_response.generated_images = [mock_image]
            return mock_response

        with patch("asyncio.to_thread", side_effect=generate_with_retry):
            with patch("asyncio.wait_for", side_effect=lambda coro, timeout: coro):
                with patch("aiofiles.open", mock_open()):
                    generator = GoogleImagenGenerator(sample_imagen_config)

                    # Act
                    result = await generator.generate("Test prompt")

        # Assert
        assert result.success is True
        assert call_count == 2  # Should have retried

    @pytest.mark.asyncio
    async def test_generate_custom_aspect_ratio(
        self, sample_imagen_config, sample_image_bytes, mock_genai
    ):
        """Test generation with custom aspect ratio."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        mock_image = MagicMock()
        mock_image.image.image_bytes = sample_image_bytes

        mock_response = MagicMock()
        mock_response.generated_images = [mock_image]

        async def mock_generate(*args, **kwargs):
            return mock_response

        with patch("asyncio.to_thread", side_effect=mock_generate):
            with patch("asyncio.wait_for", side_effect=lambda coro, timeout: coro):
                with patch("aiofiles.open", mock_open()):
                    generator = GoogleImagenGenerator(sample_imagen_config)

                    # Act
                    result = await generator.generate(
                        "Test prompt", aspect_ratio="16:9"
                    )

        # Assert
        assert result.success is True


# =============================================================================
# PromptTranslator Tests
# =============================================================================


class TestPromptTranslator:
    """Tests for PromptTranslator class."""

    def test_initialization(self, mock_genai):
        """Test translator initialization."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        # Act
        translator = PromptTranslator("test_api_key")

        # Assert
        assert translator.api_key == "test_api_key"
        mock_genai.Client.assert_called_once()

    @pytest.mark.asyncio
    async def test_translate_success(
        self, sample_russian_text, sample_english_translation, mock_genai
    ):
        """Test successful translation."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        mock_response = MagicMock()
        mock_response.text = sample_english_translation

        async def mock_generate(*args, **kwargs):
            return mock_response

        with patch("asyncio.to_thread", side_effect=mock_generate):
            translator = PromptTranslator("test_api_key")

            # Act
            result = await translator.translate(sample_russian_text)

        # Assert
        assert result == sample_english_translation

    @pytest.mark.asyncio
    async def test_translate_caching(
        self, sample_russian_text, sample_english_translation, mock_genai
    ):
        """Test translation caching."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        mock_response = MagicMock()
        mock_response.text = sample_english_translation

        call_count = 0

        async def mock_generate(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            return mock_response

        with patch("asyncio.to_thread", side_effect=mock_generate):
            translator = PromptTranslator("test_api_key")

            # Act
            result1 = await translator.translate(sample_russian_text)
            result2 = await translator.translate(
                sample_russian_text
            )  # Should use cache

        # Assert
        assert result1 == result2
        assert call_count == 1  # Should only call API once

    @pytest.mark.asyncio
    async def test_translate_not_available(self, sample_russian_text):
        """Test translation when client is not available."""
        # Arrange
        with patch(
            "app.services.imagen_generator.genai", side_effect=Exception("Import error")
        ):
            translator = PromptTranslator("test_api_key")

            # Act
            result = await translator.translate(sample_russian_text)

        # Assert
        assert result == sample_russian_text  # Returns original on failure

    @pytest.mark.asyncio
    async def test_translate_api_error(self, sample_russian_text, mock_genai):
        """Test translation handles API errors gracefully."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        async def raise_error(*args, **kwargs):
            raise Exception("Translation API error")

        with patch("asyncio.to_thread", side_effect=raise_error):
            translator = PromptTranslator("test_api_key")

            # Act
            result = await translator.translate(sample_russian_text)

        # Assert
        assert result == sample_russian_text  # Fallback to original


# =============================================================================
# ImagenPromptEngineer Tests
# =============================================================================


class TestImagenPromptEngineer:
    """Tests for ImagenPromptEngineer class."""

    @pytest.mark.asyncio
    async def test_create_prompt_location(
        self, sample_russian_text, sample_english_translation, mock_genai
    ):
        """Test prompt creation for location descriptions."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        translator = PromptTranslator("test_api_key")
        translator._cache["test_key"] = sample_english_translation  # Pre-populate cache

        engineer = ImagenPromptEngineer(translator)

        # Mock translate
        with patch.object(
            translator, "translate", return_value=sample_english_translation
        ):
            # Act
            prompt = await engineer.create_prompt(
                sample_russian_text, DescriptionType.LOCATION
            )

        # Assert
        assert sample_english_translation in prompt
        assert "book illustration" in prompt.lower() or "detailed" in prompt.lower()
        assert len(prompt) <= 1800  # Should not exceed limit

    @pytest.mark.asyncio
    async def test_create_prompt_character(
        self, sample_russian_text, sample_english_translation, mock_genai
    ):
        """Test prompt creation for character descriptions."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        translator = PromptTranslator("test_api_key")

        engineer = ImagenPromptEngineer(translator)

        with patch.object(
            translator, "translate", return_value=sample_english_translation
        ):
            # Act
            prompt = await engineer.create_prompt(
                sample_russian_text, DescriptionType.CHARACTER
            )

        # Assert
        assert "character" in prompt.lower() or "portrait" in prompt.lower()

    @pytest.mark.asyncio
    async def test_create_prompt_atmosphere(
        self, sample_russian_text, sample_english_translation, mock_genai
    ):
        """Test prompt creation for atmosphere descriptions."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        translator = PromptTranslator("test_api_key")
        engineer = ImagenPromptEngineer(translator)

        with patch.object(
            translator, "translate", return_value=sample_english_translation
        ):
            # Act
            prompt = await engineer.create_prompt(
                sample_russian_text, DescriptionType.ATMOSPHERE
            )

        # Assert
        assert "atmosphere" in prompt.lower() or "mood" in prompt.lower()

    @pytest.mark.asyncio
    async def test_create_prompt_with_genre(
        self, sample_russian_text, sample_english_translation, mock_genai
    ):
        """Test prompt creation with genre styling."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        translator = PromptTranslator("test_api_key")
        engineer = ImagenPromptEngineer(translator)

        with patch.object(
            translator, "translate", return_value=sample_english_translation
        ):
            # Act
            prompt = await engineer.create_prompt(
                sample_russian_text, DescriptionType.LOCATION, genre="fantasy"
            )

        # Assert
        assert "fantasy" in prompt.lower()

    @pytest.mark.asyncio
    async def test_create_prompt_with_custom_style(
        self, sample_russian_text, sample_english_translation, mock_genai
    ):
        """Test prompt creation with custom style."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        translator = PromptTranslator("test_api_key")
        engineer = ImagenPromptEngineer(translator)

        custom_style = "watercolor painting style"

        with patch.object(
            translator, "translate", return_value=sample_english_translation
        ):
            # Act
            prompt = await engineer.create_prompt(
                sample_russian_text, DescriptionType.LOCATION, custom_style=custom_style
            )

        # Assert
        assert custom_style in prompt

    @pytest.mark.asyncio
    async def test_create_prompt_length_limit(self, mock_genai):
        """Test that prompts are limited to max length."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        long_translation = "Very long description. " * 200  # Create very long text

        translator = PromptTranslator("test_api_key")
        engineer = ImagenPromptEngineer(translator)

        with patch.object(translator, "translate", return_value=long_translation):
            # Act
            prompt = await engineer.create_prompt(
                "Russian text", DescriptionType.LOCATION
            )

        # Assert
        assert len(prompt) <= 1800  # Should be truncated


# =============================================================================
# ImagenService Tests
# =============================================================================


class TestImagenService:
    """Tests for ImagenService main class."""

    def test_initialization_with_api_key(self, mock_genai):
        """Test service initialization with API key."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        with patch.dict("os.environ", {"GOOGLE_API_KEY": "test_key"}):
            with patch("app.services.imagen_generator.settings") as mock_settings:
                mock_settings.IMAGEN_MODEL = "imagen-4.0-generate-001"
                mock_settings.IMAGEN_ASPECT_RATIO = "4:3"
                mock_settings.IMAGEN_SAFETY_LEVEL = "block_low_and_above"
                mock_settings.IMAGEN_TIMEOUT_SECONDS = 60

                # Act
                service = ImagenService()

        # Assert
        assert service.is_available() is True

    def test_initialization_no_api_key(self):
        """Test service initialization without API key."""
        # Arrange
        with patch.dict("os.environ", {}, clear=True):
            # Act
            service = ImagenService()

        # Assert
        assert service.is_available() is False

    @pytest.mark.asyncio
    async def test_generate_image_success(
        self, sample_russian_text, sample_image_bytes, mock_genai
    ):
        """Test successful image generation through service."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        # Mock image response
        mock_image = MagicMock()
        mock_image.image.image_bytes = sample_image_bytes

        mock_response = MagicMock()
        mock_response.generated_images = [mock_image]

        async def mock_generate(*args, **kwargs):
            return mock_response

        with patch.dict("os.environ", {"GOOGLE_API_KEY": "test_key"}):
            with patch("app.services.imagen_generator.settings") as mock_settings:
                mock_settings.IMAGEN_MODEL = "imagen-4.0-generate-001"
                mock_settings.IMAGEN_ASPECT_RATIO = "4:3"
                mock_settings.IMAGEN_SAFETY_LEVEL = "block_low_and_above"
                mock_settings.IMAGEN_TIMEOUT_SECONDS = 60

                with patch("asyncio.to_thread", side_effect=mock_generate):
                    with patch(
                        "asyncio.wait_for", side_effect=lambda coro, timeout: coro
                    ):
                        with patch("aiofiles.open", mock_open()):
                            service = ImagenService()

                            # Act
                            result = await service.generate_image(
                                sample_russian_text, description_type="location"
                            )

        # Assert
        assert result.success is True

    @pytest.mark.asyncio
    async def test_generate_image_not_available(self):
        """Test image generation when service is not available."""
        # Arrange
        with patch.dict("os.environ", {}, clear=True):
            service = ImagenService()

            # Act
            result = await service.generate_image("Test description")

        # Assert
        assert result.success is False
        assert "not available" in result.error_message

    @pytest.mark.asyncio
    async def test_generate_image_invalid_type(
        self, sample_russian_text, sample_image_bytes, mock_genai
    ):
        """Test image generation with invalid description type."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        mock_image = MagicMock()
        mock_image.image.image_bytes = sample_image_bytes

        mock_response = MagicMock()
        mock_response.generated_images = [mock_image]

        async def mock_generate(*args, **kwargs):
            return mock_response

        with patch.dict("os.environ", {"GOOGLE_API_KEY": "test_key"}):
            with patch("app.services.imagen_generator.settings") as mock_settings:
                mock_settings.IMAGEN_MODEL = "imagen-4.0-generate-001"
                mock_settings.IMAGEN_ASPECT_RATIO = "4:3"
                mock_settings.IMAGEN_SAFETY_LEVEL = "block_low_and_above"
                mock_settings.IMAGEN_TIMEOUT_SECONDS = 60

                with patch("asyncio.to_thread", side_effect=mock_generate):
                    with patch(
                        "asyncio.wait_for", side_effect=lambda coro, timeout: coro
                    ):
                        with patch("aiofiles.open", mock_open()):
                            service = ImagenService()

                            # Act - invalid type should default to location
                            result = await service.generate_image(
                                sample_russian_text, description_type="invalid_type"
                            )

        # Assert
        assert result.success is True  # Should still work with default type

    @pytest.mark.asyncio
    async def test_preview_prompt(
        self, sample_russian_text, sample_english_translation, mock_genai
    ):
        """Test prompt preview functionality."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        with patch.dict("os.environ", {"GOOGLE_API_KEY": "test_key"}):
            with patch("app.services.imagen_generator.settings") as mock_settings:
                mock_settings.IMAGEN_MODEL = "imagen-4.0-generate-001"
                mock_settings.IMAGEN_ASPECT_RATIO = "4:3"
                mock_settings.IMAGEN_SAFETY_LEVEL = "block_low_and_above"
                mock_settings.IMAGEN_TIMEOUT_SECONDS = 60

                service = ImagenService()

                # Mock translation
                with patch.object(
                    service._translator,
                    "translate",
                    return_value=sample_english_translation,
                ):
                    # Act
                    result = await service.preview_prompt(sample_russian_text)

        # Assert
        assert "original_russian" in result
        assert "english_prompt" in result
        assert result["original_russian"] == sample_russian_text

    def test_get_status(self, mock_genai):
        """Test service status retrieval."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        with patch.dict("os.environ", {"GOOGLE_API_KEY": "test_key"}):
            with patch("app.services.imagen_generator.settings") as mock_settings:
                mock_settings.IMAGEN_MODEL = "imagen-4.0-generate-001"
                mock_settings.IMAGEN_ASPECT_RATIO = "4:3"
                mock_settings.IMAGEN_SAFETY_LEVEL = "block_low_and_above"
                mock_settings.IMAGEN_TIMEOUT_SECONDS = 60

                service = ImagenService()

                # Act
                status = service.get_status()

        # Assert
        assert "available" in status
        assert "has_api_key" in status
        assert status["has_api_key"] is True


# =============================================================================
# Singleton Tests
# =============================================================================


class TestSingleton:
    """Tests for singleton pattern."""

    def test_get_imagen_service_singleton(self, mock_genai):
        """Test that get_imagen_service returns singleton."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        # Reset singleton
        import app.services.imagen_generator as img_module

        img_module._imagen_service = None

        with patch.dict("os.environ", {"GOOGLE_API_KEY": "test_key"}):
            with patch("app.services.imagen_generator.settings") as mock_settings:
                mock_settings.IMAGEN_MODEL = "imagen-4.0-generate-001"
                mock_settings.IMAGEN_ASPECT_RATIO = "4:3"
                mock_settings.IMAGEN_SAFETY_LEVEL = "block_low_and_above"
                mock_settings.IMAGEN_TIMEOUT_SECONDS = 60

                # Act
                service1 = get_imagen_service()
                service2 = get_imagen_service()

        # Assert
        assert service1 is service2  # Same instance


# =============================================================================
# Edge Cases
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    @pytest.mark.asyncio
    async def test_save_image_creates_directory(
        self, sample_imagen_config, sample_image_bytes, mock_genai
    ):
        """Test that _save_image creates directory if it doesn't exist."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        generator = GoogleImagenGenerator(sample_imagen_config)

        with patch("pathlib.Path.mkdir") as mock_mkdir:
            with patch("aiofiles.open", mock_open()):
                # Act
                await generator._save_image(sample_image_bytes, "test prompt")

        # Assert
        mock_mkdir.assert_called_once()

    @pytest.mark.asyncio
    async def test_unexpected_data_type_from_imagen(
        self, sample_imagen_config, mock_genai
    ):
        """Test handling of unexpected data type from Imagen API."""
        # Arrange
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        # Mock response with unexpected data type
        mock_image = MagicMock()
        mock_image.image.image_bytes = 12345  # Integer instead of bytes/str

        mock_response = MagicMock()
        mock_response.generated_images = [mock_image]

        async def mock_generate(*args, **kwargs):
            return mock_response

        with patch("asyncio.to_thread", side_effect=mock_generate):
            with patch("asyncio.wait_for", side_effect=lambda coro, timeout: coro):
                generator = GoogleImagenGenerator(sample_imagen_config)

                # Act
                result = await generator.generate("Test prompt")

        # Assert
        assert result.success is False
        assert (
            "Unexpected data type" in result.error_message
            or "failed" in result.error_message.lower()
        )

    def test_description_type_enum_values(self):
        """Test DescriptionType enum has expected values."""
        # Assert
        assert DescriptionType.LOCATION.value == "location"
        assert DescriptionType.CHARACTER.value == "character"
        assert DescriptionType.ATMOSPHERE.value == "atmosphere"
        assert DescriptionType.OBJECT.value == "object"
        assert DescriptionType.ACTION.value == "action"

    def test_image_generation_result_dataclass(self):
        """Test ImageGenerationResult dataclass structure."""
        # Arrange & Act
        result = ImageGenerationResult(
            success=True,
            image_url="data:image/png;base64,abc123",
            image_data=b"test",
            local_path="/path/to/image.png",
            generation_time_seconds=5.5,
            model_used="imagen-4.0",
            prompt_used="test prompt",
        )

        # Assert
        assert result.success is True
        assert result.image_url == "data:image/png;base64,abc123"
        assert result.generation_time_seconds == 5.5
