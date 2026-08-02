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

def _build_production_upsert_stmt(entity_values):
    """Upsert-statement, идентичный production-коду consistency_manager.py.

    Включает:
    - LEAST(COALESCE(...)) для first_mention_chapter
    - COALESCE для visual_summary
    - DISTINCT ON merge для aliases_with_reveal внутри COALESCE над агрегатом

    Держать посимвольно синхронным с `consistency_manager._batch_resolve_entities`:
    разошедшийся дубль проверяет не production-поведение, а сам себя.
    """
    from sqlalchemy import text as sa_text

    stmt = pg_insert(Entity).values(**entity_values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["book_id", "name_lower"],
        set_={
            "first_mention_chapter": func.least(
                func.coalesce(
                    Entity.first_mention_chapter,
                    stmt.excluded.first_mention_chapter,
                ),
                func.coalesce(
                    stmt.excluded.first_mention_chapter,
                    Entity.first_mention_chapter,
                ),
            ),
            "visual_summary": func.coalesce(
                Entity.visual_summary, stmt.excluded.visual_summary
            ),
            "entity_metadata": stmt.excluded.entity_metadata,
            "aliases_with_reveal": sa_text(
                "(SELECT COALESCE(jsonb_agg(alias), '[]'::jsonb) "
                " FROM ("
                "   SELECT DISTINCT ON (alias->>'name') alias"
                "   FROM jsonb_array_elements("
                "     COALESCE(entities.aliases_with_reveal, '[]'::jsonb)"
                "     || COALESCE(excluded.aliases_with_reveal, '[]'::jsonb)"
                "   ) AS alias"
                "   ORDER BY alias->>'name',"
                "     CASE WHEN alias->>'reveal_chapter' IS NULL THEN -1"
                "          ELSE (alias->>'reveal_chapter')::int"
                "     END ASC"
                " ) merged)"
            ),
            "updated_at": func.now(),
        },
    )
    return stmt


