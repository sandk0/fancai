"""Засевает dev-книге глоссарий продового объёма — воспроизведение инцидента читалки.

Зачем. Инцидент 2026-08-05 («вечное восстановление позиции») наблюдался только
на книге с обработанными данными. Все локальные прогоны шли на dev-книге с НУЛЁМ
сущностей и проходили успешно, поэтому путь с полным глоссарием ни разу
не исполнялся. Скрипт закрывает именно этот пробел.

Форма и объёмы скопированы с продовой книги `f7d88bdc` («Нож сновидений»),
снятые чтением 2026-08-06:

    42 сущности   — 32 character, 8 location, 2 object
    visual_summary у всех, 103–166 символов
    aliases_with_reveal 1–2 записи на сущность
    first_mention_chapter 1..11
    28 описаний   — по главам 1/2/8/11 в количестве 12/8/2/6
    43 entity_mentions, 27 entity_events, 24 entity_relationships
    прогресс у самого конца книги: max_chapter_reached выше всех
    first_mention_chapter, то есть «встречены» ВСЕ сущности

Последнее — не деталь. `isEntityNameHighlighting` подсвечивает только встреченные
сущности (`isEntityMetCFI`), и на главе 4 из 23 подсветка получила бы треть
списка вместо всего.

Имена сущностей берутся из текста книги, а не выдумываются: подсветка ищет имя
в отрисованном DOM, и выдуманное имя не даст ни одного обхода дерева — то есть
не создаст той нагрузки, ради которой фикстура и существует.

Обратимость. Скрипт пишет ID всего созданного в state-файл и по `teardown`
удаляет только их. Прогресс чтения не создаётся заново, а правится, поэтому
его исходные значения сохраняются в том же файле и возвращаются на место.

    docker exec fancai_backend_dev python scripts/seed_reader_load_fixture.py setup
    docker exec fancai_backend_dev python scripts/seed_reader_load_fixture.py teardown
"""

import argparse
import asyncio
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.book import Book, ReadingProgress
from app.models.chapter import Chapter
from app.models.description import Description, DescriptionType
from app.models.entity import Entity, EntityType
from app.models.entity_event import EntityEvent
from app.models.entity_mention import EntityMention
from app.models.entity_relationship import EntityRelationship

DEFAULT_STATE = Path("/tmp/reader_load_fixture.json")

# Распределение описаний по главам — как на проде.
DESCRIPTIONS_PER_CHAPTER = {1: 12, 2: 8, 8: 2, 11: 6}
COUNTS = {EntityType.CHARACTER: 32, EntityType.LOCATION: 8, EntityType.OBJECT: 2}
MENTIONS_TOTAL = 43
EVENTS_TOTAL = 27
EDGES_TOTAL = 24

SUMMARY_TEMPLATES = [
    "Высокий, широкоплечий, с обветренным лицом и седеющими у виска волосами; "
    "носит тёмный дорожный плащ с медной пряжкой.",
    "Худая фигура в вытертой кожаной куртке, короткие тёмные волосы, "
    "на левой руке не хватает двух пальцев.",
    "Тесная комната с низким потолком, закопчённые балки, узкое окно, "
    "затянутое промасленным пергаментом, и очаг у дальней стены.",
]


def _assert_dev_database() -> str:
    """Отказывается работать где угодно, кроме dev-БД."""
    url = str(settings.DATABASE_URL)
    name = url.rsplit("/", 1)[-1].split("?")[0]
    if not name.endswith("_dev"):
        raise SystemExit(
            f"REFUSING: база '{name}' не заканчивается на _dev. "
            "Фикстура запускается только на dev-БД."
        )
    return name


def _proper_nouns(text: str) -> list[str]:
    """Собирает из текста главы слова, похожие на имена собственные.

    Отбор идёт по заглавной букве НЕ в начале предложения: так отсеиваются
    обычные слова, открывающие фразу. Имя обязано встречаться в тексте
    дословно — подсветка ищет его в DOM.
    """
    found: dict[str, int] = {}
    for match in re.finditer(r"(?<![.!?…]\s)(?<!^)\b([А-ЯЁ][а-яё]{3,})\b", text):
        word = match.group(1)
        found[word] = found.get(word, 0) + 1
    # Частые — надёжнее: они точно попадут в отрисованный фрагмент.
    return [w for w, _ in sorted(found.items(), key=lambda kv: -kv[1])]


