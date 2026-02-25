"""Integration tests for Entity concurrent upsert (ON CONFLICT DO UPDATE)."""

import asyncio
import uuid as uuid_module

import pytest
from sqlalchemy import select, func, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.entity import Entity, EntityType


def _make_entity_values(book_id, name="Test Entity", **overrides):
    """Build entity column values for pg_insert."""
    values = {
        "id": uuid_module.uuid4(),
        "book_id": book_id,
        "type": EntityType.CHARACTER.value,
        "name": name,
        "name_lower": name.casefold(),
        "visual_summary": "A test entity",
        "importance": 5,
        "entity_metadata": {"source": "test"},
        "aliases_with_reveal": [{"alias": "Tester", "chapter": 1}],
    }
    values.update(overrides)
    return values


def _build_upsert_stmt(entity_values):
    """Build an upsert statement matching production pattern."""
    stmt = pg_insert(Entity).values(**entity_values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["book_id", "name_lower"],
        set_={
            "entity_metadata": stmt.excluded.entity_metadata,
            "aliases_with_reveal": stmt.excluded.aliases_with_reveal,
            "updated_at": func.now(),
        },
    )
    return stmt


@pytest.mark.asyncio
@pytest.mark.integration
class TestEntityBasicUpsert:
    """Basic ON CONFLICT DO UPDATE behavior."""

    async def test_duplicate_insert_results_in_single_row(self, test_db):
        """Inserting the same entity (book_id + name_lower) twice yields 1 row."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values1 = _make_entity_values(book_id, name="Gandalf")
                await session.execute(_build_upsert_stmt(values1))
                await session.commit()

                values2 = _make_entity_values(book_id, name="Gandalf")
                await session.execute(_build_upsert_stmt(values2))
                await session.commit()

                result = await session.execute(
                    select(func.count())
                    .select_from(Entity)
                    .where(Entity.book_id == book_id)
                )
                count = result.scalar_one()
                assert count == 1, f"Expected 1 row, got {count}"
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()

    async def test_case_insensitive_conflict(self, test_db):
        """Case-insensitive conflict: 'gandalf' and 'GANDALF' yield 1 row."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values1 = _make_entity_values(book_id, name="gandalf")
                await session.execute(_build_upsert_stmt(values1))
                await session.commit()

                values2 = _make_entity_values(book_id, name="GANDALF")
                await session.execute(_build_upsert_stmt(values2))
                await session.commit()

                result = await session.execute(
                    select(func.count())
                    .select_from(Entity)
                    .where(Entity.book_id == book_id)
                )
                count = result.scalar_one()
                assert count == 1, (
                    f"Expected 1 row for case-insensitive match, got {count}"
                )
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()


@pytest.mark.asyncio
@pytest.mark.integration
class TestEntityConcurrentUpsert:
    """Concurrent upsert safety."""

    async def test_concurrent_upserts_result_in_single_row(self, test_db):
        """10 coroutines inserting the same entity simultaneously yields 1 row."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async def upsert_entity(idx: int):
            async with TestSessionLocal() as session:
                values = _make_entity_values(
                    book_id,
                    name="Frodo",
                    entity_metadata={"source": f"worker-{idx}"},
                )
                await session.execute(_build_upsert_stmt(values))
                await session.commit()

        await asyncio.gather(*[upsert_entity(i) for i in range(10)])

        async with TestSessionLocal() as session:
            try:
                result = await session.execute(
                    select(func.count())
                    .select_from(Entity)
                    .where(Entity.book_id == book_id)
                )
                count = result.scalar_one()
                assert count == 1, (
                    f"Expected 1 row after 10 concurrent upserts, got {count}"
                )
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()


@pytest.mark.asyncio
@pytest.mark.integration
class TestEntityConflictUpdate:
    """ON CONFLICT updates the correct fields."""

    async def test_conflict_updates_metadata_and_aliases(self, test_db):
        """Conflict updates entity_metadata and aliases_with_reveal, leaves other fields unchanged."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values1 = _make_entity_values(
                    book_id,
                    name="Aragorn",
                    entity_metadata={"role": "ranger"},
                    aliases_with_reveal=[{"alias": "Strider", "chapter": 1}],
                )
                await session.execute(_build_upsert_stmt(values1))
                await session.commit()

                values2 = _make_entity_values(
                    book_id,
                    name="Aragorn",
                    entity_metadata={"role": "king", "lineage": "Isildur"},
                    aliases_with_reveal=[
                        {"alias": "Strider", "chapter": 1},
                        {"alias": "Elessar", "chapter": 30},
                    ],
                )
                await session.execute(_build_upsert_stmt(values2))
                await session.commit()

                result = await session.execute(
                    select(Entity).where(Entity.book_id == book_id)
                )
                entity = result.scalar_one()

                assert entity.entity_metadata == {
                    "role": "king",
                    "lineage": "Isildur",
                }, f"entity_metadata not updated: {entity.entity_metadata}"

                assert len(entity.aliases_with_reveal) == 2, (
                    f"Expected 2 aliases, got {len(entity.aliases_with_reveal)}"
                )
                alias_names = [a["alias"] for a in entity.aliases_with_reveal]
                assert "Elessar" in alias_names, (
                    f"Expected 'Elessar' in aliases: {alias_names}"
                )

                assert entity.visual_summary == "A test entity", (
                    "visual_summary should remain unchanged after conflict update"
                )
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()


