"""API изображений: квота, доступ к файлам, генерация, очередь.

Внешний генератор подменяется через `app.dependency_overrides`
(`get_image_generator_service_dep`), БД — настоящая тестовая.
Все запросы идут от владельца `test_book` (`test_user_auth_headers`):
`auth_headers` — другой пользователь, и guard ответит 404.
"""

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.container import DependencyContainer, get_image_generator_service_dep
from app.main import app
from app.models.book import Book
from app.models.chapter import Chapter
from app.models.description import Description, DescriptionType
from app.models.entity import Entity, EntityType
from app.models.image import GeneratedImage
from app.models.user import (
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
    User,
)

FREE_LIMIT = 50


@pytest.fixture
def image_service(mock_image_generator_service):
    """Подменяет генератор изображений на мок и убирает override за собой."""
    app.dependency_overrides[get_image_generator_service_dep] = (
        lambda: mock_image_generator_service
    )
    yield mock_image_generator_service
    app.dependency_overrides.pop(get_image_generator_service_dep, None)
    DependencyContainer.reset_all()
    DependencyContainer.clear_caches()


@pytest.fixture
def image_file():
    """Файл в каталоге раздачи; путь и имя возвращаются вызывающему.

    Каталог берётся из МОДУЛЯ, а не из импортированного имени: autouse-фикстура
    `storage_dirs_in_tmp` перенаправляет `GENERATED_IMAGES_DIR` в tmp, и связанное
    при импорте имя указывало бы на `/app/storage`, которого вне контейнера нет.
    """
    import app.routers.images as images_router

    directory = images_router.GENERATED_IMAGES_DIR
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"test-{uuid.uuid4().hex}.png"
    path.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    yield path
    path.unlink(missing_ok=True)


async def _make_description(
    db: AsyncSession,
    chapter: Chapter,
    *,
    content: str = "Тёмный лес под дождём",
    type_: DescriptionType = DescriptionType.LOCATION,
    priority: float = 0.5,
) -> Description:
    description = Description(
        chapter_id=chapter.id,
        type=type_,
        content=content,
        confidence_score=0.9,
        priority_score=priority,
        position_in_chapter=0,
        word_count=len(content.split()),
    )
    db.add(description)
    await db.commit()
    await db.refresh(description)
    return description


async def _make_image(
    db: AsyncSession,
    description: Description,
    user: User,
    *,
    local_path: str | None = None,
    image_url: str = "/api/v1/images/file/existing.png",
) -> GeneratedImage:
    image = GeneratedImage(
        description_id=description.id,
        chapter_id=description.chapter_id,
        user_id=user.id,
        service_used="imagen",
        status="completed",
        image_url=image_url,
        local_path=local_path,
        prompt_used="prompt",
        generation_time_seconds=2.5,
    )
    db.add(image)
    await db.commit()
    await db.refresh(image)
    return image


async def _make_subscription(
    db: AsyncSession,
    user: User,
    *,
    used: int,
    plan: SubscriptionPlan = SubscriptionPlan.FREE,
    last_reset: datetime | None = None,
) -> Subscription:
    subscription = Subscription(
        user_id=user.id,
        plan=plan,
        status=SubscriptionStatus.ACTIVE,
        images_generated_month=used,
        last_reset_date=last_reset or datetime.now(timezone.utc),
    )
    db.add(subscription)
    await db.commit()
    await db.refresh(subscription)
    return subscription


# ============================================================================
# check_image_quota — платный рубеж перед любой генерацией
# ============================================================================


