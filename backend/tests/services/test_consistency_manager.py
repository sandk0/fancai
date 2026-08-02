"""
Тесты ConsistencyManager.

Покрывает:
1. Миграция на OpenRouter (старые тесты)
2. Token overlap fix (>= 0.5) — _resolve_entity_advanced с русскими именами
3. Advisory locks — _acquire_entity_lock
4. LLM dedup threshold (>= 0.75 вместо 0.85)
"""

import pytest
import json
import asyncio
import hashlib
import pathlib
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.consistency_manager import ConsistencyManager
from app.models.entity import Entity, EntityType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_entity(name: str, aliases: list[str] | None = None) -> MagicMock:
    """Create a mock Entity with the necessary attributes for _resolve_entity_advanced."""
    entity = MagicMock(spec=Entity)
    entity.name = name
    entity.name_lower = name.casefold()
    entity.entity_metadata = {"aliases": aliases or []}
    return entity


def _build_existing(entities: list[MagicMock]) -> dict[str, MagicMock]:
    """Build existing_entities dict (keyed by casefold name) from a list of mock entities."""
    return {e.name_lower: e for e in entities}


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
        assert (
            "get_openrouter_client" in content
        ), "consistency_manager.py должен использовать get_openrouter_client()"
        assert (
            "generate_text" in content
        ), "consistency_manager.py должен вызывать generate_text()"

    @pytest.mark.asyncio
    async def test_optimize_book_entities_calls_generate_text(self):
        """optimize_book_entities вызывает openrouter_client.generate_text."""
        mock_openrouter = MagicMock()
        mock_openrouter.generate_text = AsyncMock(
            return_value=json.dumps(
                {
                    "merge_operations": [],
                    "delete_operations": [],
                }
            )
        )

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

        mock_db.commit.assert_not_called()  # пустой список — ранний return

    @pytest.mark.asyncio
    async def test_optimize_book_entities_with_entities_calls_llm(self):
        """optimize_book_entities вызывает generate_text при наличии entities."""
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

        mock_openrouter.generate_text.assert_called_once()
        call_args = mock_openrouter.generate_text.call_args
        prompt_arg = call_args.kwargs.get("prompt") or (
            call_args.args[0] if call_args.args else ""
        )
        assert "Гарри" in prompt_arg

    @pytest.mark.asyncio
    async def test_optimize_book_entities_leaves_transaction_to_caller(self):
        """optimize_book_entities отрабатывает план LLM и не трогает транзакцию."""
        mock_entity = MagicMock(spec=Entity)
        mock_entity.id = "uuid-keep"
        mock_entity.name = "Волдеморт"
        mock_entity.type = EntityType.CHARACTER
        mock_entity.importance = 10
        mock_entity.visual_summary = "Тёмный маг без носа"

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

        # Транзакцией управляет caller: фаза идёт внутри его SAVEPOINT,
        # и собственный commit()/rollback() сервиса снял бы этот savepoint.
        mock_db.commit.assert_not_called()
        mock_db.rollback.assert_not_called()


# ---------------------------------------------------------------------------
# Task 1: Token overlap fix тесты
# ---------------------------------------------------------------------------


class TestTokenOverlapFix:
    """Проверяет что >= 0.5 threshold ловит частичные русские имена."""

    def setup_method(self):
        """Создаёт ConsistencyManager без реальной БД для unit-тестов _resolve."""
        self.manager = ConsistencyManager(db=MagicMock())

    def test_garry_resolves_to_garry_potter(self):
        """'Гарри' (1 токен) матчит 'Гарри Поттер' (2 токена) — overlap=1/2=0.5, >= 0.5."""
        potter = _make_entity("Гарри Поттер")
        existing = _build_existing([potter])
        result = self.manager._resolve_entity_advanced("Гарри", existing)
        assert result is potter

    def test_ron_resolves_to_ron_weasley(self):
        """'Рон' матчит 'Рон Уизли' — overlap=1/2=0.5, >= 0.5."""
        weasley = _make_entity("Рон Уизли")
        existing = _build_existing([weasley])
        result = self.manager._resolve_entity_advanced("Рон", existing)
        assert result is weasley

    def test_natasha_resolves_to_natasha_rostova(self):
        """'Наташа' матчит 'Наташа Ростова' — overlap=1/2=0.5, >= 0.5."""
        rostova = _make_entity("Наташа Ростова")
        existing = _build_existing([rostova])
        result = self.manager._resolve_entity_advanced("Наташа", existing)
        assert result is rostova

    def test_knyaz_andrei_not_resolves_to_knyaginya_anna(self):
        """'Князь Андрей' НЕ матчит 'Княгиня Анна' — нет общих токенов."""
        anna = _make_entity("Княгиня Анна")
        existing = _build_existing([anna])
        result = self.manager._resolve_entity_advanced("Князь Андрей", existing)
        assert result is None


