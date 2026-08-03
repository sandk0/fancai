"""Обратимая фикстура среды для Playwright-прогона. Только dev-БД.

Задача — дать e2e-набору предсказуемых пользователей и книгу с разобранными
главами, **ничего не потеряв**.

Изоляция по воркеру, а не общий аккаунт. Playwright гоняет пять браузерных
проектов параллельно, а `books.spec.ts` удаляет книгу через API — то есть
с диска. Один общий аккаунт с одной книгой означает, что первый же
прошедший delete-тест оставляет спеки читалки и картинок без данных.
Поэтому создаётся по аккаунту и книге на каждый parallel-слот Playwright:
`parallelIndex` уникален среди одновременно работающих воркеров, поэтому
двух одновременных пользователей одной фикстуры не бывает.

Правила, ради которых скрипт вообще написан (прошлая попытка была удалена
именно за их нарушение):

1. Ни одна существующая запись не трогается. Аккаунты живут в пространстве
   имён прогона `e2e-run-<run_id>.…@fancai.ru` — коллизия с настоящим
   аккаунтом невозможна, поэтому и подменять чужой `password_hash` не нужно.
   Совпадение имени считается аварией и останавливает setup.
2. Удаляется только созданное этим прогоном и только по ID: записанные
   аккаунты и книги, аккаунты, зарегистрированные тестами через UI (они
   обязаны попасть в то же пространство имён), и контент под ними. Разность
   снимков БД как критерий удаления не годится — она снесла бы
   и параллельную запись владельца. Снимок используется только для сверки:
   неопознанный остаток красит прогон, но не удаляется.
3. Книга не переиспользуется и не переприсваивается: делается копия строки,
   её глав и **самого файла**. Причина конкретная — `BookService.delete_book`
   удаляет файл с диска, а спека «should successfully delete a book» дергает
   именно этот эндпоинт. Общий `file_path` стоил бы единственного реального
   EPUB в dev-окружении.
4. Провал уборки красит прогон: teardown возвращает ненулевой код.

Состояние между фазами живёт в JSON-файле, путь передаётся `--state`.

    docker exec fancai_backend_dev python scripts/e2e_fixture.py setup \\
        --state /tmp/e2e-fixture-state.json --workers 4
    docker exec fancai_backend_dev python scripts/e2e_fixture.py teardown \\
        --state /tmp/e2e-fixture-state.json
"""

import argparse
import asyncio
import base64
import json
import os
import re
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.book import Book
from app.models.chapter import Chapter
from app.models.description import Description, DescriptionType
from app.models.entity import Entity, EntityType
from app.models.image import GeneratedImage
from app.models.user import Subscription, SubscriptionPlan, SubscriptionStatus, User
from app.services.auth_service import AuthService

# Обязан совпадать с frontend/tests/fixtures/test-users.ts
FIXTURE_PASSWORD = "E2eFixture!Pw7"


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


async def _snapshot_ids(db) -> dict[str, list[str]]:
    return {
        "users": [str(x) for x in (await db.execute(select(User.id))).scalars()],
        "books": [str(x) for x in (await db.execute(select(Book.id))).scalars()],
        "images": [
            str(x) for x in (await db.execute(select(GeneratedImage.id))).scalars()
        ],
    }


