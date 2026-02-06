"""
Entity deduplication service tests.

Tests cover:
1. suggest_merges() — less than 2 entities shortcut
2. _prepare_entities() — alias extraction from entity_metadata
3. Mocked Gemini response with merge groups — correct parsing
4. Mocked Gemini empty response — returns no_duplicates_found=True
5. Gemini API error — graceful degradation to no_duplicates_found=True

These are critical paths for the LLM-based entity deduplication system (EC-1.2).
"""

import pytest
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.entity_deduplication_service import (
    EntityDeduplicationService,
    DeduplicationResponse,
    MergeGroup,
    EntityForAnalysis,
)
from app.models.entity import Entity


# =============================================================================
# Fixtures
# =============================================================================


def _make_entity(
    name: str,
    entity_type: str = "character",
    visual_summary: str = None,
    importance: int = 5,
    aliases: list = None,
) -> MagicMock:
    """Helper to create a mock Entity for deduplication tests."""
    entity = MagicMock(spec=Entity)
    entity.id = uuid4()
    entity.name = name
    entity.type = entity_type
    entity.visual_summary = visual_summary
    entity.importance = importance
    entity.entity_metadata = {"aliases": aliases or []}
    return entity


@pytest.fixture
def mock_db():
    """Create a mocked async DB session."""
    return AsyncMock()


@pytest.fixture
def dedup_service(mock_db):
    """Create an EntityDeduplicationService with mocked DB."""
    return EntityDeduplicationService(db=mock_db)


# =============================================================================
# suggest_merges() — Less Than 2 Entities
# =============================================================================


class TestSuggestMergesShortcut:
    """Test the early-exit path when there are fewer than 2 entities."""

    async def test_zero_entities_returns_no_duplicates(self, dedup_service, mock_db):
        """0 entities should return no_duplicates_found=True immediately."""
        # Mock _load_entities to return empty list
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await dedup_service.suggest_merges(book_id=uuid4())

        assert result.no_duplicates_found is True
        assert result.merge_groups == []

    async def test_one_entity_returns_no_duplicates(self, dedup_service, mock_db):
        """1 entity should return no_duplicates_found=True immediately."""
        entity = _make_entity("Гарри Поттер")
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [entity]
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await dedup_service.suggest_merges(book_id=uuid4())

        assert result.no_duplicates_found is True
        assert result.merge_groups == []


# =============================================================================
# _prepare_entities() — Alias Extraction
# =============================================================================


class TestPrepareEntities:
    """Test _prepare_entities correctly extracts aliases from entity_metadata."""

    def test_extracts_aliases_from_metadata(self, dedup_service):
        """Aliases should be extracted from entity_metadata dict."""
        entity = _make_entity(
            "Геральт",
            aliases=["Белый Волк", "Ведьмак", "Мясник из Блавикена"],
        )

        result = dedup_service._prepare_entities([entity])

        assert len(result) == 1
        assert isinstance(result[0], EntityForAnalysis)
        assert result[0].name == "Геральт"
        assert result[0].aliases == ["Белый Волк", "Ведьмак", "Мясник из Блавикена"]

    def test_empty_metadata_returns_empty_aliases(self, dedup_service):
        """Entity with empty metadata should have empty aliases list."""
        entity = _make_entity("Кири")
        entity.entity_metadata = {}

        result = dedup_service._prepare_entities([entity])

        assert result[0].aliases == []

    def test_none_metadata_returns_empty_aliases(self, dedup_service):
        """Entity with None metadata should have empty aliases list."""
        entity = _make_entity("Кири")
        entity.entity_metadata = None

        result = dedup_service._prepare_entities([entity])

        assert result[0].aliases == []

    def test_preserves_entity_fields(self, dedup_service):
        """All entity fields should be correctly mapped."""
        entity = _make_entity(
            "Йеннифэр",
            entity_type="character",
            visual_summary="Черноволосая чародейка с фиолетовыми глазами",
            importance=9,
        )

        result = dedup_service._prepare_entities([entity])

        assert result[0].id == str(entity.id)
        assert result[0].name == "Йеннифэр"
        assert result[0].type == "character"
        assert result[0].visual_summary == "Черноволосая чародейка с фиолетовыми глазами"
        assert result[0].importance == 9

    def test_multiple_entities(self, dedup_service):
        """Multiple entities should all be converted."""
        entities = [
            _make_entity("Геральт", importance=10),
            _make_entity("Йеннифэр", importance=9),
            _make_entity("Цири", importance=8),
        ]

        result = dedup_service._prepare_entities(entities)

        assert len(result) == 3
        names = [e.name for e in result]
        assert "Геральт" in names
        assert "Йеннифэр" in names
        assert "Цири" in names

    def test_default_importance(self, dedup_service):
        """Entity with None importance should default to 5."""
        entity = _make_entity("Безымянный")
        entity.importance = None

        result = dedup_service._prepare_entities([entity])

        assert result[0].importance == 5


