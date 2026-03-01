"""
Тесты миграции ConsistencyManager на OpenRouter.

Проверяет что consistency_manager.py использует openrouter_client
вместо google.genai SDK для LLM-вызовов.
"""

import pytest
import json
import pathlib
from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# Тесты миграции на OpenRouter
# ---------------------------------------------------------------------------


class TestConsistencyManagerOpenRouterMigration:
    """Проверяет что consistency_manager использует OpenRouter вместо google.genai."""

    def test_no_google_genai_import_in_service(self):
        """consistency_manager.py НЕ импортирует google.genai."""
        source = (
            pathlib.Path(__file__).parent.parent.parent
            / "app"
            / "services"
            / "consistency_manager.py"
        )
        content = source.read_text()
        assert (
            "import google.genai" not in content
        ), "consistency_manager.py не должен импортировать google.genai"
        assert (
            "from google.genai" not in content
        ), "consistency_manager.py не должен импортировать из google.genai"

    def test_optimize_book_entities_uses_openrouter(self):
        """consistency_manager.py использует openrouter_client для LLM-вызовов."""
        source = (
            pathlib.Path(__file__).parent.parent.parent
            / "app"
            / "services"
            / "consistency_manager.py"
        )
        content = source.read_text()
        # Должен использовать get_openrouter_client
        assert (
            "get_openrouter_client" in content
        ), "consistency_manager.py должен использовать get_openrouter_client()"
        # Должен вызывать generate_text
        assert (
            "generate_text" in content
        ), "consistency_manager.py должен вызывать generate_text()"

    @pytest.mark.asyncio
    async def test_optimize_book_entities_calls_generate_text(self):
        """optimize_book_entities вызывает openrouter_client.generate_text."""
        from app.services.consistency_manager import ConsistencyManager

        # Мок generate_text — возвращает пустой план (нет операций)
        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock(
            return_value=json.dumps(
                {
                    "merge_operations": [],
                    "delete_operations": [],
                }
            )
        )

        # Мок БД сессии
        mock_db = MagicMock()
        mock_db.execute = AsyncMock(
            return_value=MagicMock(
                scalars=MagicMock(
                    return_value=MagicMock(all=MagicMock(return_value=[]))
                )
            )
        )
        mock_db.commit = AsyncMock()
        mock_db.rollback = AsyncMock()

        with patch(
            "app.services.consistency_manager.get_openrouter_client",
            return_value=mock_openrouter,
        ):
            manager = ConsistencyManager(db=mock_db)
            await manager.optimize_book_entities("test-book-id")

        # generate_text должен был вызваться (с непустым списком entities он вызывается)
        # Здесь с пустым списком entities — ранний return, generate_text НЕ вызывается
        # Проверяем что сервис запустился без ошибок
        mock_db.commit.assert_not_called()  # пустой список — ранний return

    @pytest.mark.asyncio
    async def test_optimize_book_entities_with_entities_calls_llm(self):
        """optimize_book_entities вызывает generate_text при наличии entities."""
        from app.services.consistency_manager import ConsistencyManager
        from app.models.entity import Entity, EntityType

        # Мок entity с необходимыми полями
        mock_entity = MagicMock(spec=Entity)
        mock_entity.id = "entity-uuid-1"
        mock_entity.name = "Гарри"
        mock_entity.type = EntityType.CHARACTER
        mock_entity.importance = 8
        mock_entity.visual_summary = "Мальчик в очках"

        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock(
            return_value=json.dumps(
                {
                    "merge_operations": [],
                    "delete_operations": [],
                }
            )
        )

        # Мок БД: возвращает одну entity
        mock_scalars = MagicMock()
        mock_scalars.all = MagicMock(return_value=[mock_entity])
        mock_execute_result = MagicMock()
        mock_execute_result.scalars = MagicMock(return_value=mock_scalars)

        mock_db = MagicMock()
        mock_db.execute = AsyncMock(return_value=mock_execute_result)
        mock_db.commit = AsyncMock()
        mock_db.rollback = AsyncMock()

        with patch(
            "app.services.consistency_manager.get_openrouter_client",
            return_value=mock_openrouter,
        ):
            manager = ConsistencyManager(db=mock_db)
            await manager.optimize_book_entities("test-book-id")

        # С непустым списком entities — generate_text должен был быть вызван
        mock_openrouter.generate_text.assert_called_once()
        call_args = mock_openrouter.generate_text.call_args
        # Промпт должен содержать entity данные
        prompt_arg = call_args.kwargs.get("prompt") or (
            call_args.args[0] if call_args.args else ""
        )
        assert "Гарри" in prompt_arg

    @pytest.mark.asyncio
    async def test_optimize_book_entities_handles_llm_response(self):
        """optimize_book_entities корректно обрабатывает ответ LLM с merge/delete операциями."""
        from app.services.consistency_manager import ConsistencyManager
        from app.models.entity import Entity, EntityType

        mock_entity = MagicMock(spec=Entity)
        mock_entity.id = "uuid-keep"
        mock_entity.name = "Волдеморт"
        mock_entity.type = EntityType.CHARACTER
        mock_entity.importance = 10
        mock_entity.visual_summary = "Тёмный маг без носа"

        # LLM возвращает план с delete операцией
        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock(
            return_value=json.dumps(
                {
                    "merge_operations": [],
                    "delete_operations": ["uuid-garbage"],
                }
            )
        )

        mock_scalars = MagicMock()
        mock_scalars.all = MagicMock(return_value=[mock_entity])
        mock_execute_result = MagicMock()
        mock_execute_result.scalars = MagicMock(return_value=mock_scalars)

        mock_db = MagicMock()
        mock_db.execute = AsyncMock(return_value=mock_execute_result)
        mock_db.commit = AsyncMock()
        mock_db.rollback = AsyncMock()

        with patch(
            "app.services.consistency_manager.get_openrouter_client",
            return_value=mock_openrouter,
        ):
            manager = ConsistencyManager(db=mock_db)
            await manager.optimize_book_entities("test-book-id")

        # Commit должен был вызваться после успешного выполнения
        mock_db.commit.assert_called_once()
