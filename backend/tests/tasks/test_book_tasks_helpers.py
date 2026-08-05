"""Вспомогательные функции `app/tasks/book_tasks.py`.

Покрываются три функции, которые можно проверить без боевого пайплайна:

* `find_entity_fuzzy` — чистая функция, три стратегии поиска подряд;
* `_save_chapter_extraction_result` — запись результата разбора главы,
  гоняется с настоящим `ConsistencyManager` против тестовой БД;
* `_atomic_cleanup_book_state` — сброс состояния книги после аварии.

Монолит `_process_book_async` намеренно не трогается.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.chapter import Chapter
from app.models.description import Description, DescriptionType
from app.models.description_entity import DescriptionEntity
from app.models.entity import Entity, EntityType
from app.models.entity_event import EntityEvent
from app.models.entity_mention import EntityMention
from app.models.entity_relationship import EntityRelationship
from app.schemas.extraction import (
    ChapterAnalysisResult,
    ExtractedDescription,
    ExtractedEntity,
    ExtractedRelationship,
)
from app.tasks.book_tasks import (
    _atomic_cleanup_book_state,
    _save_chapter_extraction_result,
    find_entity_fuzzy,
)


def _entity(name: str) -> Entity:
    """Несохранённая сущность — `find_entity_fuzzy` только возвращает значения."""
    return Entity(
        id=uuid.uuid4(),
        book_id=uuid.uuid4(),
        name=name,
        name_lower=name.casefold(),
        type=EntityType.CHARACTER.value,
    )


# ============================================================================
# find_entity_fuzzy — три стратегии и переходы между ними
# ============================================================================


class TestFindEntityFuzzy:
    """Порядок стратегий: точное совпадение → difflib(0.7) → вхождение."""

    def test_exact_match_wins_over_longer_candidate(self):
        """Точное совпадение возвращается, а не более длинный «похожий» ключ."""
        exact, longer = _entity("Кот"), _entity("Кот Баюн")
        entity_map = {"кот": exact, "кот баюн": longer}

        assert find_entity_fuzzy("Кот", entity_map) is exact

    def test_lookup_is_case_and_whitespace_insensitive(self):
        """Имя из LLM приходит как попало — нормализация обязана срабатывать."""
        geralt = _entity("Геральт")

        assert find_entity_fuzzy("  ГЕРАЛЬТ  ", {"геральт": geralt}) is geralt

    def test_typo_resolved_by_difflib_not_by_substring(self):
        """«гералт» — не подстрока «геральт»; поймать может только difflib."""
        geralt = _entity("Геральт")

        assert find_entity_fuzzy("гералт", {"геральт": geralt}) is geralt

    def test_long_form_resolved_by_substring_not_by_difflib(self):
        """Ratio «геральт из ривии»/«геральт» = 0.61 < 0.7 — работает вхождение."""
        geralt = _entity("Геральт")

        assert find_entity_fuzzy("Геральт из Ривии", {"геральт": geralt}) is geralt

    def test_unrelated_name_returns_none(self):
        """Ни одна из трёх стратегий не должна выдумывать связь."""
        assert find_entity_fuzzy("Лютик", {"геральт": _entity("Геральт")}) is None

    def test_cutoff_argument_tightens_difflib_stage(self):
        """При cutoff=0.9 пара с ratio 0.8 больше не проходит и вхождения нет."""
        yen = _entity("Йеннифэр")
        entity_map = {"йеннифэр": yen}

        assert find_entity_fuzzy("Йенифер", entity_map) is yen
        assert find_entity_fuzzy("Йенифер", entity_map, cutoff=0.9) is None

    def test_empty_map_returns_none(self):
        """Пустая карта — не повод падать на difflib."""
        assert find_entity_fuzzy("Геральт", {}) is None


# ============================================================================
# _save_chapter_extraction_result — запись главы против настоящей БД
# ============================================================================


def _description(content: str, mentions: list[str], **kw) -> ExtractedDescription:
    return ExtractedDescription(
        content=content,
        description_type=kw.get("description_type", DescriptionType.CHARACTER),
        confidence=kw.get("confidence", 0.9),
        entities=[{"name": name} for name in mentions],
    )


class TestSaveChapterExtractionResult:
    """Контракт: сущности, события, описания, связи и статус главы."""

    @pytest.mark.asyncio
    async def test_full_result_is_persisted(
        self, db_session: AsyncSession, test_book: Book, test_chapter: Chapter
    ):
        """Полный проход: Entity, EntityEvent, Description, DescriptionEntity."""
        analysis = ChapterAnalysisResult(
            entities=[
                ExtractedEntity(
                    name="Геральт",
                    type="character",
                    visual_summary="Седой ведьмак со шрамом",
                    aliases=["Белый Волк"],
                    confidence=0.95,
                    importance=9,
                    chapter_event_action="вошёл в таверну",
                    chapter_event_inner="настороженность",
                ),
                ExtractedEntity(
                    name="Таверна",
                    type="location",
                    visual_summary="Прокуренный зал с дубовыми столами",
                    confidence=0.8,
                ),
            ],
            descriptions=[
                _description("Седой мужчина у стойки", ["Белый Волк"]),
                _description(
                    "Низкий зал, пахнет элем",
                    ["Таверна"],
                    description_type=DescriptionType.LOCATION,
                ),
            ],
            relationships=[
                ExtractedRelationship(
                    source="Геральт", target="Таверна", type="visited", weight=7.0
                )
            ],
        )

        saved = await _save_chapter_extraction_result(
            db_session,
            test_chapter,
            analysis,
            book_id=test_book.id,
            idx=test_chapter.chapter_number,
        )
        await db_session.commit()

        assert saved == 2

        entities = (
            (
                await db_session.execute(
                    select(Entity).where(Entity.book_id == test_book.id)
                )
            )
            .scalars()
            .all()
        )
        assert {e.name for e in entities} == {"Геральт", "Таверна"}

        # Событие ровно одно: у «Таверны» нет chapter_event_action.
        events = (
            (
                await db_session.execute(
                    select(EntityEvent).where(EntityEvent.chapter_id == test_chapter.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1
        assert events[0].event_action == "вошёл в таверну"
        assert events[0].event_inner_state == "настороженность"
        assert events[0].chapter_number == test_chapter.chapter_number

        descriptions = (
            (
                await db_session.execute(
                    select(Description)
                    .where(Description.chapter_id == test_chapter.id)
                    .order_by(Description.position_in_chapter)
                )
            )
            .scalars()
            .all()
        )
        assert [d.position_in_chapter for d in descriptions] == [0, 1]
        assert [d.type for d in descriptions] == [
            DescriptionType.CHARACTER,
            DescriptionType.LOCATION,
        ]

        # «Белый Волк» — алиас Геральта, связь обязана указывать на Геральта.
        by_name = {e.name: e for e in entities}
        links = (
            (
                await db_session.execute(
                    select(DescriptionEntity).where(
                        DescriptionEntity.description_id == descriptions[0].id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [link.entity_id for link in links] == [by_name["Геральт"].id]
        assert links[0].mention_text == "Белый Волк"

        # Побочные записи ConsistencyManager: упоминания и связь.
        mentions = await db_session.scalar(
            select(func.count())
            .select_from(EntityMention)
            .where(EntityMention.chapter_id == test_chapter.id)
        )
        assert mentions == 2
        relationship = await db_session.scalar(
            select(EntityRelationship).where(
                EntityRelationship.source_id == by_name["Геральт"].id
            )
        )
        assert relationship is not None
        assert relationship.target_id == by_name["Таверна"].id

    @pytest.mark.asyncio
    async def test_chapter_status_is_marked_parsed(
        self, db_session: AsyncSession, test_book: Book, test_chapter: Chapter
    ):
        """Статус главы: счётчик, флаг, время, сброс ошибки, счёт попыток."""
        test_chapter.parsing_error = "предыдущий сбой"
        test_chapter.parse_attempts = 1

        analysis = ChapterAnalysisResult(
            entities=[],
            descriptions=[_description("Одинокое описание", [])],
            relationships=[],
        )

        await _save_chapter_extraction_result(
            db_session,
            test_chapter,
            analysis,
            book_id=test_book.id,
            idx=test_chapter.chapter_number,
        )
        await db_session.commit()

        assert test_chapter.descriptions_found == 1
        assert test_chapter.is_description_parsed is True
        assert test_chapter.parsed_at is not None
        assert test_chapter.parsing_error is None
        assert test_chapter.parse_attempts == 2

    @pytest.mark.asyncio
    async def test_empty_result_marks_chapter_parsed_with_zero(
        self, db_session: AsyncSession, test_book: Book, test_chapter: Chapter
    ):
        """Пустая глава — это не ошибка: она разобрана, описаний ноль."""
        analysis = ChapterAnalysisResult(entities=[], descriptions=[], relationships=[])

        saved = await _save_chapter_extraction_result(
            db_session,
            test_chapter,
            analysis,
            book_id=test_book.id,
            idx=test_chapter.chapter_number,
        )
        await db_session.commit()

        assert saved == 0
        assert test_chapter.descriptions_found == 0
        assert test_chapter.is_description_parsed is True

    @pytest.mark.asyncio
    async def test_unknown_description_type_falls_back_to_location(
        self, db_session: AsyncSession, test_book: Book, test_chapter: Chapter
    ):
        """Мусорный `type` от модели не должен ронять запись всей главы."""
        analysis = ChapterAnalysisResult(
            entities=[],
            descriptions=[
                {
                    "content": "Нечто неописуемое",
                    "type": "не-существующий-тип",
                    "confidence_score": 0.5,
                    "word_count": 2,
                }
            ],
            relationships=[],
        )

        saved = await _save_chapter_extraction_result(
            db_session,
            test_chapter,
            analysis,
            book_id=test_book.id,
            idx=test_chapter.chapter_number,
        )
        await db_session.commit()

        assert saved == 1
        description = await db_session.scalar(
            select(Description).where(Description.chapter_id == test_chapter.id)
        )
        assert description.type == DescriptionType.LOCATION

    @pytest.mark.asyncio
    async def test_unresolvable_mention_is_skipped_not_fatal(
        self, db_session: AsyncSession, test_book: Book, test_chapter: Chapter
    ):
        """Имя, которого нет в карте сущностей, теряет связь, но не описание."""
        analysis = ChapterAnalysisResult(
            entities=[
                ExtractedEntity(
                    name="Геральт",
                    type="character",
                    visual_summary="Седой ведьмак",
                    confidence=0.9,
                )
            ],
            descriptions=[_description("Кто-то у стойки", ["Кровавый Барон"])],
            relationships=[],
        )

        saved = await _save_chapter_extraction_result(
            db_session,
            test_chapter,
            analysis,
            book_id=test_book.id,
            idx=test_chapter.chapter_number,
        )
        await db_session.commit()

        assert saved == 1
        links = await db_session.scalar(
            select(func.count()).select_from(DescriptionEntity)
        )
        assert links == 0

    @pytest.mark.asyncio
    async def test_blank_mention_is_ignored_before_lookup(
        self, db_session: AsyncSession, test_book: Book, test_chapter: Chapter
    ):
        """Пустая строка в `entities_mentioned` не должна уходить в поиск.

        `find_entity_fuzzy("")` вернул бы первую попавшуюся сущность:
        пустая строка — подстрока любого ключа.
        """
        analysis = ChapterAnalysisResult(
            entities=[
                ExtractedEntity(
                    name="Геральт",
                    type="character",
                    visual_summary="Седой ведьмак",
                    confidence=0.9,
                )
            ],
            descriptions=[_description("Кто-то у стойки", ["", "Геральт"])],
            relationships=[],
        )

        await _save_chapter_extraction_result(
            db_session,
            test_chapter,
            analysis,
            book_id=test_book.id,
            idx=test_chapter.chapter_number,
        )
        await db_session.commit()

        links = (await db_session.execute(select(DescriptionEntity))).scalars().all()
        assert [link.mention_text for link in links] == ["Геральт"]


# ============================================================================
# _atomic_cleanup_book_state — сессию открывает сам
# ============================================================================


@pytest.fixture
def cleanup_uses_test_db():
    """`_atomic_cleanup_book_state` берёт `AsyncSessionLocal` напрямую.

    Без подмены правка ушла бы в рабочую `fancai_dev`, а тест смотрел бы
    в `fancai_test` и не увидел изменений.
    """
    from tests.conftest import TestSessionLocal

    with patch("app.tasks.book_tasks.AsyncSessionLocal", TestSessionLocal):
        yield


@pytest.mark.usefixtures("cleanup_uses_test_db")
class TestAtomicCleanupBookState:
    """Контракт: книга разблокирована и ошибка записана, что бы ни упало."""

    @pytest.mark.asyncio
    async def test_clears_processing_flag_and_stores_error(
        self, db_session: AsyncSession, test_book: Book
    ):
        test_book.is_processing = True
        test_book.descriptions_processing_error = None
        await db_session.commit()

        await _atomic_cleanup_book_state(test_book.id, "LLM недоступен")

        await db_session.refresh(
            test_book, ["is_processing", "descriptions_processing_error"]
        )
        assert test_book.is_processing is False
        assert test_book.descriptions_processing_error == "LLM недоступен"

    @pytest.mark.asyncio
    async def test_missing_book_does_not_raise(self, test_db):
        """Книгу могли удалить, пока задача падала."""
        await _atomic_cleanup_book_state(uuid.uuid4(), "книги уже нет")

    @pytest.mark.asyncio
    async def test_cache_failure_does_not_block_unlock(
        self, db_session: AsyncSession, test_book: Book
    ):
        """Недоступный кэш не должен оставить книгу залипшей в is_processing."""
        test_book.is_processing = True
        await db_session.commit()

        with patch(
            "app.core.cache.cache_manager.delete_pattern",
            AsyncMock(side_effect=RuntimeError("redis down")),
        ):
            await _atomic_cleanup_book_state(test_book.id, "сбой парсинга")

        await db_session.refresh(test_book, ["is_processing"])
        assert test_book.is_processing is False

    @pytest.mark.asyncio
    async def test_redis_lock_cleanup_failure_does_not_block_unlock(
        self, db_session: AsyncSession, test_book: Book
    ):
        """Снятие Redis-замка — последний шаг; его сбой не отменяет запись в БД."""
        test_book.is_processing = True
        await db_session.commit()

        with patch("redis.asyncio.from_url", side_effect=OSError("connection refused")):
            await _atomic_cleanup_book_state(test_book.id, "сбой парсинга")

        await db_session.refresh(
            test_book, ["is_processing", "descriptions_processing_error"]
        )
        assert test_book.is_processing is False
        assert test_book.descriptions_processing_error == "сбой парсинга"

    @pytest.mark.asyncio
    async def test_database_failure_is_swallowed(self, test_db):
        """Функция зовётся из `finally` аварийной ветки — падать ей нельзя."""
        with patch(
            "app.tasks.book_tasks.AsyncSessionLocal",
            side_effect=RuntimeError("postgres down"),
        ):
            await _atomic_cleanup_book_state(uuid.uuid4(), "и БД тоже легла")