@pytest.mark.asyncio
@pytest.mark.integration
class TestConflictAliasesMerge:
    """Тесты слияния aliases_with_reveal при ON CONFLICT (P2-1).

    Два параллельных воркера могут вставлять одну и ту же сущность
    с разными псевдонимами из разных глав. ON CONFLICT должен
    объединять массивы, а не заменять один другим.
    """

    async def test_конфликт_объединяет_псевдонимы_из_двух_глав(self, test_db):
        """Глава 1 и Глава 5 видят одну сущность с разными псевдонимами — оба сохраняются."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                # Глава 1 вставляет сущность с псевдонимом "Мальчик-который-выжил"
                values1 = _make_entity_values(
                    book_id, name="Гарри",
                    first_mention_chapter=1,
                    aliases_with_reveal=[
                        {"name": "Мальчик-который-выжил", "reveal_chapter": 1}
                    ],
                )
                await session.execute(_build_production_upsert_stmt(values1))
                await session.commit()

                # Глава 5 попадает в ON CONFLICT с другим псевдонимом "Избранный"
                values2 = _make_entity_values(
                    book_id, name="Гарри",
                    first_mention_chapter=5,
                    aliases_with_reveal=[
                        {"name": "Избранный", "reveal_chapter": 5}
                    ],
                )
                await session.execute(_build_production_upsert_stmt(values2))
                await session.commit()

                result = await session.execute(
                    select(Entity).where(
                        Entity.book_id == book_id,
                        Entity.name_lower == "гарри",
                    )
                )
                entity = result.scalar_one()
                alias_names = {a["name"] for a in entity.aliases_with_reveal}

                assert "Мальчик-который-выжил" in alias_names, (
                    "Псевдоним из первого INSERT потерян при ON CONFLICT"
                )
                assert "Избранный" in alias_names, (
                    "Псевдоним из второго INSERT (ON CONFLICT) не добавлен"
                )
                # first_mention_chapter должен быть минимальным
                assert entity.first_mention_chapter == 1
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()

    async def test_конфликт_дедуплицирует_одинаковые_имена_псевдонимов(self, test_db):
        """Одинаковое имя псевдонима из двух глав — сохраняем с минимальным reveal_chapter."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values1 = _make_entity_values(
                    book_id, name="Волдеморт",
                    aliases_with_reveal=[
                        {"name": "Тот-кого-нельзя-называть", "reveal_chapter": 3}
                    ],
                )
                await session.execute(_build_production_upsert_stmt(values1))
                await session.commit()

                # Тот же псевдоним, но из более поздней главы — должен взять reveal_chapter=3
                values2 = _make_entity_values(
                    book_id, name="Волдеморт",
                    aliases_with_reveal=[
                        {"name": "Тот-кого-нельзя-называть", "reveal_chapter": 7}
                    ],
                )
                await session.execute(_build_production_upsert_stmt(values2))
                await session.commit()

                result = await session.execute(
                    select(Entity).where(
                        Entity.book_id == book_id,
                        Entity.name_lower == "волдеморт",
                    )
                )
                entity = result.scalar_one()
                alias_names = [a["name"] for a in entity.aliases_with_reveal]
                alias_chapters = {
                    a["name"]: a["reveal_chapter"]
                    for a in entity.aliases_with_reveal
                }

                assert alias_names.count("Тот-кого-нельзя-называть") == 1, (
                    "Дубликат псевдонима не был дедуплицирован"
                )
                assert alias_chapters["Тот-кого-нельзя-называть"] == 3, (
                    "Должен быть сохранён минимальный reveal_chapter=3, а не 7"
                )
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()

    async def test_конфликт_сохраняет_псевдоним_без_главы_раскрытия(self, test_db):
        """Псевдоним с reveal_chapter=None (всегда видимый) сохраняется при слиянии."""
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values1 = _make_entity_values(
                    book_id, name="Арагорн",
                    aliases_with_reveal=[
                        {"name": "Бродяжник", "reveal_chapter": None}
                    ],
                )
                await session.execute(_build_production_upsert_stmt(values1))
                await session.commit()

                values2 = _make_entity_values(
                    book_id, name="Арагорн",
                    aliases_with_reveal=[
                        {"name": "Наследник Исильдура", "reveal_chapter": 10}
                    ],
                )
                await session.execute(_build_production_upsert_stmt(values2))
                await session.commit()

                result = await session.execute(
                    select(Entity).where(
                        Entity.book_id == book_id,
                        Entity.name_lower == "арагорн",
                    )
                )
                entity = result.scalar_one()
                alias_names = {a["name"] for a in entity.aliases_with_reveal}

                assert "Бродяжник" in alias_names
                assert "Наследник Исильдура" in alias_names
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()

    async def test_конфликт_без_псевдонимов_не_нарушает_NOT_NULL(self, test_db):
        """Обе стороны без псевдонимов: агрегат по пустому набору даёт NULL.

        Колонка `aliases_with_reveal` объявлена NOT NULL, поэтому без
        `COALESCE` над `jsonb_agg` вторая глава падала бы
        `NotNullViolationError` и терялась целиком.
        """
        from tests.conftest import TestSessionLocal

        book_id = uuid_module.uuid4()

        async with TestSessionLocal() as session:
            try:
                values1 = _make_entity_values(
                    book_id, name="Безымянный", aliases_with_reveal=[]
                )
                await session.execute(_build_production_upsert_stmt(values1))
                await session.commit()

                values2 = _make_entity_values(
                    book_id, name="Безымянный", aliases_with_reveal=[]
                )
                await session.execute(_build_production_upsert_stmt(values2))
                await session.commit()

                result = await session.execute(
                    select(Entity).where(
                        Entity.book_id == book_id,
                        Entity.name_lower == "безымянный",
                    )
                )
                entity = result.scalar_one()

                assert entity.aliases_with_reveal == [], (
                    "Пустое объединение обязано дать [], а не NULL"
                )
            finally:
                await session.execute(delete(Entity).where(Entity.book_id == book_id))
                await session.commit()