@pytest.mark.asyncio
@pytest.mark.integration
class TestEntityCyrillicUpsert:
    """Cyrillic case-insensitive entity upsert.

    Verifies that name_lower column (Python casefold) provides
    locale-independent case-insensitive matching, unlike PostgreSQL lower()
    which is ASCII-only under locale C.
    """

    async def test_cyrillic_case_insensitive_conflict(self, test_db):
        """Гарри and ГАРРИ must result in a single row."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values1 = _make_entity_values(book_id, name="Гарри")
                await session.execute(_build_upsert_stmt(values1))
                await session.commit()

                values2 = _make_entity_values(book_id, name="ГАРРИ")
                await session.execute(_build_upsert_stmt(values2))
                await session.commit()

                result = await session.execute(
                    select(func.count())
                    .select_from(Entity)
                    .where(Entity.book_id == book_id)
                )
                count = result.scalar_one()
                assert count == 1, (
                    f"Expected 1 row for Cyrillic case-insensitive match, got {count}"
                )
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()

    async def test_cyrillic_name_lower_column(self, test_db):
        """name_lower must contain the casefolded version of name."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values = _make_entity_values(book_id, name="Цервия")
                await session.execute(_build_upsert_stmt(values))
                await session.commit()

                result = await session.execute(
                    select(Entity).where(Entity.book_id == book_id)
                )
                entity = result.scalar_one()
                assert entity.name == "Цервия"
                assert entity.name_lower == "цервия"  # casefold()
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()

    async def test_mixed_script_names(self, test_db):
        """Mixed Latin+Cyrillic names are casefolded correctly."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values = _make_entity_values(book_id, name="Harry-Гарри")
                await session.execute(_build_upsert_stmt(values))
                await session.commit()

                result = await session.execute(
                    select(Entity).where(Entity.book_id == book_id)
                )
                entity = result.scalar_one()
                assert entity.name_lower == "harry-гарри"
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()



    async def test_casefold_expansion_conflict(self, test_db):
        """Stra\u00dfe and STRASSE must collide: casefold('Stra\u00dfe') == 'strasse'."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values1 = _make_entity_values(book_id, name="Stra\u00dfe")
                await session.execute(_build_upsert_stmt(values1))
                await session.commit()

                values2 = _make_entity_values(book_id, name="STRASSE")
                await session.execute(_build_upsert_stmt(values2))
                await session.commit()

                result = await session.execute(
                    select(func.count())
                    .select_from(Entity)
                    .where(Entity.book_id == book_id)
                )
                count = result.scalar_one()
                assert count == 1, (
                    f"Expected 1 row for casefold expansion conflict (Stra\u00dfe vs STRASSE), got {count}"
                )

                # Verify name_lower is 'strasse' for both
                entity_result = await session.execute(
                    select(Entity).where(Entity.book_id == book_id)
                )
                entity = entity_result.scalar_one()
                assert entity.name_lower == "strasse", (
                    f"Expected name_lower='strasse', got '{entity.name_lower}'"
                )
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()

