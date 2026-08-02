"""
Sync Router - Handles batch sync operations and CRUD for unified bookmarks.

Features:
- Accepts sendBeacon requests (text/plain with JSON body) for batch sync
- CRUD endpoints for bookmarks (CFI range, color, style, note)
- /highlights alias routes for backward compatibility
- All endpoints require authentication via get_current_active_user

Created: January 2026
Updated: March 2026 (unified bookmarks model)
Author: fancai Team
"""

from fastapi import APIRouter, Request, HTTPException, Depends, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field
from datetime import datetime, timezone
from uuid import UUID
import json

from ..core.database import get_database_session
from ..core.logging import logger
from ..core.auth import get_current_active_user
from ..services.auth_service import auth_service
from ..services.token_blacklist import token_blacklist
from ..models.user import User
from ..models.bookmark import Bookmark
from ..schemas.sync import (
    BookmarkCreate,
    BookmarkUpdate,
    BookmarkResponse,
)
from ..services.book import book_progress_service

router = APIRouter(prefix="/sync", tags=["sync"])


# ============================================================================
# Pydantic Models (batch sync)
# ============================================================================


class SyncOperationData(BaseModel):
    """Data payload for a sync operation."""

    chapter_number: Optional[int] = Field(None, alias="chapter_number")
    reading_location_cfi: Optional[str] = None
    scroll_offset_percent: Optional[float] = None
    # For backward compatibility with frontend format
    chapter: Optional[int] = None
    cfi: Optional[str] = None
    scrollPercent: Optional[float] = None


class SyncOperation(BaseModel):
    """Single sync operation from offline queue."""

    endpoint: str
    method: str  # 'GET' | 'POST' | 'PUT' | 'DELETE'
    body: Optional[Dict[str, Any]] = None


class BatchSyncPayload(BaseModel):
    """Batch sync request payload from sendBeacon."""

    operations: List[SyncOperation]
    token: Optional[str] = None


class BatchSyncResponse(BaseModel):
    """Batch sync response."""

    processed: int
    failed: int
    errors: List[str] = []
    timestamp: str


# ============================================================================
# Helper Functions
# ============================================================================


async def get_user_from_token(token: str, db: AsyncSession) -> Optional[User]:
    """
    Validate token and get user from database.

    Args:
        token: JWT access token
        db: Database session

    Returns:
        User if token is valid, None otherwise
    """
    if not token:
        return None

    try:
        # Check if token is blacklisted
        if await token_blacklist.is_blacklisted(token):
            logger.warning("Sync request with blacklisted token")
            return None

        # Verify token
        payload = auth_service.verify_token(token, "access")
        if payload is None:
            return None

        # Get user ID
        user_id_str = payload.get("sub")
        if user_id_str is None:
            return None

        user_id = UUID(user_id_str)

        # Get user from database
        user = await auth_service.get_user_by_id(db, user_id)
        if user is None or not user.is_active:
            return None

        return user

    except Exception as e:
        logger.warning("Token validation error in sync", error=str(e))
        return None


async def process_progress_operation(
    db: AsyncSession,
    user: User,
    endpoint: str,
    body: Optional[Dict[str, Any]],
) -> bool:
    """Process a reading progress update operation."""
    if not body:
        return False

    try:
        parts = endpoint.split("/")
        books_idx = parts.index("books")
        book_id_str = parts[books_idx + 1]
        book_id = UUID(book_id_str)
    except (ValueError, IndexError) as e:
        logger.warning("Invalid progress endpoint", endpoint=endpoint, error=str(e))
        return False

    chapter_number = body.get("chapter_number") or body.get("chapter", 1)
    reading_location_cfi = body.get("reading_location_cfi") or body.get("cfi")
    scroll_offset_percent = body.get("scroll_offset_percent") or body.get(
        "scrollPercent", 0.0
    )

    if scroll_offset_percent is not None:
        scroll_offset_percent = max(0.0, min(100.0, float(scroll_offset_percent)))

    try:
        await book_progress_service.update_reading_progress(
            db=db,
            user_id=user.id,
            book_id=book_id,
            chapter_number=int(chapter_number),
            position_percent=0.0,
            reading_location_cfi=reading_location_cfi,
            scroll_offset_percent=scroll_offset_percent,
        )
        return True
    except Exception as e:
        logger.warning(
            "Failed to update progress in batch sync",
            book_id=str(book_id),
            error=str(e),
        )
        return False


def _extract_book_id_from_endpoint(endpoint: str) -> UUID:
    """Extract book_id from endpoint path like /api/v1/sync/books/{book_id}/bookmarks."""
    parts = endpoint.split("/")
    books_idx = parts.index("books")
    return UUID(parts[books_idx + 1])


