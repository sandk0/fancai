"""
Tests for Phase 1.2 Response Schemas (Images & Descriptions).

Проверяет:
- Image generation schemas (5 schemas)
- Description analysis schemas (5 schemas)
- Validation rules и constraints
- Type safety

Version: Phase 1.2 Type Safety (2025-11-29)
"""

import pytest
from uuid import uuid4
from datetime import datetime

from app.schemas.responses.images import (
    QueueStats,
    UserGenerationInfo,
    APIProviderInfo,
    ImageGenerationStatusResponse,
    UserImageStatsResponse,
    ImageGenerationSuccessResponse,
)
from app.schemas.responses.descriptions import (
    ChapterMinimalInfo,
    DescriptionsAnalysis,
    ChapterDescriptionsResponse,
    ChapterAnalysisPreview,
    ChapterAnalysisResponse,
)
from app.schemas.responses import DescriptionResponse
from app.models.description import DescriptionType

# ============================================================================
# IMAGE SCHEMAS TESTS
# ============================================================================


class TestQueueStats:
    """Тесты для QueueStats schema."""

    def test_queue_stats_validation(self):
        """Проверка валидации QueueStats."""
        stats = QueueStats(
            pending_tasks=10,
            processing_tasks=2,
            completed_today=100,
            failed_today=5,
        )

        assert stats.pending_tasks == 10
        assert stats.processing_tasks == 2
        assert stats.completed_today == 100
        assert stats.failed_today == 5

    def test_queue_stats_negative_values(self):
        """Проверка что отрицательные значения запрещены."""
        with pytest.raises(ValueError):
            QueueStats(
                pending_tasks=-1,  # Invalid: negative
                processing_tasks=0,
                completed_today=0,
                failed_today=0,
            )

    def test_queue_stats_defaults(self):
        """Проверка default значений отсутствуют (все required)."""
        # All fields are required, no defaults
        with pytest.raises(ValueError):
            QueueStats()  # Should fail - missing required fields


class TestUserGenerationInfo:
    """Тесты для UserGenerationInfo schema."""

    def test_user_generation_info_with_quota(self):
        """Проверка UserGenerationInfo с квотой."""
        user_id = uuid4()
        info = UserGenerationInfo(
            id=user_id,
            can_generate=True,
            remaining_quota=50,
        )

        assert info.id == user_id
        assert info.can_generate is True
        assert info.remaining_quota == 50

    def test_user_generation_info_unlimited(self):
        """Проверка UserGenerationInfo с unlimited (None)."""
        user_id = uuid4()
        info = UserGenerationInfo(
            id=user_id,
            can_generate=True,
            remaining_quota=None,  # Unlimited
        )

        assert info.id == user_id
        assert info.can_generate is True
        assert info.remaining_quota is None

    def test_user_generation_info_negative_quota(self):
        """Проверка что отрицательная квота запрещена."""
        user_id = uuid4()
        with pytest.raises(ValueError):
            UserGenerationInfo(
                id=user_id,
                can_generate=True,
                remaining_quota=-10,  # Invalid
            )


class TestAPIProviderInfo:
    """Тесты для APIProviderInfo schema."""

    def test_api_provider_info_defaults(self):
        """Проверка default значений для APIProviderInfo."""
        info = APIProviderInfo()

        assert info.provider == "pollinations.ai"
        assert info.supported_formats == ["PNG"]
        assert info.max_resolution == "1024x768"
        assert info.estimated_time_per_image == "10-30 seconds"

    def test_api_provider_info_custom(self):
        """Проверка кастомных значений."""
        info = APIProviderInfo(
            provider="DALL-E",
            supported_formats=["PNG", "JPG", "WEBP"],
            max_resolution="2048x2048",
            estimated_time_per_image="30-60 seconds",
        )

        assert info.provider == "DALL-E"
        assert len(info.supported_formats) == 3
        assert info.max_resolution == "2048x2048"


class TestImageGenerationStatusResponse:
    """Тесты для ImageGenerationStatusResponse schema."""

    def test_image_generation_status_response(self):
        """Проверка полного response для статуса генерации."""
        user_id = uuid4()

        queue_stats = QueueStats(
            pending_tasks=5,
            processing_tasks=1,
            completed_today=20,
            failed_today=2,
        )

        user_info = UserGenerationInfo(
            id=user_id,
            can_generate=True,
            remaining_quota=100,
        )

        api_info = APIProviderInfo()

        response = ImageGenerationStatusResponse(
            status="operational",
            queue_stats=queue_stats,
            user_info=user_info,
            api_info=api_info,
        )

        assert response.status == "operational"
        assert response.queue_stats.pending_tasks == 5
        assert response.user_info.can_generate is True
        assert response.api_info.provider == "pollinations.ai"


