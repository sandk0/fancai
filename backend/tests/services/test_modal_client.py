"""Тесты для Modal client response converter."""

import pytest

from app.models.description import DescriptionType
from app.schemas.extraction import (
    ChapterAnalysisResult,
    ExtractedDescription,
    ExtractedEntity,
    ExtractedRelationship,
)
from app.services.modal_client import modal_response_to_chapter_result


class TestModalResponseConverter:
    def test_converts_entities(self):
        modal_json = {
            "entities": [
                {
                    "name": "Geralt",
                    "type": "character",
                    "visual_summary": "White-haired witcher",
                    "aliases": ["Butcher of Blaviken"],
                    "confidence": 0.95,
                    "importance": 9,
                }
            ],
            "descriptions": [],
            "relationships": [],
        }
        result = modal_response_to_chapter_result(modal_json)
        assert isinstance(result, ChapterAnalysisResult)
        assert len(result.entities) == 1
        assert result.entities[0].name == "Geralt"
        assert result.entities[0].type == "character"
        assert result.entities[0].aliases == ["Butcher of Blaviken"]

    def test_converts_descriptions(self):
        modal_json = {
            "entities": [],
            "descriptions": [
                {
                    "content": "Тёмная таверна с дубовыми столами",
                    "type": "location",
                    "confidence": 0.9,
                    "entities": ["Geralt"],
                    "image_prompt_en": "Dark tavern with oak tables, medieval fantasy",
                }
            ],
            "relationships": [],
        }
        result = modal_response_to_chapter_result(modal_json)
        assert len(result.descriptions) == 1
        desc = result.descriptions[0]
        assert desc.content == "Тёмная таверна с дубовыми столами"
        assert desc.description_type == DescriptionType.LOCATION

    def test_converts_relationships(self):
        modal_json = {
            "entities": [],
            "descriptions": [],
            "relationships": [
                {
                    "source": "Geralt",
                    "target": "Yennefer",
                    "type": "romantic",
                    "weight": 0.8,
                    "context": "Long-standing relationship",
                }
            ],
        }
        result = modal_response_to_chapter_result(modal_json)
        assert len(result.relationships) == 1
        assert result.relationships[0].source == "Geralt"

    def test_handles_empty_response(self):
        result = modal_response_to_chapter_result(
            {"entities": [], "descriptions": [], "relationships": []}
        )
        assert result.entities == []
        assert result.descriptions == []
        assert result.relationships == []

    def test_handles_missing_optional_fields(self):
        modal_json = {
            "entities": [{"name": "Tavern", "type": "location", "visual_summary": ""}],
            "descriptions": [
                {
                    "content": "Text",
                    "type": "atmosphere",
                    "confidence": 0.5,
                    "entities": [],
                }
            ],
            "relationships": [],
        }
        result = modal_response_to_chapter_result(modal_json)
        assert result.entities[0].chapter_event_action is None
        assert result.descriptions[0].description_type == DescriptionType.ATMOSPHERE

    def test_handles_bare_empty_dict(self):
        result = modal_response_to_chapter_result({})
        assert result.entities == []
        assert result.descriptions == []
        assert result.relationships == []

    def test_unknown_description_type_defaults_to_location(self):
        modal_json = {
            "entities": [],
            "descriptions": [
                {"content": "x", "type": "mood", "confidence": 0.5, "entities": []}
            ],
            "relationships": [],
        }
        result = modal_response_to_chapter_result(modal_json)
        assert result.descriptions[0].description_type == DescriptionType.LOCATION

    def test_description_type_mapping(self):
        """All DescriptionType values must be handled."""
        for dtype in ["location", "character", "atmosphere", "object", "action"]:
            modal_json = {
                "entities": [],
                "descriptions": [
                    {"content": "x", "type": dtype, "confidence": 0.5, "entities": []}
                ],
                "relationships": [],
            }
            result = modal_response_to_chapter_result(modal_json)
            assert result.descriptions[0].description_type.value == dtype
