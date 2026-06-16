from unittest.mock import patch

import app.core.gemini_client as gc
from app.core.gemini_client import GeminiClient


def test_developer_backend_uses_api_key():
    with patch("app.core.gemini_client.genai.Client") as C:
        GeminiClient(api_key="dev-key")
    C.assert_called_once_with(api_key="dev-key")


def test_vertex_backend_uses_project_location():
    with patch("app.core.gemini_client.genai.Client") as C:
        GeminiClient(vertexai=True, project="proj-123", location="europe-west4")
    C.assert_called_once_with(
        vertexai=True, project="proj-123", location="europe-west4"
    )


def test_singleton_picks_vertex_when_backend_vertex(monkeypatch):
    monkeypatch.setattr(gc.settings, "GEMINI_BACKEND", "vertex")
    monkeypatch.setattr(gc.settings, "GCP_PROJECT", "proj-123")
    monkeypatch.setattr(gc.settings, "GCP_LOCATION", "europe-west4")
    gc._client = None
    with patch("app.core.gemini_client.genai.Client") as C:
        gc.get_gemini_client()
    C.assert_called_once_with(
        vertexai=True, project="proj-123", location="europe-west4"
    )
    gc._client = None


def test_singleton_picks_developer_when_backend_developer(monkeypatch):
    monkeypatch.setattr(gc.settings, "GEMINI_BACKEND", "developer")
    monkeypatch.setattr(gc.settings, "GEMINI_API_KEY", "dev-key")
    gc._client = None
    with patch("app.core.gemini_client.genai.Client") as C:
        gc.get_gemini_client()
    C.assert_called_once_with(api_key="dev-key")
    gc._client = None
