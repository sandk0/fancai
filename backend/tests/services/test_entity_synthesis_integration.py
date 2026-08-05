"""
Integration tests for Entity Synthesis Pipeline.

Tests the full cycle: events → dedup → synthesis → milestone filtering → API response.
All LLM calls are mocked — tests the orchestration logic.
"""

import pytest
from unittest.mock import AsyncMock, patch

from app.services.entity_synthesis_service import EntitySynthesisService
from app.services.consistency_manager import ConsistencyManager
from app.services.entity_service import EntityService


class TestSynthesisPipelineIntegration:
    """End-to-end synthesis pipeline: events → dedup → synthesis → parse."""

    @pytest.mark.asyncio
    async def test_full_pipeline_with_mock_gemini(self):
        """Complete pipeline: entities + events → synthesis → parsed milestones."""
        entities = [
            {
                "name": "Раскольников",
                "type": "character",
                "visual_summary": "Бедный студент",
            },
            {"name": "Соня", "type": "character", "visual_summary": "Дочь пьяницы"},
        ]
        events = [
            {
                "entity_name": "Раскольников",
                "chapter_number": 1,
                "action": "Планирует убийство",
                "inner_state": "Мрачен",
            },
            {
                "entity_name": "Раскольников",
                "chapter_number": 3,
                "action": "Убивает старуху",
                "inner_state": "В ужасе",
            },
            {
                "entity_name": "Соня",
                "chapter_number": 2,
                "action": "Появляется на улице",
            },
        ]

        mock_gemini_response = {
            "entities": [
                {
                    "name": "Раскольников",
                    "base_role": "protagonist",
                    "milestones": [
                        {
                            "up_to_chapter": 1,
                            "biography": "Бедный студент",
                            "visual_summary_clean": "Молодой человек",
                            "dynamic_role": "Студент",
                            "importance": 9,
                        },
                        {
                            "up_to_chapter": 5,
                            "biography": "Совершил убийство",
                            "visual_summary_clean": "Молодой человек",
                            "dynamic_role": "Убийца",
                            "importance": 10,
                        },
                    ],
                },
                {
                    "name": "Соня",
                    "base_role": "supporting",
                    "milestones": [
                        {
                            "up_to_chapter": 2,
                            "biography": "Жертва обстоятельств",
                            "visual_summary_clean": "Худенькая девушка",
                            "dynamic_role": "Знакомая",
                            "importance": 7,
                        },
                    ],
                },
            ],
            "relationship_milestones": [
                {
                    "source": "Раскольников",
                    "target": "Соня",
                    "milestones": [{"up_to_chapter": 5, "type": "ALLY", "weight": 60}],
                },
            ],
        }

        service = EntitySynthesisService()
        with patch.object(
            service,
            "_call_gemini",
            new_callable=AsyncMock,
            return_value=mock_gemini_response,
        ):
            result = await service.synthesize_book_entities(
                book_id="test-book-1",
                entities=entities,
                events=events,
                genre="CLASSIC",
                language="ru",
            )

        assert len(result["entities"]) == 2
        rask = next(e for e in result["entities"] if e["name"] == "Раскольников")
        assert rask["base_role"] == "protagonist"
        assert len(rask["milestones"]) == 2

        sonya = next(e for e in result["entities"] if e["name"] == "Соня")
        assert sonya["base_role"] == "supporting"

        assert len(result["relationship_milestones"]) == 1
        assert result["relationship_milestones"][0]["source"] == "Раскольников"

    @pytest.mark.asyncio
    async def test_empty_entities_returns_empty(self):
        """Empty entities list should return empty result without calling Gemini."""
        service = EntitySynthesisService()
        result = await service.synthesize_book_entities(
            book_id="test-book-2",
            entities=[],
            events=[],
            genre="FANTASY",
            language="ru",
        )
        assert result == {"entities": [], "relationship_milestones": []}

    @pytest.mark.asyncio
    async def test_pipeline_handles_gemini_failure_gracefully(self):
        """If Gemini fails, pipeline returns empty results without crashing."""
        entities = [{"name": "Тест", "type": "character", "visual_summary": ""}]
        events = []

        service = EntitySynthesisService()
        with patch.object(
            service,
            "_call_gemini",
            new_callable=AsyncMock,
            side_effect=Exception("API error"),
        ):
            result = await service.synthesize_book_entities(
                book_id="test-book-3",
                entities=entities,
                events=events,
                genre="FANTASY",
                language="ru",
            )

        assert result["entities"] == []
        assert result["relationship_milestones"] == []


class TestEventDedupIntegration:
    """Tests event dedup → synthesis input flow."""

    def test_deduped_events_in_synthesis_input(self):
        """Events are deduped before being passed to synthesis prompt."""
        raw_events = [
            {
                "action": "Родион Раскольников убивает старуху-процентщицу",
                "inner": None,
            },
            {
                "action": "Родион Раскольников убивает старуху-процентщицу топором",
                "inner": None,
            },
            {"action": "Гарри улетает на метле", "inner": "Счастлив"},
        ]

        deduped = ConsistencyManager._deduplicate_events(raw_events)
        assert len(deduped) == 2  # first two merged (similarity > 0.8)

        # Verify the longer version survived
        kill_event = next(e for e in deduped if "Раскольников" in e["action"])
        assert "топором" in kill_event["action"]


