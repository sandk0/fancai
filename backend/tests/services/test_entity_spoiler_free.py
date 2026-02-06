"""
Spoiler-free filtering tests for EntityService.

Tests cover:
1. _filter_aliases_by_chapter() — alias visibility based on reading position
2. _process_visual_summary() — visual summary filtering by [Глава N] markers
3. Entity locking — entities not yet met should be hidden

These are critical paths for the entity/glossary spoiler protection system.
"""

import pytest
from uuid import uuid4
from unittest.mock import MagicMock

from app.services.entity_service import EntityService
from app.models.entity import Entity


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def service():
    """Create an EntityService with a mocked DB session."""
    return EntityService(db=MagicMock())


def _make_entity(
    entity_metadata=None,
    aliases_with_reveal=None,
    visual_summary=None,
    first_mention_chapter=None,
    importance=5,
    name="Test Entity",
    entity_type="character",
) -> MagicMock:
    """Helper to create a mock Entity with the given attributes."""
    entity = MagicMock(spec=Entity)
    entity.id = uuid4()
    entity.name = name
    entity.type = entity_type
    entity.visual_summary = visual_summary
    entity.importance = importance
    entity.master_portrait_url = None
    entity.first_mention_chapter = first_mention_chapter
    entity.entity_metadata = entity_metadata if entity_metadata is not None else {}
    entity.aliases_with_reveal = (
        aliases_with_reveal if aliases_with_reveal is not None else []
    )
    return entity


# =============================================================================
# _filter_aliases_by_chapter Tests
# =============================================================================


