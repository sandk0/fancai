"""Reduce-фаза обязана ходить через `get_ai_provider()`, а не в OpenRouter.

Регрессия, ради которой файл существует: `_single_reduce_pass()` годами звал
`get_openrouter_client()` напрямую, минуя фабрику. На проде это означало,
что при `AI_PROVIDER=gemini` reduce всё равно уходил в OpenRouter — платили
двум провайдерам сразу, а переключение флага не давало обещанного эффекта.
Найдено чтением живого прода 2026-08-05.

Тест защищает наблюдаемый контракт: единственный внешний вызов фазы идёт
через фабрику, и в модуле не остаётся прямой ссылки на OpenRouter.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.entity import Entity, EntityType
from app.services import consistency_manager as cm
from app.services.consistency_manager import ConsistencyManager


def _entity(name: str) -> MagicMock:
    """Сущность в том же виде, что в `test_consistency_manager_reduce.py`."""
    entity = MagicMock(spec=Entity)
    entity.id = f"id-{name}"
    entity.name = name
    entity.type = EntityType.CHARACTER
    entity.importance = 5
    entity.visual_summary = f"{name} выглядит внушительно"
    return entity


@pytest.mark.asyncio
async def test_reduce_pass_routes_through_provider_factory():
    """Единственный LLM-вызов reduce идёт через `get_ai_provider()`."""
    with patch("app.services.consistency_manager.get_ai_provider") as gp:
        gp.return_value.generate_text = AsyncMock(return_value='{"merge": []}')

        # Сессия здесь не участвует: фаза формирует промпт и разбирает
        # ответ, а записи в БД делает вызывающий код.
        plan = await ConsistencyManager(db=MagicMock())._single_reduce_pass(
            [_entity("Геральт"), _entity("Ведьмак")]
        )

    assert gp.return_value.generate_text.await_count == 1
    _, kwargs = gp.return_value.generate_text.call_args
    # Промпт и системная инструкция должны доехать до провайдера как есть:
    # без них фаза попросит модель о чём угодно, только не о слиянии.
    assert "merge" in kwargs["prompt"].lower()
    assert "json" in kwargs["system_prompt"].lower()
    assert plan == {"merge": []}


def test_module_has_no_direct_openrouter_reference():
    """В модуле не остаётся собственной двери в OpenRouter мимо фабрики."""
    assert not hasattr(cm, "get_openrouter_client")
