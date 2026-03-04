"""
Тесты спойлерной фильтрации EntityService.

Покрывают:
1. _filter_aliases_from_raw() — видимость псевдонимов по позиции чтения
2. _process_visual_summary() — фильтрация visual_summary по маркерам [Глава N]
3. _filter_entity_detail() — передача first_mention_chapter в схему
4. _get_current_milestone() — выбор актуального milestone по главе
5. _filter_events_by_chapter() — фильтрация событий по главе
6. notes spoiler marking — пометка заметок из будущих глав как спойлер
7. _filter_edge_detail() — фильтрация описания связей по relationship milestones
8. Граничные случаи — глава 0, None, max+1, пустые данные

Критические пути системы антиспойлеров глоссария сущностей.
"""

import pytest
from uuid import uuid4
from unittest.mock import MagicMock

from app.services.entity_service import EntityService
from app.models.entity import Entity

# =============================================================================
# Fixtures и хелперы
# =============================================================================


@pytest.fixture
def service():
    """Создать EntityService с замоканной сессией БД."""
    return EntityService(db=MagicMock())


def _make_entity(
    entity_metadata=None,
    aliases_with_reveal=None,
    visual_summary=None,
    first_mention_chapter=None,
    importance=5,
    name="Тестовая сущность",
    entity_type="character",
) -> MagicMock:
    """Хелпер: создать мок Entity с заданными атрибутами."""
    entity = MagicMock(spec=Entity)
    entity.id = uuid4()
    entity.name = name
    entity.type = entity_type
    entity.visual_summary = visual_summary
    entity.importance = importance
    entity.master_portrait_url = None
    entity.first_mention_chapter = first_mention_chapter
    entity.entity_metadata = entity_metadata if entity_metadata is not None else {}
    entity.aliases_with_reveal = (
        aliases_with_reveal if aliases_with_reveal is not None else []
    )
    entity.biography_milestones = None
    entity.base_role = None
    return entity


def _make_detail_data(
    entity: MagicMock,
    all_aliases: list = None,
    notes: list = None,
    events: list = None,
    biography_milestones: list = None,
) -> dict:
    """Построить минимальный dict в формате RAW-кеша из мок-сущности для _filter_entity_detail."""
    meta = entity.entity_metadata or {}
    computed_aliases = (
        all_aliases
        if all_aliases is not None
        else (meta.get("aliases", []) if isinstance(meta, dict) else [])
    )
    return {
        "id": str(entity.id),
        "name": entity.name,
        "type": entity.type,
        "importance": entity.importance,
        "first_mention_chapter": entity.first_mention_chapter,
        "first_mention_cfi": None,
        "first_mention_offset": None,
        "avatar_url": None,
        "base_role": None,
        "mentions": [],
        "notes": notes if notes is not None else [],
        "_aliases_with_reveal": entity.aliases_with_reveal or [],
        "_all_aliases": computed_aliases,
        "_all_events": events if events is not None else [],
        "_biography_milestones": biography_milestones,
        "_raw_visual_summary": entity.visual_summary,
    }


def _make_edge_data(
    source_id=None,
    target_id=None,
    edge_type="ally",
    weight=5,
    context=None,
    relationship_milestones=None,
    first_interaction_chapter=None,
) -> dict:
    """Построить минимальный dict в формате RAW-кеша для _filter_edge_detail."""
    return {
        "source": str(source_id or uuid4()),
        "target": str(target_id or uuid4()),
        "type": edge_type,
        "weight": weight,
        "_context": context,
        "_relationship_milestones": relationship_milestones,
        "first_interaction_cfi": None,
        "first_interaction_chapter": first_interaction_chapter,
    }


# =============================================================================
# _filter_aliases_from_raw — тесты
# =============================================================================