async def process_bookmark_sync(
    db: AsyncSession,
    user: User,
    endpoint: str,
    method: str,
    body: Optional[Dict[str, Any]],
) -> bool:
    """Process a bookmark sync operation from batch sync."""
    try:
        book_id = _extract_book_id_from_endpoint(endpoint)

        if method == "POST" and body:
            bookmark = Bookmark(
                user_id=user.id,
                book_id=book_id,
                cfi_range=body.get("cfi_range", ""),
                chapter_number=body.get("chapter_number", 0),
                text=body.get("text", "")[:2000],
                color=body.get("color"),
                text_color=body.get("text_color"),
                style=body.get("style", "none"),
                note=body.get("note"),
            )
            db.add(bookmark)
            return True

        elif method == "PUT" and body:
            # Extract bookmark_id from endpoint: .../bookmarks/{bookmark_id}
            parts = endpoint.split("/")
            bookmarks_idx = parts.index("bookmarks")
            bookmark_id = UUID(parts[bookmarks_idx + 1])

            result = await db.execute(
                select(Bookmark).where(
                    and_(
                        Bookmark.id == bookmark_id,
                        Bookmark.user_id == user.id,
                    )
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                if "color" in body:
                    existing.color = body["color"]
                if "text_color" in body:
                    existing.text_color = body["text_color"]
                if "style" in body:
                    existing.style = body["style"]
                if "note" in body:
                    existing.note = body["note"]
            return True

        elif method == "DELETE":
            parts = endpoint.split("/")
            bookmarks_idx = parts.index("bookmarks")
            bookmark_id = UUID(parts[bookmarks_idx + 1])

            result = await db.execute(
                select(Bookmark).where(
                    and_(
                        Bookmark.id == bookmark_id,
                        Bookmark.user_id == user.id,
                    )
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                await db.delete(existing)
            return True

        return False
    except Exception as e:
        logger.warning("Failed to process bookmark sync", error=str(e))
        return False


# ============================================================================
# Bookmark CRUD Endpoints
# ============================================================================


@router.get(
    "/books/{book_id}/bookmarks",
    response_model=List[BookmarkResponse],
)
async def get_bookmarks(
    book_id: UUID,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> List[BookmarkResponse]:
    """Get all bookmarks for a book."""
    result = await db.execute(
        select(Bookmark)
        .where(
            and_(
                Bookmark.user_id == current_user.id,
                Bookmark.book_id == book_id,
            )
        )
        .order_by(Bookmark.chapter_number, Bookmark.created_at)
    )
    bookmarks = result.scalars().all()
    return [BookmarkResponse.model_validate(b) for b in bookmarks]


@router.post(
    "/books/{book_id}/bookmarks",
    response_model=BookmarkResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_bookmark(
    book_id: UUID,
    data: BookmarkCreate,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> BookmarkResponse:
    """Create a bookmark."""
    bookmark = Bookmark(
        user_id=current_user.id,
        book_id=book_id,
        cfi_range=data.cfi_range,
        chapter_number=data.chapter_number,
        text=data.text,
        color=data.color,
        text_color=data.text_color,
        style=data.style,
        note=data.note,
    )
    db.add(bookmark)
    await db.commit()
    await db.refresh(bookmark)
    return BookmarkResponse.model_validate(bookmark)


@router.put(
    "/books/{book_id}/bookmarks/{bookmark_id}",
    response_model=BookmarkResponse,
)
async def update_bookmark(
    book_id: UUID,
    bookmark_id: UUID,
    data: BookmarkUpdate,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> BookmarkResponse:
    """Update bookmark color, style, and/or note. Checks ownership."""
    result = await db.execute(
        select(Bookmark).where(
            and_(
                Bookmark.id == bookmark_id,
                Bookmark.user_id == current_user.id,
                Bookmark.book_id == book_id,
            )
        )
    )
    bookmark = result.scalar_one_or_none()
    if not bookmark:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bookmark not found",
        )

    if data.color is not None:
        bookmark.color = data.color
    if data.text_color is not None:
        bookmark.text_color = data.text_color
    if data.style is not None:
        bookmark.style = data.style
    if data.note is not None:
        bookmark.note = data.note

    await db.commit()
    await db.refresh(bookmark)
    return BookmarkResponse.model_validate(bookmark)


@router.delete(
    "/books/{book_id}/bookmarks/{bookmark_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_bookmark(
    book_id: UUID,
    bookmark_id: UUID,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> None:
    """Delete a bookmark. Checks ownership."""
    result = await db.execute(
        select(Bookmark).where(
            and_(
                Bookmark.id == bookmark_id,
                Bookmark.user_id == current_user.id,
                Bookmark.book_id == book_id,
            )
        )
    )
    bookmark = result.scalar_one_or_none()
    if not bookmark:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bookmark not found",
        )

    await db.delete(bookmark)
    await db.commit()


# ============================================================================
# Backward-compatible /highlights aliases → redirect to /bookmarks
# ============================================================================


@router.get(
    "/books/{book_id}/highlights",
    response_model=List[BookmarkResponse],
)
async def get_highlights_alias(
    book_id: UUID,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> List[BookmarkResponse]:
    """Backward-compatible alias for GET /bookmarks."""
    return await get_bookmarks(book_id, db, current_user)


@router.post(
    "/books/{book_id}/highlights",
    response_model=BookmarkResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_highlight_alias(
    book_id: UUID,
    data: BookmarkCreate,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> BookmarkResponse:
    """Backward-compatible alias for POST /bookmarks."""
    return await create_bookmark(book_id, data, db, current_user)


# ============================================================================
# Batch Sync Endpoint
# ============================================================================


@router.post("/batch", response_model=BatchSyncResponse)
async def batch_sync(
    request: Request,
    db: AsyncSession = Depends(get_database_session),
) -> BatchSyncResponse:
    """
    Process batch sync operations from PWA offline queue.

    This endpoint is called by navigator.sendBeacon when the app
    is closing or going to background. It processes multiple
    sync operations in a single request.

    Note: sendBeacon sends data as text/plain with JSON string body,
    not as application/json. We need to handle the raw body.
    """
    timestamp = datetime.now(timezone.utc).isoformat()

    try:
        # Enforce body size limit before reading (sendBeacon max is ~64KB)
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 65536:
            raise HTTPException(status_code=413, detail="Request body too large")

        # Read raw body (sendBeacon sends as text/plain)
        body = await request.body()
        if len(body) > 65536:
            raise HTTPException(status_code=413, detail="Request body too large")

        if not body:
            logger.debug("Empty batch sync request")
            return BatchSyncResponse(
                processed=0, failed=0, errors=[], timestamp=timestamp
            )

        # Parse JSON from body
        try:
            data = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as e:
            logger.warning("Invalid JSON in batch sync", error=str(e))
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

        # Validate structure
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="Expected object payload")

        # Extract token and operations
        token = data.get("token")
        operations = data.get("operations", [])

        if not operations:
            logger.debug("No operations in batch sync request")
            return BatchSyncResponse(
                processed=0, failed=0, errors=[], timestamp=timestamp
            )

        # Validate token and get user
        user = await get_user_from_token(token, db) if token else None

        if not user:
            logger.warning("Batch sync without valid authentication")
            return BatchSyncResponse(
                processed=0,
                failed=len(operations),
                errors=["Authentication required"],
                timestamp=timestamp,
            )

        # Process operations
        processed = 0
        failed = 0
        errors: List[str] = []

        for op in operations:
            try:
                endpoint = op.get("endpoint", "")
                method = op.get("method", "")
                op_body = op.get("body")

                # Determine operation type from endpoint
                if "/progress" in endpoint and method == "PUT":
                    success = await process_progress_operation(
                        db=db, user=user, endpoint=endpoint, body=op_body
                    )
                    if success:
                        processed += 1
                    else:
                        failed += 1
                        errors.append(f"Failed to process progress: {endpoint}")

                elif "/bookmarks" in endpoint or "/highlights" in endpoint:
                    success = await process_bookmark_sync(
                        db=db,
                        user=user,
                        endpoint=endpoint,
                        method=method,
                        body=op_body,
                    )
                    if success:
                        processed += 1
                    else:
                        failed += 1
                        errors.append(f"Failed to process bookmark: {endpoint}")

                elif "/reading-sessions" in endpoint:
                    # NOT IMPLEMENTED
                    failed += 1
                    errors.append("501: Reading session sync not implemented")

                else:
                    failed += 1
                    errors.append(f"Unknown operation type: {endpoint}")

            except Exception as e:
                failed += 1
                errors.append("Operation error")
                logger.warning("Error processing sync operation", error=str(e))

        # Commit any changes
        await db.commit()

        logger.info(
            "Batch sync completed",
            user_id=str(user.id),
            processed=processed,
            failed=failed,
        )

        return BatchSyncResponse(
            processed=processed,
            failed=failed,
            errors=errors[:10],  # Limit errors in response
            timestamp=timestamp,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.opt(exception=True).error(f"Batch sync error: {e}")
        raise HTTPException(
            status_code=500, detail="An internal error occurred during sync"
        )
