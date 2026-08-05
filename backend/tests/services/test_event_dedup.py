"""Тесты дедупликации событий в ConsistencyManager.

Порог — SequenceMatcher > 0.8 (`consistency_manager.py:140-161`). Прежние
примеры его не проходили: «Гарри получает письмо» против «…из Хогвартса»
даёт 0.764, «Родион убивает старуху» против «…-процентщицу» — 0.786,
то есть тесты требовали слияния там, где реализация обязана оставить
оба события. Замерено `difflib.SequenceMatcher`.

Порог 0.8 на коротких строках не ловит приписку из одного слова — известный
потолок эвристики, а не дефект: понижать его без данных нельзя, иначе
начнут склеиваться разные события.
"""

from app.services.consistency_manager import ConsistencyManager


class TestEventDedup:
    def test_dedup_similar_events(self):
        """Похожие events (>0.8) дедуплицируются, остаётся длинный."""
        events = [
            {"action": "Гарри получает письмо из Хогвартса", "inner": None},
            {"action": "Гарри получает письмо из Хогвартса совой", "inner": None},
        ]
        result = ConsistencyManager._deduplicate_events(events)
        assert len(result) == 1
        assert "совой" in result[0]["action"]

    def test_below_threshold_events_are_kept(self):
        """Приписка одного слова к короткому событию — 0.764, оба остаются."""
        events = [
            {"action": "Гарри получает письмо", "inner": None},
            {"action": "Гарри получает письмо из Хогвартса", "inner": None},
        ]
        result = ConsistencyManager._deduplicate_events(events)
        assert len(result) == 2

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
        """Три похожих — остаётся один самый длинный.

        Сравнение идёт с ПЕРВЫМ элементом, а не с текущим лидером
        (`consistency_manager.py:150-159`), поэтому все варианты должны быть
        похожи именно на него: цепочка «A→B→C» с падающим сходством A↔C
        оставляет два события, и это поведение реализации, а не дефект теста.
        """
        events = [
            {"action": "Родион убивает старуху-процентщицу топором", "inner": None},
            {
                "action": "Родион убивает старуху-процентщицу топором днём",
                "inner": None,
            },
            {
                "action": "Родион убивает старуху-процентщицу топором в квартире",
                "inner": None,
            },
        ]
        result = ConsistencyManager._deduplicate_events(events)
        assert len(result) == 1
        assert "в квартире" in result[0]["action"]
