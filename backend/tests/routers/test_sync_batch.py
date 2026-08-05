"""`POST /api/v1/sync/batch` — очередь офлайн-операций из PWA.

Endpoint вызывается через `navigator.sendBeacon`, поэтому у него НЕТ
`Depends(get_current_active_user)`: токен приезжает полем JSON-тела, а тело
приходит как `text/plain`. Из-за этого аутентификация здесь — собственный код
(`get_user_from_token`), и его контракт проверяется отдельно.
"""

import json
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, ReadingProgress
from app.models.bookmark import Bookmark
from app.models.user import User


def _token(headers: dict) -> str:
    return headers["Authorization"].removeprefix("Bearer ")


async def _post_batch(client: AsyncClient, payload) -> "object":
    """sendBeacon шлёт JSON строкой в text/plain — воспроизводим ровно это."""
    body = payload if isinstance(payload, (str, bytes)) else json.dumps(payload)
    return await client.post(
        "/api/v1/sync/batch", content=body, headers={"Content-Type": "text/plain"}
    )


async def _make_bookmark(db: AsyncSession, user: User, book: Book, **kw) -> Bookmark:
    bookmark = Bookmark(
        user_id=user.id,
        book_id=book.id,
        cfi_range=kw.get("cfi_range", "epubcfi(/6/4!/4/2,/1:0,/1:20)"),
        chapter_number=kw.get("chapter_number", 1),
        text=kw.get("text", "выделенный текст"),
        color=kw.get("color", "yellow"),
        style=kw.get("style", "highlight"),
        note=kw.get("note"),
    )
    db.add(bookmark)
    await db.commit()
    await db.refresh(bookmark)
    return bookmark


# ============================================================================
# Аутентификация из тела запроса
# ============================================================================


