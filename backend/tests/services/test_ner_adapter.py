"""
Unit-tests for NERAdapter and deduplicate_overlap_entities from ner_service.py.
"""

import pytest

from app.services.ner_service import NERAdapter, deduplicate_overlap_entities
from app.services.gemini_extractor import ExtractedEntity, ChapterAnalysisResult


class TestAdaptBasicEntities:
    """test_adapt_basic_entities: raw GLiNER2 entities -> ExtractedEntity with correct fields."""

    def test_basic_entity_conversion(self):
        raw = [
            {
                "text": "Геральт",
                "start": 10,
                "end": 17,
                "confidence": 0.85,
                "label": "person",
            },
        ]
        chunk_offsets = [(0, 100)]
        result = NERAdapter.adapt_to_chapter_result(raw, chunk_offsets)
        assert len(result.entities) == 1
        entity = result.entities[0]
        assert entity.name == "Геральт"
        assert entity.type == "character"
        assert entity.confidence == 0.85
        assert entity.first_mention_offset == 10


class TestAdaptLabelMapping:
    """test_adapt_label_mapping: person->character, location->location, artifact->object, organization->object."""

    def test_person_maps_to_character(self):
        raw = [
            {
                "text": "Геральт",
                "start": 0,
                "end": 7,
                "confidence": 0.9,
                "label": "person",
            }
        ]
        result = NERAdapter.adapt_to_chapter_result(raw, [(0, 100)])
        assert result.entities[0].type == "character"

    def test_location_maps_to_location(self):
        raw = [
            {
                "text": "Каэр Морхен",
                "start": 0,
                "end": 11,
                "confidence": 0.8,
                "label": "location",
            }
        ]
        result = NERAdapter.adapt_to_chapter_result(raw, [(0, 100)])
        assert result.entities[0].type == "location"

    def test_artifact_maps_to_object(self):
        raw = [
            {
                "text": "Меч ведьмака",
                "start": 0,
                "end": 12,
                "confidence": 0.7,
                "label": "artifact",
            }
        ]
        result = NERAdapter.adapt_to_chapter_result(raw, [(0, 100)])
        assert result.entities[0].type == "object"

    def test_organization_maps_to_object(self):
        raw = [
            {
                "text": "Орден Пламенной Розы",
                "start": 0,
                "end": 20,
                "confidence": 0.75,
                "label": "organization",
            }
        ]
        result = NERAdapter.adapt_to_chapter_result(raw, [(0, 100)])
        assert result.entities[0].type == "object"


class TestAdaptFilterShortNames:
    """test_adapt_filter_short_names: names < 2 chars filtered out (D-12)."""

    def test_single_char_name_filtered(self):
        raw = [
            {"text": "А", "start": 0, "end": 1, "confidence": 0.9, "label": "person"},
            {
                "text": "Геральт",
                "start": 5,
                "end": 12,
                "confidence": 0.8,
                "label": "person",
            },
        ]
        result = NERAdapter.adapt_to_chapter_result(raw, [(0, 100)])
        assert len(result.entities) == 1
        assert result.entities[0].name == "Геральт"

    def test_empty_name_filtered(self):
        raw = [
            {"text": "", "start": 0, "end": 0, "confidence": 0.9, "label": "person"},
        ]
        result = NERAdapter.adapt_to_chapter_result(raw, [(0, 100)])
        assert len(result.entities) == 0


class TestAdaptAggregateMentions:
    """test_adapt_aggregate_mentions: two mentions of same name -> one entity, confidence=avg, offset=min (D-13)."""

    def test_aggregate_same_name_mentions(self):
        raw = [
            {
                "text": "Геральт",
                "start": 10,
                "end": 17,
                "confidence": 0.80,
                "label": "person",
            },
            {
                "text": "Геральт",
                "start": 50,
                "end": 57,
                "confidence": 0.90,
                "label": "person",
            },
        ]
        result = NERAdapter.adapt_to_chapter_result(raw, [(0, 100)])
        assert len(result.entities) == 1
        entity = result.entities[0]
        assert entity.first_mention_offset == 10  # min offset
        assert abs(entity.confidence - 0.85) < 0.01  # avg confidence

    def test_aggregate_case_insensitive(self):
        raw = [
            {
                "text": "Геральт",
                "start": 5,
                "end": 12,
                "confidence": 0.70,
                "label": "person",
            },
            {
                "text": "геральт",
                "start": 30,
                "end": 37,
                "confidence": 0.80,
                "label": "person",
            },
        ]
        result = NERAdapter.adapt_to_chapter_result(raw, [(0, 100)])
        assert len(result.entities) == 1
        # Uses the first occurrence's name form
        assert result.entities[0].name == "Геральт"


class TestAdaptEmptyDefaults:
    """test_adapt_empty_defaults: visual_summary='', aliases=[], importance=5, events=None (D-11)."""

    def test_empty_defaults_set(self):
        raw = [
            {
                "text": "Геральт",
                "start": 0,
                "end": 7,
                "confidence": 0.9,
                "label": "person",
            },
        ]
        result = NERAdapter.adapt_to_chapter_result(raw, [(0, 100)])
        entity = result.entities[0]
        assert entity.visual_summary == ""
        assert entity.aliases == []
        assert entity.importance == 5
        assert entity.chapter_event_action is None
        assert entity.chapter_event_inner is None


class TestDeduplicateOverlap:
    """test_deduplicate_overlap: two entities with same offset+name -> keep higher confidence."""

    def test_dedup_same_offset_and_name(self):
        entities = [
            {
                "text": "Геральт",
                "start": 10,
                "end": 17,
                "confidence": 0.70,
                "label": "person",
            },
            {
                "text": "Геральт",
                "start": 10,
                "end": 17,
                "confidence": 0.90,
                "label": "person",
            },
        ]
        result = deduplicate_overlap_entities(entities)
        assert len(result) == 1
        assert result[0]["confidence"] == 0.90

    def test_different_offsets_not_deduped(self):
        entities = [
            {
                "text": "Геральт",
                "start": 10,
                "end": 17,
                "confidence": 0.70,
                "label": "person",
            },
            {
                "text": "Геральт",
                "start": 50,
                "end": 57,
                "confidence": 0.90,
                "label": "person",
            },
        ]
        result = deduplicate_overlap_entities(entities)
        assert len(result) == 2


class TestCreateChapterResult:
    """test_create_chapter_result: descriptions=[], relationships=[] (D-14)."""

    def test_chapter_result_has_empty_descriptions_and_relationships(self):
        raw = [
            {
                "text": "Геральт",
                "start": 0,
                "end": 7,
                "confidence": 0.9,
                "label": "person",
            },
        ]
        result = NERAdapter.adapt_to_chapter_result(raw, [(0, 100)])
        assert isinstance(result, ChapterAnalysisResult)
        assert result.descriptions == []
        assert result.relationships == []
