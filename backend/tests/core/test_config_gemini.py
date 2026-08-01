from app.core.config import settings
from app.core.gemini_pricing import PRICING, compute_cost


def test_gemini_settings_exist_with_defaults():
    assert settings.AI_PROVIDER == "gemini"
    assert settings.GEMINI_EXTRACTION_MODEL == "gemini-3.6-flash"
    assert settings.GEMINI_IMAGE_MODEL == "gemini-3.1-flash-image"
    assert hasattr(settings, "GEMINI_API_KEY")
    # GEMINI_LITE_MODEL удалён: у ключа не было ни одного потребителя в коде
    assert not hasattr(settings, "GEMINI_LITE_MODEL")


def test_vertex_backend_settings_exist_with_defaults():
    assert settings.GEMINI_BACKEND == "vertex"
    assert settings.GCP_LOCATION == "global"
    assert hasattr(settings, "GCP_PROJECT")


def test_extraction_model_is_priced():
    """Смена модели без правки PRICING молча обнуляет учёт расходов."""
    model = settings.GEMINI_EXTRACTION_MODEL
    assert model in PRICING, f"{model} отсутствует в таблице цен"
    assert compute_cost(model, in_tokens=100_000, out_tokens=10_000) > 0


def test_openrouter_fallback_models_are_current():
    """Обе модели 2.5-семейства выключаются 2026-10-16 — цепочка отката не должна на них указывать."""
    from app.core.openrouter_client import FALLBACK_MODELS

    assert FALLBACK_MODELS == [
        "google/gemini-3.6-flash",
        "google/gemini-3.5-flash-lite",
    ]