class TestFilterAliasesFromRaw:
    """Тесты для EntityService._filter_aliases_from_raw() — видимость псевдонимов по главе.

    _filter_aliases_from_raw(aliases_with_reveal, current_chapter) — @staticmethod,
    принимает список raw псевдонимов и целый номер главы.

    Путь current_chapter=None обрабатывается на уровне _filter_entity_detail
    (возвращает _all_aliases из кеша) — тестируется отдельно.
    """

    def test_пустой_список_возвращает_пустой_результат(self, service):
        """Пустой список псевдонимов → пустой результат."""
        result = EntityService._filter_aliases_from_raw([], current_chapter=1)
        assert result == []

    def test_псевдоним_скрыт_до_главы_раскрытия(self, service):
        """Псевдоним с reveal_chapter=3 скрыт при current_chapter=2."""
        aliases_with_reveal = [{"name": "Мальчик-который-выжил", "reveal_chapter": 3}]

        result = EntityService._filter_aliases_from_raw(
            aliases_with_reveal, current_chapter=2
        )
        assert result == []

    def test_псевдоним_виден_в_главе_раскрытия(self, service):
        """Псевдоним с reveal_chapter=3 виден при current_chapter=3."""
        aliases_with_reveal = [{"name": "Мальчик-который-выжил", "reveal_chapter": 3}]

        result = EntityService._filter_aliases_from_raw(
            aliases_with_reveal, current_chapter=3
        )
        assert result == ["Мальчик-который-выжил"]

    def test_псевдоним_виден_после_главы_раскрытия(self, service):
        """Псевдоним с reveal_chapter=3 остаётся видимым при current_chapter=5."""
        aliases_with_reveal = [{"name": "Мальчик-который-выжил", "reveal_chapter": 3}]

        result = EntityService._filter_aliases_from_raw(
            aliases_with_reveal, current_chapter=5
        )
        assert result == ["Мальчик-который-выжил"]

    def test_прогрессивное_раскрытие_нескольких_псевдонимов(self, service):
        """Несколько псевдонимов с разными главами раскрытия — прогрессивное раскрытие."""
        aliases_with_reveal = [
            {"name": "Гарри", "reveal_chapter": 1},
            {"name": "Мальчик-который-выжил", "reveal_chapter": 3},
            {"name": "Избранный", "reveal_chapter": 7},
        ]

        # Глава 1: только «Гарри»
        result_ch1 = EntityService._filter_aliases_from_raw(
            aliases_with_reveal, current_chapter=1
        )
        assert result_ch1 == ["Гарри"]

        # Глава 3: «Гарри» + «Мальчик-который-выжил»
        result_ch3 = EntityService._filter_aliases_from_raw(
            aliases_with_reveal, current_chapter=3
        )
        assert result_ch3 == ["Гарри", "Мальчик-который-выжил"]

        # Глава 10: все три
        result_ch10 = EntityService._filter_aliases_from_raw(
            aliases_with_reveal, current_chapter=10
        )
        assert len(result_ch10) == 3
        assert "Избранный" in result_ch10

    def test_псевдоним_без_главы_раскрытия_всегда_виден(self, service):
        """Псевдоним с reveal_chapter=None всегда виден."""
        aliases_with_reveal = [
            {"name": "Всегда видимый", "reveal_chapter": None},
            {"name": "Скрытый до главы 5", "reveal_chapter": 5},
        ]

        result = EntityService._filter_aliases_from_raw(
            aliases_with_reveal, current_chapter=1
        )
        assert "Всегда видимый" in result
        assert "Скрытый до главы 5" not in result

    def test_не_dict_элемент_пропускается(self, service):
        """Не-dict элементы в aliases_with_reveal пропускаются без ошибок."""
        aliases_with_reveal = [
            "невалидная_строка",  # должна быть пропущена
            {"name": "Валидный", "reveal_chapter": 1},
        ]

        result = EntityService._filter_aliases_from_raw(
            aliases_with_reveal, current_chapter=1
        )
        assert result == ["Валидный"]

    def test_пустое_имя_псевдонима_пропускается(self, service):
        """Псевдонимы с пустым именем пропускаются."""
        aliases_with_reveal = [
            {"name": "", "reveal_chapter": 1},
            {"name": "Настоящее имя", "reveal_chapter": 1},
        ]

        result = EntityService._filter_aliases_from_raw(
            aliases_with_reveal, current_chapter=1
        )
        assert result == ["Настоящее имя"]

    def test_current_chapter_none_через_filter_entity_detail_возвращает_все(
        self, service
    ):
        """current_chapter=None в _filter_entity_detail возвращает все псевдонимы."""
        entity = _make_entity(
            entity_metadata={
                "aliases": ["Белый Волк", "Ведьмак", "Мясник из Блавикена"]
            },
            aliases_with_reveal=[
                {"name": "Белый Волк", "reveal_chapter": 1},
                {"name": "Ведьмак", "reveal_chapter": 3},
                {"name": "Мясник из Блавикена", "reveal_chapter": 8},
            ],
        )
        data = _make_detail_data(
            entity,
            all_aliases=["Белый Волк", "Ведьмак", "Мясник из Блавикена"],
        )

        detail = service._filter_entity_detail(data, current_chapter=None)

        assert detail.aliases == ["Белый Волк", "Ведьмак", "Мясник из Блавикена"]

    def test_нет_метаданных_и_chapter_none_возвращает_пустой(self, service):
        """Нет предвычисленных псевдонимов + current_chapter=None → пустой список."""
        entity = _make_entity(entity_metadata=None, aliases_with_reveal=[])
        data = _make_detail_data(entity, all_aliases=[])

        detail = service._filter_entity_detail(data, current_chapter=None)

        assert detail.aliases == []


