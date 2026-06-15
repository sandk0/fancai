from app.core.config import settings


def test_gemini_settings_exist_with_defaults():
    assert settings.AI_PROVIDER in ("openrouter", "gemini")
    assert settings.GEMINI_EXTRACTION_MODEL == "gemini-3.5-flash"
    assert settings.GEMINI_IMAGE_MODEL == "gemini-3.1-flash-image"
    assert hasattr(settings, "GEMINI_API_KEY")
    assert hasattr(settings, "GEMINI_LITE_MODEL")
