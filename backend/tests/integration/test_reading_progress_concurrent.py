"""Integration tests for concurrent reading-progress writes.

Регрессия, ради которой файл существует: у `reading_progress` не было
уникального ограничения на (user_id, book_id), а сервис писал прогресс
через read-then-insert. Читалка сохраняет позицию пачками, поэтому два
одновременных запроса оба не находили строку и оба вставляли свою. Дубль
оставался навсегда, и `scalar_one_or_none()` — и в сервисе, и в
`GET /books/{id}/progress` — начинал падать «Multiple rows were found».
Прогресс книги ломался безвозвратно.

Второй, более тихий отказ: `max_chapter_reached` монотонно возрастает,
на нём держится спойлерный гейт глоссария. Read-modify-write без
блокировки строки позволял двум сохранениям прочитать одно старое
значение, и поздний commit ЗАНИЖАЛ максимум — то есть открывал доступ
к меньшему числу глав, чем читатель уже видел.

Само ограничение `uq_reading_progress_user_book` отдельным тестом здесь
не проверяется: фикстуры создают event loop на тест, а второй тест в этом
классе переиспользует движок первого и падает «attached to a different
loop» — проверка ловила бы фикстуру, а не схему. Ограничение проверено
живьём на round-trip миграции `g1h2i3j4k5l6`: повторная вставка отвергается
`duplicate key value violates unique constraint`.
"""

import asyncio

import pytest
from sqlalchemy import delete, func, select

from app.models.book import ReadingProgress
from app.models.chapter import Chapter
from app.services.book.book_progress_service import BookProgressService


@pytest.mark.asyncio
@pytest.mark.integration
class TestReadingProgressConcurrentWrites:
    """Одновременные сохранения позиции."""

    async def test_concurrent_writes_keep_single_row_and_max_chapter(
        self, test_db, test_user, test_book
    ):
        """Восемь параллельных сохранений: одна строка и максимум по главам."""
        from tests.conftest import TestSessionLocal

        service = BookProgressService()
        user_id = test_user.id
        book_id = test_book.id

        # Главы нужны: сервис зажимает номер главы по их количеству.
        # Фикстура `test_book` уже создала 1–3, добавляем только 4–8.
        async with TestSessionLocal() as session:
            for number in range(4, 9):
                session.add(
                    Chapter(
                        book_id=book_id,
                        chapter_number=number,
                        title=f"Глава {number}",
                        content="Текст главы " * 40,
                        word_count=80,
                        estimated_reading_time=1,
                        is_description_parsed=False,
                        descriptions_found=0,
                        parsing_progress=100,
                    )
                )
            await session.commit()

        chapters = [3, 8, 1, 5, 2, 7, 4, 6]

        async def save(chapter: int) -> None:
            # Каждая корутина — своя сессия: иначе это не гонка, а очередь.
            async with TestSessionLocal() as session:
                await service.update_reading_progress(
                    db=session,
                    user_id=user_id,
                    book_id=book_id,
                    chapter_number=chapter,
                    position_percent=float(chapter * 10),
                )

        try:
            await asyncio.gather(*[save(c) for c in chapters])

            async with TestSessionLocal() as session:
                rows = (
                    await session.execute(
                        select(func.count())
                        .select_from(ReadingProgress)
                        .where(
                            ReadingProgress.user_id == user_id,
                            ReadingProgress.book_id == book_id,
                        )
                    )
                ).scalar_one()
                assert rows == 1, (
                    f"После {len(chapters)} одновременных сохранений строк "
                    f"прогресса должно остаться ровно 1, а их {rows}"
                )

                progress = (
                    await session.execute(
                        select(ReadingProgress).where(
                            ReadingProgress.user_id == user_id,
                            ReadingProgress.book_id == book_id,
                        )
                    )
                ).scalar_one()
                assert progress.max_chapter_reached == max(chapters), (
                    "max_chapter_reached обязан быть монотонным: ожидался "
                    f"{max(chapters)}, получен {progress.max_chapter_reached}"
                )
        finally:
            async with TestSessionLocal() as session:
                await session.execute(
                    delete(ReadingProgress).where(ReadingProgress.book_id == book_id)
                )
                # Главы 1–3 принадлежат фикстуре — их не трогаем.
                await session.execute(
                    delete(Chapter).where(
                        Chapter.book_id == book_id, Chapter.chapter_number >= 4
                    )
                )
                await session.commit()