@pytest.mark.asyncio
@pytest.mark.integration
class TestLocaleCSafety:
    """Verify locale C behavior with PostgreSQL lower() vs Python casefold().

    These tests document WHY we use name_lower (Python casefold) instead of
    relying on PostgreSQL lower(). Under locale C, lower() only handles ASCII.
    """

    async def test_pg_lower_cyrillic_is_noop_under_locale_c(self, test_db):
        """PostgreSQL lower() under locale C does NOT lowercase Cyrillic."""
        from tests.conftest import TestSessionLocal

        async with TestSessionLocal() as session:
            result = await session.execute(
                select(
                    func.lower("\u0413\u0410\u0420\u0420\u0418"),  # ГАРРИ
                )
            )
            pg_lower = result.scalar_one()
            # Under locale C, PostgreSQL lower() returns Cyrillic unchanged
            # Under a proper locale (e.g. ru_RU.UTF-8), it would return \u0433\u0430\u0440\u0440\u0438
            # We assert it's either unchanged (locale C) OR properly lowered (other locale)
            # The test documents the behavior rather than requiring a specific locale
            if pg_lower == "\u0413\u0410\u0420\u0420\u0418":
                # locale C: broken for Cyrillic (expected in our production setup)
                assert pg_lower != "\u0433\u0430\u0440\u0440\u0438", (
                    "PostgreSQL lower() should NOT lowercase Cyrillic under locale C"
                )
            else:
                # Other locale: lower() works, but our name_lower approach
                # is still correct and portable
                assert pg_lower == "\u0433\u0430\u0440\u0440\u0438"

    async def test_python_casefold_always_works(self):
        """Python casefold() handles Cyrillic correctly regardless of locale."""
        assert "\u0413\u0410\u0420\u0420\u0418".casefold() == "\u0433\u0430\u0440\u0440\u0438"
        assert "\u0410\u043d\u043d\u0430 \u041a\u0430\u0440\u0435\u043d\u0438\u043d\u0430".casefold() == "\u0430\u043d\u043d\u0430 \u043a\u0430\u0440\u0435\u043d\u0438\u043d\u0430"
        # German sharp s — casefold expands it
        assert "Stra\u00dfe".casefold() == "strasse"
        # Turkish dotted I — casefold handles it
        assert "\u0130stanbul".casefold() == "i\u0307stanbul"

    async def test_pg_lower_latin_works_under_locale_c(self, test_db):
        """PostgreSQL lower() under locale C DOES work for ASCII Latin."""
        from tests.conftest import TestSessionLocal

        async with TestSessionLocal() as session:
            result = await session.execute(
                select(func.lower("GANDALF"))
            )
            pg_lower = result.scalar_one()
            assert pg_lower == "gandalf", (
                f"PostgreSQL lower() should work for ASCII: got {pg_lower}"
            )


@pytest.mark.asyncio
@pytest.mark.integration
class TestRollbackSafety:
    """Verify safe patterns for accessing ORM objects after rollback.

    After session.rollback(), all ORM objects are expired. In async context,
    accessing expired attributes triggers MissingGreenlet because lazy loading
    requires a sync greenlet. These tests verify the 'capture scalar early' pattern.
    """

    async def test_scalar_captured_before_rollback_survives(self, test_db):
        """Scalar values captured before rollback remain accessible."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values = _make_entity_values(book_id, name="\u0422\u0435\u0441\u0442")
                await session.execute(_build_upsert_stmt(values))
                await session.commit()

                result = await session.execute(
                    select(Entity).where(Entity.book_id == book_id)
                )
                entity = result.scalar_one()

                # Capture scalar BEFORE rollback — this is the safe pattern
                entity_id = entity.id
                entity_name = entity.name

                await session.rollback()

                # Captured scalars are still accessible after rollback
                assert entity_id is not None
                assert entity_name == "\u0422\u0435\u0441\u0442"

                # Re-fetch using captured ID — safe pattern for continued work
                entity_fresh = await session.get(Entity, entity_id)
                assert entity_fresh is not None
                assert entity_fresh.name == "\u0422\u0435\u0441\u0442"
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()

    async def test_fresh_query_after_rollback_works(self, test_db):
        """Fresh queries after rollback return valid, non-expired objects."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values = _make_entity_values(book_id, name="\u041f\u0435\u0440\u0441\u043e\u043d\u0430\u0436")
                await session.execute(_build_upsert_stmt(values))
                await session.commit()

                # Simulate a failed operation
                try:
                    # Insert duplicate to trigger conflict, then rollback
                    raise ValueError("Simulated error")
                except ValueError:
                    await session.rollback()

                # After rollback, a fresh query should work fine
                result = await session.execute(
                    select(Entity).where(Entity.book_id == book_id)
                )
                entity = result.scalar_one()
                assert entity.name == "\u041f\u0435\u0440\u0441\u043e\u043d\u0430\u0436"
                assert entity.name_lower == "\u043f\u0435\u0440\u0441\u043e\u043d\u0430\u0436"
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()