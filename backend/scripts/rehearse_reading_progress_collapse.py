"""Репетиция миграции `g1h2i3j4k5l6` на настоящих дублях `reading_progress`.

Миграция разрушительная: она схлопывает дубли живых пользователей и лишние
строки каждой группы удаляет безвозвратно. На dev-БД дублей нет (один
пользователь, одна книга), поэтому логика выбора победителя там не
проверяется вовсе — `upgrade` проходит по пустому множеству. Прогонять
до выкатки на прод, где дубли как раз есть: ради них миграция и написана.

Группы покрывают все достижимые ветки `ORDER BY`:

* `plain`        — обычный дубль, победитель по `last_read_at`;
* `tie_position` — дата и глава равны, победитель по `current_position`;
* `tie_chapter`  — дата равна, но у одной строки глава дальше, а позиция
  внутри главы меньше. Победить обязана дальняя глава: `current_position` —
  это процент ВНУТРИ главы, и сортировка по нему одному потеряла бы
  прогресс. Ради этого случая в миграцию добавлен `current_chapter DESC`;
* `tie_all`      — совпадает всё, победитель по `id`;
* `spoiler`      — самый свежий прогресс имеет НЕ максимальный
  `max_chapter_reached`; проверяется, что спойлерный гейт не понижен;
* `triple`       — три строки в группе, а не две;
* `single`       — контрольная группа из одной строки, её трогать нельзя.

Чего в списке нет и почему: ветки `NULLS LAST` недостижимы по данным —
`last_read_at` и `max_chapter_reached` объявлены NOT NULL с дефолтами
(`now()` и `1`). В миграции они оставлены защитой, воспроизвести их
на этой схеме нельзя.

Запуск — на отдельной БД, не на dev:

    URL=postgresql+asyncpg://USER:PASS@postgres:5432/migration_rehearsal
    docker exec -e DATABASE_URL=$URL fancai_backend_dev \\
        python scripts/rehearse_reading_progress_collapse.py seed
    docker exec -e DATABASE_URL=$URL fancai_backend_dev alembic upgrade head
    docker exec -e DATABASE_URL=$URL fancai_backend_dev \\
        python scripts/rehearse_reading_progress_collapse.py verify
"""

import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.core.database import AsyncSessionLocal

BASE = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)

# (смещение last_read_at в минутах, current_chapter, current_position,
#  max_chapter_reached, маркер)
#
# Первая строка группы — ожидаемый победитель. Маркер кладётся
# в `reading_time_minutes`: этой колонки миграция не касается, и по ней
# `verify` опознаёт выжившего там, где остальные поля совпадают.
GROUPS: dict[str, list[tuple[int, int, int, int, int]]] = {
    "plain": [(30, 2, 40, 4, 1), (10, 3, 90, 3, 2)],
    "tie_position": [(20, 5, 75, 5, 1), (20, 5, 20, 2, 2)],
    "tie_chapter": [(20, 10, 20, 6, 1), (20, 1, 90, 3, 2)],
    "tie_all": [(20, 4, 50, 3, 1), (20, 4, 50, 6, 2)],
    "spoiler": [(50, 3, 10, 2, 1), (5, 8, 5, 9, 2)],
    "triple": [(40, 2, 11, 3, 1), (25, 5, 22, 8, 2), (10, 7, 33, 5, 3)],
    "single": [(15, 3, 55, 3, 1)],
}


