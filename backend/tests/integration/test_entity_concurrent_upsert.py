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
        index_elements=["book_id", func.lower(Entity.__table__.c.name)],
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
        """Inserting the same entity (book_id + lower(name)) twice yields 1 row."""
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