class TestMilestoneFilteringIntegration:
    """Tests the chapter-based filtering that happens in API response."""

    def test_progressive_disclosure(self):
        """Milestones reveal progressively as reader advances."""
        milestones = [
            {
                "up_to_chapter": 1,
                "biography": "Студент",
                "dynamic_role": "Студент",
                "importance": 5,
            },
            {
                "up_to_chapter": 5,
                "biography": "Убийца",
                "dynamic_role": "Убийца",
                "importance": 9,
            },
            {
                "up_to_chapter": 10,
                "biography": "Каторжник",
                "dynamic_role": "Каторжник",
                "importance": 8,
            },
        ]

        # Reader at chapter 1 sees only first milestone
        ch1 = EntityService._get_current_milestone(milestones, current_chapter=1)
        assert ch1["biography"] == "Студент"

        # Reader at chapter 7 sees up_to_chapter=5 milestone
        ch7 = EntityService._get_current_milestone(milestones, current_chapter=7)
        assert ch7["biography"] == "Убийца"

        # Reader at chapter 15 sees last milestone
        ch15 = EntityService._get_current_milestone(milestones, current_chapter=15)
        assert ch15["biography"] == "Каторжник"

    def test_events_filtered_by_chapter(self):
        """Only events up to current chapter are visible."""
        events = [
            {"chapter_number": 1, "action": "Рождается"},
            {"chapter_number": 3, "action": "Идёт в школу"},
            {"chapter_number": 5, "action": "Убивает"},
            {"chapter_number": 10, "action": "Арестован"},
        ]

        ch3_events = EntityService._filter_events_by_chapter(events, current_chapter=3)
        assert len(ch3_events) == 2
        actions = [e["action"] for e in ch3_events]
        assert "Убивает" not in actions

    def test_relationship_evolution_by_chapter(self):
        """Relationship type changes based on reader's chapter."""
        rel_milestones = [
            {"up_to_chapter": 3, "type": "ENEMY", "weight": -60},
            {"up_to_chapter": 8, "type": "RIVAL", "weight": -20},
            {"up_to_chapter": 15, "type": "ALLY", "weight": 70},
        ]

        # At chapter 5, reader sees ENEMY (latest <= 5)
        ch5 = EntityService._get_current_relationship_milestone(
            rel_milestones, current_chapter=5
        )
        assert ch5["type"] == "ENEMY"

        # At chapter 10, reader sees RIVAL
        ch10 = EntityService._get_current_relationship_milestone(
            rel_milestones, current_chapter=10
        )
        assert ch10["type"] == "RIVAL"

        # At chapter 20, reader sees ALLY
        ch20 = EntityService._get_current_relationship_milestone(
            rel_milestones, current_chapter=20
        )
        assert ch20["type"] == "ALLY"


class TestSynthesisPromptConstruction:
    """Tests that prompt is correctly constructed with entity data."""

    def test_prompt_includes_events_per_entity(self):
        """Events are merged into entities_data before prompt generation."""
        entities = [
            {
                "name": "Герцог",
                "type": "character",
                "visual_summary": "Высокий мужчина",
            },
        ]
        events = [
            {
                "entity_name": "Герцог",
                "chapter_number": 1,
                "action": "Входит во дворец",
            },
            {"entity_name": "Герцог", "chapter_number": 3, "action": "Объявляет войну"},
        ]

        # Simulate what synthesize_book_entities does internally
        events_by_entity: dict[str, list] = {}
        for ev in events:
            name = ev.get("entity_name", "").lower()
            if name not in events_by_entity:
                events_by_entity[name] = []
            events_by_entity[name].append(ev)

        entities_data = []
        for e in entities:
            name = e.get("name", "")
            entity_events = events_by_entity.get(name.lower(), [])
            entities_data.append(
                {
                    "name": name,
                    "type": e.get("type", "character"),
                    "visual_summary": e.get("visual_summary", ""),
                    "events": entity_events,
                }
            )

        prompt = EntitySynthesisService._build_synthesis_prompt(
            entities_data=entities_data,
            all_entity_names=["Герцог"],
            genre="FANTASY",
            language="ru",
        )

        assert "Входит во дворец" in prompt
        assert "Объявляет войну" in prompt
        assert "Герцог" in prompt
        assert "FANTASY" in prompt

    def test_prompt_handles_location_type(self):
        """Location entities get type-specific instructions in prompt."""
        prompt = EntitySynthesisService._build_synthesis_prompt(
            entities_data=[
                {
                    "name": "Замок",
                    "type": "location",
                    "visual_summary": "Древний каменный замок",
                    "events": [],
                }
            ],
            all_entity_names=["Замок"],
            genre="FANTASY",
            language="ru",
        )

        assert "location" in prompt
        assert "Замок" in prompt