# =============================================================================
# Mocked Gemini Response — Merge Groups
# =============================================================================


class TestGeminiMergeResponse:
    """Test parsing of Gemini deduplication responses."""

    async def test_gemini_returns_merge_groups(self, dedup_service, mock_db):
        """Gemini response with merge groups should be correctly parsed."""
        entity1 = _make_entity("Гарри Поттер", importance=10)
        entity2 = _make_entity("Поттер", importance=5)
        entity3 = _make_entity("Дамблдор", importance=8)

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [
            entity1,
            entity2,
            entity3,
        ]
        mock_db.execute = AsyncMock(return_value=mock_result)

        # Mock _call_gemini to return a structured response
        mock_gemini_response = DeduplicationResponse(
            merge_groups=[
                MergeGroup(
                    master_id=str(entity1.id),
                    duplicate_ids=[str(entity2.id)],
                    confidence=0.95,
                    reason="Гарри Поттер и Поттер — один персонаж",
                )
            ],
            no_duplicates_found=False,
        )

        with patch.object(
            dedup_service, "_call_gemini", new_callable=AsyncMock
        ) as mock_call:
            mock_call.return_value = mock_gemini_response

            result = await dedup_service.suggest_merges(book_id=uuid4())

        assert len(result.merge_groups) == 1
        assert result.merge_groups[0].master_id == str(entity1.id)
        assert str(entity2.id) in result.merge_groups[0].duplicate_ids
        assert result.merge_groups[0].confidence == 0.95
        assert result.no_duplicates_found is False

    async def test_gemini_returns_empty_merge_groups(self, dedup_service, mock_db):
        """Gemini empty response should return no_duplicates_found=True."""
        entity1 = _make_entity("Гарри Поттер")
        entity2 = _make_entity("Дамблдор")

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [entity1, entity2]
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_gemini_response = DeduplicationResponse(
            merge_groups=[],
            no_duplicates_found=True,
        )

        with patch.object(
            dedup_service, "_call_gemini", new_callable=AsyncMock
        ) as mock_call:
            mock_call.return_value = mock_gemini_response

            result = await dedup_service.suggest_merges(book_id=uuid4())

        assert result.no_duplicates_found is True
        assert result.merge_groups == []


# =============================================================================
# Gemini API Error — Graceful Degradation
# =============================================================================


class TestGeminiErrorHandling:
    """Test graceful error handling when Gemini API fails."""

    async def test_gemini_api_error_returns_no_duplicates(
        self, dedup_service, mock_db
    ):
        """Gemini API error should gracefully return no_duplicates_found=True."""
        entity1 = _make_entity("Гарри Поттер")
        entity2 = _make_entity("Дамблдор")

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [entity1, entity2]
        mock_db.execute = AsyncMock(return_value=mock_result)

        with patch.object(
            dedup_service, "_call_gemini", new_callable=AsyncMock
        ) as mock_call:
            mock_call.side_effect = Exception("Gemini API rate limit exceeded")

            # Also mock the monitoring functions to avoid import issues
            with patch(
                "app.services.entity_deduplication_service.record_llm_error"
            ):
                result = await dedup_service.suggest_merges(book_id=uuid4())

        assert result.no_duplicates_found is True
        assert result.merge_groups == []

    async def test_gemini_timeout_returns_no_duplicates(
        self, dedup_service, mock_db
    ):
        """Gemini timeout should gracefully return no_duplicates_found=True."""
        entity1 = _make_entity("Гарри Поттер")
        entity2 = _make_entity("Дамблдор")

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [entity1, entity2]
        mock_db.execute = AsyncMock(return_value=mock_result)

        with patch.object(
            dedup_service, "_call_gemini", new_callable=AsyncMock
        ) as mock_call:
            mock_call.side_effect = TimeoutError("Request timed out after 120s")

            with patch(
                "app.services.entity_deduplication_service.record_llm_error"
            ):
                result = await dedup_service.suggest_merges(book_id=uuid4())

        assert result.no_duplicates_found is True

    async def test_gemini_connection_error_returns_no_duplicates(
        self, dedup_service, mock_db
    ):
        """Gemini connection error should gracefully return no_duplicates_found=True."""
        entity1 = _make_entity("Гарри Поттер")
        entity2 = _make_entity("Дамблдор")

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [entity1, entity2]
        mock_db.execute = AsyncMock(return_value=mock_result)

        with patch.object(
            dedup_service, "_call_gemini", new_callable=AsyncMock
        ) as mock_call:
            mock_call.side_effect = ConnectionError("Cannot connect to Gemini API")

            with patch(
                "app.services.entity_deduplication_service.record_llm_error"
            ):
                result = await dedup_service.suggest_merges(book_id=uuid4())

        assert result.no_duplicates_found is True
