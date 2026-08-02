"""Живой smoke LLM-ветки обработки книги — без единого платного вызова.

Проверяет, что после удаления GLiNER2 (S4) `_process_book_async` по-прежнему
доводит книгу до конца: главы разбираются, сущности и описания попадают в БД,
книга помечается обработанной.

Экстрактор подменяется фейком: он возвращает готовый `ChapterAnalysisResult`,
поэтому LLM-провайдер не вызывается. Заглушены и четыре пост-фазы, которые
ходят в AI за деньги: reduce, LLM-дедуп, synthesis и master references. Без
заглушек они падают на пустых ключах, откатывают транзакцию и роняют
финализацию по `MissingGreenlet` — это отдельный дефект, не относящийся к S4.
Проверяемая здесь ветка — «глава → LLM → сущности и описания → финализация».
Запускать только на dev-БД:

    docker exec -e OPENROUTER_API_KEY= -e GEMINI_API_KEY= fancai_backend_dev \\
        python scripts/smoke_llm_book_pipeline.py
"""

import asyncio
import sys
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.models.book import Book
from app.models.chapter import Chapter
from app.models.description import Description
from app.models.entity import Entity
from app.models.user import User
from app.schemas.extraction import (
    ChapterAnalysisResult,
    ExtractedDescription,
    ExtractedEntity,
)
from app.models.description import DescriptionType

CHAPTER_TEXT = (
    "Геральт вошёл в таверну «Под старым вязом», низкое помещение с закопчёнными "
    "балками и длинными дубовыми столами. Ведьмак был высок и сед, лицо его "
    "пересекал старый шрам, а на поясе висели два меча — стальной и серебряный. "
    "За стойкой хозяин протирал кружки, и пахло разлитым пивом и мокрой шерстью. "
) * 6


def _fake_result() -> ChapterAnalysisResult:
    return ChapterAnalysisResult(
        descriptions=[
            ExtractedDescription(
                content=(
                    "Низкое помещение с закопчёнными балками и длинными "
                    "дубовыми столами."
                ),
                description_type=DescriptionType.LOCATION,
                confidence=0.9,
                position=0,
            ),
            ExtractedDescription(
                content=(
                    "Высок и сед, лицо пересекает старый шрам, на поясе два меча."
                ),
                description_type=DescriptionType.CHARACTER,
                confidence=0.95,
                position=1,
            ),
        ],
        entities=[
            ExtractedEntity(
                name="Геральт",
                type="character",
                visual_summary="Седой ведьмак со шрамом, два меча на поясе.",
                # Непустые алиасы обязательны: при повторной встрече сущности
                # в следующей главе upsert считает aliases_with_reveal через
                # jsonb_agg, и на пустом наборе тот вернул бы NULL при NOT NULL
                # колонке. Это отдельный дефект, записанный в handoff.
                aliases=["Белый Волк"],
                confidence=0.95,
                # importance < 7 — второй предохранитель против генерации
                # мастер-портрета, даже если ключ где-то всё же окажется.
                importance=5,
                chapter_event_action="Входит в таверну.",
            ),
            ExtractedEntity(
                name="Таверна «Под старым вязом»",
                type="location",
                visual_summary="Низкий зал с закопчёнными балками.",
                aliases=["Старый вяз"],
                confidence=0.9,
                importance=4,
            ),
        ],
        relationships=[],
    )


class FakeExtractor:
    """Совместим с `get_gemini_extractor()` по вызываемой поверхности."""

    def __init__(self) -> None:
        self.calls = 0

    def is_available(self) -> bool:
        return True

    async def analyze_chapter(self, content: str) -> ChapterAnalysisResult:
        self.calls += 1
        return _fake_result()


class _NoMerges:
    merge_groups: list = []


def _stub_paid_phases() -> None:
    """Глушит четыре пост-фазы, которые ходят в AI за деньги."""
    from app.services.consistency_manager import ConsistencyManager
    from app.services.entity_deduplication_service import EntityDeduplicationService
    from app.services.entity_synthesis_service import EntitySynthesisService

    async def _noop(*args, **kwargs):
        return None

    async def _no_merges(*args, **kwargs):
        return _NoMerges()

    async def _empty_synthesis(*args, **kwargs):
        return {}

    ConsistencyManager.optimize_book_entities = _noop
    ConsistencyManager.generate_master_references = _noop
    EntityDeduplicationService.suggest_merges = _no_merges
    EntitySynthesisService.synthesize_book_entities = _empty_synthesis


async def main() -> int:
    from app.tasks import book_tasks

    async with AsyncSessionLocal() as db:
        user_id = (await db.execute(select(User.id).limit(1))).scalar_one_or_none()
        if user_id is None:
            print("FAIL: в dev-БД нет ни одного пользователя")
            return 1

        book = Book(
            user_id=user_id,
            title=f"S4 smoke {uuid.uuid4().hex[:8]}",
            author="smoke",
            genre="fantasy",
            file_path="/dev/null",
            file_format="epub",
            file_size=1,
            is_parsed=True,
            is_processing=True,
        )
        db.add(book)
        await db.flush()
        book_id = book.id

        for number in (1, 2):
            db.add(
                Chapter(
                    book_id=book_id,
                    chapter_number=number,
                    title=f"Глава {number}",
                    content=CHAPTER_TEXT,
                    word_count=len(CHAPTER_TEXT.split()),
                )
            )
        await db.commit()

    _stub_paid_phases()
    fake = FakeExtractor()
    original = book_tasks.get_gemini_extractor
    book_tasks.get_gemini_extractor = lambda: fake
    try:
        result = await book_tasks._process_book_async(book_id)
    finally:
        book_tasks.get_gemini_extractor = original

    async with AsyncSessionLocal() as db:
        entities = (
            await db.execute(
                select(func.count())
                .select_from(Entity)
                .where(Entity.book_id == book_id)
            )
        ).scalar_one()
        descriptions = (
            await db.execute(
                select(func.count())
                .select_from(Description)
                .join(Chapter, Description.chapter_id == Chapter.id)
                .where(Chapter.book_id == book_id)
            )
        ).scalar_one()
        parsed_chapters = (
            await db.execute(
                select(func.count())
                .select_from(Chapter)
                .where(
                    Chapter.book_id == book_id,
                    Chapter.is_description_parsed.is_(True),
                )
            )
        ).scalar_one()

        print(f"task result       : {result['status']}")
        print(f"chapters processed: {result['chapters_processed']}")
        print(f"chapters parsed   : {parsed_chapters}")
        print(f"extractor calls   : {fake.calls}")
        print(f"entities in DB    : {entities}")
        print(f"descriptions in DB: {descriptions}")

        # Bulk-DELETE не каскадит: FK на chapters объявлен без ON DELETE CASCADE,
        # каскад живёт в ORM-relationship. Поэтому удаляем через объект.
        book_obj = await db.get(
            Book,
            book_id,
            options=[
                selectinload(Book.chapters),
                selectinload(Book.entities),
                selectinload(Book.reading_progress),
                selectinload(Book.reading_sessions),
            ],
        )
        if book_obj is not None:
            await db.delete(book_obj)
            await db.commit()
        print("cleanup           : book deleted")

    ok = (
        result["status"] == "completed"
        and result["chapters_processed"] == 2
        and parsed_chapters == 2
        and fake.calls == 2
        and entities == 2
        and descriptions == 4
    )
    print("SMOKE:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
