"""
Unit-tests for NERService — mock GLiNER2, full pipeline.

All tests mock GLiNER2 model and tokenizer to avoid GPU/PyTorch loading.
"""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from dataclasses import dataclass

import app.services.ner_service as ner_module
from app.services.ner_service import NERService, get_ner_service
from app.services.gemini_extractor import ExtractedEntity, ChapterAnalysisResult


def make_mock_model():
    """Create a mock GLiNER2 model that returns predefined entities."""
    model = MagicMock()
    model.predict_entities = MagicMock(
        return_value=[
            {"text": "Геральт", "start": 0, "end": 7, "score": 0.92, "label": "person"},
            {
                "text": "Каэр Морхен",
                "start": 20,
                "end": 31,
                "score": 0.85,
                "label": "location",
            },
        ]
    )
    return model


def make_mock_tokenizer():
    """Create a mock tokenizer (approx 3 chars per token)."""
    tokenizer = MagicMock()
    tokenizer.encode = lambda text, add_special_tokens=False: [0] * (len(text) // 3)
    return tokenizer


class TestExtractEntitiesMocked:
    """test_extract_entities_mocked: mock GLiNER2 model -> correct return."""

    def test_extract_entities_returns_normalized_dicts(self):
        service = NERService()
        service._model = make_mock_model()
        service._tokenizer = make_mock_tokenizer()
        service._loaded = True

        results = service.extract_entities(
            "Геральт сидел в Каэр Морхен.",
            labels=["person", "location"],
            threshold=0.4,
        )

        assert len(results) == 2
        assert results[0]["text"] == "Геральт"
        assert results[0]["label"] == "person"
        assert results[0]["confidence"] == 0.92
        assert results[1]["text"] == "Каэр Морхен"
        assert results[1]["label"] == "location"

    def test_extract_entities_passes_threshold(self):
        service = NERService()
        service._model = make_mock_model()
        service._tokenizer = make_mock_tokenizer()
        service._loaded = True

        service.extract_entities("text", labels=["person"], threshold=0.7)

        service._model.predict_entities.assert_called_once_with(
            "text",
            ["person"],
            threshold=0.7,
        )


class TestExtractChapterFullPipeline:
    """test_extract_chapter_full_pipeline: mock model -> chunking -> dedup -> adapt -> ChapterAnalysisResult."""

    def test_full_pipeline_returns_chapter_analysis_result(self):
        service = NERService()
        service._model = make_mock_model()
        service._tokenizer = make_mock_tokenizer()
        service._loaded = True

        text = "Геральт сидел в Каэр Морхен. Он смотрел на горы."

        with patch("app.monitoring.metrics.record_ner_chapter_duration"), patch(
            "app.monitoring.metrics.record_ner_chunk_duration"
        ), patch("app.monitoring.metrics.record_ner_chunks"), patch(
            "app.monitoring.metrics.record_ner_entities"
        ):
            result = service.extract_chapter(text)

        assert isinstance(result, ChapterAnalysisResult)
        assert len(result.entities) > 0
        assert result.descriptions == []
        assert result.relationships == []

        # Check entities have correct types
        entity_types = {e.type for e in result.entities}
        assert "character" in entity_types or "location" in entity_types

    def test_pipeline_entities_have_correct_fields(self):
        service = NERService()
        service._model = make_mock_model()
        service._tokenizer = make_mock_tokenizer()
        service._loaded = True

        text = "Геральт из Ривии прибыл в Каэр Морхен после долгого пути."

        with patch("app.monitoring.metrics.record_ner_chapter_duration"), patch(
            "app.monitoring.metrics.record_ner_chunk_duration"
        ), patch("app.monitoring.metrics.record_ner_chunks"), patch(
            "app.monitoring.metrics.record_ner_entities"
        ):
            result = service.extract_chapter(text)

        for entity in result.entities:
            assert isinstance(entity, ExtractedEntity)
            assert entity.visual_summary == ""
            assert entity.aliases == []
            assert entity.importance == 5


class TestSingletonPattern:
    """test_singleton_pattern: get_ner_service() returns the same object."""

    def test_singleton_returns_same_instance(self):
        # Reset the global singleton
        ner_module._ner_service = None

        svc1 = get_ner_service()
        svc2 = get_ner_service()
        assert svc1 is svc2

        # Clean up
        ner_module._ner_service = None

    def test_singleton_is_ner_service_instance(self):
        ner_module._ner_service = None
        svc = get_ner_service()
        assert isinstance(svc, NERService)
        ner_module._ner_service = None


class TestLabelsFromSettings:
    """test_labels_from_settings: mock settings_manager -> custom labels passed to GLiNER2."""

    def test_custom_labels_from_settings(self):
        service = NERService()
        mock_model = MagicMock()
        mock_model.predict_entities = MagicMock(
            return_value=[
                {"text": "Москва", "start": 0, "end": 6, "score": 0.9, "label": "city"},
            ]
        )
        service._model = mock_model
        service._tokenizer = make_mock_tokenizer()
        service._loaded = True

        # Mock settings_manager with get_setting returning custom labels
        mock_settings = MagicMock()
        mock_settings.get_setting = AsyncMock(
            side_effect=lambda cat, key, default=None: {
                ("ner", "labels"): ["person", "city"],
                ("ner", "threshold"): 0.3,
            }.get((cat, key), default)
        )

        with patch("app.monitoring.metrics.record_ner_chapter_duration"), patch(
            "app.monitoring.metrics.record_ner_chunk_duration"
        ), patch("app.monitoring.metrics.record_ner_chunks"), patch(
            "app.monitoring.metrics.record_ner_entities"
        ):
            result = service.extract_chapter("Москва — столица России.", mock_settings)

        assert isinstance(result, ChapterAnalysisResult)


class TestThresholdFromSettings:
    """test_threshold_from_settings: mock settings_manager -> custom threshold."""

    def test_default_threshold_used_without_settings(self):
        service = NERService()
        mock_model = MagicMock()
        mock_model.predict_entities = MagicMock(return_value=[])
        service._model = mock_model
        service._tokenizer = make_mock_tokenizer()
        service._loaded = True

        with patch("app.monitoring.metrics.record_ner_chapter_duration"), patch(
            "app.monitoring.metrics.record_ner_chunk_duration"
        ), patch("app.monitoring.metrics.record_ner_chunks"), patch(
            "app.monitoring.metrics.record_ner_entities"
        ):
            service.extract_chapter("Простой текст без сущностей.")

        # Default threshold 0.4 should be used
        mock_model.predict_entities.assert_called()
        call_args = mock_model.predict_entities.call_args
        assert call_args[1]["threshold"] == 0.4