# =============================================================================
# _process_visual_summary — тесты
# =============================================================================


class TestProcessVisualSummary:
    """Тесты для EntityService._process_visual_summary() — спойлерно-безопасные описания."""

    def test_none_возвращает_none(self, service):
        """None visual_summary → None."""
        result = service._process_visual_summary(None, current_chapter=5)
        assert result is None

    def test_пустая_строка_возвращает_none(self, service):
        """Пустой visual_summary → None."""
        result = service._process_visual_summary("", current_chapter=5)
        assert result is None

    def test_описание_без_маркеров_возвращается_полностью(self, service):
        """Описание без маркеров [Глава N] возвращается целиком."""
        summary = "Высокий мужчина с белыми волосами и жёлтыми глазами кошки."
        result = service._process_visual_summary(summary, current_chapter=5)
        assert result == summary

    def test_части_из_будущих_глав_отфильтровываются(self, service):
        """Части описания из будущих глав должны быть скрыты."""
        summary = (
            "Высокий мужчина с белыми волосами."
            "\n\n[Глава 3]: Получил шрам на лице."
            "\n\n[Глава 8]: Потерял левый глаз."
        )

        # Глава 5: базовый текст + глава 3 видны, глава 8 скрыта
        result = service._process_visual_summary(summary, current_chapter=5)
        assert "белыми волосами" in result
        assert "шрам на лице" in result
        assert "левый глаз" not in result

    def test_current_chapter_none_показывает_всё(self, service):
        """current_chapter=None показывает все части описания."""
        summary = (
            "Базовое описание."
            "\n\n[Глава 3]: Деталь из главы 3."
            "\n\n[Глава 8]: Деталь из главы 8."
        )

        result = service._process_visual_summary(summary, current_chapter=None)
        assert "Базовое описание" in result
        assert "Деталь из главы 3" in result
        assert "Деталь из главы 8" in result

    def test_маркер_текущей_главы_включается(self, service):
        """Маркер точно на текущей главе должен быть включён."""
        summary = "Базовое описание.[Глава 5]: Обновление из текущей главы."

        result = service._process_visual_summary(summary, current_chapter=5)
        assert "Обновление из текущей главы" in result

    def test_только_базовый_текст_без_маркеров(self, service):
        """Описание только с базовым текстом (без маркеров) возвращается как есть."""
        summary = "Просто описание без маркеров глав."
        result = service._process_visual_summary(summary, current_chapter=1)
        assert result == summary

    def test_все_маркеры_в_будущем_возвращает_только_базу(self, service):
        """Если все маркеры в будущем — возвращается только базовый текст."""
        summary = "Базовое." "\n\n[Глава 10]: Будущее 1." "\n\n[Глава 20]: Будущее 2."

        result = service._process_visual_summary(summary, current_chapter=1)
        assert result == "Базовое."

    def test_нет_базового_текста_только_маркеры_будущего_возвращает_none(self, service):
        """Нет базового текста + все маркеры в будущем → None."""
        summary = "[Глава 10]: Только будущее."

        result = service._process_visual_summary(summary, current_chapter=1)
        assert result is None


# =============================================================================
# _filter_entity_detail — передача first_mention_chapter в схему
# =============================================================================


