"""
Property-based тесты спойлер-фильтрации EntityService (Hypothesis).

Математически доказывают инварианты:
1. Milestones из будущих глав НИКОГДА не утекают
2. Events из будущих глав НИКОГДА не утекают
3. Aliases из будущих глав НИКОГДА не утекают
4. Relationship milestones из будущих глав НИКОГДА не утекают
5. Монотонность: больше прочитанных глав = больше или равно видимых данных
"""

import pytest
from hypothesis import given, assume, settings
from hypothesis import strategies as st

from app.services.entity_service import EntityService

# =============================================================================
# Стратегии генерации данных
# =============================================================================

milestone_strategy = st.fixed_dictionaries(
    {
        "up_to_chapter": st.integers(min_value=0, max_value=200),
        "biography": st.text(min_size=1, max_size=50),
        "dynamic_role": st.text(min_size=1, max_size=30),
        "visual_summary_clean": st.text(min_size=1, max_size=50),
    }
)

event_strategy = st.fixed_dictionaries(
    {
        "chapter_number": st.integers(min_value=0, max_value=200),
        "event_action": st.text(min_size=1, max_size=50),
        "event_inner_state": st.one_of(st.none(), st.text(max_size=50)),
    }
)

alias_strategy = st.fixed_dictionaries(
    {
        "name": st.text(min_size=1, max_size=30),
        "reveal_chapter": st.one_of(st.none(), st.integers(min_value=0, max_value=200)),
    }
)

relationship_milestone_strategy = st.fixed_dictionaries(
    {
        "up_to_chapter": st.integers(min_value=0, max_value=200),
        "description": st.text(min_size=1, max_size=50),
    }
)


# =============================================================================
# Инвариант 1: _get_current_milestone -- milestones не утекают из будущих глав
# =============================================================================


class TestMilestoneNeverLeaksFuture:
    """Property-based: milestone из будущей главы НИКОГДА не возвращается."""

    @given(
        milestones=st.lists(milestone_strategy, min_size=0, max_size=20),
        current_chapter=st.integers(min_value=0, max_value=200),
    )
    @settings(max_examples=500, database=None)
    def test_milestone_never_leaks_future(self, milestones, current_chapter):
        """Если milestone возвращен, его up_to_chapter <= current_chapter."""
        result = EntityService._get_current_milestone(milestones, current_chapter)
        if result is not None:
            assert result["up_to_chapter"] <= current_chapter

    @given(
        milestones=st.lists(milestone_strategy, min_size=1, max_size=20),
        current_chapter=st.integers(min_value=0, max_value=200),
    )
    @settings(max_examples=500, database=None)
    def test_milestone_is_max_valid(self, milestones, current_chapter):
        """Возвращенный milestone -- максимальный из допустимых."""
        result = EntityService._get_current_milestone(milestones, current_chapter)
        valid = [m for m in milestones if m["up_to_chapter"] <= current_chapter]
        if valid:
            assert result is not None
            expected_max = max(valid, key=lambda m: m["up_to_chapter"])
            assert result["up_to_chapter"] == expected_max["up_to_chapter"]
        else:
            assert result is None


# =============================================================================
# Инвариант 2: _filter_events_by_chapter -- events не утекают из будущих глав
# =============================================================================


class TestEventsNeverLeakFuture:
    """Property-based: events из будущих глав НИКОГДА не включаются."""

    @given(
        events=st.lists(event_strategy, min_size=0, max_size=30),
        current_chapter=st.integers(min_value=0, max_value=200),
    )
    @settings(max_examples=500, database=None)
    def test_events_never_leak_future(self, events, current_chapter):
        """Все отфильтрованные events имеют chapter_number <= current_chapter."""
        result = EntityService._filter_events_by_chapter(events, current_chapter)
        for event in result:
            assert event["chapter_number"] <= current_chapter

    @given(
        events=st.lists(event_strategy, min_size=0, max_size=30),
        current_chapter=st.integers(min_value=0, max_value=200),
    )
    @settings(max_examples=500, database=None)
    def test_events_include_all_valid(self, events, current_chapter):
        """Все events с chapter_number <= current_chapter включены в результат."""
        result = EntityService._filter_events_by_chapter(events, current_chapter)
        expected_count = sum(
            1 for e in events if e["chapter_number"] <= current_chapter
        )
        assert len(result) == expected_count


# =============================================================================
# Инвариант 3: _filter_aliases_from_raw -- aliases не утекают из будущих глав
# =============================================================================


