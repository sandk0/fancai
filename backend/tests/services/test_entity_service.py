import pytest
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.entity_service import EntityService
from app.models.entity import Entity
from app.models.entity_relationship import EntityRelationship
from app.models.description import Description
from app.models.chapter import Chapter
from app.schemas.responses.entities import EntityNetworkResponse


class TestEntityServiceNormalizeName:
    def test_normalize_name_lowercase(self):
        service = EntityService(db=MagicMock())
        assert service._normalize_name("GERALT") == "geralt"

    def test_normalize_name_strips_whitespace(self):
        service = EntityService(db=MagicMock())
        assert service._normalize_name("  Geralt  ") == "geralt"

    def test_normalize_name_replaces_yo(self):
        service = EntityService(db=MagicMock())
        assert service._normalize_name("Ёлка") == "елка"

    def test_normalize_name_empty_string(self):
        service = EntityService(db=MagicMock())
        assert service._normalize_name("") == ""

    def test_normalize_name_none(self):
        service = EntityService(db=MagicMock())
        assert service._normalize_name(None) == ""


class TestEntityServiceGetEarliestCfi:
    def test_get_earliest_cfi_empty_list(self):
        service = EntityService(db=MagicMock())
        assert service._get_earliest_cfi([]) is None

    def test_get_earliest_cfi_single_item(self):
        service = EntityService(db=MagicMock())
        cfi_list = ["epubcfi(/6/4!/4/2:100)"]
        assert service._get_earliest_cfi(cfi_list) == "epubcfi(/6/4!/4/2:100)"

    def test_get_earliest_cfi_multiple_items(self):
        service = EntityService(db=MagicMock())
        cfi_list = [
            "epubcfi(/6/10!/4/2:100)",
            "epubcfi(/6/4!/4/2:50)",
            "epubcfi(/6/8!/4/2:200)",
        ]
        assert service._get_earliest_cfi(cfi_list) == "epubcfi(/6/4!/4/2:50)"

    def test_get_earliest_cfi_invalid_format(self):
        service = EntityService(db=MagicMock())
        cfi_list = ["invalid_cfi", "epubcfi(/6/4!/4/2:100)"]
        result = service._get_earliest_cfi(cfi_list)
        assert result == "epubcfi(/6/4!/4/2:100)"


class TestEntityServiceBuildNetworkResponse:
    def test_build_network_response_empty_entities(self):
        service = EntityService(db=MagicMock())
        response = service._build_network_response(
            entities=[],
            edges=[],
            hard_mentions_map={},
            cfi_mentions_map={},
            offset_mentions_map={},
            entity_to_descriptions={},
            description_cfi_map={},
        )
        assert response.entities == {}
        assert response.edges == []

    def test_build_network_response_single_entity(self):
        service = EntityService(db=MagicMock())

        entity_id = uuid4()
        entity = MagicMock(spec=Entity)
        entity.id = entity_id
        entity.name = "Geralt"
        entity.type = "character"
        entity.visual_summary = "White-haired witcher"
        entity.importance = 10
        entity.master_portrait_url = None
        entity.entity_metadata = {"aliases": []}
        entity.first_mention_chapter = None
        entity.aliases_with_reveal = []

        response = service._build_network_response(
            entities=[entity],
            edges=[],
            hard_mentions_map={entity_id: {1, 2, 3}},
            cfi_mentions_map={entity_id: ["epubcfi(/6/4!/4/2:100)"]},
            offset_mentions_map={entity_id: [100, 200, 300]},
            entity_to_descriptions={},
            description_cfi_map={},
        )

        assert entity_id in response.entities
        detail = response.entities[entity_id]
        assert detail.name == "Geralt"
        assert detail.type == "character"
        assert detail.mentions == [1, 2, 3]
        assert detail.first_mention_offset == 100

    def test_build_network_response_merges_duplicate_entities(self):
        service = EntityService(db=MagicMock())

        entity1_id = uuid4()
        entity1 = MagicMock(spec=Entity)
        entity1.id = entity1_id
        entity1.name = "Geralt"
        entity1.type = "character"
        entity1.visual_summary = "White-haired witcher"
        entity1.importance = 10
        entity1.master_portrait_url = None
        entity1.entity_metadata = {"aliases": ["White Wolf"]}
        entity1.first_mention_chapter = None
        entity1.aliases_with_reveal = []

        entity2_id = uuid4()
        entity2 = MagicMock(spec=Entity)
        entity2.id = entity2_id
        entity2.name = "Geralt"
        entity2.type = "character"
        entity2.visual_summary = None
        entity2.importance = 5
        entity2.master_portrait_url = None
        entity2.entity_metadata = {}
        entity2.first_mention_chapter = None
        entity2.aliases_with_reveal = []

        response = service._build_network_response(
            entities=[entity1, entity2],
            edges=[],
            hard_mentions_map={},
            cfi_mentions_map={},
            offset_mentions_map={},
            entity_to_descriptions={},
            description_cfi_map={},
        )

        assert len(response.entities) == 1
        master_entity = list(response.entities.values())[0]
        assert master_entity.visual_summary == "White-haired witcher"

    def test_build_network_response_with_edges(self):
        service = EntityService(db=MagicMock())

        entity1_id = uuid4()
        entity1 = MagicMock(spec=Entity)
        entity1.id = entity1_id
        entity1.name = "Geralt"
        entity1.type = "character"
        entity1.visual_summary = None
        entity1.importance = 5
        entity1.master_portrait_url = None
        entity1.entity_metadata = {}
        entity1.first_mention_chapter = None
        entity1.aliases_with_reveal = []

        entity2_id = uuid4()
        entity2 = MagicMock(spec=Entity)
        entity2.id = entity2_id
        entity2.name = "Yennefer"
        entity2.type = "character"
        entity2.visual_summary = None
        entity2.importance = 5
        entity2.master_portrait_url = None
        entity2.entity_metadata = {}
        entity2.first_mention_chapter = None
        entity2.aliases_with_reveal = []

        edge = MagicMock(spec=EntityRelationship)
        edge.source_id = entity1_id
        edge.target_id = entity2_id
        edge.type = "friend"
        edge.weight = 5
        edge.relationship_metadata = {"context": "They are companions"}
        edge.first_interaction_cfi = None

        response = service._build_network_response(
            entities=[entity1, entity2],
            edges=[edge],
            hard_mentions_map={},
            cfi_mentions_map={},
            offset_mentions_map={},
            entity_to_descriptions={},
            description_cfi_map={},
        )

        assert len(response.edges) == 1
        assert response.edges[0].type == "friend"
        assert response.edges[0].description == "They are companions"