class TestBatchSyncAuth:
    """У endpoint нет DI-гарда: аутентификацию делает он сам."""

    @pytest.mark.asyncio
    async def test_operations_without_token_are_all_rejected(
        self, client: AsyncClient, test_book: Book
    ):
        """Без токена ни одна операция не должна примениться."""
        response = await _post_batch(
            client,
            {
                "operations": [
                    {
                        "endpoint": f"/api/v1/books/{test_book.id}/progress",
                        "method": "PUT",
                        "body": {"chapter_number": 2},
                    }
                ]
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["processed"] == 0
        assert body["failed"] == 1
        assert body["errors"] == ["Authentication required"]

    @pytest.mark.asyncio
    async def test_garbage_token_is_rejected(
        self, client: AsyncClient, test_book: Book, db_session: AsyncSession
    ):
        response = await _post_batch(
            client,
            {
                "token": "не-jwt-вовсе",
                "operations": [
                    {
                        "endpoint": f"/api/v1/books/{test_book.id}/progress",
                        "method": "PUT",
                        "body": {"chapter_number": 2},
                    }
                ],
            },
        )

        assert response.json()["errors"] == ["Authentication required"]
        assert await db_session.scalar(select(ReadingProgress)) is None

    @pytest.mark.asyncio
    async def test_blacklisted_token_is_rejected(
        self,
        client: AsyncClient,
        test_book: Book,
        test_user_auth_headers: dict,
        db_session: AsyncSession,
    ):
        """После logout отложенная очередь не должна дописывать прогресс."""
        with patch(
            "app.routers.sync.token_blacklist.is_blacklisted",
            AsyncMock(return_value=True),
        ):
            response = await _post_batch(
                client,
                {
                    "token": _token(test_user_auth_headers),
                    "operations": [
                        {
                            "endpoint": f"/api/v1/books/{test_book.id}/progress",
                            "method": "PUT",
                            "body": {"chapter_number": 2},
                        }
                    ],
                },
            )

        assert response.json()["failed"] == 1
        assert await db_session.scalar(select(ReadingProgress)) is None


# ============================================================================
# Разбор тела
# ============================================================================


class TestBatchSyncPayload:
    @pytest.mark.asyncio
    async def test_empty_body_is_noop(self, client: AsyncClient):
        response = await _post_batch(client, b"")

        assert response.status_code == 200
        assert response.json()["processed"] == 0
        assert response.json()["failed"] == 0

    @pytest.mark.asyncio
    async def test_empty_operations_list_is_noop(
        self, client: AsyncClient, test_user_auth_headers: dict
    ):
        response = await _post_batch(
            client, {"token": _token(test_user_auth_headers), "operations": []}
        )

        assert response.status_code == 200
        assert response.json() | {"timestamp": None} == {
            "processed": 0,
            "failed": 0,
            "errors": [],
            "timestamp": None,
        }

    @pytest.mark.asyncio
    async def test_malformed_json_is_400(self, client: AsyncClient):
        response = await _post_batch(client, "{не json")

        assert response.status_code == 400
        assert response.json()["detail"] == "Invalid JSON payload"

    @pytest.mark.asyncio
    async def test_non_object_payload_is_400(self, client: AsyncClient):
        response = await _post_batch(client, [1, 2, 3])

        assert response.status_code == 400
        assert response.json()["detail"] == "Expected object payload"

    @pytest.mark.asyncio
    async def test_oversized_body_is_413(self, client: AsyncClient):
        """Лимит sendBeacon ~64 КБ; тело больше отбивается до разбора."""
        response = await _post_batch(client, {"operations": ["x" * 70000]})

        assert response.status_code == 413
        assert response.json()["detail"] == "Request body too large"


# ============================================================================
# Операции прогресса
# ============================================================================


class TestBatchProgressOperations:
    @pytest.mark.asyncio
    async def test_progress_operation_is_persisted(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        test_user_auth_headers: dict,
    ):
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": f"/api/v1/books/{test_book.id}/progress",
                        "method": "PUT",
                        "body": {
                            "chapter_number": 2,
                            "reading_location_cfi": "epubcfi(/6/8!/4/2/2)",
                            "scroll_offset_percent": 42.5,
                        },
                    }
                ],
            },
        )

        assert response.json()["processed"] == 1
        progress = await db_session.scalar(
            select(ReadingProgress).where(ReadingProgress.book_id == test_book.id)
        )
        assert progress is not None
        assert progress.current_chapter == 2
        assert progress.reading_location_cfi == "epubcfi(/6/8!/4/2/2)"
        assert progress.scroll_offset_percent == 42.5

    @pytest.mark.asyncio
    async def test_camelcase_payload_from_service_worker_is_accepted(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_user_auth_headers: dict,
    ):
        """Очередь в SW пишет `chapter`/`cfi`/`scrollPercent` — это тоже контракт."""
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": f"/api/v1/books/{test_book.id}/progress",
                        "method": "PUT",
                        "body": {
                            "chapter": 3,
                            "cfi": "epubcfi(/6/10!/4/2)",
                            "scrollPercent": 10.0,
                        },
                    }
                ],
            },
        )

        assert response.json()["processed"] == 1
        progress = await db_session.scalar(select(ReadingProgress))
        assert progress.current_chapter == 3
        assert progress.reading_location_cfi == "epubcfi(/6/10!/4/2)"

    @pytest.mark.asyncio
    async def test_scroll_percent_is_clamped(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_user_auth_headers: dict,
    ):
        """Битое значение из офлайн-очереди не должно уезжать в БД как есть."""
        await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": f"/api/v1/books/{test_book.id}/progress",
                        "method": "PUT",
                        "body": {"chapter_number": 1, "scrollPercent": 1000.0},
                    }
                ],
            },
        )

        progress = await db_session.scalar(select(ReadingProgress))
        assert progress.scroll_offset_percent == 100.0

    @pytest.mark.asyncio
    async def test_endpoint_without_book_id_is_counted_failed(
        self, client: AsyncClient, test_user_auth_headers: dict
    ):
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": "/api/v1/progress",
                        "method": "PUT",
                        "body": {"chapter_number": 1},
                    }
                ],
            },
        )

        body = response.json()
        assert body["processed"] == 0
        assert body["failed"] == 1
        assert body["errors"] == ["Failed to process progress: /api/v1/progress"]

    @pytest.mark.asyncio
    async def test_progress_for_unknown_book_is_counted_failed(
        self, client: AsyncClient, test_user_auth_headers: dict
    ):
        """Книгу могли удалить, пока клиент был офлайн."""
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": f"/api/v1/books/{uuid4()}/progress",
                        "method": "PUT",
                        "body": {"chapter_number": 1},
                    }
                ],
            },
        )

        assert response.json()["failed"] == 1

    @pytest.mark.asyncio
    async def test_progress_without_body_is_counted_failed(
        self, client: AsyncClient, test_book: Book, test_user_auth_headers: dict
    ):
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": f"/api/v1/books/{test_book.id}/progress",
                        "method": "PUT",
                    }
                ],
            },
        )

        assert response.json()["failed"] == 1