async def _clone_book_for(
    db, source: Book, owner: User, copied: list[Path]
) -> dict[str, Any] | None:
    """Копирует книгу владельцу фикстуры: строку, главы и файлы.

    Оригинал не изменяется ничем. Пути скопированных файлов складываются
    в `copied`, чтобы аварийный откат setup смог их убрать.
    """
    src_path = Path(source.file_path)
    if not src_path.exists():
        print(f"WARN: файл книги {src_path} отсутствует — копия не создаётся")
        return None

    new_id = uuid.uuid4()
    new_path = src_path.with_name(f"{uuid.uuid4()}{src_path.suffix}")
    shutil.copy2(src_path, new_path)
    copied.append(new_path)

    # Обложка тоже копируется: delete_book снесёт её вместе с копией,
    # а общая обложка означала бы дыру в оригинале.
    cover_path: str | None = None
    if source.cover_image:
        cover_src = Path(source.cover_image)
        if cover_src.exists():
            cover_dst = cover_src.with_name(f"{uuid.uuid4()}{cover_src.suffix}")
            shutil.copy2(cover_src, cover_dst)
            copied.append(cover_dst)
            cover_path = str(cover_dst)

    db.add(
        Book(
            id=new_id,
            user_id=owner.id,
            title=source.title,
            author=source.author,
            genre=source.genre,
            language=source.language,
            file_path=str(new_path),
            file_format=source.file_format,
            file_size=source.file_size,
            cover_image=cover_path,
            description=source.description,
            total_pages=source.total_pages,
            estimated_reading_time=source.estimated_reading_time,
            is_parsed=source.is_parsed,
            parsing_progress=source.parsing_progress,
            book_metadata=source.book_metadata,
            is_processing=False,
            descriptions_extracted=source.descriptions_extracted,
        )
    )
    await db.flush()

    chapters = (
        (
            await db.execute(
                select(Chapter)
                .where(Chapter.book_id == source.id)
                .order_by(Chapter.chapter_number)
            )
        )
        .scalars()
        .all()
    )
    first_chapter_id: uuid.UUID | None = None
    first_chapter_number: int | None = None
    first_chapter_title: str | None = None
    first_chapter_text = ""
    for ch in chapters:
        clone_chapter = Chapter(
            book_id=new_id,
            chapter_number=ch.chapter_number,
            title=ch.title,
            content=ch.content,
            html_content=ch.html_content,
            word_count=ch.word_count,
            estimated_reading_time=ch.estimated_reading_time,
            is_description_parsed=True,
            descriptions_found=ch.descriptions_found,
            parsing_progress=ch.parsing_progress,
            is_service_page=ch.is_service_page,
            file_path=ch.file_path,
        )
        db.add(clone_chapter)
        await db.flush()
        # Первая НЕ служебная глава с настоящей прозой: из её текста
        # берутся описания, иначе подсветке нечего искать.
        if (
            first_chapter_id is None
            and not ch.is_service_page
            and len(ch.content or "") > 400
        ):
            first_chapter_id = clone_chapter.id
            first_chapter_number = ch.chapter_number
            first_chapter_title = ch.title
            first_chapter_text = ch.content or ""

    # Сущность, описания и одна картинка. Без них спеки глоссария и галереи
    # проверяли бы пустой экран: в dev-БД ноль сущностей и ноль описаний,
    # а получить их по-настоящему — это платные вызовы AI (стоп-точка).
    # Данные кладутся напрямую в БД, ни одного обращения к провайдеру.
    seeded = await _seed_glossary(
        db, new_id, first_chapter_id, first_chapter_text, owner, copied
    )

    return {
        "book_id": str(new_id),
        "file_path": str(new_path),
        "cover_image": cover_path,
        "chapters": len(chapters),
        "seeded_chapter": first_chapter_number,
        # Номер главы в БД и позиция в оглавлении EPUB не совпадают
        # (в оглавлении есть служебные разделы), поэтому тест переходит
        # по названию, а не по индексу.
        "seeded_chapter_title": first_chapter_title,
        **seeded,
    }


# 1×1 PNG: галерее нужен реальный файл на диске, а не заглушка пути.
PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _sentences_from(text: str, count: int) -> list[str]:
    """Забирает из текста главы `count` осмысленных предложений.

    Содержимое описаний обязано **дословно** встречаться в главе:
    `useDescriptionHighlighting` ищет `desc.content` в отрисованном тексте,
    и выдуманная фраза не подсветится никогда.
    """
    parts = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text or "")]
    good = [s for s in parts if 60 <= len(s) <= 240]
    # Первые предложения главы склеены с её заголовком («Глава первая Каэдвен…»),
    # а `removeChapterHeaders` в матчере подсветки его срезает — совпадения
    # не будет. Берём из середины.
    return good[3 : 3 + count] if len(good) >= 3 + count else good[:count]