class TestUserImageStatsResponse:
    """Тесты для UserImageStatsResponse schema."""

    def test_user_image_stats_response(self):
        """Проверка статистики изображений пользователя."""
        response = UserImageStatsResponse(
            total_images_generated=42,
            total_descriptions_found=156,
            images_by_type={
                "LOCATION": 20,
                "CHARACTER": 15,
                "ATMOSPHERE": 7,
            },
        )

        assert response.total_images_generated == 42
        assert response.total_descriptions_found == 156
        assert response.images_by_type["LOCATION"] == 20
        assert len(response.images_by_type) == 3

    def test_user_image_stats_empty(self):
        """Проверка пустой статистики."""
        response = UserImageStatsResponse(
            total_images_generated=0,
            total_descriptions_found=0,
            images_by_type={},
        )

        assert response.total_images_generated == 0
        assert response.total_descriptions_found == 0
        assert response.images_by_type == {}


class TestImageGenerationSuccessResponse:
    """Тесты для ImageGenerationSuccessResponse schema."""

    def test_image_generation_success_response(self):
        """Проверка успешной генерации изображения."""
        image_id = uuid4()
        desc_id = uuid4()

        response = ImageGenerationSuccessResponse(
            image_id=image_id,
            description_id=desc_id,
            image_url="https://pollinations.ai/p/image123.png",
            generation_time=15.5,
            status="completed",
            created_at="2025-11-29T12:00:00Z",
            message="Image generated successfully",
        )

        assert response.image_id == image_id
        assert response.description_id == desc_id
        assert "pollinations.ai" in response.image_url
        assert response.generation_time == 15.5
        assert response.status == "completed"

    def test_image_generation_negative_time(self):
        """Проверка что отрицательное время запрещено."""
        with pytest.raises(ValueError):
            ImageGenerationSuccessResponse(
                image_id=uuid4(),
                description_id=uuid4(),
                image_url="https://example.com/image.png",
                generation_time=-5.0,  # Invalid
                created_at="2025-11-29T12:00:00Z",
            )


# ============================================================================
# DESCRIPTION SCHEMAS TESTS
# ============================================================================


class TestChapterMinimalInfo:
    """Тесты для ChapterMinimalInfo schema."""

    def test_chapter_minimal_info(self):
        """Проверка минимальной информации о главе."""
        chapter_id = uuid4()
        info = ChapterMinimalInfo(
            id=chapter_id,
            number=5,
            title="Глава пятая",
            word_count=2500,
        )

        assert info.id == chapter_id
        assert info.number == 5
        assert info.title == "Глава пятая"
        assert info.word_count == 2500

    def test_chapter_minimal_info_invalid_number(self):
        """Проверка что номер главы >= 1."""
        with pytest.raises(ValueError):
            ChapterMinimalInfo(
                id=uuid4(),
                number=0,  # Invalid: chapters start at 1
                title="Test",
                word_count=100,
            )


class TestDescriptionsAnalysis:
    """Тесты для DescriptionsAnalysis schema."""

    def test_nlp_analysis_result(self):
        """Проверка NLP анализа."""
        # Create mock DescriptionResponse
        desc_response = DescriptionResponse(
            id=uuid4(),
            chapter_id=uuid4(),
            type=DescriptionType.LOCATION,
            content="Тёмный лес окутывал дорогу",
            context="Путешественник шёл по тёмному лесу",
            confidence_score=0.85,
            priority_score=75.0,
            position_in_chapter=0,
            word_count=5,
            is_suitable_for_generation=True,
            image_generated=False,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )

        result = DescriptionsAnalysis(
            total_descriptions=10,
            by_type={"LOCATION": 6, "CHARACTER": 3, "ATMOSPHERE": 1},
            descriptions=[desc_response],
            processing_time_seconds=2.5,
        )

        assert result.total_descriptions == 10
        assert result.by_type["LOCATION"] == 6
        assert len(result.descriptions) == 1
        assert result.processing_time_seconds == 2.5

    def test_nlp_analysis_result_without_time(self):
        """Проверка NLP анализа без времени обработки."""
        result = DescriptionsAnalysis(
            total_descriptions=0,
            by_type={},
            descriptions=[],
            processing_time_seconds=None,  # Not tracked
        )

        assert result.total_descriptions == 0
        assert result.processing_time_seconds is None


class TestChapterDescriptionsResponse:
    """Тесты для ChapterDescriptionsResponse schema."""

    def test_chapter_descriptions_response(self):
        """Проверка response для описаний главы."""
        chapter_info = ChapterMinimalInfo(
            id=uuid4(),
            number=3,
            title="Глава третья",
            word_count=3000,
        )

        nlp_analysis = DescriptionsAnalysis(
            total_descriptions=5,
            by_type={"LOCATION": 3, "CHARACTER": 2},
            descriptions=[],
        )

        response = ChapterDescriptionsResponse(
            chapter_info=chapter_info,
            nlp_analysis=nlp_analysis,
            message="Found 5 descriptions in chapter 3",
        )

        assert response.chapter_info.number == 3
        assert response.nlp_analysis.total_descriptions == 5
        assert "Found 5 descriptions" in response.message