class TestImageQuota:
    """Контракт квоты: 402 при исчерпании, месячный сброс, X-RateLimit-*."""

    @pytest.mark.asyncio
    async def test_missing_subscription_is_created_as_free(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        """Пользователь без подписки получает FREE, а не отказ."""
        description = await _make_description(db_session, test_chapter)

        response = await client.post(
            f"/api/v1/images/generate/description/{description.id}",
            json={},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 201
        assert response.headers["X-RateLimit-Limit"] == str(FREE_LIMIT)

        subscription = await db_session.scalar(
            select(Subscription).where(Subscription.user_id == test_user.id)
        )
        assert subscription is not None
        assert subscription.plan == SubscriptionPlan.FREE

    @pytest.mark.asyncio
    async def test_exhausted_quota_is_rejected_with_402(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        """Исчерпанная квота — 402 и нулевой остаток в заголовке."""
        await _make_subscription(db_session, test_user, used=FREE_LIMIT)
        description = await _make_description(db_session, test_chapter)

        response = await client.post(
            f"/api/v1/images/generate/description/{description.id}",
            json={},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 402
        assert response.headers["X-RateLimit-Remaining"] == "0"
        assert response.json()["detail"]["error"] == "quota_exceeded"
        image_service.generate_image_for_description.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_quota_resets_on_new_month(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        """Счётчик прошлого месяца не должен блокировать генерацию в текущем."""
        subscription = await _make_subscription(
            db_session,
            test_user,
            used=FREE_LIMIT,
            last_reset=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
        description = await _make_description(db_session, test_chapter)

        response = await client.post(
            f"/api/v1/images/generate/description/{description.id}",
            json={},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 201
        await db_session.refresh(subscription)
        # Сброс в ноль, плюс единица за эту генерацию.
        assert subscription.images_generated_month == 1

    @pytest.mark.asyncio
    async def test_premium_plan_gets_its_own_limit(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        """FREE-лимит не должен применяться к платному плану."""
        await _make_subscription(
            db_session, test_user, used=FREE_LIMIT, plan=SubscriptionPlan.PREMIUM
        )
        description = await _make_description(db_session, test_chapter)

        response = await client.post(
            f"/api/v1/images/generate/description/{description.id}",
            json={},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 201
        assert response.headers["X-RateLimit-Limit"] == "500"
        assert response.headers["X-RateLimit-Remaining"] == "450"

    @pytest.mark.asyncio
    async def test_successful_generation_increments_counter(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        """Без инкремента квота никогда бы не кончалась."""
        subscription = await _make_subscription(db_session, test_user, used=7)
        description = await _make_description(db_session, test_chapter)

        response = await client.post(
            f"/api/v1/images/generate/description/{description.id}",
            json={},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 201
        await db_session.refresh(subscription)
        assert subscription.images_generated_month == 8


# ============================================================================
# GET /images/file/{filename} — раздача файла и защита от чужих
# ============================================================================


class TestGetGeneratedImageFile:
    """Файл отдаётся только владельцу записи или владельцу книги-сущности."""

    @pytest.mark.asyncio
    async def test_traversal_in_filename_is_rejected(
        self, client: AsyncClient, test_user_auth_headers: dict
    ):
        """Быстрое отсечение по чёрному списку подстрок."""
        response = await client.get(
            "/api/v1/images/file/..png", headers=test_user_auth_headers
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "Invalid filename"

    @pytest.mark.asyncio
    async def test_symlink_out_of_storage_is_rejected(
        self, client: AsyncClient, test_user_auth_headers: dict, tmp_path
    ):
        """Случай, который чёрный список НЕ ловит: имя безобидное, цель — снаружи.

        Ни `..`, ни `/`, ни `\\` в имени нет, поэтому проверку подстрок запрос
        проходит. Отклонить его может только сравнение канонических путей.
        """
        import app.routers.images as images_router

        outside = tmp_path / "secret.txt"
        outside.write_text("не ваше")

        directory = images_router.GENERATED_IMAGES_DIR
        directory.mkdir(parents=True, exist_ok=True)
        link = directory / "innocent.png"
        link.symlink_to(outside)

        try:
            response = await client.get(
                f"/api/v1/images/file/{link.name}", headers=test_user_auth_headers
            )
        finally:
            link.unlink(missing_ok=True)

        assert response.status_code == 400
        assert response.json()["detail"] == "Invalid filename"

    @pytest.mark.asyncio
    async def test_absent_file_is_404(
        self, client: AsyncClient, test_user_auth_headers: dict
    ):
        response = await client.get(
            "/api/v1/images/file/no-such-file.png", headers=test_user_auth_headers
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_owner_receives_file_with_immutable_cache_headers(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_file,
    ):
        description = await _make_description(db_session, test_chapter)
        await _make_image(
            db_session, description, test_user, local_path=str(image_file)
        )

        response = await client.get(
            f"/api/v1/images/file/{image_file.name}", headers=test_user_auth_headers
        )

        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "public, max-age=31536000, immutable"
        assert response.headers["ETag"]

    @pytest.mark.asyncio
    async def test_matching_etag_returns_304_without_body(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_file,
    ):
        """Иммутабельная раздача обязана поддерживать условный запрос."""
        description = await _make_description(db_session, test_chapter)
        await _make_image(
            db_session, description, test_user, local_path=str(image_file)
        )

        first = await client.get(
            f"/api/v1/images/file/{image_file.name}", headers=test_user_auth_headers
        )
        second = await client.get(
            f"/api/v1/images/file/{image_file.name}",
            headers={
                **test_user_auth_headers,
                "If-None-Match": first.headers["ETag"],
            },
        )

        assert second.status_code == 304
        assert second.content == b""

    @pytest.mark.asyncio
    async def test_foreign_image_is_404_not_403(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        auth_headers: dict,
        test_chapter: Chapter,
        image_file,
    ):
        """404, а не 403: 403 подтвердил бы существование файла."""
        description = await _make_description(db_session, test_chapter)
        await _make_image(
            db_session, description, test_user, local_path=str(image_file)
        )

        response = await client.get(
            f"/api/v1/images/file/{image_file.name}", headers=auth_headers
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_master_portrait_without_image_row_is_served(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_user_auth_headers: dict,
        image_file,
    ):
        """Мастер-портреты живут в Entity, а не в generated_images."""
        entity = Entity(
            book_id=test_book.id,
            name="Геральт",
            name_lower="геральт",
            type=EntityType.CHARACTER.value,
            master_portrait_url=f"/api/v1/images/file/{image_file.name}",
        )
        db_session.add(entity)
        await db_session.commit()

        response = await client.get(
            f"/api/v1/images/file/{image_file.name}", headers=test_user_auth_headers
        )

        assert response.status_code == 200


# ============================================================================
# Статистика
# ============================================================================


class TestImageStats:
    @pytest.mark.asyncio
    async def test_generation_status_reports_queue(
        self, client: AsyncClient, test_user_auth_headers: dict, image_service
    ):
        image_service.get_generation_stats.return_value = {
            "queue_size": 4,
            "is_processing": True,
        }

        response = await client.get(
            "/api/v1/images/generation/status", headers=test_user_auth_headers
        )

        assert response.status_code == 200
        body = response.json()
        assert body["queue_stats"]["pending_tasks"] == 4
        assert body["queue_stats"]["processing_tasks"] == 1

    @pytest.mark.asyncio
    async def test_user_stats_count_own_rows_only(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        auth_headers: dict,
        test_chapter: Chapter,
    ):
        description = await _make_description(db_session, test_chapter)
        await _make_image(db_session, description, test_user)

        mine = await client.get(
            "/api/v1/images/user/stats", headers=test_user_auth_headers
        )
        stranger = await client.get(
            "/api/v1/images/user/stats", headers=auth_headers
        )

        assert mine.status_code == 200
        assert mine.json()["total_images_generated"] == 1
        assert mine.json()["images_by_type"] == {"location": 1}
        assert stranger.json()["total_images_generated"] == 0

    @pytest.mark.asyncio
    async def test_admin_stats_require_admin(
        self, client: AsyncClient, test_user_auth_headers: dict, image_service
    ):
        response = await client.get(
            "/api/v1/images/admin/stats", headers=test_user_auth_headers
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_admin_stats_aggregate_all_users(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        admin_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        description = await _make_description(db_session, test_chapter)
        await _make_image(db_session, description, test_user)

        response = await client.get(
            "/api/v1/images/admin/stats", headers=admin_auth_headers
        )

        assert response.status_code == 200
        body = response.json()
        assert body["total_images_generated"] == 1
        assert body["generation_by_type"] == {"location": 1}
        assert body["performance"]["average_generation_time_seconds"] == 2.5


# ============================================================================
# POST /images/generate/description/{id}
# ============================================================================


class TestGenerateImageForDescription:
    @pytest.mark.asyncio
    async def test_creates_row_and_returns_url(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        description = await _make_description(db_session, test_chapter)

        response = await client.post(
            f"/api/v1/images/generate/description/{description.id}",
            json={"style_prompt": "нуар"},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 201
        body = response.json()
        assert body["description_id"] == str(description.id)
        assert body["image_url"] == "https://example.com/test-image.png"
        assert body["status"] == "completed"

        stored = await db_session.scalar(
            select(GeneratedImage).where(
                GeneratedImage.description_id == description.id
            )
        )
        assert stored is not None
        assert str(stored.id) == body["image_id"]

        _, kwargs = image_service.generate_image_for_description.call_args
        assert kwargs["custom_style"] == "нуар"

    @pytest.mark.asyncio
    async def test_foreign_description_is_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        description = await _make_description(db_session, test_chapter)

        response = await client.post(
            f"/api/v1/images/generate/description/{description.id}",
            json={},
            headers=auth_headers,
        )

        assert response.status_code == 404
        image_service.generate_image_for_description.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_second_image_for_same_description_is_409(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        description = await _make_description(db_session, test_chapter)
        await _make_image(db_session, description, test_user)

        response = await client.post(
            f"/api/v1/images/generate/description/{description.id}",
            json={},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_generator_failure_is_500_and_leaves_no_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        from tests.conftest import MockImageGenerationResult

        image_service.generate_image_for_description.return_value = (
            MockImageGenerationResult(success=False, error_message="провайдер лёг")
        )
        description = await _make_description(db_session, test_chapter)

        response = await client.post(
            f"/api/v1/images/generate/description/{description.id}",
            json={},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 500
        stored = await db_session.scalar(
            select(GeneratedImage).where(
                GeneratedImage.description_id == description.id
            )
        )
        assert stored is None


# ============================================================================
# POST /images/generate/chapter/{id} — пакетная генерация
# ============================================================================


class TestGenerateImagesForChapter:
    @pytest.mark.asyncio
    async def test_processes_highest_priority_first_within_max_images(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        """Порядок обязан быть по priority_score: результаты сопоставляются по индексу."""
        from tests.conftest import MockImageGenerationResult

        low = await _make_description(db_session, test_chapter, content="Низкий", priority=0.1)
        high = await _make_description(
            db_session, test_chapter, content="Высокий", priority=0.9
        )
        mid = await _make_description(
            db_session, test_chapter, content="Средний", priority=0.5
        )

        image_service.batch_generate_for_chapter.return_value = [
            MockImageGenerationResult(image_url="https://example.com/1.png"),
            MockImageGenerationResult(image_url="https://example.com/2.png"),
        ]

        response = await client.post(
            f"/api/v1/images/generate/chapter/{test_chapter.id}",
            json={"chapter_id": str(test_chapter.id), "max_images": 2},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["total_descriptions"] == 3
        assert body["processed"] == 2
        assert body["successful"] == 2

        _, kwargs = image_service.batch_generate_for_chapter.call_args
        assert [d.id for d in kwargs["descriptions"]] == [high.id, mid.id]
        assert low.id not in {d.id for d in kwargs["descriptions"]}

    @pytest.mark.asyncio
    async def test_failed_results_are_counted_not_stored(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        from tests.conftest import MockImageGenerationResult

        await _make_description(db_session, test_chapter, content="Первое")
        await _make_description(db_session, test_chapter, content="Второе")

        image_service.batch_generate_for_chapter.return_value = [
            MockImageGenerationResult(success=True),
            MockImageGenerationResult(success=False, error_message="таймаут"),
        ]

        response = await client.post(
            f"/api/v1/images/generate/chapter/{test_chapter.id}",
            json={"chapter_id": str(test_chapter.id), "max_images": 5},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["successful"] == 1
        assert body["failed"] == 1
        assert len(body["images"]) == 1

        stored = (
            (await db_session.execute(select(GeneratedImage))).scalars().all()
        )
        assert len(stored) == 1

    @pytest.mark.asyncio
    async def test_chapter_without_descriptions_is_404(
        self,
        client: AsyncClient,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        response = await client.post(
            f"/api/v1/images/generate/chapter/{test_chapter.id}",
            json={"chapter_id": str(test_chapter.id)},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_foreign_chapter_is_404(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        response = await client.post(
            f"/api/v1/images/generate/chapter/{test_chapter.id}",
            json={"chapter_id": str(test_chapter.id)},
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_all_descriptions_already_covered_short_circuits(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        """Повторный запрос не должен снова платить за генерацию."""
        description = await _make_description(db_session, test_chapter)
        await _make_image(db_session, description, test_user)

        response = await client.post(
            f"/api/v1/images/generate/chapter/{test_chapter.id}",
            json={"chapter_id": str(test_chapter.id)},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["processed"] == 0
        image_service.batch_generate_for_chapter.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_description_type_filter_narrows_selection(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        from tests.conftest import MockImageGenerationResult

        await _make_description(
            db_session, test_chapter, content="Локация", type_=DescriptionType.LOCATION
        )
        character = await _make_description(
            db_session,
            test_chapter,
            content="Персонаж",
            type_=DescriptionType.CHARACTER,
        )
        image_service.batch_generate_for_chapter.return_value = [
            MockImageGenerationResult()
        ]

        response = await client.post(
            f"/api/v1/images/generate/chapter/{test_chapter.id}",
            json={
                "chapter_id": str(test_chapter.id),
                "description_types": ["character"],
            },
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["total_descriptions"] == 1
        _, kwargs = image_service.batch_generate_for_chapter.call_args
        assert [d.id for d in kwargs["descriptions"]] == [character.id]


# ============================================================================
# Чтение и удаление
# ============================================================================


class TestReadAndDelete:
    @pytest.mark.asyncio
    async def test_image_detail_truncates_long_preview(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
    ):
        long_text = "о" * 250
        description = await _make_description(
            db_session, test_chapter, content=long_text
        )
        await _make_image(db_session, description, test_user)

        response = await client.get(
            f"/api/v1/images/description/{description.id}",
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["description"]["content"] == "о" * 100 + "..."
        assert body["description"]["text"] == long_text
        assert body["chapter"]["number"] == test_chapter.chapter_number

    @pytest.mark.asyncio
    async def test_image_detail_missing_is_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
    ):
        description = await _make_description(db_session, test_chapter)

        response = await client.get(
            f"/api/v1/images/description/{description.id}",
            headers=test_user_auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_book_images_are_paginated(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_book: Book,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
    ):
        for i in range(3):
            description = await _make_description(
                db_session, test_chapter, content=f"Описание {i}"
            )
            await _make_image(db_session, description, test_user)

        response = await client.get(
            f"/api/v1/images/book/{test_book.id}?skip=1&limit=2",
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["book_title"] == test_book.title
        assert len(body["images"]) == 2
        assert body["pagination"] == {"skip": 1, "limit": 2, "total_found": 2}

    @pytest.mark.asyncio
    async def test_foreign_book_images_are_404(
        self, client: AsyncClient, test_book: Book, auth_headers: dict
    ):
        response = await client.get(
            f"/api/v1/images/book/{test_book.id}", headers=auth_headers
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_removes_row_and_file(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_file,
    ):
        description = await _make_description(db_session, test_chapter)
        image = await _make_image(
            db_session, description, test_user, local_path=str(image_file)
        )

        response = await client.delete(
            f"/api/v1/images/{image.id}", headers=test_user_auth_headers
        )

        assert response.status_code == 200
        assert await db_session.get(GeneratedImage, image.id) is None
        assert not image_file.exists()

    @pytest.mark.asyncio
    async def test_delete_foreign_image_is_404_and_keeps_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        auth_headers: dict,
        test_chapter: Chapter,
    ):
        description = await _make_description(db_session, test_chapter)
        image = await _make_image(db_session, description, test_user)

        response = await client.delete(
            f"/api/v1/images/{image.id}", headers=auth_headers
        )

        assert response.status_code == 404
        assert await db_session.get(GeneratedImage, image.id) is not None


# ============================================================================
# POST /images/regenerate/{id}
# ============================================================================


class TestRegenerateImage:
    @pytest.mark.asyncio
    async def test_replaces_url_on_existing_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        from tests.conftest import MockImageGenerationResult

        description = await _make_description(db_session, test_chapter)
        image = await _make_image(db_session, description, test_user)
        image_service.generate_image_for_description.return_value = (
            MockImageGenerationResult(image_url="https://example.com/new.png")
        )

        response = await client.post(
            f"/api/v1/images/regenerate/{image.id}",
            json={"style_prompt": "акварель"},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["image_url"] == "https://example.com/new.png"
        assert response.json()["status"] == "regenerated"

        await db_session.refresh(image)
        assert image.image_url == "https://example.com/new.png"
        assert image.prompt_used == "акварель"

    @pytest.mark.asyncio
    async def test_foreign_image_is_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        description = await _make_description(db_session, test_chapter)
        image = await _make_image(db_session, description, test_user)

        response = await client.post(
            f"/api/v1/images/regenerate/{image.id}", json={}, headers=auth_headers
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_generator_failure_keeps_previous_url(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        """Провал перегенерации не должен обнулять уже существующую картинку."""
        from tests.conftest import MockImageGenerationResult

        description = await _make_description(db_session, test_chapter)
        image = await _make_image(
            db_session, description, test_user, image_url="/api/v1/images/file/old.png"
        )
        image_service.generate_image_for_description.return_value = (
            MockImageGenerationResult(success=False, error_message="нет квоты у API")
        )

        response = await client.post(
            f"/api/v1/images/regenerate/{image.id}", json={}, headers=test_user_auth_headers
        )

        assert response.status_code == 500
        await db_session.refresh(image)
        assert image.image_url == "/api/v1/images/file/old.png"


# ============================================================================
# Асинхронная очередь
# ============================================================================


class TestAsyncQueue:
    @pytest.mark.asyncio
    async def test_queue_single_returns_task_and_status_url(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        description = await _make_description(db_session, test_chapter)

        response = await client.post(
            f"/api/v1/images/generate/async/{description.id}",
            json={"book_genre": "fantasy"},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 202
        body = response.json()
        assert body["task_id"] == "test-task-123"
        assert body["status_url"] == "/api/v1/images/task/test-task-123"

        _, kwargs = image_service.queue_image_generation.call_args
        assert kwargs["book_genre"] == "fantasy"
        assert kwargs["description_type"] == "location"

    @pytest.mark.asyncio
    async def test_queue_single_conflicts_with_existing_image(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        description = await _make_description(db_session, test_chapter)
        await _make_image(db_session, description, test_user)

        response = await client.post(
            f"/api/v1/images/generate/async/{description.id}",
            json={},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 409
        image_service.queue_image_generation.assert_not_called()

    @pytest.mark.asyncio
    async def test_queue_single_foreign_description_is_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        description = await _make_description(db_session, test_chapter)

        response = await client.post(
            f"/api/v1/images/generate/async/{description.id}",
            json={},
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_queue_batch_passes_book_genre_and_counts(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_book: Book,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        await _make_description(db_session, test_chapter, content="Первое")
        await _make_description(db_session, test_chapter, content="Второе")
        image_service.queue_batch_generation.return_value = {
            "task_id": "batch-1",
            "status": "queued",
            "descriptions_count": 2,
            "message": "Queued",
        }

        response = await client.post(
            f"/api/v1/images/generate/async/chapter/{test_chapter.id}",
            json={"chapter_id": str(test_chapter.id), "max_images": 5},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 202
        body = response.json()
        assert body["queued_for_processing"] == 2
        assert body["total_descriptions"] == 2
        assert body["skipped_existing"] == 0

        _, kwargs = image_service.queue_batch_generation.call_args
        assert kwargs["book_genre"] == test_book.genre

    @pytest.mark.asyncio
    async def test_queue_batch_skips_when_everything_covered(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        description = await _make_description(db_session, test_chapter)
        await _make_image(db_session, description, test_user)

        response = await client.post(
            f"/api/v1/images/generate/async/chapter/{test_chapter.id}",
            json={"chapter_id": str(test_chapter.id)},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 202
        assert response.json()["skipped"] == 1
        image_service.queue_batch_generation.assert_not_called()

    @pytest.mark.asyncio
    async def test_queue_batch_without_descriptions_is_404(
        self,
        client: AsyncClient,
        test_user_auth_headers: dict,
        test_chapter: Chapter,
        image_service,
    ):
        response = await client.post(
            f"/api/v1/images/generate/async/chapter/{test_chapter.id}",
            json={"chapter_id": str(test_chapter.id)},
            headers=test_user_auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_task_status_maps_known_state_to_message(
        self, client: AsyncClient, test_user_auth_headers: dict, image_service
    ):
        image_service.get_task_status.return_value = {
            "task_id": "abc",
            "status": "FAILURE",
            "ready": True,
            "error": "boom",
        }

        response = await client.get(
            "/api/v1/images/task/abc", headers=test_user_auth_headers
        )

        assert response.status_code == 200
        body = response.json()
        assert body["message"] == "Task failed"
        assert body["error"] == "boom"

    @pytest.mark.asyncio
    async def test_task_status_falls_back_for_unknown_state(
        self, client: AsyncClient, test_user_auth_headers: dict, image_service
    ):
        image_service.get_task_status.return_value = {"status": "WEIRD", "ready": False}

        response = await client.get(
            "/api/v1/images/task/xyz", headers=test_user_auth_headers
        )

        assert response.status_code == 200
        assert response.json()["message"] == "Task status: WEIRD"
        assert response.json()["task_id"] == "xyz"