class TestFilterAliasesByChapter:
    """Tests for EntityService._filter_aliases_by_chapter()."""

    def test_no_aliases_with_reveal_returns_all_metadata_aliases(self, service):
        """Entity with no aliases_with_reveal — should return all aliases from metadata."""
        entity = _make_entity(
            entity_metadata={"aliases": ["Белый Волк", "Ведьмак"]},
            aliases_with_reveal=[],
        )

        # When current_chapter is set but aliases_with_reveal is empty,
        # the method iterates over empty list, so returns empty.
        # But when current_chapter is None, it returns metadata aliases.
        result = service._filter_aliases_by_chapter(entity, current_chapter=None)
        assert result == ["Белый Волк", "Ведьмак"]

    def test_alias_hidden_before_reveal_chapter(self, service):
        """Alias with reveal_chapter=3 should be hidden when current_chapter=2."""
        entity = _make_entity(
            aliases_with_reveal=[
                {"name": "Мальчик-который-выжил", "reveal_chapter": 3},
            ],
        )

        result = service._filter_aliases_by_chapter(entity, current_chapter=2)
        assert result == []

    def test_alias_visible_at_reveal_chapter(self, service):
        """Alias with reveal_chapter=3 should be visible when current_chapter=3."""
        entity = _make_entity(
            aliases_with_reveal=[
                {"name": "Мальчик-который-выжил", "reveal_chapter": 3},
            ],
        )

        result = service._filter_aliases_by_chapter(entity, current_chapter=3)
        assert result == ["Мальчик-который-выжил"]

    def test_alias_visible_after_reveal_chapter(self, service):
        """Alias with reveal_chapter=3 should remain visible at current_chapter=5."""
        entity = _make_entity(
            aliases_with_reveal=[
                {"name": "Мальчик-который-выжил", "reveal_chapter": 3},
            ],
        )

        result = service._filter_aliases_by_chapter(entity, current_chapter=5)
        assert result == ["Мальчик-который-выжил"]

    def test_progressive_reveal_multiple_aliases(self, service):
        """Multiple aliases at different reveal chapters — progressive reveal."""
        entity = _make_entity(
            aliases_with_reveal=[
                {"name": "Гарри", "reveal_chapter": 1},
                {"name": "Мальчик-который-выжил", "reveal_chapter": 3},
                {"name": "Избранный", "reveal_chapter": 7},
            ],
        )

        # At chapter 1: only "Гарри"
        result_ch1 = service._filter_aliases_by_chapter(entity, current_chapter=1)
        assert result_ch1 == ["Гарри"]

        # At chapter 3: "Гарри" + "Мальчик-который-выжил"
        result_ch3 = service._filter_aliases_by_chapter(entity, current_chapter=3)
        assert result_ch3 == ["Гарри", "Мальчик-который-выжил"]

        # At chapter 10: all three
        result_ch10 = service._filter_aliases_by_chapter(entity, current_chapter=10)
        assert len(result_ch10) == 3
        assert "Избранный" in result_ch10

    def test_current_chapter_none_returns_all_metadata_aliases(self, service):
        """current_chapter=None should return all aliases from metadata (no filtering)."""
        entity = _make_entity(
            entity_metadata={"aliases": ["Alias A", "Alias B", "Alias C"]},
            aliases_with_reveal=[
                {"name": "Alias A", "reveal_chapter": 1},
                {"name": "Alias B", "reveal_chapter": 5},
                {"name": "Alias C", "reveal_chapter": 10},
            ],
        )

        result = service._filter_aliases_by_chapter(entity, current_chapter=None)
        # When current_chapter=None, returns metadata aliases (unfiltered)
        assert result == ["Alias A", "Alias B", "Alias C"]

    def test_alias_with_no_reveal_chapter_always_visible(self, service):
        """Alias with reveal_chapter=None should always be visible."""
        entity = _make_entity(
            aliases_with_reveal=[
                {"name": "Всегда видимый", "reveal_chapter": None},
                {"name": "Скрытый до главы 5", "reveal_chapter": 5},
            ],
        )

        result = service._filter_aliases_by_chapter(entity, current_chapter=1)
        assert "Всегда видимый" in result
        assert "Скрытый до главы 5" not in result

    def test_non_dict_alias_data_skipped(self, service):
        """Non-dict items in aliases_with_reveal should be skipped gracefully."""
        entity = _make_entity(
            aliases_with_reveal=[
                "invalid_string_alias",  # Should be skipped
                {"name": "Валидный", "reveal_chapter": 1},
            ],
        )

        result = service._filter_aliases_by_chapter(entity, current_chapter=1)
        assert result == ["Валидный"]

    def test_empty_alias_name_skipped(self, service):
        """Alias with empty name should not be included."""
        entity = _make_entity(
            aliases_with_reveal=[
                {"name": "", "reveal_chapter": 1},
                {"name": "Реальный", "reveal_chapter": 1},
            ],
        )

        result = service._filter_aliases_by_chapter(entity, current_chapter=1)
        assert result == ["Реальный"]

    def test_entity_metadata_not_dict(self, service):
        """When entity_metadata is not a dict and current_chapter=None, return empty."""
        entity = _make_entity(entity_metadata=None)

        result = service._filter_aliases_by_chapter(entity, current_chapter=None)
        assert result == []

    def test_entity_metadata_has_no_aliases_key(self, service):
        """When entity_metadata has no 'aliases' key and current_chapter=None."""
        entity = _make_entity(entity_metadata={"other_key": "value"})

        result = service._filter_aliases_by_chapter(entity, current_chapter=None)
        assert result == []


# =============================================================================
# _process_visual_summary Tests
# =============================================================================


