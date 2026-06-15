"""
Task A2.2 — Verify that entity dedup and synthesis route through get_ai_provider.

These tests fail BEFORE the swap (get_openrouter_client still in the module)
and pass AFTER the swap (get_ai_provider imported instead).
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.entity_synthesis_service import EntitySynthesisService
from app.services.entity_deduplication_service import (
    EntityDeduplicationService,
    EntityForAnalysis,
    DeduplicationResponse,
)


class TestSynthesisUsesAIProvider:
    @pytest.mark.asyncio
    async def test_synthesis_routes_through_ai_provider(self):
        """_call_gemini in EntitySynthesisService must call get_ai_provider, not get_openrouter_client."""
        expected = {"entities": [], "relationship_milestones": []}

        mock_client = MagicMock()
        mock_client.generate_text = AsyncMock(return_value=json.dumps(expected))

        with patch(
            "app.services.entity_synthesis_service.get_ai_provider",
            return_value=mock_client,
        ):
            service = EntitySynthesisService()
            result = await service._call_gemini("test prompt")

        assert result == expected
        mock_client.generate_text.assert_called_once()

    @pytest.mark.asyncio
    async def test_synthesis_no_openrouter_client_import(self):
        """entity_synthesis_service must NOT import get_openrouter_client."""
        import app.services.entity_synthesis_service as mod

        assert not hasattr(
            mod, "get_openrouter_client"
        ), "get_openrouter_client must be removed from entity_synthesis_service"


class TestDeduplicationUsesAIProvider:
    @pytest.mark.asyncio
    async def test_deduplication_routes_through_ai_provider(self):
        """_call_gemini in EntityDeduplicationService must call get_ai_provider, not get_openrouter_client."""
        mock_client = AsyncMock()
        mock_client.generate_structured = AsyncMock(
            return_value={"merge_groups": [], "no_duplicates_found": True}
        )

        entities = [
            EntityForAnalysis(id="1", name="Геральт", type="character"),
            EntityForAnalysis(id="2", name="Белый Волк", type="character"),
        ]

        with patch(
            "app.services.entity_deduplication_service.get_ai_provider",
            return_value=mock_client,
        ):
            db = AsyncMock()
            service = EntityDeduplicationService(db=db)
            result = await service._call_gemini(entities)

        mock_client.generate_structured.assert_called_once()
        assert isinstance(result, DeduplicationResponse)

    @pytest.mark.asyncio
    async def test_deduplication_no_openrouter_client_import(self):
        """entity_deduplication_service must NOT import get_openrouter_client."""
        import app.services.entity_deduplication_service as mod

        assert not hasattr(
            mod, "get_openrouter_client"
        ), "get_openrouter_client must be removed from entity_deduplication_service"
