from unittest.mock import patch

import app.services.illustration_service as ig
from app.services.illustration_service import IllustrationService


def test_illustration_available_in_vertex_without_api_key(monkeypatch):
    monkeypatch.setattr(ig.settings, "GEMINI_BACKEND", "vertex")
    monkeypatch.setattr(ig.settings, "GCP_PROJECT", "proj-123")
    monkeypatch.setattr(ig.settings, "GEMINI_API_KEY", "")
    with patch.object(ig, "NanoBananaGenerator"), patch.object(
        ig, "PromptTranslator"
    ), patch.object(ig, "IllustrationPromptEngineer"):
        svc = IllustrationService()
    assert svc.is_available() is True


def test_illustration_disabled_developer_without_key(monkeypatch):
    monkeypatch.setattr(ig.settings, "GEMINI_BACKEND", "developer")
    monkeypatch.setattr(ig.settings, "GEMINI_API_KEY", "")
    svc = IllustrationService()
    assert svc.is_available() is False