class TestProcessVisualSummary:
    """Tests for EntityService._process_visual_summary() — spoiler-free summaries."""

    def test_none_summary_returns_none(self, service):
        """None visual_summary should return None."""
        result = service._process_visual_summary(None, current_chapter=5)
        assert result is None

    def test_empty_summary_returns_none(self, service):
        """Empty visual_summary should return None."""
        result = service._process_visual_summary("", current_chapter=5)
        assert result is None

    def test_summary_without_markers_returns_full_text(self, service):
        """Summary without [Глава N] markers returns the full text."""
        summary = "Высокий мужчина с белыми волосами и жёлтыми глазами."
        result = service._process_visual_summary(summary, current_chapter=5)
        assert result == summary

    def test_summary_with_future_chapter_marker_filtered(self, service):
        """Summary parts from future chapters should be filtered out."""
        summary = (
            "Высокий мужчина с белыми волосами."
            "\n\n[Глава 3]: Получил шрам на лице."
            "\n\n[Глава 8]: Потерял левый глаз."
        )

        # At chapter 5: base + chapter 3 visible, chapter 8 hidden
        result = service._process_visual_summary(summary, current_chapter=5)
        assert "белыми волосами" in result
        assert "шрам на лице" in result
        assert "левый глаз" not in result

    def test_summary_with_current_chapter_none_shows_all(self, service):
        """current_chapter=None should show all parts of the summary."""
        summary = (
            "Базовое описание."
            "\n\n[Глава 3]: Деталь из главы 3."
            "\n\n[Глава 8]: Деталь из главы 8."
        )

        result = service._process_visual_summary(summary, current_chapter=None)
        assert "Базовое описание" in result
        assert "Деталь из главы 3" in result
        assert "Деталь из главы 8" in result

    def test_summary_chapter_boundary_exact(self, service):
        """Chapter marker at exactly the current chapter should be included."""
        summary = "Базовое описание.[Глава 5]: Обновление из текущей главы."

        result = service._process_visual_summary(summary, current_chapter=5)
        assert "Обновление из текущей главы" in result

    def test_summary_only_base_text_no_markers(self, service):
        """Summary with only base text (no markers) returns base text."""
        summary = "Просто описание без маркеров глав."
        result = service._process_visual_summary(summary, current_chapter=1)
        assert result == summary

    def test_summary_all_markers_in_future(self, service):
        """When all chapter markers are in the future, only base text returned."""
        summary = (
            "Базовое."
            "\n\n[Глава 10]: Будущее 1."
            "\n\n[Глава 20]: Будущее 2."
        )

        result = service._process_visual_summary(summary, current_chapter=1)
        assert result == "Базовое."

    def test_summary_no_base_text_only_future_markers(self, service):
        """When there's no base text and all markers are future, returns None."""
        summary = "[Глава 10]: Только будущее."

        result = service._process_visual_summary(summary, current_chapter=1)
        # The split produces empty base text, and chapter 10 > current 1
        assert result is None


# =============================================================================
# Entity Locking (first_mention_chapter > current_chapter)
# =============================================================================


class TestEntityLocking:
    """Tests for entity locking based on first_mention_chapter."""

    def test_entity_not_yet_met_has_first_mention_chapter(self, service):
        """Entity with first_mention_chapter > current should be lockable by frontend."""
        entity = _make_entity(
            first_mention_chapter=5,
            name="Секретный персонаж",
            visual_summary="Описание персонажа",
        )

        # The _create_merged_detail sets first_mention_chapter in the detail schema.
        # Frontend uses this to decide visibility. Let's verify the field is set correctly.
        detail = service._create_merged_detail(
            master=entity,
            descriptions=[],
            hard_mentions_map={},
            cfi_mentions_map={},
            offset_mentions_map={},
            description_cfi_map={},
            current_chapter=2,
        )

        assert detail.first_mention_chapter == 5
        assert detail.name == "Секретный персонаж"

    def test_entity_already_met(self, service):
        """Entity with first_mention_chapter <= current should be fully visible."""
        entity = _make_entity(
            first_mention_chapter=2,
            name="Известный персонаж",
            visual_summary="Описание",
            entity_metadata={"aliases": ["Прозвище"]},
            aliases_with_reveal=[{"name": "Прозвище", "reveal_chapter": 2}],
        )

        detail = service._create_merged_detail(
            master=entity,
            descriptions=[],
            hard_mentions_map={},
            cfi_mentions_map={},
            offset_mentions_map={},
            description_cfi_map={},
            current_chapter=5,
        )

        assert detail.first_mention_chapter == 2
        assert "Прозвище" in detail.aliases

    def test_entity_with_no_first_mention_chapter(self, service):
        """Entity with first_mention_chapter=None should have None in detail."""
        entity = _make_entity(first_mention_chapter=None)

        detail = service._create_merged_detail(
            master=entity,
            descriptions=[],
            hard_mentions_map={},
            cfi_mentions_map={},
            offset_mentions_map={},
            description_cfi_map={},
            current_chapter=5,
        )

        assert detail.first_mention_chapter is None
