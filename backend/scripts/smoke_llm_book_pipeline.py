"""Живой smoke LLM-ветки обработки книги — без единого платного вызова.

Экстрактор всегда подменяется фейком: он возвращает готовый
`ChapterAnalysisResult`, поэтому LLM-провайдер по главам не вызывается.
Режимов пять, и каждый проверяет своё:

`stubbed` (по умолчанию) — четыре пост-фазы, ходящие в AI за деньги (reduce,
LLM-дедуп, synthesis, master references), заглушены. Проверяет саму ветку
«глава → LLM → сущности и описания → финализация».

`failing` — заглушек нет, ключи пустые, поэтому пост-фазы падают по-настоящему.
Проверяет, что их отказ не разрушает сессию: книга всё равно доходит
до `completed`, а synthesis не отваливается по `MissingGreenlet`
или `PendingRollbackError`. Именно так ловится регрессия, когда какая-нибудь
пост-фаза снова начнёт откатывать транзакцию под живыми ORM-объектами.

`merge_failure` — auto-merge роняется настоящей ошибкой БД; проверяется
SAVEPOINT вокруг слияния в `book_tasks`.

`reduce_failure` — фаза A падает ошибкой БД изнутри настоящего
`optimize_book_entities`. Проверяет, что сервис ошибку не глотает и не
откатывает транзакцию сам, а SAVEPOINT вызывающего ограничивает откат этой
фазой: соседние фазы и финализация не страдают.

`no_aliases` — фикстура отдаёт сущности **без единого алиаса**. Обе главы
видят одни и те же имена, поэтому вторая идёт по ветке `ON CONFLICT`,
где `jsonb_agg` агрегирует пустое объединение. Без `COALESCE` агрегат
возвращает NULL, колонка `NOT NULL` его отвергает и глава теряется целиком.
Пост-фазы здесь заглушены как в `stubbed`: режим про upsert, а не про них.

Запускать только на dev-БД:

    docker exec -e OPENROUTER_API_KEY= -e GEMINI_API_KEY= fancai_backend_dev \\
        python scripts/smoke_llm_book_pipeline.py \\
            [stubbed|failing|merge_failure|reduce_failure|no_aliases|all]
"""

import asyncio
import contextlib
import sys
import uuid
from unittest.mock import patch

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


def _fake_result(with_aliases: bool = True) -> ChapterAnalysisResult:
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
                aliases=["Белый Волк"] if with_aliases else [],
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
                aliases=["Старый вяз"] if with_aliases else [],
                confidence=0.9,
                importance=4,
            ),
        ],
        relationships=[],
    )


class FakeExtractor:
    """Совместим с `get_gemini_extractor()` по вызываемой поверхности."""

    def __init__(self, with_aliases: bool = True) -> None:
        self.calls = 0
        self._with_aliases = with_aliases

    def is_available(self) -> bool:
        return True

    async def analyze_chapter(self, content: str) -> ChapterAnalysisResult:
        self.calls += 1
        return _fake_result(with_aliases=self._with_aliases)


class _NoMerges:
    merge_groups: list = []


class _FailingMergeGroup:
    """Один авто-merge с достаточной уверенностью; id произвольные."""

    confidence = 0.9
    master_id = str(uuid.uuid4())
    duplicate_ids = [str(uuid.uuid4())]


class _OneGroup:
    merge_groups = [_FailingMergeGroup()]


