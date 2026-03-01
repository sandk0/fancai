"""
Тесты для ImagenGenerator после миграции на OpenRouter FLUX.2 Klein 4B.

Покрывает:
1. PromptTranslator использует openrouter_client.generate_text() (не google-genai)
2. ImagenService.generate_image() вызывает openrouter_client.generate_image()
3. generate_image вызывается с model из settings.OPENROUTER_IMAGE_MODEL
4. NSFW-защита: переведённый промпт содержит "SFW, safe for work"
5. google-genai нет в импортах
"""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from app.services.imagen_generator import (
    ImageGenerationResult,
    PromptTranslator,
    ImagenPromptEngineer,
    ImagenService,
    get_imagen_service,
)
from app.models.description import DescriptionType

# =============================================================================
# Фикстуры
# =============================================================================


@pytest.fixture
def sample_image_bytes():
    """Тестовые байты изображения (PNG header)."""
    return b"\x89PNG\r\n\x1a\n" + b"fake_image_data" * 100


@pytest.fixture
def mock_openrouter_client(sample_image_bytes):
    """Mock OpenRouterClient."""
    client = MagicMock()
    client.generate_text = AsyncMock(return_value="An old castle on a hill")
    client.generate_image = AsyncMock(return_value=sample_image_bytes)
    return client


@pytest.fixture
def sample_russian_text():
    """Тестовый русский текст."""
    return "Старый замок на холме, окружённый густым лесом."


@pytest.fixture
def sample_english_translation():
    """Тестовый английский перевод."""
    return "An old castle on a hill, surrounded by dense forest."


# =============================================================================
# Тест 1: Нет импортов google.genai
# =============================================================================


class TestNoGoogleGenai:
    """Проверяет, что google-genai полностью удалён."""

    def test_imagen_generator_no_google_import(self):
        """imagen_generator.py НЕ должен импортировать google.genai."""
        import app.services.imagen_generator as module
        import inspect

        source = inspect.getsource(module)
        assert "from google import genai" not in source
        assert "import google.genai" not in source
        # google-genai пакет не импортируется (не должно быть import-инструкций)
        assert "from google.genai" not in source

    def test_google_genai_not_in_module_dict(self):
        """google.genai не должен быть доступен как атрибут модуля."""
        import app.services.imagen_generator as module

        # genai из google-genai SDK не должен быть в пространстве имён модуля
        has_genai_client = hasattr(module, "genai") and hasattr(
            getattr(module, "genai", None), "Client"
        )
        assert (
            not has_genai_client
        ), "google.genai не должен быть импортирован на уровне модуля"


# =============================================================================
# Тест 2: PromptTranslator использует generate_text
# =============================================================================


class TestPromptTranslatorOpenRouter:
    """PromptTranslator должен использовать openrouter_client.generate_text()."""

    @pytest.mark.asyncio
    async def test_translate_uses_generate_text(
        self, sample_russian_text, sample_english_translation, mock_openrouter_client
    ):
        """translate() должен вызывать generate_text() из openrouter_client."""
        mock_openrouter_client.generate_text = AsyncMock(
            return_value=sample_english_translation
        )

        with patch(
            "app.services.imagen_generator.get_openrouter_client",
            return_value=mock_openrouter_client,
        ):
            translator = PromptTranslator()
            result = await translator.translate(sample_russian_text)

        mock_openrouter_client.generate_text.assert_called_once()
        assert result == sample_english_translation

    @pytest.mark.asyncio
    async def test_translate_system_prompt_contains_sfw(
        self, sample_russian_text, mock_openrouter_client
    ):
        """Системный промпт перевода должен содержать SFW."""
        mock_openrouter_client.generate_text = AsyncMock(
            return_value="An old castle. SFW, safe for work"
        )

        with patch(
            "app.services.imagen_generator.get_openrouter_client",
            return_value=mock_openrouter_client,
        ):
            translator = PromptTranslator()
            await translator.translate(sample_russian_text)

        call_kwargs = mock_openrouter_client.generate_text.call_args
        # system_prompt должен содержать SFW
        system_prompt = call_kwargs.kwargs.get("system_prompt", "")
        assert "SFW" in system_prompt or "safe for work" in system_prompt.lower()

    @pytest.mark.asyncio
    async def test_translate_fallback_on_error(
        self, sample_russian_text, mock_openrouter_client
    ):
        """При ошибке translate() возвращает оригинальный текст."""
        mock_openrouter_client.generate_text = AsyncMock(
            side_effect=Exception("API Error")
        )

        with patch(
            "app.services.imagen_generator.get_openrouter_client",
            return_value=mock_openrouter_client,
        ):
            translator = PromptTranslator()
            result = await translator.translate(sample_russian_text)

        assert result == sample_russian_text