class TestFirstMentionChapterPropagation:
    """Тесты: first_mention_chapter корректно передаётся в EntityDetailSchema.

    Фронтенд использует это поле для блокировки/скрытия сущностей,
    которые читатель ещё не встретил.
    """

    def test_first_mention_chapter_сохраняется_для_непрочитанной_сущности(
        self, service
    ):
        """first_mention_chapter=5 сохраняется в схеме при current_chapter=2."""
        entity = _make_entity(
            first_mention_chapter=5,
            name="Секретный персонаж",
            visual_summary="Описание персонажа",
        )
        data = _make_detail_data(entity)

        detail = service._filter_entity_detail(data, current_chapter=2)

        assert detail.first_mention_chapter == 5
        assert detail.name == "Секретный персонаж"

    def test_first_mention_chapter_сохраняется_для_прочитанной_сущности(self, service):
        """first_mention_chapter <= current: сущность полностью видима."""
        entity = _make_entity(
            first_mention_chapter=2,
            name="Известный персонаж",
            visual_summary="Описание",
            entity_metadata={"aliases": ["Прозвище"]},
            aliases_with_reveal=[{"name": "Прозвище", "reveal_chapter": 2}],
        )
        data = _make_detail_data(entity)

        detail = service._filter_entity_detail(data, current_chapter=5)

        assert detail.first_mention_chapter == 2
        assert "Прозвище" in detail.aliases

    def test_first_mention_chapter_none_передаётся_как_none(self, service):
        """first_mention_chapter=None сохраняется в схеме как None."""
        entity = _make_entity(first_mention_chapter=None)
        data = _make_detail_data(entity)

        detail = service._filter_entity_detail(data, current_chapter=5)

        assert detail.first_mention_chapter is None


# =============================================================================
# _get_current_milestone — тесты
# =============================================================================


class TestGetCurrentMilestone:
    """Тесты для EntityService._get_current_milestone() — выбор актуального milestone."""

    def test_пустой_список_возвращает_none(self):
        """Пустой список milestones -> None."""
        result = EntityService._get_current_milestone([], current_chapter=5)
        assert result is None

    def test_none_вход_возвращает_none(self):
        """None вместо списка milestones -> None."""
        result = EntityService._get_current_milestone(None, current_chapter=5)
        assert result is None

    def test_все_в_будущем_возвращает_none(self):
        """Все milestones в будущих главах -> None."""
        milestones = [
            {"up_to_chapter": 10, "biography": "Био 10"},
            {"up_to_chapter": 20, "biography": "Био 20"},
        ]
        result = EntityService._get_current_milestone(milestones, current_chapter=5)
        assert result is None

    def test_один_milestone_в_прошлом(self):
        """Единственный milestone до текущей главы -> возвращает его."""
        milestones = [{"up_to_chapter": 3, "biography": "Био 3"}]
        result = EntityService._get_current_milestone(milestones, current_chapter=5)
        assert result is not None
        assert result["up_to_chapter"] == 3
        assert result["biography"] == "Био 3"

    def test_несколько_milestones_берётся_максимальный(self):
        """Несколько допустимых milestones -> берётся с максимальным up_to_chapter."""
        milestones = [
            {"up_to_chapter": 1, "biography": "Начало"},
            {"up_to_chapter": 3, "biography": "Развитие"},
            {"up_to_chapter": 5, "biography": "Кульминация"},
            {"up_to_chapter": 10, "biography": "Финал"},
        ]
        result = EntityService._get_current_milestone(milestones, current_chapter=5)
        assert result["up_to_chapter"] == 5
        assert result["biography"] == "Кульминация"

    def test_milestone_точно_на_текущей_главе_включается(self):
        """Milestone с up_to_chapter == current_chapter включается (<=)."""
        milestones = [{"up_to_chapter": 7, "biography": "Глава 7"}]
        result = EntityService._get_current_milestone(milestones, current_chapter=7)
        assert result is not None
        assert result["up_to_chapter"] == 7


# =============================================================================
# _filter_events_by_chapter — тесты
# =============================================================================


class TestFilterEventsByChapter:
    """Тесты для EntityService._filter_events_by_chapter() — фильтрация событий."""

    def test_пустой_список_возвращает_пустой(self):
        """Пустой список events -> пустой результат."""
        result = EntityService._filter_events_by_chapter([], current_chapter=5)
        assert result == []

    def test_все_в_будущем_возвращает_пустой(self):
        """Все events в будущих главах -> пустой результат."""
        events = [
            {"chapter_number": 10, "event_action": "Событие 10"},
            {"chapter_number": 20, "event_action": "Событие 20"},
        ]
        result = EntityService._filter_events_by_chapter(events, current_chapter=5)
        assert result == []

    def test_смешанные_events_фильтруются(self):
        """Events из прошлых и текущей глав включены, будущие отфильтрованы."""
        events = [
            {"chapter_number": 1, "event_action": "Прибытие"},
            {"chapter_number": 3, "event_action": "Встреча"},
            {"chapter_number": 5, "event_action": "Битва"},
            {"chapter_number": 8, "event_action": "Поражение"},
        ]
        result = EntityService._filter_events_by_chapter(events, current_chapter=5)
        assert len(result) == 3
        actions = [e["event_action"] for e in result]
        assert "Прибытие" in actions
        assert "Встреча" in actions
        assert "Битва" in actions
        assert "Поражение" not in actions

    def test_event_текущей_главы_включается(self):
        """Event с chapter_number == current_chapter включается (<=)."""
        events = [{"chapter_number": 5, "event_action": "Текущее событие"}]
        result = EntityService._filter_events_by_chapter(events, current_chapter=5)
        assert len(result) == 1
        assert result[0]["event_action"] == "Текущее событие"