@contextlib.contextmanager
def _phase_patches(mode: str):
    """Подмены на время одного режима — снимаются на выходе.

    Восстановление обязательно: `run_modes()` гоняет режимы в одном процессе,
    и без него `merge_failure` оставил бы инъекцию включённой, а следующий
    `failing` проверял бы не то, что заявляет.

    `stubbed` и `no_aliases` глушат четыре пост-фазы, которые ходят в AI
    за деньги.
    `merge_failure` роняет auto-merge настоящей ошибкой БД: проверяется
    обработчик в `book_tasks`, а не сам merge — реальный
    `_merge_entities_internal` транзакцией не управляет, и без SAVEPOINT'а
    вокруг вызова сессия осталась бы сломанной, а следующие фазы валились бы
    `InFailedSQLTransactionError`.
    `reduce_failure` роняет ошибкой БД фазу A изнутри настоящего
    `optimize_book_entities`: подменён только `_single_reduce_pass`. Проверяет
    обе половины контракта — сервис ошибку не глотает и не откатывает, а
    SAVEPOINT вызывающего ограничивает откат этой фазой. Остальные AI-фазы
    заглушены, чтобы сигнал был чистым.
    """
    from sqlalchemy import text

    from app.routers.admin import entities as admin_entities
    from app.services.consistency_manager import ConsistencyManager
    from app.services.entity_deduplication_service import EntityDeduplicationService
    from app.services.entity_synthesis_service import EntitySynthesisService

    async def _noop(*args, **kwargs):
        return None

    async def _no_merges(*args, **kwargs):
        return _NoMerges()

    async def _empty_synthesis(*args, **kwargs):
        return {}

    async def _one_group(self, *args, **kwargs):
        return _OneGroup()

    async def _boom(db, master_id, duplicate_ids):
        # Деление на ноль на стороне Postgres: та же категория отказа, что
        # нарушение constraint внутри merge — транзакция уходит в failed.
        await db.execute(text("SELECT 1 / 0"))

    async def _reduce_boom(self, entities):
        # Та же ошибка БД, но внутри фазы A: сервис обязан выпустить её
        # наружу, а не проглотить с откатом всей транзакции.
        await self.db.execute(text("SELECT 1 / 0"))

    with contextlib.ExitStack() as stack:
        if mode in ("stubbed", "no_aliases"):
            for target, name, repl in (
                (ConsistencyManager, "optimize_book_entities", _noop),
                (ConsistencyManager, "generate_master_references", _noop),
                (EntityDeduplicationService, "suggest_merges", _no_merges),
                (EntitySynthesisService, "synthesize_book_entities", _empty_synthesis),
            ):
                stack.enter_context(patch.object(target, name, repl))
        elif mode == "merge_failure":
            stack.enter_context(
                patch.object(EntityDeduplicationService, "suggest_merges", _one_group)
            )
            stack.enter_context(
                patch.object(admin_entities, "_merge_entities_internal", _boom)
            )
        elif mode == "reduce_failure":
            stack.enter_context(
                patch.object(ConsistencyManager, "_single_reduce_pass", _reduce_boom)
            )
            for target, name, repl in (
                (ConsistencyManager, "generate_master_references", _noop),
                (EntityDeduplicationService, "suggest_merges", _no_merges),
                (EntitySynthesisService, "synthesize_book_entities", _empty_synthesis),
            ):
                stack.enter_context(patch.object(target, name, repl))
        yield


SESSION_DAMAGE = (
    "greenlet_spawn",
    "MissingGreenlet",
    "PendingRollbackError",
    # Реальный симптом непокрытой ошибки БД: asyncpg сообщает не
    # PendingRollbackError, а «current transaction is aborted».
    "InFailedSQLTransactionError",
    "current transaction is aborted",
)


def _capture_task_logs(sink: list) -> int:
    """Подписывается на loguru и складывает сообщения `book_tasks` в `sink`."""
    from app.core.logging import logger as loguru_logger

    return loguru_logger.add(
        lambda message: sink.append(message.record["message"]),
        level="WARNING",
        filter=lambda record: record["name"] == "app.tasks.book_tasks",
    )


async def _drop_book(book_id) -> bool:
    """Удаляет книгу в собственной сессии; вызывается из `finally`.

    Возвращает `True`, если книги в БД не осталось. Своё исключение наружу
    не выпускает — из `finally` оно подменило бы исходное и спрятало настоящую
    причину падения; вместо этого о неудаче сообщает возвращаемое значение,
    и вызывающий делает прогон красным.

    Своя сессия обязательна: рабочая после отказа пост-фазы может быть
    в failed-состоянии.

    Bulk-DELETE не каскадит: FK на `chapters` объявлен без ON DELETE CASCADE,
    каскад живёт в ORM-relationship, поэтому удаляем через объект.
    """
    try:
        async with AsyncSessionLocal() as db:
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
        return True
    except Exception as cleanup_err:  # noqa: BLE001 — уборка не маскирует исходное
        print(f"cleanup           : FAILED, book {book_id} остался: {cleanup_err}")
        return False


