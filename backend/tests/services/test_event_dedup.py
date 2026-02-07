"""Тесты дедупликации событий в ConsistencyManager."""

from app.services.consistency_manager import ConsistencyManager


class TestEventDedup:
    def test_dedup_similar_events(self):
        """Похожие events (>0.8) дедуплицируются, остаётся длинный."""
        events = [
            {"action": "Гарри получает письмо", "inner": None},
            {"action": "Гарри получает письмо из Хогвартса", "inner": None},
        ]
        result = ConsistencyManager._deduplicate_events(events)
        assert len(result) == 1
        assert "Хогвартса" in result[0]["action"]

    def test_keep_different_events(self):
        """Разные events сохраняются."""
        events = [
            {"action": "Гарри получает письмо", "inner": None},
            {"action": "Гарри летит на метле", "inner": None},
        ]
        result = ConsistencyManager._deduplicate_events(events)
        assert len(result) == 2

    def test_empty_events(self):
        """Пустой список."""
        result = ConsistencyManager._deduplicate_events([])
        assert result == []

    def test_single_event(self):
        """Один event — без изменений."""
        events = [{"action": "Появляется", "inner": None}]
        result = ConsistencyManager._deduplicate_events(events)
        assert len(result) == 1

    def test_three_similar_events(self):
        """Три похожих — остаётся один самый длинный."""
        events = [
            {"action": "Родион убивает старуху", "inner": None},
            {"action": "Родион убивает старуху-процентщицу", "inner": None},
            {"action": "Родион убивает старуху-процентщицу топором", "inner": None},
        ]
        result = ConsistencyManager._deduplicate_events(events)
        assert len(result) == 1
        assert "топором" in result[0]["action"]