# ============================================================================
# Операции с закладками
# ============================================================================


class TestBatchBookmarkOperations:
    @pytest.mark.asyncio
    async def test_post_creates_bookmark(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        test_user_auth_headers: dict,
    ):
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": f"/api/v1/sync/books/{test_book.id}/bookmarks",
                        "method": "POST",
                        "body": {
                            "cfi_range": "epubcfi(/6/4!/4/2,/1:0,/1:9)",
                            "chapter_number": 1,
                            "text": "офлайн-выделение",
                            "color": "green",
                            "style": "highlight",
                        },
                    }
                ],
            },
        )

        assert response.json()["processed"] == 1
        bookmark = await db_session.scalar(select(Bookmark))
        assert bookmark is not None
        assert bookmark.user_id == test_user.id
        assert bookmark.text == "офлайн-выделение"
        assert bookmark.color == "green"

    @pytest.mark.asyncio
    async def test_post_truncates_overlong_text(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_user_auth_headers: dict,
    ):
        """Колонка `text` — VARCHAR(2000); без обрезки коммит упал бы целиком."""
        await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": f"/api/v1/sync/books/{test_book.id}/bookmarks",
                        "method": "POST",
                        "body": {
                            "cfi_range": "epubcfi(/6/4!/4/2)",
                            "chapter_number": 1,
                            "text": "я" * 5000,
                        },
                    }
                ],
            },
        )

        bookmark = await db_session.scalar(select(Bookmark))
        assert len(bookmark.text) == 2000

    @pytest.mark.asyncio
    async def test_put_updates_only_supplied_fields(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        test_user_auth_headers: dict,
    ):
        bookmark = await _make_bookmark(
            db_session, test_user, test_book, color="yellow", note="старая"
        )

        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": (
                            f"/api/v1/sync/books/{test_book.id}"
                            f"/bookmarks/{bookmark.id}"
                        ),
                        "method": "PUT",
                        "body": {"color": "blue"},
                    }
                ],
            },
        )

        assert response.json()["processed"] == 1
        await db_session.refresh(bookmark)
        assert bookmark.color == "blue"
        assert bookmark.note == "старая"

    @pytest.mark.asyncio
    async def test_put_does_not_touch_foreign_bookmark(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        auth_headers: dict,
    ):
        """Чужая закладка не меняется: запрос идёт от другого пользователя."""
        bookmark = await _make_bookmark(
            db_session, test_user, test_book, color="yellow"
        )

        await _post_batch(
            client,
            {
                "token": _token(auth_headers),
                "operations": [
                    {
                        "endpoint": (
                            f"/api/v1/sync/books/{test_book.id}"
                            f"/bookmarks/{bookmark.id}"
                        ),
                        "method": "PUT",
                        "body": {"color": "red"},
                    }
                ],
            },
        )

        await db_session.refresh(bookmark)
        assert bookmark.color == "yellow"

    @pytest.mark.asyncio
    async def test_delete_removes_own_bookmark(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        test_user_auth_headers: dict,
    ):
        bookmark = await _make_bookmark(db_session, test_user, test_book)

        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": (
                            f"/api/v1/sync/books/{test_book.id}"
                            f"/bookmarks/{bookmark.id}"
                        ),
                        "method": "DELETE",
                    }
                ],
            },
        )

        assert response.json()["processed"] == 1
        assert await db_session.get(Bookmark, bookmark.id) is None

    @pytest.mark.asyncio
    async def test_delete_keeps_foreign_bookmark(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        auth_headers: dict,
    ):
        bookmark = await _make_bookmark(db_session, test_user, test_book)

        await _post_batch(
            client,
            {
                "token": _token(auth_headers),
                "operations": [
                    {
                        "endpoint": (
                            f"/api/v1/sync/books/{test_book.id}"
                            f"/bookmarks/{bookmark.id}"
                        ),
                        "method": "DELETE",
                    }
                ],
            },
        )

        assert await db_session.get(Bookmark, bookmark.id) is not None

    @pytest.mark.asyncio
    async def test_unparsable_bookmark_endpoint_is_counted_failed(
        self, client: AsyncClient, test_user_auth_headers: dict
    ):
        """В пути нет сегмента `books` — `_extract_book_id_from_endpoint` падает."""
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": "/api/v1/sync/bookmarks",
                        "method": "POST",
                        "body": {"cfi_range": "x", "chapter_number": 1, "text": "t"},
                    }
                ],
            },
        )

        body = response.json()
        assert body["failed"] == 1
        assert body["errors"] == ["Failed to process bookmark: /api/v1/sync/bookmarks"]

    @pytest.mark.asyncio
    async def test_unsupported_method_is_counted_failed(
        self, client: AsyncClient, test_book: Book, test_user_auth_headers: dict
    ):
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": f"/api/v1/sync/books/{test_book.id}/bookmarks",
                        "method": "PATCH",
                        "body": {"color": "red"},
                    }
                ],
            },
        )

        assert response.json()["failed"] == 1


