"""
Тесты спойлерной фильтрации EntityService.

Покрывают:
1. _filter_aliases_from_raw() — видимость псевдонимов по позиции чтения
2. _process_visual_summary() — фильтрация visual_summary по маркерам [Глава N]
3. _filter_entity_detail() — передача first_mention_chapter в схему

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
        "notes": [],
        "_aliases_with_reveal": entity.aliases_with_reveal or [],
        "_all_aliases": computed_aliases,
        "_all_events": [],
        "_biography_milestones": None,
        "_raw_visual_summary": entity.visual_summary,
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

    def test_current_chapter_none_через_filter_entity_detail_возвращает_все(self, service):
        """current_chapter=None в _filter_entity_detail возвращает все псевдонимы."""
        entity = _make_entity(
            entity_metadata={"aliases": ["Белый Волк", "Ведьмак", "Мясник из Блавикена"]},
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
        summary = (
            "Базовое."
            "\n\n[Глава 10]: Будущее 1."
            "\n\n[Глава 20]: Будущее 2."
        )

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

    def test_first_mention_chapter_сохраняется_для_непрочитанной_сущности(self, service):
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