class TestAliasesNeverLeakFuture:
    """Property-based: aliases с reveal_chapter из будущего НИКОГДА не видны."""

    @given(
        aliases=st.lists(alias_strategy, min_size=0, max_size=20),
        current_chapter=st.integers(min_value=0, max_value=200),
    )
    @settings(max_examples=500, database=None)
    def test_aliases_never_leak_future(self, aliases, current_chapter):
        """Каждый видимый alias имеет хотя бы один источник с reveal_chapter <= current или None.

        Имя может появиться в результатах из-за другого alias-entry с тем же именем,
        поэтому проверяем: для каждого имени в результатах существует хотя бы одна
        запись с допустимым reveal_chapter.
        """
        result = EntityService._filter_aliases_from_raw(aliases, current_chapter)
        for name in result:
            # Найти все alias-entries с этим именем
            entries = [a for a in aliases if a.get("name") == name]
            assert any(
                a.get("reveal_chapter") is None
                or a.get("reveal_chapter") <= current_chapter
                for a in entries
            ), f"Alias '{name}' visible but no valid source entry found"

    @given(
        aliases=st.lists(alias_strategy, min_size=0, max_size=20),
        current_chapter=st.integers(min_value=0, max_value=200),
    )
    @settings(max_examples=500, database=None)
    def test_aliases_include_all_valid(self, aliases, current_chapter):
        """Все aliases с reveal_chapter <= current или None включены (если name непустой)."""
        result = EntityService._filter_aliases_from_raw(aliases, current_chapter)
        for alias_data in aliases:
            name = alias_data.get("name", "")
            reveal = alias_data.get("reveal_chapter")
            if name and (reveal is None or reveal <= current_chapter):
                assert name in result


# =============================================================================
# Инвариант 4: _get_current_relationship_milestone -- relationship milestones
# =============================================================================


class TestRelationshipMilestoneNeverLeaksFuture:
    """Property-based: relationship milestone из будущей главы не утекает."""

    @given(
        milestones=st.lists(relationship_milestone_strategy, min_size=0, max_size=20),
        current_chapter=st.integers(min_value=0, max_value=200),
    )
    @settings(max_examples=500, database=None)
    def test_relationship_milestone_never_leaks_future(
        self, milestones, current_chapter
    ):
        """Если milestone возвращен, его up_to_chapter <= current_chapter."""
        result = EntityService._get_current_relationship_milestone(
            milestones, current_chapter
        )
        if result is not None:
            assert result["up_to_chapter"] <= current_chapter

    @given(
        milestones=st.lists(relationship_milestone_strategy, min_size=1, max_size=20),
        current_chapter=st.integers(min_value=0, max_value=200),
    )
    @settings(max_examples=500, database=None)
    def test_relationship_milestone_is_max_valid(self, milestones, current_chapter):
        """Возвращенный relationship milestone -- максимальный из допустимых."""
        result = EntityService._get_current_relationship_milestone(
            milestones, current_chapter
        )
        valid = [m for m in milestones if m["up_to_chapter"] <= current_chapter]
        if valid:
            assert result is not None
            expected_max = max(valid, key=lambda m: m["up_to_chapter"])
            assert result["up_to_chapter"] == expected_max["up_to_chapter"]
        else:
            assert result is None


# =============================================================================
# Инвариант 5: Монотонность -- больше глав => больше или равно данных
# =============================================================================


class TestMonotonicity:
    """Property-based: прогресс чтения монотонно увеличивает видимые данные."""

    @given(
        events=st.lists(event_strategy, min_size=0, max_size=30),
        ch_a=st.integers(min_value=0, max_value=100),
        ch_b=st.integers(min_value=0, max_value=100),
    )
    @settings(max_examples=500, database=None)
    def test_events_monotonic(self, events, ch_a, ch_b):
        """Больше прочитанных глав => больше или равно видимых events."""
        assume(ch_a <= ch_b)
        result_a = EntityService._filter_events_by_chapter(events, ch_a)
        result_b = EntityService._filter_events_by_chapter(events, ch_b)
        assert len(result_a) <= len(result_b)

    @given(
        aliases=st.lists(alias_strategy, min_size=0, max_size=20),
        ch_a=st.integers(min_value=0, max_value=100),
        ch_b=st.integers(min_value=0, max_value=100),
    )
    @settings(max_examples=500, database=None)
    def test_aliases_monotonic(self, aliases, ch_a, ch_b):
        """Больше прочитанных глав => больше или равно видимых aliases."""
        assume(ch_a <= ch_b)
        result_a = EntityService._filter_aliases_from_raw(aliases, ch_a)
        result_b = EntityService._filter_aliases_from_raw(aliases, ch_b)
        assert len(result_a) <= len(result_b)

    @given(
        milestones=st.lists(milestone_strategy, min_size=0, max_size=20),
        ch_a=st.integers(min_value=0, max_value=100),
        ch_b=st.integers(min_value=0, max_value=100),
    )
    @settings(max_examples=500, database=None)
    def test_milestone_monotonic_presence(self, milestones, ch_a, ch_b):
        """Если milestone виден на главе A, он виден и на главе B >= A."""
        assume(ch_a <= ch_b)
        result_a = EntityService._get_current_milestone(milestones, ch_a)
        result_b = EntityService._get_current_milestone(milestones, ch_b)
        if result_a is not None:
            assert result_b is not None
