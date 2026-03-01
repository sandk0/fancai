"""
Sync Router - Handles batch sync operations from PWA offline queue.

This endpoint receives batch sync data from navigator.sendBeacon when
the app is being closed or going to background. It processes multiple
sync operations in a single request.

Features:
- Accepts sendBeacon requests (text/plain with JSON body)
- Processes multiple operations in a single request
- Handles progress, bookmark, and highlight operations
- Provides detailed response with processed/failed counts

Created: January 2026
Author: fancai Team
"""

from fastapi import APIRouter, Request, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field
from datetime import datetime, timezone
from uuid import UUID
import json

from ..core.database import get_database_session
from ..core.logging import logger
from ..services.auth_service import auth_service
from ..services.token_blacklist import token_blacklist
from ..models.user import User
from ..services.book import book_progress_service

router = APIRouter(prefix="/sync", tags=["sync"])


# ============================================================================
# Pydantic Models
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
    """
    Process a reading progress update operation.

    Args:
        db: Database session
        user: Authenticated user
        endpoint: API endpoint (e.g., /api/v1/books/{book_id}/progress)
        body: Operation body with progress data

    Returns:
        True if successful, False otherwise
    """
    if not body:
        return False

    # Extract book_id from endpoint: /api/v1/books/{book_id}/progress
    try:
        parts = endpoint.split("/")
        # Find "books" index and get the next element as book_id
        books_idx = parts.index("books")
        book_id_str = parts[books_idx + 1]
        book_id = UUID(book_id_str)
    except (ValueError, IndexError) as e:
        logger.warning("Invalid progress endpoint", endpoint=endpoint, error=str(e))
        return False

    # Extract progress data (handle both frontend formats)
    chapter_number = body.get("chapter_number") or body.get("chapter", 1)
    reading_location_cfi = body.get("reading_location_cfi") or body.get("cfi")
    scroll_offset_percent = body.get("scroll_offset_percent") or body.get(
        "scrollPercent", 0.0
    )

    # Validate scroll_offset_percent
    if scroll_offset_percent is not None:
        scroll_offset_percent = max(0.0, min(100.0, float(scroll_offset_percent)))

    try:
        await book_progress_service.update_reading_progress(
            db=db,
            user_id=user.id,
            book_id=book_id,
            chapter_number=int(chapter_number),
            position_percent=0.0,  # Default position
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


# ============================================================================
# API Endpoints
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

    Args:
        request: FastAPI request object
        db: Database session

    Returns:
        BatchSyncResponse with processed/failed counts

    Example payload (sent via sendBeacon):
        {
            "operations": [
                {
                    "endpoint": "/api/v1/books/123/progress",
                    "method": "PUT",
                    "body": {"chapter_number": 5, "cfi": "epubcfi(...)"}
                }
            ],
            "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        }
    """
    timestamp = datetime.now(timezone.utc).isoformat()

    try:
        # Read raw body (sendBeacon sends as text/plain)
        body = await request.body()

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
            # Return partial success - we received the data but couldn't process
            # This is intentional to not lose data that might be resent later
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

                elif "/bookmarks" in endpoint:
                    # NOT IMPLEMENTED (Phase 8: READ-01)
                    failed += 1
                    errors.append(
                        "501: Bookmark sync not implemented (planned Phase 8)"
                    )

                elif "/highlights" in endpoint:
                    # NOT IMPLEMENTED (Phase 8: READ-02)
                    failed += 1
                    errors.append(
                        "501: Highlight sync not implemented (planned Phase 8)"
                    )

                elif "/reading-sessions" in endpoint:
                    # NOT IMPLEMENTED
                    failed += 1
                    errors.append("501: Reading session sync not implemented")

                else:
                    failed += 1
                    errors.append(f"Unknown operation type: {endpoint}")

            except Exception as e:
                failed += 1
                errors.append(f"Operation error: {str(e)}")
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