# =============================================================================
# Notes spoiler marking — тесты
# =============================================================================


class TestNotesSpoilerMarking:
    """Тесты пометки notes из будущих глав как спойлер через _filter_entity_detail."""

    def test_note_из_будущей_главы_помечена_is_spoiler_true(self, service):
        """Note с chapter_index > current_chapter -> is_spoiler=True."""
        entity = _make_entity(name="Персонаж")
        notes = [
            {
                "text": "Прошлая заметка",
                "chapter_index": 2,
                "cfi": None,
                "type": "APPEARANCE",
            },
            {
                "text": "Будущая заметка",
                "chapter_index": 8,
                "cfi": None,
                "type": "ACTION",
            },
        ]
        data = _make_detail_data(entity, notes=notes)

        detail = service._filter_entity_detail(data, current_chapter=5)

        past_note = next(n for n in detail.notes if n.text == "Прошлая заметка")
        future_note = next(n for n in detail.notes if n.text == "Будущая заметка")
        assert past_note.is_spoiler is False
        assert future_note.is_spoiler is True

    def test_note_текущей_главы_не_спойлер(self, service):
        """Note с chapter_index == current_chapter -> is_spoiler=False."""
        entity = _make_entity(name="Персонаж")
        notes = [
            {
                "text": "Текущая заметка",
                "chapter_index": 5,
                "cfi": None,
                "type": "APPEARANCE",
            },
        ]
        data = _make_detail_data(entity, notes=notes)

        detail = service._filter_entity_detail(data, current_chapter=5)

        assert detail.notes[0].is_spoiler is False

    def test_notes_при_current_chapter_none_все_не_спойлер(self, service):
        """current_chapter=None -> все notes имеют is_spoiler=False."""
        entity = _make_entity(name="Персонаж")
        notes = [
            {
                "text": "Заметка глава 1",
                "chapter_index": 1,
                "cfi": None,
                "type": "APPEARANCE",
            },
            {
                "text": "Заметка глава 50",
                "chapter_index": 50,
                "cfi": None,
                "type": "ACTION",
            },
        ]
        data = _make_detail_data(entity, notes=notes)

        detail = service._filter_entity_detail(data, current_chapter=None)

        for note in detail.notes:
            assert note.is_spoiler is False

    def test_несколько_notes_из_прошлых_глав_все_не_спойлер(self, service):
        """Несколько notes из прошлых глав -> все is_spoiler=False."""
        entity = _make_entity(name="Герой")
        notes = [
            {
                "text": "Заметка 1",
                "chapter_index": 1,
                "cfi": None,
                "type": "APPEARANCE",
            },
            {"text": "Заметка 2", "chapter_index": 2, "cfi": None, "type": "ACTION"},
            {
                "text": "Заметка 3",
                "chapter_index": 3,
                "cfi": None,
                "type": "APPEARANCE",
            },
        ]
        data = _make_detail_data(entity, notes=notes)

        detail = service._filter_entity_detail(data, current_chapter=5)

        assert all(not n.is_spoiler for n in detail.notes)


# =============================================================================
# _filter_edge_detail — тесты
# =============================================================================


