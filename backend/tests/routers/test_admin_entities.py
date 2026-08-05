"""Админские операции над сущностями: дубликаты, слияние, CFI.

Все маршруты закрыты `get_current_admin_user`: обычный пользователь получает
403, без токена — 401.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.chapter import Chapter
from app.models.description import Description, DescriptionType
from app.models.description_entity import DescriptionEntity
from app.models.entity import Entity, EntityType
from app.models.entity_mention import EntityMention
from app.models.user import User


async def _make_entity(
    db: AsyncSession,
    book: Book,
    name: str,
    *,
    name_lower: str | None = None,
    importance: int = 5,
    aliases: list[str] | None = None,
) -> Entity:
    entity = Entity(
        book_id=book.id,
        name=name,
        # `name_lower` пишется как `name.casefold()[:255]` — без strip, поэтому
        # «Геральт» и « Геральт» проходят уникальный индекс как разные строки.
        name_lower=name_lower if name_lower is not None else name.casefold()[:255],
        type=EntityType.CHARACTER.value,
        importance=importance,
        entity_metadata={"aliases": aliases} if aliases is not None else None,
    )
    db.add(entity)
    await db.commit()
    await db.refresh(entity)
    return entity


async def _make_mention(
    db: AsyncSession,
    entity: Entity,
    chapter: Chapter,
    *,
    start_index: int | None = None,
) -> EntityMention:
    mention = EntityMention(
        entity_id=entity.id,
        chapter_id=chapter.id,
        mention_text=entity.name,
        start_index=start_index,
    )
    db.add(mention)
    await db.commit()
    await db.refresh(mention)
    return mention


async def _make_description(db: AsyncSession, chapter: Chapter) -> Description:
    description = Description(
        chapter_id=chapter.id,
        type=DescriptionType.CHARACTER,
        content="Описание",
        confidence_score=0.9,
        priority_score=0.5,
        position_in_chapter=0,
        word_count=1,
    )
    db.add(description)
    await db.commit()
    await db.refresh(description)
    return description


async def _make_book(db: AsyncSession, user: User, title: str) -> Book:
    book = Book(
        user_id=user.id,
        title=title,
        author="Автор",
        file_path=f"/tmp/{title}.epub",
        file_format="epub",
        file_size=1024,
        language="ru",
    )
    db.add(book)
    await db.commit()
    await db.refresh(book)
    return book


# ============================================================================
# GET /admin/entities/duplicates
# ============================================================================


class TestDuplicateEntities:
    @pytest.mark.asyncio
    async def test_requires_admin(
        self, client: AsyncClient, test_user_auth_headers: dict
    ):
        response = await client.get(
            "/api/v1/admin/entities/duplicates", headers=test_user_auth_headers
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient):
        response = await client.get("/api/v1/admin/entities/duplicates")

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_groups_names_differing_only_by_case_and_spaces(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        admin_auth_headers: dict,
    ):
        """Именно эти пары уникальный индекс по `name_lower` не ловит."""
        await _make_entity(db_session, test_book, "Геральт", importance=3)
        await _make_entity(
            db_session, test_book, " геральт ", name_lower=" геральт ", importance=9
        )
        await _make_entity(db_session, test_book, "Лютик")

        response = await client.get(
            "/api/v1/admin/entities/duplicates", headers=admin_auth_headers
        )

        assert response.status_code == 200
        body = response.json()
        assert body["total_duplicates"] == 1
        assert len(body["groups"]) == 1
        group = body["groups"][0]
        assert group["normalized_name"] == "геральт"
        assert group["book_title"] == test_book.title
        # Внутри группы порядок по убыванию importance: мастер сверху.
        assert [e["importance"] for e in group["entities"]] == [9, 3]

    @pytest.mark.asyncio
    async def test_same_name_in_different_books_is_not_a_duplicate(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        admin_auth_headers: dict,
    ):
        """Ключ группировки — пара (book_id, имя), иначе слились бы разные книги."""
        other_book = await _make_book(db_session, test_user, "Другая книга")

        await _make_entity(db_session, test_book, "Геральт")
        await _make_entity(db_session, other_book, "Геральт")

        response = await client.get(
            "/api/v1/admin/entities/duplicates", headers=admin_auth_headers
        )

        assert response.json() == {"groups": [], "total_duplicates": 0}

    @pytest.mark.asyncio
    async def test_book_id_filter_narrows_scan(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        admin_auth_headers: dict,
    ):
        other_book = await _make_book(db_session, test_user, "Другая книга")

        await _make_entity(db_session, test_book, "Геральт")
        await _make_entity(db_session, test_book, "геральт", name_lower="геральт!")
        await _make_entity(db_session, other_book, "Цири")
        await _make_entity(db_session, other_book, "цири", name_lower="цири!")

        response = await client.get(
            f"/api/v1/admin/entities/duplicates?book_id={other_book.id}",
            headers=admin_auth_headers,
        )

        assert response.json()["total_duplicates"] == 1
        assert response.json()["groups"][0]["normalized_name"] == "цири"


# ============================================================================
# POST /admin/entities/merge
# ============================================================================


class TestMergeEntities:
    @pytest.mark.asyncio
    async def test_empty_duplicate_list_is_400(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        response = await client.post(
            "/api/v1/admin/entities/merge",
            json={"master_id": str(uuid.uuid4()), "duplicate_ids": []},
            headers=admin_auth_headers,
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "No duplicate IDs provided"

    @pytest.mark.asyncio
    async def test_master_inside_duplicates_is_400(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Иначе мастер удалился бы вместе с дубликатами."""
        master_id = str(uuid.uuid4())

        response = await client.post(
            "/api/v1/admin/entities/merge",
            json={"master_id": master_id, "duplicate_ids": [master_id]},
            headers=admin_auth_headers,
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "Master ID cannot be in duplicate IDs"

    @pytest.mark.asyncio
    async def test_unknown_master_is_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        admin_auth_headers: dict,
    ):
        duplicate = await _make_entity(db_session, test_book, "Лютик")

        response = await client.post(
            "/api/v1/admin/entities/merge",
            json={
                "master_id": str(uuid.uuid4()),
                "duplicate_ids": [str(duplicate.id)],
            },
            headers=admin_auth_headers,
        )

        assert response.status_code == 404
        assert await db_session.get(Entity, duplicate.id) is not None

    @pytest.mark.asyncio
    async def test_merge_repoints_mentions_and_absorbs_aliases(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_chapter: Chapter,
        admin_auth_headers: dict,
    ):
        master = await _make_entity(
            db_session, test_book, "Геральт", importance=4, aliases=["Ведьмак"]
        )
        duplicate = await _make_entity(
            db_session,
            test_book,
            "Белый Волк",
            importance=8,
            aliases=["Гвинблейдд"],
        )
        mention = await _make_mention(db_session, duplicate, test_chapter)

        response = await client.post(
            "/api/v1/admin/entities/merge",
            json={
                "master_id": str(master.id),
                "duplicate_ids": [str(duplicate.id)],
            },
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["merged_count"] == 1
        assert response.json()["success"] is True

        assert await db_session.get(Entity, duplicate.id) is None
        await db_session.refresh(mention)
        assert mention.entity_id == master.id

        await db_session.refresh(master)
        # Алиасы обоих плюс имя поглощённой сущности.
        assert set(master.entity_metadata["aliases"]) == {
            "Ведьмак",
            "Гвинблейдд",
            "Белый Волк",
        }
        # Важность берётся максимальная, а не мастерская.
        assert master.importance == 8

    @pytest.mark.asyncio
    async def test_shared_description_link_is_dropped_not_duplicated(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_chapter: Chapter,
        admin_auth_headers: dict,
    ):
        """Обе сущности связаны с одним описанием — после слияния связь одна."""
        master = await _make_entity(db_session, test_book, "Геральт")
        duplicate = await _make_entity(db_session, test_book, "Белый Волк")
        shared = await _make_description(db_session, test_chapter)
        own = await _make_description(db_session, test_chapter)

        db_session.add_all(
            [
                DescriptionEntity(description_id=shared.id, entity_id=master.id),
                DescriptionEntity(description_id=shared.id, entity_id=duplicate.id),
                DescriptionEntity(description_id=own.id, entity_id=duplicate.id),
            ]
        )
        await db_session.commit()

        response = await client.post(
            "/api/v1/admin/entities/merge",
            json={
                "master_id": str(master.id),
                "duplicate_ids": [str(duplicate.id)],
            },
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        links = (
            (
                await db_session.execute(
                    select(DescriptionEntity).where(
                        DescriptionEntity.entity_id == master.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {link.description_id for link in links} == {shared.id, own.id}
        assert (
            await db_session.scalar(select(func.count()).select_from(DescriptionEntity))
            == 2
        )

    @pytest.mark.asyncio
    async def test_nonexistent_duplicates_merge_nothing(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        admin_auth_headers: dict,
    ):
        """Повторный запрос из UI после успешного слияния не должен падать."""
        master = await _make_entity(db_session, test_book, "Геральт")

        response = await client.post(
            "/api/v1/admin/entities/merge",
            json={
                "master_id": str(master.id),
                "duplicate_ids": [str(uuid.uuid4())],
            },
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["merged_count"] == 0


# ============================================================================
# PATCH /admin/entities/mentions/cfi и /admin/entities/cfi
# ============================================================================


class TestEntityCFIUpdates:
    @pytest.mark.asyncio
    async def test_mention_cfi_is_written(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_chapter: Chapter,
        admin_auth_headers: dict,
    ):
        entity = await _make_entity(db_session, test_book, "Геральт")
        mention = await _make_mention(db_session, entity, test_chapter)

        response = await client.patch(
            "/api/v1/admin/entities/mentions/cfi",
            json={"mention_id": str(mention.id), "cfi": "epubcfi(/6/4!/4/2/2)"},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        assert response.json() is True
        await db_session.refresh(mention)
        assert mention.mention_cfi == "epubcfi(/6/4!/4/2/2)"

    @pytest.mark.asyncio
    async def test_first_mention_is_chosen_by_start_index(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_chapter: Chapter,
        admin_auth_headers: dict,
    ):
        """CFI получает САМОЕ раннее упоминание — на нём висит спойлерный гейт."""
        entity = await _make_entity(db_session, test_book, "Геральт")
        later = await _make_mention(db_session, entity, test_chapter, start_index=900)
        earlier = await _make_mention(db_session, entity, test_chapter, start_index=10)

        response = await client.patch(
            "/api/v1/admin/entities/cfi",
            json={"entity_id": str(entity.id), "cfi": "epubcfi(/6/4!/4/2)"},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        await db_session.refresh(earlier)
        await db_session.refresh(later)
        assert earlier.mention_cfi == "epubcfi(/6/4!/4/2)"
        assert later.mention_cfi is None

    @pytest.mark.asyncio
    async def test_entity_without_mentions_is_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        admin_auth_headers: dict,
    ):
        entity = await _make_entity(db_session, test_book, "Геральт")

        response = await client.patch(
            "/api/v1/admin/entities/cfi",
            json={"entity_id": str(entity.id), "cfi": "epubcfi(/6/4)"},
            headers=admin_auth_headers,
        )

        assert response.status_code == 404
        # `detail` эндпоинта до клиента не доезжает: в `main.py` зарегистрирован
        # общий `@app.exception_handler(404)`, он подменяет тело любого 404
        # на «Not Found» с путём запроса. Проверяем то, что видит клиент.
        assert response.json()["error"] == "Not Found"
        assert response.json()["path"] == "/api/v1/admin/entities/cfi"


# ============================================================================
# GET /admin/entities/suggest-merges/{book_id}
# ============================================================================


class TestSuggestMerges:
    @pytest.mark.asyncio
    async def test_single_entity_short_circuits_without_llm(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        admin_auth_headers: dict,
    ):
        """Меньше двух сущностей — сравнивать нечего, LLM не зовём."""
        await _make_entity(db_session, test_book, "Геральт")

        with (
            patch(
                "app.core.cache.cache_manager.acquire_lock",
                AsyncMock(return_value=True),
            ),
            patch("app.core.cache.cache_manager.release_lock", AsyncMock()),
            patch(
                "app.services.entity_deduplication_service.EntityDeduplicationService._call_gemini"
            ) as call_gemini,
        ):
            response = await client.get(
                f"/api/v1/admin/entities/suggest-merges/{test_book.id}",
                headers=admin_auth_headers,
            )

        assert response.status_code == 200
        assert response.json() == {"merge_groups": [], "no_duplicates_found": True}
        call_gemini.assert_not_called()

    @pytest.mark.asyncio
    async def test_concurrent_deduplication_is_409(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        admin_auth_headers: dict,
    ):
        """Распределённый замок: второй запуск по той же книге отбивается."""
        with patch(
            "app.core.cache.cache_manager.acquire_lock", AsyncMock(return_value=False)
        ):
            response = await client.get(
                f"/api/v1/admin/entities/suggest-merges/{test_book.id}",
                headers=admin_auth_headers,
            )

        assert response.status_code == 409
        assert (
            response.json()["detail"]
            == "Deduplication already in progress for this book"
        )

    @pytest.mark.asyncio
    async def test_llm_failure_degrades_to_no_duplicates(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_chapter: Chapter,
        admin_auth_headers: dict,
    ):
        """Падение модели не должно возвращать 500 в админку."""
        first = await _make_entity(db_session, test_book, "Геральт")
        await _make_entity(db_session, test_book, "Белый Волк")
        await _make_mention(db_session, first, test_chapter)

        with (
            patch(
                "app.core.cache.cache_manager.acquire_lock",
                AsyncMock(return_value=True),
            ),
            patch("app.core.cache.cache_manager.release_lock", AsyncMock()),
            patch(
                "app.services.entity_deduplication_service.EntityDeduplicationService._call_gemini",
                AsyncMock(side_effect=RuntimeError("модель недоступна")),
            ),
        ):
            response = await client.get(
                f"/api/v1/admin/entities/suggest-merges/{test_book.id}",
                headers=admin_auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["no_duplicates_found"] is True

    @pytest.mark.asyncio
    async def test_merge_groups_from_llm_are_returned(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_chapter: Chapter,
        admin_auth_headers: dict,
    ):
        from app.services.entity_deduplication_service import (
            DeduplicationResponse,
            MergeGroup,
        )

        master = await _make_entity(db_session, test_book, "Геральт", importance=9)
        duplicate = await _make_entity(db_session, test_book, "Белый Волк")
        await _make_mention(db_session, master, test_chapter)

        suggestion = DeduplicationResponse(
            merge_groups=[
                MergeGroup(
                    master_id=str(master.id),
                    duplicate_ids=[str(duplicate.id)],
                    confidence=0.93,
                    reason="прозвище",
                )
            ]
        )

        with (
            patch(
                "app.core.cache.cache_manager.acquire_lock",
                AsyncMock(return_value=True),
            ),
            patch("app.core.cache.cache_manager.release_lock", AsyncMock()),
            patch(
                "app.services.entity_deduplication_service.EntityDeduplicationService._call_gemini",
                AsyncMock(return_value=suggestion),
            ) as call_gemini,
        ):
            response = await client.get(
                f"/api/v1/admin/entities/suggest-merges/{test_book.id}",
                headers=admin_auth_headers,
            )

        assert response.status_code == 200
        body = response.json()
        assert body["no_duplicates_found"] is False
        assert body["merge_groups"][0]["master_id"] == str(master.id)
        assert body["merge_groups"][0]["duplicate_ids"] == [str(duplicate.id)]

        # В модель уезжают именно сущности этой книги, с номерами глав.
        (entities_arg,), _ = call_gemini.call_args
        assert {e.name for e in entities_arg} == {"Геральт", "Белый Волк"}
        assert entities_arg[0].chapters == [test_chapter.chapter_number]
