from unittest.mock import patch

import app.services.imagen_generator as ig
from app.services.imagen_generator import ImagenService


def test_imagen_available_in_vertex_without_api_key(monkeypatch):
    monkeypatch.setattr(ig.settings, "GEMINI_BACKEND", "vertex")
    monkeypatch.setattr(ig.settings, "GCP_PROJECT", "proj-123")
    monkeypatch.setattr(ig.settings, "GEMINI_API_KEY", "")
    with patch.object(ig, "NanoBananaGenerator"), patch.object(
        ig, "PromptTranslator"
    ), patch.object(ig, "ImagenPromptEngineer"):
        svc = ImagenService()
    assert svc.is_available() is True


def test_imagen_disabled_developer_without_key(monkeypatch):
    monkeypatch.setattr(ig.settings, "GEMINI_BACKEND", "developer")
    monkeypatch.setattr(ig.settings, "GEMINI_API_KEY", "")
    svc = ImagenService()
    assert svc.is_available() is False