class TestEdgeFiltering:
    """Тесты для EntityService._filter_edge_detail() — фильтрация описания связей."""

    def test_с_milestones_описание_текущей_главы(self):
        """Relationship milestone текущей главы используется как description."""
        edge_data = _make_edge_data(
            context="Начальный контекст",
            relationship_milestones=[
                {"up_to_chapter": 3, "description": "Знакомство"},
                {"up_to_chapter": 7, "description": "Дружба"},
                {"up_to_chapter": 15, "description": "Вражда"},
            ],
        )

        result = EntityService._filter_edge_detail(edge_data, current_chapter=10)

        assert result.description == "Дружба"

    def test_с_milestones_будущее_описание_скрыто(self):
        """Relationship milestone из будущей главы не используется."""
        edge_data = _make_edge_data(
            context="Начальный контекст",
            relationship_milestones=[
                {"up_to_chapter": 10, "description": "Описание из будущего"},
            ],
        )

        result = EntityService._filter_edge_detail(edge_data, current_chapter=5)

        # Milestone из будущего не применяется -> fallback на _context
        assert result.description == "Начальный контекст"

    def test_без_milestones_используется_context(self):
        """Без relationship_milestones -> используется _context как description."""
        edge_data = _make_edge_data(
            context="Контекст связи",
            relationship_milestones=None,
        )

        result = EntityService._filter_edge_detail(edge_data, current_chapter=5)

        assert result.description == "Контекст связи"

    def test_current_chapter_none_используется_context(self):
        """current_chapter=None -> используется _context без milestone фильтрации."""
        edge_data = _make_edge_data(
            context="Базовый контекст",
            relationship_milestones=[
                {"up_to_chapter": 3, "description": "Milestone описание"},
            ],
        )

        result = EntityService._filter_edge_detail(edge_data, current_chapter=None)

        assert result.description == "Базовый контекст"

    def test_пустые_milestones_используется_context(self):
        """Пустой список milestones -> fallback на _context."""
        edge_data = _make_edge_data(
            context="Fallback контекст",
            relationship_milestones=[],
        )

        result = EntityService._filter_edge_detail(edge_data, current_chapter=5)

        assert result.description == "Fallback контекст"


# =============================================================================
# Граничные случаи — тесты
# =============================================================================