# ============================================================================
# Маршрутизация операций и сводка
# ============================================================================


class TestBatchRouting:
    @pytest.mark.asyncio
    async def test_reading_session_operations_are_reported_unimplemented(
        self, client: AsyncClient, test_user_auth_headers: dict
    ):
        """Синхронизация сессий чтения не реализована — и это видно клиенту."""
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": "/api/v1/reading-sessions/start",
                        "method": "POST",
                        "body": {},
                    }
                ],
            },
        )

        body = response.json()
        assert body["failed"] == 1
        assert body["errors"] == ["501: Reading session sync not implemented"]

    @pytest.mark.asyncio
    async def test_unknown_endpoint_is_reported(
        self, client: AsyncClient, test_user_auth_headers: dict
    ):
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {"endpoint": "/api/v1/something/else", "method": "POST"}
                ],
            },
        )

        assert response.json()["errors"] == [
            "Unknown operation type: /api/v1/something/else"
        ]

    @pytest.mark.asyncio
    async def test_mixed_batch_counts_both_sides(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_user_auth_headers: dict,
    ):
        """Одна плохая операция не должна отменять хорошие."""
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {
                        "endpoint": f"/api/v1/books/{test_book.id}/progress",
                        "method": "PUT",
                        "body": {"chapter_number": 2},
                    },
                    {"endpoint": "/api/v1/nonsense", "method": "POST"},
                    {
                        "endpoint": f"/api/v1/sync/books/{test_book.id}/bookmarks",
                        "method": "POST",
                        "body": {
                            "cfi_range": "epubcfi(/6/4!/4/2)",
                            "chapter_number": 1,
                            "text": "ок",
                        },
                    },
                ],
            },
        )

        body = response.json()
        assert body["processed"] == 2
        assert body["failed"] == 1
        assert await db_session.scalar(select(Bookmark)) is not None
        assert await db_session.scalar(select(ReadingProgress)) is not None

    @pytest.mark.asyncio
    async def test_error_list_is_capped_at_ten(
        self, client: AsyncClient, test_user_auth_headers: dict
    ):
        """Ответ уходит в sendBeacon — список ошибок не должен раздуваться."""
        response = await _post_batch(
            client,
            {
                "token": _token(test_user_auth_headers),
                "operations": [
                    {"endpoint": f"/api/v1/nonsense/{i}", "method": "POST"}
                    for i in range(15)
                ],
            },
        )

        body = response.json()
        assert body["failed"] == 15
        assert len(body["errors"]) == 10


# ============================================================================
# Совместимые алиасы /highlights
# ============================================================================


class TestHighlightAliases:
    @pytest.mark.asyncio
    async def test_post_highlight_alias_creates_bookmark(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_user_auth_headers: dict,
    ):
        response = await client.post(
            f"/api/v1/sync/books/{test_book.id}/highlights",
            json={
                "cfi_range": "epubcfi(/6/4!/4/2,/1:0,/1:5)",
                "chapter_number": 1,
                "text": "через алиас",
                "style": "highlight",
            },
            headers=test_user_auth_headers,
        )

        assert response.status_code == 201
        assert response.json()["text"] == "через алиас"
        assert await db_session.scalar(select(Bookmark)) is not None

    @pytest.mark.asyncio
    async def test_get_highlight_alias_returns_same_rows_as_bookmarks(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        test_user_auth_headers: dict,
    ):
        await _make_bookmark(db_session, test_user, test_book)

        aliased = await client.get(
            f"/api/v1/sync/books/{test_book.id}/highlights",
            headers=test_user_auth_headers,
        )
        canonical = await client.get(
            f"/api/v1/sync/books/{test_book.id}/bookmarks",
            headers=test_user_auth_headers,
        )

        assert aliased.status_code == 200
        assert aliased.json() == canonical.json()
        assert len(aliased.json()) == 1
