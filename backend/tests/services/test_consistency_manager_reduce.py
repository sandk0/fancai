"""
Тесты рекурсивного batched reduce в ConsistencyManager.

Покрывает:
1. Малый список сущностей (один reduce pass)
2. Большой список (батчевый reduce)
3. Пустой список (ранний return)
4. Merge operations применяются корректно
5. Невалидный JSON — rollback
6. max_depth=2 предотвращает бесконечную рекурсию
7. merge_operations обновляют source/target в EntityRelationship
8. delete_operations удаляют мусорные сущности
"""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services.consistency_manager import ConsistencyManager
from app.models.entity import Entity, EntityType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_entity(name: str, entity_id: str | None = None) -> MagicMock:
    """Create a mock Entity for reduce tests."""
    entity = MagicMock(spec=Entity)
    entity.id = entity_id or str(uuid4())
    entity.name = name
    entity.type = EntityType.CHARACTER
    entity.importance = 5
    entity.visual_summary = f"Description of {name}"
    return entity


def _make_db_returning_entities(entities: list[MagicMock]) -> MagicMock:
    """Create a mock DB session that returns given entities on first execute."""
    mock_db = MagicMock()

    mock_scalars = MagicMock()
    mock_scalars.all = MagicMock(return_value=entities)
    mock_execute_result = MagicMock()
    mock_execute_result.scalars = MagicMock(return_value=mock_scalars)

    mock_db.execute = AsyncMock(return_value=mock_execute_result)
    mock_db.commit = AsyncMock()
    mock_db.rollback = AsyncMock()
    return mock_db


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestBatchedReduceSmallList:
    """10 сущностей — один reduce pass."""

    @pytest.mark.asyncio
    async def test_small_list_single_pass(self):
        """10 сущностей — generate_text вызывается 1 раз."""
        entities = [_make_mock_entity(f"Entity_{i}") for i in range(10)]
        mock_db = _make_db_returning_entities(entities)

        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock(
            return_value=json.dumps({"merge_operations": [], "delete_operations": []})
        )

        with patch(
            "app.services.consistency_manager.get_openrouter_client",
            return_value=mock_openrouter,
        ):
            manager = ConsistencyManager(db=mock_db)
            await manager.optimize_book_entities("test-book-id")

        mock_openrouter.generate_text.assert_called_once()


class TestBatchedReduceLargeList:
    """200 сущностей — батчевый reduce."""

    @pytest.mark.asyncio
    async def test_large_list_batched(self):
        """200 сущностей — generate_text вызывается 4 раза (200/50=4 батча)."""
        entities = [_make_mock_entity(f"Entity_{i}") for i in range(200)]
        mock_db = _make_db_returning_entities(entities)

        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock(
            return_value=json.dumps({"merge_operations": [], "delete_operations": []})
        )

        with patch(
            "app.services.consistency_manager.get_openrouter_client",
            return_value=mock_openrouter,
        ):
            manager = ConsistencyManager(db=mock_db)
            await manager.optimize_book_entities("test-book-id")

        # 200 entities / 50 batch size = 4 batches
        assert mock_openrouter.generate_text.call_count >= 4


class TestBatchedReduceEmptyList:
    """0 сущностей — ранний return."""

    @pytest.mark.asyncio
    async def test_empty_list_early_return(self):
        """0 сущностей — generate_text не вызывается."""
        mock_db = _make_db_returning_entities([])

        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock()

        with patch(
            "app.services.consistency_manager.get_openrouter_client",
            return_value=mock_openrouter,
        ):
            manager = ConsistencyManager(db=mock_db)
            await manager.optimize_book_entities("test-book-id")

        mock_openrouter.generate_text.assert_not_called()


class TestBatchedReduceMergeOps:
    """Merge operations применяются корректно."""

    @pytest.mark.asyncio
    async def test_merge_operations_applied(self):
        """LLM возвращает merge_operations — merges применяются."""
        keep_id = str(uuid4())
        merge_id = str(uuid4())

        entities = [
            _make_mock_entity("Гарри Поттер", entity_id=keep_id),
            _make_mock_entity("Гарри", entity_id=merge_id),
        ]
        mock_db = _make_db_returning_entities(entities)

        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock(
            return_value=json.dumps(
                {
                    "merge_operations": [
                        {
                            "keep_id": keep_id,
                            "merge_ids": [merge_id],
                            "merged_aliases": [
                                {"name": "Гарри", "reveal_chapter": None}
                            ],
                        }
                    ],
                    "delete_operations": [],
                }
            )
        )

        with patch(
            "app.services.consistency_manager.get_openrouter_client",
            return_value=mock_openrouter,
        ):
            manager = ConsistencyManager(db=mock_db)
            await manager.optimize_book_entities("test-book-id")

        # DB execute should have been called for: initial query + source update + target update + delete merged
        # At minimum 4 calls: SELECT + UPDATE source + UPDATE target + DELETE merged
        assert mock_db.execute.call_count >= 4
        mock_db.commit.assert_not_called()