async def main(mode: str) -> int:
    from app.tasks import book_tasks

    book_id = None
    cleaned = False
    # Создание книги тоже внутри try: commit может пройти на сервере
    # и упасть уже на клиенте — строка останется, и уборке нужен её id.
    try:
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

        fake = FakeExtractor(with_aliases=(mode != "no_aliases"))
        warnings: list = []
        sink_id = _capture_task_logs(warnings)
        try:
            with _phase_patches(mode), patch.object(
                book_tasks, "get_gemini_extractor", lambda: fake
            ):
                result = await book_tasks._process_book_async(book_id)
        finally:
            from app.core.logging import logger as loguru_logger

            loguru_logger.remove(sink_id)

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

        damaged = [w for w in warnings if any(m in w for m in SESSION_DAMAGE)]
        print(f"session damage    : {damaged or 'none'}")
        merge_tripped = any("Auto-merge failed" in w for w in warnings)
        # Именно инъекция, а не любой отказ фазы A: в `failing` она падает
        # на пустых ключах и тоже пишет «Reduce phase failed».
        reduce_tripped = any(
            "Reduce phase failed" in w and "division by zero" in w for w in warnings
        )
        # Печатаются во всех режимах: True в чужом режиме сразу видно глазами.
        print(f"auto-merge tripped: {merge_tripped}")
        print(f"reduce db failure : {reduce_tripped}")

        ok = (
            result["status"] == "completed"
            and result["chapters_processed"] == 2
            and parsed_chapters == 2
            and fake.calls == 2
            and entities == 2
            and descriptions == 4
            # Пост-фаза вправе упасть на пустых ключах, но не вправе оставить
            # сессию сломанной — иначе следующие фазы отваливаются не по своей
            # вине.
            and not damaged
            # Инъекция обязана срабатывать ровно в своём режиме: True в чужом
            # означает, что подмена протекла между режимами, и `failing`
            # проверял бы не незаглушенные пост-фазы, а чужую инъекцию.
            and merge_tripped == (mode == "merge_failure")
            and reduce_tripped == (mode == "reduce_failure")
        )
        print(f"SMOKE[{mode}]:", "PASS" if ok else "FAIL")
        code = 0 if ok else 1
    finally:
        if book_id is not None:
            cleaned = await _drop_book(book_id)

    # Сюда попадаем только штатным путём: при исключении `finally` уже отработал
    # и оно летит дальше нетронутым. Неудачная уборка красит прогон — иначе
    # оставленная книга уехала бы в следующий режим и в следующую сессию.
    if not cleaned:
        print(f"SMOKE[{mode}]: FAIL — уборка не прошла, книга {book_id} осталась")
        return 1
    return code


async def run_modes(modes: list) -> int:
    """Все режимы в одном loop.

    Второй `asyncio.run()` в том же процессе упал бы «Event loop is closed»:
    пул модульного engine держит соединения, привязанные к закрытому loop, —
    та же ловушка, из-за которой `process_book_task` зовёт `engine.dispose()`.

    Порядок режимов значения не имеет: подмены живут в `_phase_patches()`
    и снимаются на выходе из режима.
    """
    code = 0
    for mode in modes:
        code = max(code, await main(mode))
    return code


if __name__ == "__main__":
    requested = sys.argv[1] if len(sys.argv) > 1 else "stubbed"
    selected = (
        ["merge_failure", "reduce_failure", "failing", "no_aliases", "stubbed"]
        if requested == "all"
        else [requested]
    )
    sys.exit(asyncio.run(run_modes(selected)))