async def seed() -> int:
    async with AsyncSessionLocal() as db:
        user_id = uuid.uuid4()
        await db.execute(
            text(
                "INSERT INTO users (id, email, password_hash, is_active,"
                " is_verified, is_admin, longest_streak_days, timezone,"
                " created_at, updated_at) VALUES (:id, :email, 'x', true, true,"
                " false, 0, 'UTC', now(), now())"
            ),
            {"id": user_id, "email": f"rehearsal-{user_id.hex[:8]}@example.com"},
        )

        for label, rows in GROUPS.items():
            book_id = uuid.uuid4()
            await db.execute(
                text(
                    "INSERT INTO books (id, user_id, title, author, file_path,"
                    " file_format, file_size, genre, language, total_pages,"
                    " estimated_reading_time, is_parsed, parsing_progress,"
                    " is_processing, descriptions_extracted, created_at,"
                    " updated_at) VALUES (:id, :user_id, :title, 'Rehearsal',"
                    " :path, 'epub', 1, 'fantasy', 'ru', 1, 1, true, 100,"
                    " false, false, now(), now())"
                ),
                {
                    "id": book_id,
                    "user_id": user_id,
                    "title": f"rehearsal-{label}",
                    "path": f"/tmp/rehearsal-{label}.epub",
                },
            )

            # Возрастающие id в порядке списка: в группе `tie_all` победитель
            # определяется именно по `id`, и ожидание «побеждает первая
            # строка списка» должно быть верно и там.
            ids = sorted(uuid.uuid4() for _ in rows)
            for row_id, (offset, chapter, position, reached, marker) in zip(ids, rows):
                await db.execute(
                    text(
                        "INSERT INTO reading_progress (id, user_id, book_id,"
                        " current_chapter, current_page, current_position,"
                        " reading_time_minutes, reading_speed_wpm,"
                        " scroll_offset_percent, max_chapter_reached,"
                        " last_read_at, created_at, updated_at)"
                        " VALUES (:id, :user_id, :book_id, :chapter, 1,"
                        " :position, :marker, 0, 0, :reached, :last_read_at,"
                        " now(), now())"
                    ),
                    {
                        "id": row_id,
                        "user_id": user_id,
                        "book_id": book_id,
                        "chapter": chapter,
                        "position": position,
                        "reached": reached,
                        "marker": marker,
                        "last_read_at": BASE + timedelta(minutes=offset),
                    },
                )
        await db.commit()

        total = (
            await db.execute(text("SELECT count(*) FROM reading_progress"))
        ).scalar_one()
        print(f"seed: групп {len(GROUPS)}, строк прогресса {total}")
        return 0


async def verify() -> int:
    failures: list[str] = []
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    "SELECT b.title, count(*) AS n,"
                    " min(rp.reading_time_minutes) AS marker,"
                    " min(rp.current_chapter) AS chapter,"
                    " min(rp.current_position) AS position,"
                    " min(rp.max_chapter_reached) AS reached"
                    " FROM reading_progress rp JOIN books b ON b.id = rp.book_id"
                    " WHERE b.author = 'Rehearsal' GROUP BY b.title ORDER BY b.title"
                )
            )
        ).all()

        seen = {
            title.removeprefix("rehearsal-"): rest
            for title, *rest in [list(r) for r in rows]
        }
        if set(seen) != set(GROUPS):
            failures.append(
                f"группы не совпали: {sorted(seen)} против {sorted(GROUPS)}"
            )

        for label, spec in GROUPS.items():
            if label not in seen:
                continue
            count, marker, chapter, position, reached = seen[label]
            _, want_chapter, want_position, _, want_marker = spec[0]
            want_reached = max(row[3] for row in spec)

            if count != 1:
                failures.append(f"{label}: строк {count}, ожидалась 1")
            if marker != want_marker:
                failures.append(
                    f"{label}: выжила строка {marker}, ожидалась {want_marker}"
                )
            if (chapter, position) != (want_chapter, want_position):
                failures.append(
                    f"{label}: позиция {chapter}/{position},"
                    f" ожидалась {want_chapter}/{want_position}"
                )
            if reached != want_reached:
                failures.append(
                    f"{label}: max_chapter_reached {reached},"
                    f" ожидался максимум группы {want_reached}"
                )
            print(
                f"{label:13}: строк={count} выжила={marker} глава/позиция="
                f"{chapter}/{position} reached={reached}"
            )

        constraint = (
            await db.execute(
                text(
                    "SELECT count(*) FROM pg_constraint"
                    " WHERE conname = 'uq_reading_progress_user_book'"
                )
            )
        ).scalar_one()
        if constraint != 1:
            failures.append("ограничение uq_reading_progress_user_book не создано")
        print(f"ограничение: {'есть' if constraint == 1 else 'НЕТ'}")

    if failures:
        print("\nREHEARSAL: FAIL")
        for line in failures:
            print(f"  - {line}")
        return 1
    print("\nREHEARSAL: PASS")
    return 0


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "verify"
    sys.exit(asyncio.run(seed() if action == "seed" else verify()))