class TestBatchedReduceInvalidJSON:
    """Невалидный JSON гасится разбором, а не транзакцией."""

    @pytest.mark.asyncio
    async def test_invalid_json_does_not_touch_transaction(self):
        """LLM возвращает невалидный JSON — плана нет, исключения нет, транзакция цела."""
        entities = [_make_mock_entity("Test Entity")]
        mock_db = _make_db_returning_entities(entities)

        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock(return_value="NOT VALID JSON {{{}")

        with patch(
            "app.services.consistency_manager.get_openrouter_client",
            return_value=mock_openrouter,
        ):
            manager = ConsistencyManager(db=mock_db)
            await manager.optimize_book_entities("test-book-id")

        # parse_json_safe возвращает None, план пустой — операций нет.
        # Транзакцию сервис не трогает ни в каком исходе: он работает внутри
        # SAVEPOINT'а вызывающего, и commit()/rollback() снял бы этот savepoint.
        mock_db.commit.assert_not_called()
        mock_db.rollback.assert_not_called()


class TestBatchedReduceMaxDepth:
    """max_depth=2 предотвращает бесконечную рекурсию."""

    @pytest.mark.asyncio
    async def test_max_depth_prevents_infinite_recursion(self):
        """При 0 merge operations — список не уменьшается, выход после max_depth итераций."""
        entities = [_make_mock_entity(f"Entity_{i}") for i in range(200)]
        mock_db = _make_db_returning_entities(entities)

        # Return empty operations — list doesn't shrink
        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock(
            return_value=json.dumps({"merge_operations": [], "delete_operations": []})
        )

        with patch(
            "app.services.consistency_manager.get_openrouter_client",
            return_value=mock_openrouter,
        ):
            manager = ConsistencyManager(db=mock_db)
            await manager.optimize_book_entities("test-book-id")

        # With 200 entities and BATCH_SIZE=50, each depth level = 4 calls
        # max_depth=2 means at most 2 * 4 = 8 calls (if list doesn't shrink, loop breaks)
        # But with the no-shrink break, it should stop after the first round (4 calls)
        # because len(entities) >= old_count → break
        assert mock_openrouter.generate_text.call_count <= 8


class TestBatchedReduceDeleteOps:
    """delete_operations удаляют мусорные сущности."""

    @pytest.mark.asyncio
    async def test_delete_operations_executed(self):
        """delete_operations удаляют garbage entities."""
        garbage_id = str(uuid4())
        entities = [
            _make_mock_entity("Гарри Поттер"),
            _make_mock_entity("ааааа", entity_id=garbage_id),
        ]
        mock_db = _make_db_returning_entities(entities)

        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock(
            return_value=json.dumps(
                {
                    "merge_operations": [],
                    "delete_operations": [garbage_id],
                }
            )
        )

        with patch(
            "app.services.consistency_manager.get_openrouter_client",
            return_value=mock_openrouter,
        ):
            manager = ConsistencyManager(db=mock_db)
            await manager.optimize_book_entities("test-book-id")

        # Транзакцией управляет caller — сервис её не трогает.
        mock_db.commit.assert_not_called()
        # execute called for: initial query + delete garbage
        assert mock_db.execute.call_count >= 2


class TestSingleReducePassExtracted:
    """Проверяет что метод _single_reduce_pass извлечён."""

    def test_single_reduce_pass_method_exists(self):
        """ConsistencyManager имеет метод _single_reduce_pass."""
        assert hasattr(
            ConsistencyManager, "_single_reduce_pass"
        ), "ConsistencyManager должен иметь метод _single_reduce_pass"

    def test_execute_reduce_operations_method_exists(self):
        """ConsistencyManager имеет метод _execute_reduce_operations."""
        assert hasattr(
            ConsistencyManager, "_execute_reduce_operations"
        ), "ConsistencyManager должен иметь метод _execute_reduce_operations"


class TestNo300KTruncation:
    """Проверяет что обрезка на 300K символов удалена."""

    def test_no_300000_in_source(self):
        """consistency_manager.py НЕ содержит '300000'."""
        import pathlib

        source = (
            pathlib.Path(__file__).parent.parent.parent
            / "app"
            / "services"
            / "consistency_manager.py"
        )
        content = source.read_text()
        assert (
            "300000" not in content
        ), "consistency_manager.py не должен содержать '300000' (обрезка удалена)"