# =============================================================================
# Тест 3: ImagenService использует generate_image с правильной моделью
# =============================================================================


class TestImagenServiceOpenRouter:
    """ImagenService должен вызывать openrouter_client.generate_image()."""

    @pytest.mark.asyncio
    async def test_generate_image_calls_openrouter(
        self, sample_russian_text, sample_image_bytes, mock_openrouter_client
    ):
        """generate_image() должен вызвать openrouter_client.generate_image()."""
        mock_openrouter_client.generate_text = AsyncMock(
            return_value="An old castle on a hill"
        )
        mock_openrouter_client.generate_image = AsyncMock(
            return_value=sample_image_bytes
        )

        with patch(
            "app.services.imagen_generator.get_openrouter_client",
            return_value=mock_openrouter_client,
        ):
            with patch.object(
                ImagenService,
                "_save_image",
                new=AsyncMock(return_value="/tmp/test.png"),
            ):
                service = ImagenService()
                result = await service.generate_image(
                    sample_russian_text, description_type="location"
                )

        assert mock_openrouter_client.generate_image.called
        assert result.success is True

    @pytest.mark.asyncio
    async def test_generate_image_uses_flux_model(
        self, sample_russian_text, sample_image_bytes, mock_openrouter_client
    ):
        """generate_image() должен вызываться с model из settings.OPENROUTER_IMAGE_MODEL."""
        mock_openrouter_client.generate_text = AsyncMock(
            return_value="An old castle on a hill"
        )
        mock_openrouter_client.generate_image = AsyncMock(
            return_value=sample_image_bytes
        )

        with patch(
            "app.services.imagen_generator.get_openrouter_client",
            return_value=mock_openrouter_client,
        ):
            with patch.object(
                ImagenService,
                "_save_image",
                new=AsyncMock(return_value="/tmp/test.png"),
            ):
                with patch("app.services.imagen_generator.settings") as mock_settings:
                    mock_settings.OPENROUTER_API_KEY = "test-key"
                    mock_settings.OPENROUTER_IMAGE_MODEL = (
                        "black-forest-labs/flux.2-klein-4b"
                    )
                    mock_settings.REDIS_URL = "redis://localhost:6379"

                    service = ImagenService()
                    await service.generate_image(
                        sample_russian_text, description_type="location"
                    )

        call_kwargs = mock_openrouter_client.generate_image.call_args
        assert call_kwargs is not None
        model_used = call_kwargs.kwargs.get("model") or (
            call_kwargs.args[1] if len(call_kwargs.args) > 1 else None
        )
        assert model_used == "black-forest-labs/flux.2-klein-4b"

    @pytest.mark.asyncio
    async def test_generate_image_result_contains_data_url(
        self, sample_russian_text, sample_image_bytes, mock_openrouter_client
    ):
        """Результат генерации должен содержать data URL с base64."""
        mock_openrouter_client.generate_text = AsyncMock(
            return_value="An old castle on a hill"
        )
        mock_openrouter_client.generate_image = AsyncMock(
            return_value=sample_image_bytes
        )

        with patch(
            "app.services.imagen_generator.get_openrouter_client",
            return_value=mock_openrouter_client,
        ):
            with patch.object(
                ImagenService,
                "_save_image",
                new=AsyncMock(return_value="/tmp/test.png"),
            ):
                service = ImagenService()
                result = await service.generate_image(sample_russian_text)

        assert result.success is True
        assert result.image_url is not None
        assert result.image_url.startswith("data:image/")
        assert "base64" in result.image_url

    @pytest.mark.asyncio
    async def test_generate_image_not_available_without_key(self):
        """Без API ключа сервис должен возвращать success=False."""
        with patch("app.services.imagen_generator.settings") as mock_settings:
            mock_settings.OPENROUTER_API_KEY = ""
            mock_settings.OPENROUTER_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b"

            service = ImagenService()
            result = await service.generate_image("Test description")

        assert result.success is False
        assert result.error_message is not None


