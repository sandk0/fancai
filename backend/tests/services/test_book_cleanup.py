"""
Tests for book cleanup service (cleanup_book_data).

Tests:
1. cleanup_book_data() deletes all Description records for the book (via chapter_ids)
2. cleanup_book_data() deletes all Entity records for the book (CASCADE deletes mentions, relationships, events)
3. After cleanup_book_data(), chapter flags are reset: is_description_parsed=False, descriptions_found=0, etc.
4. After cleanup_book_data(), book flags are reset: descriptions_extracted=False, descriptions_processing_error=None
5. cleanup_book_data() collects and deletes avatar files and generated image files
6. cleanup_book_data() works correctly for a book with no descriptions/entities (does not crash)
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, call, patch
from uuid import UUID, uuid4

import pytest

from app.services.book_cleanup_service import cleanup_book_data


def _make_mock_db() -> AsyncMock:
    """Create a mock AsyncSession."""
    db = AsyncMock()
    db.execute = AsyncMock()
    db.flush = AsyncMock()
    return db


def _make_scalars_result(values: list) -> MagicMock:
    """Create a mock result that returns scalars().all()."""
    result = MagicMock()
    scalars_mock = MagicMock()
    scalars_mock.all.return_value = values
    result.scalars.return_value = scalars_mock
    return result


@pytest.mark.asyncio
async def test_cleanup_deletes_descriptions():
    """Test 1: cleanup_book_data() deletes all Description records for the book."""
    db = _make_mock_db()
    book_id = uuid4()
    chapter_ids = [uuid4(), uuid4()]

    # Setup mock responses for sequential db.execute calls
    db.execute = AsyncMock(
        side_effect=[
            _make_scalars_result(chapter_ids),  # SELECT chapter_ids
            _make_scalars_result([]),  # SELECT avatar urls
            _make_scalars_result([]),  # SELECT image paths
            MagicMock(rowcount=5),  # DELETE descriptions
            MagicMock(rowcount=0),  # DELETE entities
            MagicMock(),  # UPDATE chapters
            MagicMock(),  # UPDATE book
        ]
    )

    result = await cleanup_book_data(db, book_id)

    assert result["descriptions_deleted"] == 5
    db.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_cleanup_deletes_entities():
    """Test 2: cleanup_book_data() deletes all Entity records for the book."""
    db = _make_mock_db()
    book_id = uuid4()
    chapter_ids = [uuid4()]

    db.execute = AsyncMock(
        side_effect=[
            _make_scalars_result(chapter_ids),  # SELECT chapter_ids
            _make_scalars_result([]),  # SELECT avatar urls
            _make_scalars_result([]),  # SELECT image paths
            MagicMock(rowcount=0),  # DELETE descriptions
            MagicMock(rowcount=3),  # DELETE entities
            MagicMock(),  # UPDATE chapters
            MagicMock(),  # UPDATE book
        ]
    )

    result = await cleanup_book_data(db, book_id)

    assert result["entities_deleted"] == 3


@pytest.mark.asyncio
async def test_cleanup_resets_chapter_flags():
    """Test 3: After cleanup, chapter flags are reset to initial state."""
    db = _make_mock_db()
    book_id = uuid4()
    chapter_ids = [uuid4(), uuid4(), uuid4()]

    db.execute = AsyncMock(
        side_effect=[
            _make_scalars_result(chapter_ids),  # SELECT chapter_ids
            _make_scalars_result([]),  # SELECT avatar urls
            _make_scalars_result([]),  # SELECT image paths
            MagicMock(rowcount=0),  # DELETE descriptions
            MagicMock(rowcount=0),  # DELETE entities
            MagicMock(),  # UPDATE chapters
            MagicMock(),  # UPDATE book
        ]
    )

    result = await cleanup_book_data(db, book_id)

    assert result["chapters_reset"] == 3

    # Verify UPDATE chapters was called (6th call, index 5)
    update_chapters_call = db.execute.call_args_list[5]
    # The statement should be an UPDATE targeting the chapter_ids
    stmt = update_chapters_call[0][0]
    # We verify through the result that chapters_reset matches chapter count
    assert result["chapters_reset"] == len(chapter_ids)


@pytest.mark.asyncio
async def test_cleanup_resets_book_flags():
    """Test 4: After cleanup, book flags are reset."""
    db = _make_mock_db()
    book_id = uuid4()
    chapter_ids = [uuid4()]

    db.execute = AsyncMock(
        side_effect=[
            _make_scalars_result(chapter_ids),  # SELECT chapter_ids
            _make_scalars_result([]),  # SELECT avatar urls
            _make_scalars_result([]),  # SELECT image paths
            MagicMock(rowcount=0),  # DELETE descriptions
            MagicMock(rowcount=0),  # DELETE entities
            MagicMock(),  # UPDATE chapters
            MagicMock(),  # UPDATE book
        ]
    )

    result = await cleanup_book_data(db, book_id)

    # Verify UPDATE book was called (7th call, index 6)
    assert db.execute.call_count == 7
    assert "book_reset" in result
    assert result["book_reset"] is True


@pytest.mark.asyncio
async def test_cleanup_deletes_files():
    """Test 5: cleanup_book_data() collects and deletes avatar and image files."""
    db = _make_mock_db()
    book_id = uuid4()
    chapter_ids = [uuid4()]

    avatar_paths = [
        "/app/storage/avatars/entity1.png",
        "/app/storage/avatars/entity2.png",
    ]
    image_paths = [
        "/app/storage/generated_images/img1.png",
        "/app/storage/generated_images/img2.jpg",
    ]

    db.execute = AsyncMock(
        side_effect=[
            _make_scalars_result(chapter_ids),  # SELECT chapter_ids
            _make_scalars_result(avatar_paths),  # SELECT avatar urls
            _make_scalars_result(image_paths),  # SELECT image paths
            MagicMock(rowcount=2),  # DELETE descriptions
            MagicMock(rowcount=2),  # DELETE entities
            MagicMock(),  # UPDATE chapters
            MagicMock(),  # UPDATE book
        ]
    )

    with patch("app.services.book_cleanup_service._delete_files") as mock_delete:
        result = await cleanup_book_data(db, book_id)

    # Verify _delete_files was called with all collected paths
    mock_delete.assert_called_once()
    deleted_paths = mock_delete.call_args[0][0]
    assert len(deleted_paths) == 4
    assert set(deleted_paths) == set(avatar_paths + image_paths)

    assert result["files_deleted"] == 4


@pytest.mark.asyncio
async def test_cleanup_empty_book():
    """Test 6: cleanup_book_data() works for a book with no descriptions/entities."""
    db = _make_mock_db()
    book_id = uuid4()

    # No chapters at all
    db.execute = AsyncMock(
        side_effect=[
            _make_scalars_result([]),  # SELECT chapter_ids -- empty
            _make_scalars_result([]),  # SELECT avatar urls
            MagicMock(
                rowcount=0
            ),  # DELETE entities (no chapter_ids, skip descriptions)
            MagicMock(),  # UPDATE book
        ]
    )

    # Should not raise any exception
    result = await cleanup_book_data(db, book_id)

    assert result["descriptions_deleted"] == 0
    assert result["entities_deleted"] == 0
    assert result["chapters_reset"] == 0
    assert result["files_deleted"] == 0
