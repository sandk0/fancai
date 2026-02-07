"""Тесты Entity Synthesis Service."""

from app.services.entity_synthesis_service import EntitySynthesisService


class TestEntitySynthesisService:
    def test_build_synthesis_prompt_includes_genre(self):
        """Prompt содержит жанр книги."""
        prompt = EntitySynthesisService._build_synthesis_prompt(
            entities_data=[{
                "name": "Гарри",
                "type": "character",
                "events": [],
                "visual_summary": "",
            }],
            all_entity_names=["Гарри"],
            genre="FANTASY",
            language="ru",
        )
        assert "FANTASY" in prompt
        assert "ru" in prompt

    def test_build_synthesis_prompt_type_aware(self):
        """Prompt содержит type-aware инструкции."""
        prompt = EntitySynthesisService._build_synthesis_prompt(
            entities_data=[{
                "name": "Хогвартс",
                "type": "location",
                "events": [],
                "visual_summary": "",
            }],
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
            "entities": [{
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
            }],
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