class TestEntityServiceCreateMergedDetail:
    def test_create_merged_detail_basic(self):
        service = EntityService(db=MagicMock())

        entity_id = uuid4()
        entity = MagicMock(spec=Entity)
        entity.id = entity_id
        entity.name = "Kaer Morhen"
        entity.type = "location"
        entity.visual_summary = "Ancient witcher fortress"
        entity.importance = 8
        entity.master_portrait_url = "http://example.com/kaer.jpg"
        entity.first_mention_chapter = None
        entity.aliases_with_reveal = []
        entity.entity_metadata = {}

        detail = service._create_merged_detail(
            master=entity,
            descriptions=[],
            hard_mentions_map={entity_id: {1, 2}},
            cfi_mentions_map={entity_id: ["epubcfi(/6/4!/4/2:100)"]},
            offset_mentions_map={entity_id: [100]},
            description_cfi_map={},
        )

        assert detail.name == "Kaer Morhen"
        assert detail.type == "location"
        assert detail.avatar_url == "http://example.com/kaer.jpg"
        assert detail.first_mention_offset == 100
        assert detail.mentions == [1, 2]

    def test_create_merged_detail_with_descriptions(self):
        service = EntityService(db=MagicMock())

        entity_id = uuid4()
        entity = MagicMock(spec=Entity)
        entity.id = entity_id
        entity.name = "Kaer Morhen"
        entity.type = "location"
        entity.visual_summary = None
        entity.importance = 5
        entity.master_portrait_url = None
        entity.first_mention_chapter = None
        entity.aliases_with_reveal = []
        entity.entity_metadata = {}

        chapter = MagicMock(spec=Chapter)
        chapter.chapter_number = 3

        description = MagicMock(spec=Description)
        description.id = uuid4()
        description.content = "The ancient fortress stood tall"
        description.chapter = chapter
        description.type = MagicMock()
        description.type.value = "location"

        detail = service._create_merged_detail(
            master=entity,
            descriptions=[description],
            hard_mentions_map={},
            cfi_mentions_map={},
            offset_mentions_map={},
            description_cfi_map={},
        )

        assert len(detail.notes) == 1
        assert detail.notes[0].text == "The ancient fortress stood tall"
        assert detail.notes[0].chapter_index == 3
        assert 3 in detail.mentions


@pytest.mark.asyncio
class TestEntityServiceGetBookEntityNetwork:
    async def test_get_book_entity_network_returns_cached_data(self):
        mock_db = AsyncMock()
        service = EntityService(db=mock_db)

        book_id = uuid4()
        cached_response = {"entities": {}, "edges": []}

        with patch("app.services.entity_service.cache_manager") as mock_cache:
            mock_cache.get = AsyncMock(return_value=cached_response)

            result = await service.get_book_entity_network(book_id)

            assert isinstance(result, EntityNetworkResponse)
            mock_cache.get.assert_called_once()

    async def test_get_book_entity_network_loads_from_db_on_cache_miss(self):
        mock_db = AsyncMock()

        mock_entities_result = MagicMock()
        mock_entities_result.scalars.return_value.all.return_value = []

        mock_descriptions_result = MagicMock()
        mock_descriptions_result.scalars.return_value.all.return_value = []

        mock_mentions_result = MagicMock()
        mock_mentions_result.all.return_value = []

        mock_desc_entities_result = MagicMock()
        mock_desc_entities_result.all.return_value = []

        mock_edges_result = MagicMock()
        mock_edges_result.scalars.return_value.all.return_value = []

        mock_db.execute = AsyncMock(
            side_effect=[
                mock_entities_result,
                mock_descriptions_result,
                mock_desc_entities_result,
                mock_mentions_result,
                mock_edges_result,
            ]
        )

        service = EntityService(db=mock_db)
        book_id = uuid4()

        with patch("app.services.entity_service.cache_manager") as mock_cache:
            mock_cache.get = AsyncMock(return_value=None)
            mock_cache.set = AsyncMock()

            result = await service.get_book_entity_network(book_id)

            assert isinstance(result, EntityNetworkResponse)
            assert result.entities == {}
            assert result.edges == []