# =============================================================================
# Тест 4: NSFW-защита через суффикс SFW в промпте
# =============================================================================


class TestNSFWProtection:
    """NSFW-защита через суффикс 'SFW, safe for work' в промпте."""

    @pytest.mark.asyncio
    async def test_final_prompt_contains_sfw_suffix(
        self, sample_russian_text, sample_image_bytes, mock_openrouter_client
    ):
        """Промпт, передаваемый в generate_image(), должен содержать SFW суффикс."""
        translation = "An old castle on a hill, surrounded by forest"
        mock_openrouter_client.generate_text = AsyncMock(return_value=translation)
        mock_openrouter_client.generate_image = AsyncMock(
            return_value=sample_image_bytes
        )

        with patch(
            "app.services.imagen_generator.get_openrouter_client",
            return_value=mock_openrouter_client,
        ):
            with patch.object(
                ImagenService,
                "_save_image",
                new=AsyncMock(return_value="/tmp/test.png"),
            ):
                service = ImagenService()
                await service.generate_image(
                    sample_russian_text, description_type="location"
                )

        call_kwargs = mock_openrouter_client.generate_image.call_args
        assert call_kwargs is not None
        prompt_used = (
            call_kwargs.args[0]
            if call_kwargs.args
            else call_kwargs.kwargs.get("prompt", "")
        )
        # Промпт должен содержать SFW защиту
        assert "SFW" in prompt_used or "safe for work" in prompt_used.lower()


# =============================================================================
# Тест 5: ImageGenerationResult датакласс
# =============================================================================


class TestImageGenerationResult:
    """Тесты структуры ImageGenerationResult."""

    def test_image_generation_result_success(self):
        """ImageGenerationResult создаётся корректно при успехе."""
        result = ImageGenerationResult(
            success=True,
            image_url="data:image/png;base64,abc123",
            image_data=b"test",
            local_path="/path/to/image.png",
            generation_time_seconds=5.5,
            model_used="black-forest-labs/flux.2-klein-4b",
            prompt_used="test prompt. SFW, safe for work",
        )

        assert result.success is True
        assert result.image_url == "data:image/png;base64,abc123"
        assert result.model_used == "black-forest-labs/flux.2-klein-4b"

    def test_image_generation_result_failure(self):
        """ImageGenerationResult при ошибке."""
        result = ImageGenerationResult(
            success=False,
            error_message="API Error",
        )

        assert result.success is False
        assert result.error_message == "API Error"


# =============================================================================
# Тест 6: Одиночный экземпляр (Singleton)
# =============================================================================


class TestSingleton:
    """Тесты паттерна Singleton."""

    def test_get_imagen_service_returns_singleton(self, mock_openrouter_client):
        """get_imagen_service() возвращает один и тот же объект."""
        import app.services.imagen_generator as img_module

        img_module._imagen_service = None

        with patch(
            "app.services.imagen_generator.get_openrouter_client",
            return_value=mock_openrouter_client,
        ):
            service1 = get_imagen_service()
            service2 = get_imagen_service()

        assert service1 is service2


# =============================================================================
# Тест 7: DescriptionType enum
# =============================================================================


class TestDescriptionType:
    """Тесты enum DescriptionType."""

    def test_description_type_values(self):
        """DescriptionType содержит ожидаемые значения."""
        assert DescriptionType.LOCATION.value == "location"
        assert DescriptionType.CHARACTER.value == "character"
        assert DescriptionType.ATMOSPHERE.value == "atmosphere"
        assert DescriptionType.OBJECT.value == "object"
        assert DescriptionType.ACTION.value == "action"