async def _seed_glossary(
    db,
    book_id: uuid.UUID,
    chapter_id: uuid.UUID | None,
    chapter_text: str,
    owner: User,
    copied: list[Path],
) -> dict[str, Any]:
    """Кладёт сущность, два описания и одну готовую картинку."""
    sentences = _sentences_from(chapter_text, 2)
    if chapter_id is None or len(sentences) < 2:
        print("WARN: в главе не нашлось подходящих предложений — глоссарий не засеян")
        return {"description_ids": [], "image_id": None}

    db.add(
        Entity(
            book_id=book_id,
            type=EntityType.CHARACTER.value,
            name="Геральт",
            name_lower="геральт",
            visual_summary="Седой ведьмак со шрамом на щеке и двумя мечами за спиной.",
            importance=9,
            first_mention_chapter=1,
            entity_metadata={},
        )
    )

    with_image = Description(
        chapter_id=chapter_id,
        type=DescriptionType.CHARACTER.value,
        content=sentences[0],
        confidence_score=0.92,
        position_in_chapter=1,
        word_count=len(sentences[0].split()),
        is_suitable_for_generation=True,
        priority_score=0.9,
        image_generated=True,
        generation_requested=True,
    )
    without_image = Description(
        chapter_id=chapter_id,
        type=DescriptionType.LOCATION.value,
        content=sentences[1],
        confidence_score=0.81,
        position_in_chapter=2,
        word_count=len(sentences[1].split()),
        is_suitable_for_generation=True,
        priority_score=0.7,
        image_generated=False,
        generation_requested=False,
    )
    db.add(with_image)
    db.add(without_image)
    await db.flush()

    # Каталог именно этот: `images.py:66` отдаёт файлы из
    # GENERATED_IMAGES_DIR = /app/storage/generated_images. Любой другой путь
    # даст 404 на превью в галерее.
    images_dir = Path("/app/storage/generated_images")
    images_dir.mkdir(parents=True, exist_ok=True)
    image_path = images_dir / f"illustration_{uuid.uuid4()}.png"
    image_path.write_bytes(PIXEL_PNG)
    copied.append(image_path)

    image = GeneratedImage(
        description_id=with_image.id,
        chapter_id=chapter_id,
        user_id=owner.id,
        # "imagen" — значение под CHECK-constraint миграции add_imagen_2025;
        # переименовывать его нельзя, см. handoff 2026-08-04.
        service_used="imagen",
        status="completed",
        local_path=str(image_path),
        # API отдаёт `image.image_url or ""` и путь сам не строит: без этого
        # поля галерея получает пустой src, а тест файла — пустой URL.
        image_url=f"/api/v1/images/file/{image_path.name}",
        prompt_used="A grey-haired witcher with a scar, dark cloak, two swords",
        image_width=1,
        image_height=1,
        file_size=len(PIXEL_PNG),
        file_format="png",
        is_moderated=False,
        view_count=0,
        download_count=0,
        retry_count=0,
        generated_at=datetime.now(timezone.utc),
    )
    db.add(image)
    await db.flush()

    return {
        "description_ids": [str(with_image.id), str(without_image.id)],
        "image_id": str(image.id),
        # Путь пишется в state, а не берётся из строки при уборке: тест мог
        # удалить или перегенерировать картинку через API, и тогда исходный
        # файл остался бы на диске без единой ссылки.
        "image_path": str(image_path),
    }


async def setup(state_path: Path, workers: int) -> int:
    db_name = _assert_dev_database()
    if state_path.exists():
        raise SystemExit(
            f"REFUSING: {state_path} уже существует — предыдущий прогон не убрался. "
            "Сначала teardown по этому файлу, иначе его записи станут потерянными."
        )

    auth = AuthService()
    run_id = uuid.uuid4().hex[:12]
    password_hash = auth.get_password_hash(FIXTURE_PASSWORD)

    state: dict[str, Any] = {
        "database": db_name,
        "run_id": run_id,
        "password": FIXTURE_PASSWORD,
        "workers": [],
    }
    # Порядок важен: state пишется ДО commit. След в БД без записи о нём —
    # это осиротевшие данные, которые teardown не найдёт; запись без следа
    # безобидна и снимается тем же аварийным откатом.
    copied: list[Path] = []
    committed = False
    try:
        async with AsyncSessionLocal() as db:
            state["snapshot"] = await _snapshot_ids(db)

            source = (
                (
                    await db.execute(
                        select(Book)
                        .where(Book.is_parsed.is_(True))
                        .order_by(Book.created_at)
                    )
                )
                .scalars()
                .first()
            )
            if source is None:
                print(
                    "WARN: в dev-БД нет ни одной разобранной книги — "
                    "спеки читалки и картинок будут пропущены"
                )

            for index in range(workers):
                email = f"e2e-run-{run_id}.worker-{index}@fancai.ru"
                collision = (
                    await db.execute(select(User).where(User.email == email))
                ).scalar_one_or_none()
                if collision is not None:
                    raise SystemExit(
                        f"REFUSING: {email} уже существует. Пространство имён "
                        "прогона обязано быть свободным — иначе уборка тронет "
                        "чужую запись."
                    )

                user = User(
                    email=email,
                    password_hash=password_hash,
                    full_name=f"E2E Worker {index}",
                    is_active=True,
                    is_verified=True,
                )
                db.add(user)
                await db.flush()
                # Без строки подписки `GET /users/subscription` отвечает 404,
                # а от неё зависят лимиты генерации изображений.
                db.add(
                    Subscription(
                        user_id=user.id,
                        plan=SubscriptionPlan.FREE,
                        status=SubscriptionStatus.ACTIVE,
                        start_date=datetime.now(timezone.utc),
                        auto_renewal=False,
                        books_uploaded=0,
                        images_generated_month=0,
                        last_reset_date=datetime.now(timezone.utc),
                    )
                )

                book = (
                    await _clone_book_for(db, source, user, copied) if source else None
                )
                state["workers"].append(
                    {"index": index, "email": email, "id": str(user.id), "book": book}
                )
                chapters = book["chapters"] if book else 0
                print(f"worker {index}: {email} ({user.id}), book chapters={chapters}")

            state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
            await db.commit()
            committed = True
    except BaseException:
        if not committed:
            for path in copied:
                if path.exists():
                    path.unlink()
            if state_path.exists():
                state_path.unlink()
            print("setup откатан: БД не изменена, копии файлов удалены")
        raise

    print(f"state written: {state_path}")
    return 0


