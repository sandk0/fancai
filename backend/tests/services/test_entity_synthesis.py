"""Тесты Entity Synthesis Service."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.entity_synthesis_service import EntitySynthesisService


class TestEntitySynthesisService:
    def test_build_synthesis_prompt_includes_genre(self):
        """Prompt содержит жанр книги."""
        prompt = EntitySynthesisService._build_synthesis_prompt(
            entities_data=[
                {
                    "name": "Гарри",
                    "type": "character",
                    "events": [],
                    "visual_summary": "",
                }
            ],
            all_entity_names=["Гарри"],
            genre="FANTASY",
            language="ru",
        )
        assert "FANTASY" in prompt
        assert "ru" in prompt

    def test_build_synthesis_prompt_type_aware(self):
        """Prompt содержит type-aware инструкции."""
        prompt = EntitySynthesisService._build_synthesis_prompt(
            entities_data=[
                {
                    "name": "Хогвартс",
                    "type": "location",
                    "events": [],
                    "visual_summary": "",
                }
            ],
            all_entity_names=["Хогвартс"],
            genre="FANTASY",
            language="ru",
        )
        assert "location" in prompt

    def test_batch_entities_small(self):
        """Entities <= batch_size — один batch."""
        entities = [{"name": f"Entity_{i}"} for i in range(30)]
        batches = EntitySynthesisService._batch_entities(entities, batch_size=50)
        assert len(batches) == 1
        assert len(batches[0]) == 30

    def test_batch_entities_large(self):
        """Entities > 80 разбиваются на batch'и по ~50."""
        entities = [{"name": f"Entity_{i}"} for i in range(120)]
        batches = EntitySynthesisService._batch_entities(entities, batch_size=50)
        assert len(batches) == 3
        assert len(batches[0]) == 50
        assert len(batches[2]) == 20

    def test_batch_entities_exact(self):
        """Точное деление."""
        entities = [{"name": f"Entity_{i}"} for i in range(100)]
        batches = EntitySynthesisService._batch_entities(entities, batch_size=50)
        assert len(batches) == 2

    def test_parse_synthesis_response(self):
        """Парсинг JSON ответа synthesis."""
        response = {
            "entities": [
                {
                    "name": "Гарри",
                    "base_role": "protagonist",
                    "milestones": [
                        {
                            "up_to_chapter": 1,
                            "biography": "Сирота",
                            "visual_summary_clean": "Мальчик",
                            "dynamic_role": "Ученик",
                            "importance": 8,
                        }
                    ],
                }
            ],
            "relationship_milestones": [],
        }
        result = EntitySynthesisService._parse_synthesis_response(response)
        assert len(result["entities"]) == 1
        assert result["entities"][0]["base_role"] == "protagonist"
        assert len(result["entities"][0]["milestones"]) == 1

    def test_parse_synthesis_response_empty(self):
        """Пустой ответ."""
        result = EntitySynthesisService._parse_synthesis_response({})
        assert result["entities"] == []
        assert result["relationship_milestones"] == []

    def test_parse_synthesis_response_invalid_entity(self):
        """Entity без name пропускается."""
        response = {
            "entities": [
                {"base_role": "supporting"},  # no name
                {"name": "Рон", "base_role": "supporting"},
            ],
            "relationship_milestones": [],
        }
        result = EntitySynthesisService._parse_synthesis_response(response)
        assert len(result["entities"]) == 1
        assert result["entities"][0]["name"] == "Рон"


# ---------------------------------------------------------------------------
# Тесты миграции на OpenRouter
# ---------------------------------------------------------------------------


class TestEntitySynthesisOpenRouterMigration:
    """Проверяет что entity_synthesis_service использует OpenRouter вместо google.genai."""

    def test_no_google_genai_import(self):
        """entity_synthesis_service.py НЕ импортирует google.genai."""
        import pathlib

        source = (
            pathlib.Path(__file__).parent.parent.parent
            / "app"
            / "services"
            / "entity_synthesis_service.py"
        )
        content = source.read_text()
        assert (
            "import google" not in content
        ), "entity_synthesis_service.py не должен импортировать google.genai"
        assert (
            "from google" not in content
        ), "entity_synthesis_service.py не должен импортировать из google"

    @pytest.mark.asyncio
    async def test_call_gemini_uses_openrouter_generate_text(self):
        """_call_gemini вызывает openrouter_client.generate_text с правильными аргументами."""
        import json

        mock_client = MagicMock()
        mock_client.generate_text = AsyncMock(
            return_value=json.dumps(
                {
                    "entities": [],
                    "relationship_milestones": [],
                }
            )
        )

        with patch(
            "app.services.entity_synthesis_service.get_ai_provider",
            return_value=mock_client,
        ):
            service = EntitySynthesisService()
            result = await service._call_gemini("Тестовый промпт")

        mock_client.generate_text.assert_called_once()
        call_kwargs = mock_client.generate_text.call_args
        # Должен передать prompt (может быть keyword или positional аргументом)
        prompt_value = call_kwargs.kwargs.get("prompt") or (
            call_kwargs.args[0] if call_kwargs.args else ""
        )
        assert "Тестовый промпт" in prompt_value

    @pytest.mark.asyncio
    async def test_call_gemini_returns_parsed_dict(self):
        """_call_gemini возвращает dict из JSON ответа OpenRouter."""
        import json

        expected = {"entities": [{"name": "Гарри"}], "relationship_milestones": []}
        mock_client = MagicMock()
        mock_client.generate_text = AsyncMock(return_value=json.dumps(expected))

        with patch(
            "app.services.entity_synthesis_service.get_ai_provider",
            return_value=mock_client,
        ):
            service = EntitySynthesisService()
            result = await service._call_gemini("prompt")

        assert result == expected

    @pytest.mark.asyncio
    async def test_call_gemini_handles_invalid_json(self):
        """_call_gemini обрабатывает невалидный JSON gracefully (возвращает пустой dict)."""
        mock_client = MagicMock()
        mock_client.generate_text = AsyncMock(return_value="not json at all {{{")

        with patch(
            "app.services.entity_synthesis_service.get_ai_provider",
            return_value=mock_client,
        ):
            service = EntitySynthesisService()
            result = await service._call_gemini("prompt")

        # parse_json_safe должен вернуть {} при ошибке парсинга
        assert isinstance(result, dict)