class TestBoundaryConditions:
    """Граничные случаи спойлер-фильтрации: глава 0, None, max+1, пустые данные."""

    def test_глава_0_entity_с_first_mention_chapter_0_видна(self, service):
        """Entity с first_mention_chapter=0 видна при current_chapter=0."""
        entity = _make_entity(
            first_mention_chapter=0,
            name="Нулевая сущность",
        )
        notes = [
            {
                "text": "Заметка глава 0",
                "chapter_index": 0,
                "cfi": None,
                "type": "APPEARANCE",
            },
        ]
        data = _make_detail_data(entity, notes=notes)

        detail = service._filter_entity_detail(data, current_chapter=0)

        assert detail.first_mention_chapter == 0
        assert detail.notes[0].is_spoiler is False

    def test_entity_без_chapter_number_none_обрабатывается(self, service):
        """Entity с first_mention_chapter=None корректно обрабатывается."""
        entity = _make_entity(first_mention_chapter=None, name="Без главы")
        data = _make_detail_data(entity)

        detail = service._filter_entity_detail(data, current_chapter=5)

        assert detail.first_mention_chapter is None
        assert detail.name == "Без главы"

    def test_current_chapter_больше_максимальной_все_данные_видны(self, service):
        """current_chapter=999 (больше max) -> все данные видны."""
        entity = _make_entity(name="Финальный герой")
        notes = [
            {
                "text": "Ранняя заметка",
                "chapter_index": 1,
                "cfi": None,
                "type": "APPEARANCE",
            },
            {
                "text": "Поздняя заметка",
                "chapter_index": 50,
                "cfi": None,
                "type": "ACTION",
            },
        ]
        events = [
            {"chapter_number": 1, "event_action": "Рождение"},
            {"chapter_number": 25, "event_action": "Поход"},
            {"chapter_number": 50, "event_action": "Финал"},
        ]
        milestones = [
            {
                "up_to_chapter": 1,
                "biography": "Молодость",
                "dynamic_role": "Юноша",
                "visual_summary_clean": "Молодой",
            },
            {
                "up_to_chapter": 25,
                "biography": "Зрелость",
                "dynamic_role": "Воин",
                "visual_summary_clean": "Сильный",
            },
            {
                "up_to_chapter": 50,
                "biography": "Старость",
                "dynamic_role": "Мудрец",
                "visual_summary_clean": "Седой",
            },
        ]
        data = _make_detail_data(
            entity, notes=notes, events=events, biography_milestones=milestones
        )

        detail = service._filter_entity_detail(data, current_chapter=999)

        # Все notes не спойлер
        assert all(not n.is_spoiler for n in detail.notes)
        # Все events видны
        assert len(detail.events) == 3
        # Последний milestone выбран
        assert detail.biography == "Старость"
        assert detail.dynamic_role == "Мудрец"

    def test_пустые_milestones_и_events_не_ломают_фильтрацию(self, service):
        """Пустые milestones=[] и events=[] -> фильтрация не ломается."""
        entity = _make_entity(name="Простая сущность")
        data = _make_detail_data(
            entity,
            notes=[],
            events=[],
            biography_milestones=[],
        )

        detail = service._filter_entity_detail(data, current_chapter=5)

        assert detail.biography is None
        assert detail.events == []
        assert detail.notes == []

    def test_entity_упоминается_в_нескольких_главах_все_до_current_видны(self, service):
        """Entity с events в нескольких главах -> все события до current_chapter видны."""
        entity = _make_entity(name="Многоглавный герой")
        events = [
            {"chapter_number": 1, "event_action": "Появление"},
            {"chapter_number": 3, "event_action": "Развитие"},
            {"chapter_number": 5, "event_action": "Конфликт"},
            {"chapter_number": 7, "event_action": "Разрешение"},
            {"chapter_number": 10, "event_action": "Эпилог"},
        ]
        notes = [
            {
                "text": "Заметка 1",
                "chapter_index": 1,
                "cfi": None,
                "type": "APPEARANCE",
            },
            {"text": "Заметка 3", "chapter_index": 3, "cfi": None, "type": "ACTION"},
            {
                "text": "Заметка 5",
                "chapter_index": 5,
                "cfi": None,
                "type": "APPEARANCE",
            },
            {"text": "Заметка 7", "chapter_index": 7, "cfi": None, "type": "ACTION"},
        ]
        data = _make_detail_data(entity, notes=notes, events=events)

        detail = service._filter_entity_detail(data, current_chapter=5)

        # 3 events видны (главы 1, 3, 5)
        assert len(detail.events) == 3
        event_actions = [e.event_action for e in detail.events]
        assert "Появление" in event_actions
        assert "Развитие" in event_actions
        assert "Конфликт" in event_actions
        assert "Разрешение" not in event_actions

        # Notes: главы 1, 3, 5 не спойлер, глава 7 спойлер
        non_spoiler = [n for n in detail.notes if not n.is_spoiler]
        spoiler = [n for n in detail.notes if n.is_spoiler]
        assert len(non_spoiler) == 3
        assert len(spoiler) == 1
        assert spoiler[0].text == "Заметка 7"

    def test_milestones_через_filter_entity_detail_biography_и_dynamic_role(
        self, service
    ):
        """_filter_entity_detail корректно извлекает biography и dynamic_role из milestones."""
        entity = _make_entity(name="Эволюционирующий герой")
        milestones = [
            {
                "up_to_chapter": 1,
                "biography": "Новичок",
                "dynamic_role": "Ученик",
                "visual_summary_clean": "Юный",
            },
            {
                "up_to_chapter": 5,
                "biography": "Опытный",
                "dynamic_role": "Мастер",
                "visual_summary_clean": "Зрелый",
            },
            {
                "up_to_chapter": 10,
                "biography": "Легенда",
                "dynamic_role": "Наставник",
                "visual_summary_clean": "Мудрый",
            },
        ]
        data = _make_detail_data(entity, biography_milestones=milestones)

        # Глава 5 -> milestone с up_to_chapter=5
        detail = service._filter_entity_detail(data, current_chapter=5)
        assert detail.biography == "Опытный"
        assert detail.dynamic_role == "Мастер"
        assert detail.visual_summary_clean == "Зрелый"

    def test_milestones_current_chapter_none_берётся_максимальный(self, service):
        """current_chapter=None -> берётся milestone с максимальным up_to_chapter."""
        entity = _make_entity(name="Полный герой")
        milestones = [
            {
                "up_to_chapter": 1,
                "biography": "Начало",
                "dynamic_role": "Юноша",
                "visual_summary_clean": "Молод",
            },
            {
                "up_to_chapter": 50,
                "biography": "Конец",
                "dynamic_role": "Старец",
                "visual_summary_clean": "Сед",
            },
        ]
        data = _make_detail_data(entity, biography_milestones=milestones)

        detail = service._filter_entity_detail(data, current_chapter=None)

        assert detail.biography == "Конец"
        assert detail.dynamic_role == "Старец"