def _sentences_from(text: str, count: int) -> list[str]:
    """Забирает из главы `count` предложений, годных под содержимое описания.

    Правило то же, что в `e2e_fixture.py`: содержимое обязано встречаться
    в главе дословно, а первые предложения склеены с заголовком, который
    матчер подсветки срезает.
    """
    parts = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text or "")]
    good = [s for s in parts if 60 <= len(s) <= 240]
    return good[3 : 3 + count]


async def setup(state_path: Path, book_id: str | None) -> int:
    db_name = _assert_dev_database()
    if state_path.exists():
        raise SystemExit(
            f"REFUSING: {state_path} уже существует — сначала teardown, "
            "иначе прежний слой станет неудаляемым."
        )

    async with AsyncSessionLocal() as db:
        q = select(Book)
        if book_id:
            q = q.where(Book.id == uuid.UUID(book_id))
        books = list((await db.execute(q)).scalars())
        if len(books) != 1:
            raise SystemExit(
                f"REFUSING: найдено книг: {len(books)}. Укажите --book-id."
            )
        book = books[0]

        chapters = list(
            (
                await db.execute(
                    select(Chapter)
                    .where(Chapter.book_id == book.id)
                    .order_by(Chapter.chapter_number)
                )
            ).scalars()
        )
        if len(chapters) < max(DESCRIPTIONS_PER_CHAPTER):
            raise SystemExit(
                f"REFUSING: в книге {len(chapters)} глав, а описания кладутся "
                f"до главы {max(DESCRIPTIONS_PER_CHAPTER)}."
            )
        by_number = {c.chapter_number: c for c in chapters}

        existing = {
            n
            for (n,) in await db.execute(
                select(Entity.name_lower).where(Entity.book_id == book.id)
            )
        }

        # ── имена: из текста первых одиннадцати глав, как на проде ──
        pool: list[str] = []
        for number in range(1, 12):
            chapter = by_number.get(number)
            if chapter is None:
                continue
            for word in _proper_nouns(chapter.content or ""):
                if word.lower() not in existing and word not in pool:
                    pool.append(word)

        total_entities = sum(COUNTS.values())
        if len(pool) < total_entities:
            raise SystemExit(
                f"REFUSING: в тексте нашлось {len(pool)} имён, нужно "
                f"{total_entities}. Книга слишком короткая для фикстуры."
            )

        state: dict[str, Any] = {
            "db": db_name,
            "book_id": str(book.id),
            "entity_ids": [],
            "description_ids": [],
            "progress_before": None,
        }

        entities: list[Entity] = []
        cursor = 0
        for entity_type, count in COUNTS.items():
            for index in range(count):
                name = pool[cursor]
                cursor += 1
                # first_mention_chapter 1..11 — ровно продовый разброс.
                chapter_number = 1 + (len(entities) % 11)
                aliases = [{"name": name, "reveal_chapter": chapter_number}]
                if len(entities) % 2 == 0:
                    aliases.append(
                        {"name": name.lower(), "reveal_chapter": chapter_number}
                    )
                entity = Entity(
                    book_id=book.id,
                    type=entity_type.value,
                    name=name,
                    name_lower=name.lower(),
                    visual_summary=SUMMARY_TEMPLATES[index % len(SUMMARY_TEMPLATES)],
                    importance=9 - (index % 9),
                    first_mention_chapter=chapter_number,
                    aliases_with_reveal=aliases,
                    entity_metadata={},
                )
                db.add(entity)
                entities.append(entity)
        await db.flush()
        state["entity_ids"] = [str(e.id) for e in entities]

        # ── описания: дословные предложения из тех же глав, что на проде ──
        descriptions: list[Description] = []
        desc_types = [
            DescriptionType.CHARACTER,
            DescriptionType.LOCATION,
            DescriptionType.ATMOSPHERE,
        ]
        for number, wanted in DESCRIPTIONS_PER_CHAPTER.items():
            chapter = by_number[number]
            sentences = _sentences_from(chapter.content or "", wanted)
            if len(sentences) < wanted:
                raise SystemExit(
                    f"REFUSING: в главе {number} нашлось {len(sentences)} "
                    f"пригодных предложений, нужно {wanted}."
                )
            for position, sentence in enumerate(sentences, start=1):
                description = Description(
                    chapter_id=chapter.id,
                    type=desc_types[position % len(desc_types)].value,
                    content=sentence,
                    confidence_score=0.88,
                    position_in_chapter=position,
                    word_count=len(sentence.split()),
                    is_suitable_for_generation=True,
                    priority_score=0.8,
                    image_generated=False,
                    generation_requested=False,
                )
                db.add(description)
                descriptions.append(description)
        await db.flush()
        state["description_ids"] = [str(d.id) for d in descriptions]

        # ── упоминания, события, связи: удаляются каскадом по entity_id ──
        for index in range(MENTIONS_TOTAL):
            entity = entities[index % len(entities)]
            chapter = by_number[entity.first_mention_chapter]
            db.add(
                EntityMention(
                    chapter_id=chapter.id,
                    entity_id=entity.id,
                    mention_text=entity.name,
                    context=f"…{entity.name}…",
                    start_index=index * 137,
                    end_index=index * 137 + len(entity.name),
                )
            )
        for index in range(EVENTS_TOTAL):
            entity = entities[index % len(entities)]
            chapter = by_number[entity.first_mention_chapter]
            db.add(
                EntityEvent(
                    entity_id=entity.id,
                    chapter_id=chapter.id,
                    chapter_number=chapter.chapter_number,
                    event_action=f"{entity.name} появляется в главе {chapter.chapter_number}",
                    event_inner_state="настороженность",
                )
            )
        for index in range(EDGES_TOTAL):
            source = entities[index % len(entities)]
            target = entities[(index + 7) % len(entities)]
            db.add(
                EntityRelationship(
                    source_id=source.id,
                    target_id=target.id,
                    type="ally",
                    weight=1 + (index % 5),
                    relationship_metadata={},
                    first_interaction_chapter=source.first_mention_chapter,
                )
            )

        # ── прогресс: у конца книги, чтобы «встречены» были ВСЕ сущности ──
        progress = (
            await db.execute(
                select(ReadingProgress).where(ReadingProgress.book_id == book.id)
            )
        ).scalar_one_or_none()
        if progress is None:
            raise SystemExit(
                "REFUSING: у книги нет строки прогресса. Откройте её в читалке "
                "один раз, чтобы прогресс создался настоящим путём."
            )
        state["progress_before"] = {
            "id": str(progress.id),
            "current_chapter": progress.current_chapter,
            "max_chapter_reached": progress.max_chapter_reached,
            "current_position": progress.current_position,
            "reading_location_cfi": progress.reading_location_cfi,
            "scroll_offset_percent": progress.scroll_offset_percent,
        }
        deep = len(chapters) - 2
        progress.current_chapter = deep
        progress.max_chapter_reached = deep + 1
        progress.current_position = 96

        await db.commit()

    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    print(
        f"OK: база {db_name}, книга {state['book_id']}: "
        f"{len(state['entity_ids'])} сущностей, "
        f"{len(state['description_ids'])} описаний, "
        f"{MENTIONS_TOTAL} упоминаний, {EVENTS_TOTAL} событий, {EDGES_TOTAL} связей; "
        f"прогресс {state['progress_before']['current_chapter']} → {deep}"
    )
    print(f"state: {state_path}")
    return 0