# ---------------------------------------------------------------------------
# Task 1: _resolve_entity_advanced — полный набор тестов
# ---------------------------------------------------------------------------


class TestResolveEntityAdvanced:
    """Полный набор тестов для _resolve_entity_advanced."""

    def setup_method(self):
        self.manager = ConsistencyManager(db=MagicMock())

    def test_hermione_resolves_via_sequence_matcher(self):
        """'Гермиона' матчит 'Гермионы' через SequenceMatcher (0.875 > 0.75)."""
        hermione = _make_entity("Гермионы")
        existing = _build_existing([hermione])
        result = self.manager._resolve_entity_advanced("Гермиона", existing)
        assert result is hermione

    def test_dumbledore_resolves_via_sequence_matcher(self):
        """'Дамблдор' матчит 'Дамблдору' через SequenceMatcher."""
        dumbledore = _make_entity("Дамблдору")
        existing = _build_existing([dumbledore])
        result = self.manager._resolve_entity_advanced("Дамблдор", existing)
        assert result is dumbledore

    def test_exact_match_found_first(self):
        """Точное совпадение по name_lower находится первым."""
        harry = _make_entity("Гарри")
        potter = _make_entity("Гарри Поттер")
        existing = _build_existing([harry, potter])
        result = self.manager._resolve_entity_advanced("Гарри", existing)
        assert result is harry  # exact match, not token overlap

    def test_alias_match_found(self):
        """Совпадение по aliases находится."""
        entity = _make_entity("Гарри Поттер", aliases=["Избранный"])
        existing = _build_existing([entity])
        result = self.manager._resolve_entity_advanced("Избранный", existing)
        assert result is entity

    def test_no_match_returns_none(self):
        """Нет совпадений — возвращается None."""
        entity = _make_entity("Гарри Поттер")
        existing = _build_existing([entity])
        result = self.manager._resolve_entity_advanced("Саурон", existing)
        assert result is None


# ---------------------------------------------------------------------------
# Task 1: Advisory locks тесты
# ---------------------------------------------------------------------------


class TestAdvisoryLocks:
    """Тесты _acquire_entity_lock."""

    @pytest.mark.asyncio
    async def test_lock_generates_correct_int_key(self):
        """advisory lock генерирует корректный int ключ из book_id + entity_name."""
        mock_db = MagicMock()
        mock_db.execute = AsyncMock()
        manager = ConsistencyManager(db=mock_db)

        await manager._acquire_entity_lock("book-123", "Гарри Поттер")

        mock_db.execute.assert_called_once()
        call_args = mock_db.execute.call_args
        params = (
            call_args[0][1]
            if len(call_args[0]) > 1
            else call_args.kwargs.get("params", {})
        )

        expected_key = int(
            hashlib.sha256("book-123:гарри поттер".encode()).hexdigest()[:15],
            16,
        )
        assert params["key"] == expected_key

    @pytest.mark.asyncio
    async def test_concurrent_locks_no_race(self):
        """Два конкурентных вызова _acquire_entity_lock генерируют разные ключи."""
        mock_db = MagicMock()
        mock_db.execute = AsyncMock()
        manager = ConsistencyManager(db=mock_db)

        await asyncio.gather(
            manager._acquire_entity_lock("book-123", "Гарри"),
            manager._acquire_entity_lock("book-123", "Рон"),
        )

        assert mock_db.execute.call_count == 2
        calls = mock_db.execute.call_args_list
        key1 = calls[0][0][1]["key"]
        key2 = calls[1][0][1]["key"]
        assert key1 != key2, "Разные entity_name должны генерировать разные ключи"


# ---------------------------------------------------------------------------
# Task 1: LLM dedup threshold тесты
# ---------------------------------------------------------------------------


class TestLLMDedupThreshold:
    """Проверяет что порог LLM dedup снижен до >= 0.75."""

    def test_threshold_075_in_source(self):
        """book_tasks.py содержит group.confidence >= 0.75."""
        source = (
            pathlib.Path(__file__).parent.parent.parent
            / "app"
            / "tasks"
            / "book_tasks.py"
        )
        content = source.read_text()
        assert (
            "group.confidence >= 0.75" in content
        ), "book_tasks.py должен содержать 'group.confidence >= 0.75' (снижено с 0.85)"

    def test_threshold_085_not_in_source(self):
        """book_tasks.py НЕ содержит group.confidence >= 0.85."""
        source = (
            pathlib.Path(__file__).parent.parent.parent
            / "app"
            / "tasks"
            / "book_tasks.py"
        )
        content = source.read_text()
        assert (
            "group.confidence >= 0.85" not in content
        ), "book_tasks.py не должен содержать 'group.confidence >= 0.85' (старый порог)"