class TestChapterAnalysisPreview:
    """Тесты для ChapterAnalysisPreview schema."""

    def test_chapter_analysis_preview(self):
        """Проверка preview информации о главе."""
        preview = ChapterAnalysisPreview(
            chapter_number=1,
            title="Пролог",
            word_count=500,
            preview_text="Было раннее утро. Солнце только начинало вставать...",
        )

        assert preview.chapter_number == 1
        assert preview.title == "Пролог"
        assert preview.word_count == 500
        assert "Было раннее утро" in preview.preview_text

    def test_chapter_analysis_preview_max_length(self):
        """Проверка максимальной длины preview_text."""
        long_text = "a" * 600
        with pytest.raises(ValueError):
            ChapterAnalysisPreview(
                chapter_number=1,
                title="Test",
                word_count=100,
                preview_text=long_text,  # Exceeds max_length=500
            )


class TestChapterAnalysisResponse:
    """Тесты для ChapterAnalysisResponse schema."""

    def test_chapter_analysis_response(self):
        """Проверка response для анализа главы (preview mode)."""
        chapter_info = ChapterAnalysisPreview(
            chapter_number=1,
            title="Глава первая",
            word_count=2000,
            preview_text="Начало истории...",
        )

        nlp_analysis = DescriptionsAnalysis(
            total_descriptions=8,
            by_type={"LOCATION": 5, "CHARACTER": 3},
            descriptions=[],
        )

        response = ChapterAnalysisResponse(
            chapter_info=chapter_info,
            nlp_analysis=nlp_analysis,
            message="Chapter 1 analyzed: 8 descriptions extracted",
            test_mode=True,
        )

        assert response.chapter_info.chapter_number == 1
        assert response.nlp_analysis.total_descriptions == 8
        assert response.test_mode is True
        assert "analyzed" in response.message


# ============================================================================
# INTEGRATION TESTS
# ============================================================================


class TestPhase12Integration:
    """Integration тесты для Phase 1.2 schemas."""

    def test_full_image_generation_flow(self):
        """Проверка полного flow генерации изображения."""
        # 1. Check status
        status_response = ImageGenerationStatusResponse(
            status="operational",
            queue_stats=QueueStats(
                pending_tasks=0,
                processing_tasks=0,
                completed_today=10,
                failed_today=0,
            ),
            user_info=UserGenerationInfo(
                id=uuid4(),
                can_generate=True,
                remaining_quota=50,
            ),
            api_info=APIProviderInfo(),
        )

        assert status_response.status == "operational"
        assert status_response.user_info.can_generate is True

        # 2. Generate image
        success_response = ImageGenerationSuccessResponse(
            image_id=uuid4(),
            description_id=uuid4(),
            image_url="https://pollinations.ai/p/test.png",
            generation_time=12.3,
            created_at=datetime.utcnow().isoformat(),
        )

        assert success_response.generation_time > 0
        assert "pollinations.ai" in success_response.image_url

        # 3. Check user stats
        stats_response = UserImageStatsResponse(
            total_images_generated=1,
            total_descriptions_found=10,
            images_by_type={"LOCATION": 1},
        )

        assert stats_response.total_images_generated == 1

    def test_full_description_analysis_flow(self):
        """Проверка полного flow анализа описаний."""
        # 1. Analyze chapter (preview mode)
        analysis_response = ChapterAnalysisResponse(
            chapter_info=ChapterAnalysisPreview(
                chapter_number=1,
                title="Test Chapter",
                word_count=1000,
                preview_text="Preview...",
            ),
            nlp_analysis=DescriptionsAnalysis(
                total_descriptions=5,
                by_type={"LOCATION": 3, "CHARACTER": 2},
                descriptions=[],
                processing_time_seconds=1.2,
            ),
            test_mode=True,
        )

        assert analysis_response.test_mode is True
        assert analysis_response.nlp_analysis.total_descriptions == 5

        # 2. Get descriptions from saved chapter
        descriptions_response = ChapterDescriptionsResponse(
            chapter_info=ChapterMinimalInfo(
                id=uuid4(),
                number=1,
                title="Test Chapter",
                word_count=1000,
            ),
            nlp_analysis=DescriptionsAnalysis(
                total_descriptions=5,
                by_type={"LOCATION": 3, "CHARACTER": 2},
                descriptions=[],
            ),
        )

        assert descriptions_response.chapter_info.number == 1
        assert descriptions_response.nlp_analysis.total_descriptions == 5