async def teardown(state_path: Path) -> int:
    _assert_dev_database()
    if not state_path.exists():
        print(f"нечего убирать: {state_path} нет")
        return 0

    state = json.loads(state_path.read_text())
    entity_ids = [uuid.UUID(x) for x in state["entity_ids"]]
    description_ids = [uuid.UUID(x) for x in state["description_ids"]]

    async with AsyncSessionLocal() as db:
        # Упоминания, события и связи уходят каскадом по entity_id — кроме
        # входящих связей, где сущность фикстуры стоит целью.
        if entity_ids:
            await db.execute(
                delete(EntityRelationship).where(
                    EntityRelationship.target_id.in_(entity_ids)
                )
            )
            await db.execute(delete(Entity).where(Entity.id.in_(entity_ids)))
        if description_ids:
            await db.execute(
                delete(Description).where(Description.id.in_(description_ids))
            )

        before = state.get("progress_before")
        if before:
            progress = await db.get(ReadingProgress, uuid.UUID(before["id"]))
            if progress is not None:
                progress.current_chapter = before["current_chapter"]
                progress.max_chapter_reached = before["max_chapter_reached"]
                progress.current_position = before["current_position"]
                progress.reading_location_cfi = before["reading_location_cfi"]
                progress.scroll_offset_percent = before["scroll_offset_percent"]

        await db.commit()

    state_path.unlink()
    print(
        f"OK: удалено {len(entity_ids)} сущностей и {len(description_ids)} описаний, "
        "прогресс возвращён"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["setup", "teardown"])
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--book-id", default=None)
    args = parser.parse_args()
    if args.action == "setup":
        return asyncio.run(setup(args.state, args.book_id))
    return asyncio.run(teardown(args.state))


if __name__ == "__main__":
    sys.exit(main())
