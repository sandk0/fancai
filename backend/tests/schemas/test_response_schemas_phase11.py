"""
Unit tests для новых response schemas (Phase 1.1 Type Safety).

Tests for:
- UserProfileResponse
- SubscriptionDetailResponse
- LogoutResponse
- ReadingProgressDetailResponse
- ChapterDetailResponse
"""

import pytest
from datetime import datetime
from uuid import uuid4

from app.schemas.responses import (
    # User schemas
    UserResponse,
    SubscriptionResponse,
    UserStatistics,
    UserProfileResponse,
    UsageInfo,
    LimitsInfo,
    WithinLimitsInfo,
    SubscriptionDetailResponse,
    # Auth schemas
    LogoutResponse,
    # Progress schemas
    ReadingProgressResponse,
    ReadingProgressDetailResponse,
    # Chapter schemas
    ChapterResponse,
    NavigationInfo,
    BookMinimalInfo,
    ChapterDetailResponse,
    DescriptionWithImageResponse,
)
from app.models.user import SubscriptionPlan, SubscriptionStatus
from app.models.description import DescriptionType


class TestUserSchemas:
    """Tests для user-related response schemas."""

    def test_user_statistics_validation(self):
        """Тест валидации UserStatistics."""
        # Valid statistics
        stats = UserStatistics(
            total_books=10,
            total_descriptions=150,
            total_images=75,
            total_reading_time_minutes=360,
        )
        assert stats.total_books == 10
        assert stats.total_descriptions == 150
        assert stats.total_images == 75
        assert stats.total_reading_time_minutes == 360

        # Negative values should fail
        with pytest.raises(ValueError):
            UserStatistics(
                total_books=-1,
                total_descriptions=0,
                total_images=0,
                total_reading_time_minutes=0,
            )

    def test_user_profile_response(self):
        """Тест UserProfileResponse с полными данными."""
        user_data = {
            "id": uuid4(),
            "email": "test@example.com",
            "full_name": "Test User",
            "is_active": True,
            "is_verified": True,
            "is_admin": False,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "last_login": None,
            "subscription": None,
        }
        user_response = UserResponse(**user_data)

        subscription_data = {
            "id": uuid4(),
            "plan": SubscriptionPlan.PREMIUM,
            "status": SubscriptionStatus.ACTIVE,
            "start_date": datetime.utcnow(),
            "end_date": None,
            "auto_renewal": True,
            "books_uploaded": 5,
            "images_generated_month": 25,
            "last_reset_date": datetime.utcnow(),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        subscription_response = SubscriptionResponse(**subscription_data)

        statistics = UserStatistics(
            total_books=5,
            total_descriptions=50,
            total_images=25,
            total_reading_time_minutes=120,
        )

        profile = UserProfileResponse(
            user=user_response,
            subscription=subscription_response,
            statistics=statistics,
        )

        assert profile.user.email == "test@example.com"
        assert profile.subscription.plan == SubscriptionPlan.PREMIUM
        assert profile.statistics.total_books == 5

    def test_subscription_detail_response(self):
        """Тест SubscriptionDetailResponse с лимитами."""
        subscription_data = {
            "id": uuid4(),
            "plan": SubscriptionPlan.FREE,
            "status": SubscriptionStatus.ACTIVE,
            "start_date": datetime.utcnow(),
            "end_date": None,
            "auto_renewal": False,
            "books_uploaded": 2,
            "images_generated_month": 30,
            "last_reset_date": datetime.utcnow(),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        subscription = SubscriptionResponse(**subscription_data)

        usage = UsageInfo(
            books_uploaded=2,
            images_generated_month=30,
            last_reset_date=datetime.utcnow(),
        )

        limits = LimitsInfo(books=3, generations_month=50)

        within_limits = WithinLimitsInfo(books=True, generations=True)

        detail = SubscriptionDetailResponse(
            subscription=subscription,
            usage=usage,
            limits=limits,
            within_limits=within_limits,
        )

        assert detail.subscription.plan == SubscriptionPlan.FREE
        assert detail.usage.books_uploaded == 2
        assert detail.limits.books == 3
        assert detail.within_limits.books is True


class TestAuthSchemas:
    """Tests для auth response schemas."""

    def test_logout_response(self):
        """Тест LogoutResponse."""
        logout = LogoutResponse()
        assert logout.message == "Logout successful"
        assert isinstance(logout.logged_out_at, datetime)

        # Custom message
        logout_custom = LogoutResponse(message="Goodbye!")
        assert logout_custom.message == "Goodbye!"


class TestProgressSchemas:
    """Tests для reading progress schemas."""

    def test_reading_progress_detail_response(self):
        """Тест ReadingProgressDetailResponse."""
        # With progress
        progress_data = {
            "id": uuid4(),
            "user_id": uuid4(),
            "book_id": uuid4(),
            "current_chapter_id": uuid4(),
            "current_position": 45.5,
            "reading_location_cfi": "epubcfi(/6/14[chapter03]!/4/2/16,/1:125,/1:126)",
            "scroll_offset_percent": 23.4,
            "last_read_at": datetime.utcnow(),
            "reading_speed_wpm": 250,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        progress = ReadingProgressResponse(**progress_data)
        detail = ReadingProgressDetailResponse(progress=progress)
        assert detail.progress is not None
        assert detail.progress.current_position == 45.5
        assert detail.progress.reading_location_cfi is not None

        # Without progress (new book)
        detail_empty = ReadingProgressDetailResponse(progress=None)
        assert detail_empty.progress is None


class TestChapterSchemas:
    """Tests для chapter response schemas."""

    def test_navigation_info(self):
        """Тест NavigationInfo."""
        # Middle chapter
        nav = NavigationInfo(
            has_previous=True, has_next=True, previous_chapter=2, next_chapter=4
        )
        assert nav.has_previous is True
        assert nav.has_next is True
        assert nav.previous_chapter == 2
        assert nav.next_chapter == 4

        # First chapter
        nav_first = NavigationInfo(has_previous=False, has_next=True, next_chapter=2)
        assert nav_first.has_previous is False
        assert nav_first.previous_chapter is None

    def test_book_minimal_info(self):
        """Тест BookMinimalInfo."""
        book_info = BookMinimalInfo(
            id=uuid4(), title="Test Book", author="Test Author", total_chapters=15
        )
        assert book_info.title == "Test Book"
        assert book_info.total_chapters == 15

    def test_chapter_detail_response(self):
        """Тест ChapterDetailResponse с описаниями."""
        chapter_data = {
            "id": uuid4(),
            "book_id": uuid4(),
            "chapter_number": 3,
            "title": "Chapter 3",
            "content": "Chapter content here...",
            "word_count": 3500,
            "estimated_reading_time": 14,
            "is_description_parsed": True,
            "descriptions_found": 5,
            "parsing_progress": 100.0,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        chapter = ChapterResponse(**chapter_data)

        # Create description with image
        desc_data = {
            "id": uuid4(),
            "chapter_id": chapter_data["id"],
            "type": DescriptionType.LOCATION,
            "content": "Beautiful mountain landscape",
            "context": "The mountains rose high above the valley",
            "confidence_score": 0.85,
            "priority_score": 75.0,
            "position_in_chapter": 10,
            "word_count": 5,
            "is_suitable_for_generation": True,
            "image_generated": True,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        description = DescriptionWithImageResponse(**desc_data)
        description.image_url = "https://example.com/image.jpg"
        description.image_id = uuid4()

        navigation = NavigationInfo(
            has_previous=True, has_next=True, previous_chapter=2, next_chapter=4
        )

        book_info = BookMinimalInfo(
            id=uuid4(), title="Test Book", author="Test Author", total_chapters=15
        )

        detail = ChapterDetailResponse(
            chapter=chapter,
            descriptions=[description],
            navigation=navigation,
            book_info=book_info,
        )

        assert detail.chapter.chapter_number == 3
        assert len(detail.descriptions) == 1
        assert detail.descriptions[0].image_url == "https://example.com/image.jpg"
        assert detail.navigation.has_previous is True
        assert detail.book_info.total_chapters == 15


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