async def teardown(state_path: Path) -> int:
    if not state_path.exists():
        print(f"FAIL: файла состояния нет: {state_path}")
        return 1

    _assert_dev_database()
    state = json.loads(state_path.read_text(encoding="utf-8"))
    snapshot = state["snapshot"]
    run_prefix = f"e2e-run-{state['run_id']}."
    problems: list[str] = []

    async with AsyncSessionLocal() as db:
        # 1. Аккаунты прогона: записанные воркерские плюс всё, что тесты
        #    зарегистрировали через UI внутри того же пространства имён.
        recorded = {uuid.UUID(w["id"]) for w in state["workers"]}
        run_users = [
            u
            for u in (await db.execute(select(User))).scalars().all()
            if u.email.startswith(run_prefix) or u.id in recorded
        ]
        owned_ids = {u.id for u in run_users}

        # 2. Контент под этими аккаунтами: картинки, затем книги (файлы —
        #    руками, каскад про диск не знает), затем сами аккаунты.
        if owned_ids:
            for image in (
                (
                    await db.execute(
                        select(GeneratedImage).where(
                            GeneratedImage.user_id.in_(owned_ids)
                        )
                    )
                )
                .scalars()
                .all()
            ):
                # Файл на диске каскад не трогает — снимаем руками.
                if image.local_path and os.path.exists(image.local_path):
                    os.remove(image.local_path)
                    print(f"file removed: {image.local_path}")
                await db.delete(image)
                print(f"image deleted: {image.id}")

            for book in (
                (await db.execute(select(Book).where(Book.user_id.in_(owned_ids))))
                .scalars()
                .all()
            ):
                for path in (book.file_path, book.cover_image):
                    if path and os.path.exists(path):
                        os.remove(path)
                        print(f"file removed: {path}")
                await db.delete(book)
                print(f"book deleted: {book.id}")

            for user in run_users:
                await db.delete(user)
                print(f"user deleted: {user.id} ({user.email})")

        # 3. Файлы книг, чьи строки тесты успели удалить через API сами.
        for worker in state["workers"]:
            book = worker.get("book")
            if not book:
                continue
            for key in ("file_path", "cover_image", "image_path"):
                path = book.get(key)
                if path and os.path.exists(path):
                    os.remove(path)
                    print(f"orphan file removed: {path}")

        await db.commit()

        # 4. Сверка. Неопознанное НЕ удаляется — прогон падает и оставляет
        #    разбор человеку.
        after = await _snapshot_ids(db)
        for key in ("users", "books", "images"):
            extra = sorted(set(after[key]) - set(snapshot[key]))
            missing = sorted(set(snapshot[key]) - set(after[key]))
            if extra:
                problems.append(
                    f"{key}: остались неопознанные записи {extra} — "
                    "автоматически они не удаляются, разобрать вручную"
                )
            if missing:
                problems.append(f"{key}: пропали существовавшие {missing}")

    if problems:
        print("TEARDOWN FAILED:")
        for p in problems:
            print(f"  - {p}")
        return 1

    state_path.unlink()
    print("teardown OK: счётчики вернулись к входным")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["setup", "teardown"])
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args()
    if args.action == "setup":
        return asyncio.run(setup(args.state, args.workers))
    return asyncio.run(teardown(args.state))


if __name__ == "__main__":
    sys.exit(main())
