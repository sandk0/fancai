"""Тесты для интеграции Modal в book_tasks."""

from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.schemas.extraction import ChapterAnalysisResult, ExtractedEntity
from app.services.modal_client import modal_response_to_chapter_result


class TestModalBookTaskIntegration:
    def test_modal_response_produces_valid_chapter_result(self):
        """Modal JSON → ChapterAnalysisResult → работает с интерфейсом ConsistencyManager."""
        modal_json = {
            "entities": [
                {
                    "name": "Геральт",
                    "type": "character",
                    "visual_summary": "Седовласый ведьмак",
                    "aliases": ["Ведьмак", "Мясник из Блавикена"],
                    "confidence": 0.95,
                    "importance": 9,
                    "chapter_event_action": "Вошёл в таверну",
                    "chapter_event_inner": "Настороженность",
                }
            ],
            "descriptions": [
                {
                    "content": "Тёмная таверна",
                    "type": "location",
                    "confidence": 0.9,
                    "entities": ["Геральт"],
                    "image_prompt_en": "Dark medieval tavern, candlelight, SFW",
                }
            ],
            "relationships": [
                {
                    "source": "Геральт",
                    "target": "Таверна",
                    "type": "located_in",
                    "weight": 0.7,
                    "context": "Геральт вошёл в таверну",
                }
            ],
        }
        result = modal_response_to_chapter_result(modal_json)

        # Проверяем, что все поля для ConsistencyManager на месте
        assert isinstance(result, ChapterAnalysisResult)
        entity = result.entities[0]
        assert entity.name == "Геральт"
        assert entity.chapter_event_action == "Вошёл в таверну"
        assert entity.chapter_event_inner == "Настороженность"

        desc = result.descriptions[0]
        assert desc.to_dict()["type"] == "location"
        assert desc.to_dict()["word_count"] > 0
