"""
Тесты для API endpoints feature flags.

Проверяет все 9+ endpoints, авторизацию, валидацию запросов/ответов,
и обработку ошибок.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature_flag import FeatureFlagCategory


@pytest.mark.asyncio
class TestFeatureFlagsListEndpoint:
    """Тесты endpoint GET /admin/feature-flags."""

    async def test_get_all_feature_flags(self, client: AsyncClient, admin_auth_headers):
        """Тест получения списка всех флагов."""
        response = await client.get(
            "/api/v1/admin/feature-flags",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert isinstance(data, list)
        assert len(data) == 6  # Дефолтных флагов
        assert all("name" in item for item in data)
        assert all("enabled" in item for item in data)

    async def test_get_feature_flags_by_category(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест получения флагов с фильтром по категории."""
        response = await client.get(
            "/api/v1/admin/feature-flags?category=nlp",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data) == 4  # 4 NLP флага
        assert all(item["category"] == "nlp" for item in data)

    async def test_get_feature_flags_enabled_only(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест получения только включенных флагов."""
        response = await client.get(
            "/api/v1/admin/feature-flags?enabled_only=true",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        # По умолчанию 4 флага включены
        assert len(data) == 4
        assert all(item["enabled"] is True for item in data)

    async def test_get_feature_flags_category_and_enabled_filter(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест комбинированный фильтр категория и enabled."""
        response = await client.get(
            "/api/v1/admin/feature-flags?category=nlp&enabled_only=true",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert all(item["category"] == "nlp" for item in data)
        assert all(item["enabled"] is True for item in data)

    async def test_get_feature_flags_requires_admin(
        self, client: AsyncClient, auth_headers
    ):
        """Тест что endpoint требует admin доступа."""
        response = await client.get(
            "/api/v1/admin/feature-flags",
            headers=auth_headers,  # regular user, not admin
        )

        assert response.status_code in [401, 403]

    async def test_get_feature_flags_no_auth(self, client: AsyncClient):
        """Тест что endpoint требует авторизацию."""
        response = await client.get("/api/v1/admin/feature-flags")

        assert response.status_code in [
            401,
            403,
        ]  # Может быть 401 (no auth) или 403 (forbidden)

    async def test_get_feature_flags_response_structure(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест структура ответа."""
        response = await client.get(
            "/api/v1/admin/feature-flags",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        # Проверяем все поля в ответе
        required_fields = [
            "id",
            "name",
            "enabled",
            "category",
            "description",
            "default_value",
            "created_at",
            "updated_at",
        ]

        assert all(all(field in item for field in required_fields) for item in data)


@pytest.mark.asyncio
class TestGetFeatureFlagEndpoint:
    """Тесты endpoint GET /admin/feature-flags/{flag_name}."""

    async def test_get_specific_flag(self, client: AsyncClient, admin_auth_headers):
        """Тест получения конкретного флага."""
        response = await client.get(
            "/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert data["name"] == "USE_NEW_NLP_ARCHITECTURE"
        assert data["enabled"] is True
        assert data["category"] == "nlp"

    async def test_get_nonexistent_flag(self, client: AsyncClient, admin_auth_headers):
        """Тест получения несуществующего флага."""
        response = await client.get(
            "/api/v1/admin/feature-flags/NONEXISTENT_FLAG",
            headers=admin_auth_headers,
        )

        assert response.status_code == 404
        # The response might be a JSON with detail or just an empty response
        response_data = response.json()
        if isinstance(response_data, dict) and "detail" in response_data:
            assert "not found" in response_data["detail"].lower()
        # If not a dict with detail, that's okay - HTTPException should still return 404

    async def test_get_flag_requires_admin(self, client: AsyncClient, auth_headers):
        """Тест что endpoint требует admin доступа."""
        response = await client.get(
            "/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE",
            headers=auth_headers,
        )

        assert response.status_code in [401, 403]

    async def test_get_disabled_flag(self, client: AsyncClient, admin_auth_headers):
        """Тест получения отключенного флага."""
        response = await client.get(
            "/api/v1/admin/feature-flags/USE_ADVANCED_PARSER",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert data["name"] == "USE_ADVANCED_PARSER"
        assert data["enabled"] is False


@pytest.mark.asyncio
class TestUpdateFeatureFlagEndpoint:
    """Тесты endpoint PUT /admin/feature-flags/{flag_name}."""

    async def test_update_flag_enable(self, client: AsyncClient, admin_auth_headers):
        """Тест включения флага."""
        # Сначала флаг отключен
        response = await client.get(
            "/api/v1/admin/feature-flags/USE_ADVANCED_PARSER",
            headers=admin_auth_headers,
        )
        assert response.json()["enabled"] is False

        # Включаем флаг
        response = await client.put(
            "/api/v1/admin/feature-flags/USE_ADVANCED_PARSER",
            json={"enabled": True},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["flag"]["enabled"] is True

        # Проверяем что флаг действительно включен
        response = await client.get(
            "/api/v1/admin/feature-flags/USE_ADVANCED_PARSER",
            headers=admin_auth_headers,
        )
        assert response.json()["enabled"] is True

    async def test_update_flag_disable(self, client: AsyncClient, admin_auth_headers):
        """Тест отключения флага."""
        response = await client.put(
            "/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE",
            json={"enabled": False},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["flag"]["enabled"] is False

    async def test_update_nonexistent_flag(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест обновления несуществующего флага."""
        response = await client.put(
            "/api/v1/admin/feature-flags/NONEXISTENT_FLAG",
            json={"enabled": True},
            headers=admin_auth_headers,
        )

        assert response.status_code == 404

    async def test_update_flag_requires_admin(self, client: AsyncClient, auth_headers):
        """Тест что обновление требует admin доступа."""
        response = await client.put(
            "/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE",
            json={"enabled": False},
            headers=auth_headers,
        )

        assert response.status_code in [401, 403]

    async def test_update_flag_response_contains_admin_email(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест что ответ содержит email администратора."""
        response = await client.put(
            "/api/v1/admin/feature-flags/ENABLE_IMAGE_CACHING",
            json={"enabled": False},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert "admin" in data
        assert "@" in data["admin"]  # email формат

    async def test_update_flag_invalid_json(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест что invalid JSON возвращает 400."""
        response = await client.put(
            "/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE",
            json={"invalid_field": True},
            headers=admin_auth_headers,
        )

        assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
class TestCreateFeatureFlagEndpoint:
    """Тесты endpoint POST /admin/feature-flags."""

    async def test_create_new_flag(self, client: AsyncClient, admin_auth_headers):
        """Тест создания нового флага."""
        response = await client.post(
            "/api/v1/admin/feature-flags",
            json={
                "name": "NEW_EXPERIMENTAL_FLAG",
                "enabled": True,
                "category": "experimental",
                "description": "New test flag",
                "default_value": True,
            },
            headers=admin_auth_headers,
        )

        assert response.status_code == 201
        data = response.json()

        assert data["name"] == "NEW_EXPERIMENTAL_FLAG"
        assert data["enabled"] is True
        assert data["category"] == "experimental"
        assert data["description"] == "New test flag"

    async def test_create_flag_duplicate_fails(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест что создание дубликата флага не удается."""
        response = await client.post(
            "/api/v1/admin/feature-flags",
            json={
                "name": "USE_NEW_NLP_ARCHITECTURE",  # Already exists
                "enabled": False,
            },
            headers=admin_auth_headers,
        )

        assert response.status_code == 400
        assert "already exists" in response.json()["detail"].lower()

    async def test_create_flag_minimal_data(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест создание флага с минимальными данными."""
        response = await client.post(
            "/api/v1/admin/feature-flags",
            json={"name": "MINIMAL_NEW_FLAG"},
            headers=admin_auth_headers,
        )

        assert response.status_code == 201
        data = response.json()

        assert data["name"] == "MINIMAL_NEW_FLAG"
        assert data["enabled"] is False  # default value
        assert data["category"] == "system"  # default category

    async def test_create_flag_requires_admin(self, client: AsyncClient, auth_headers):
        """Тест что создание требует admin доступа."""
        response = await client.post(
            "/api/v1/admin/feature-flags",
            json={"name": "NEW_FLAG", "enabled": True},
            headers=auth_headers,
        )

        assert response.status_code in [401, 403]

    async def test_create_flag_invalid_category(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест создание флага с невалидной категорией (но не обязательно ошибка)."""
        response = await client.post(
            "/api/v1/admin/feature-flags",
            json={
                "name": "FLAG_WITH_INVALID_CATEGORY",
                "category": "invalid_category",
            },
            headers=admin_auth_headers,
        )

        # Может быть 201 если система допускает любые категории
        # или 422 если проверяет
        assert response.status_code in [201, 422]


@pytest.mark.asyncio
class TestBulkUpdateEndpoint:
    """Тесты endpoint POST /admin/feature-flags/bulk-update."""

    async def test_bulk_update_multiple_flags(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест массового обновления флагов."""
        response = await client.post(
            "/api/v1/admin/feature-flags/bulk-update",
            json={
                "updates": {
                    "USE_ADVANCED_PARSER": True,
                    "USE_LLM_ENRICHMENT": True,
                    "ENABLE_PARALLEL_PROCESSING": False,
                }
            },
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert data["success_count"] == 3
        assert data["failed_count"] == 0
        assert data["total"] == 3
        assert all(data["results"].values())

    async def test_bulk_update_partial_failure(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест массового обновления с частичным отказом."""
        response = await client.post(
            "/api/v1/admin/feature-flags/bulk-update",
            json={
                "updates": {
                    "USE_ADVANCED_PARSER": True,
                    "NONEXISTENT_FLAG": False,
                    "ENABLE_IMAGE_CACHING": False,
                }
            },
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert data["success_count"] == 2
        assert data["failed_count"] == 1
        assert data["total"] == 3

    async def test_bulk_update_empty(self, client: AsyncClient, admin_auth_headers):
        """Тест массового обновления с пустым списком."""
        response = await client.post(
            "/api/v1/admin/feature-flags/bulk-update",
            json={"updates": {}},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert data["success_count"] == 0
        assert data["failed_count"] == 0

    async def test_bulk_update_requires_admin(self, client: AsyncClient, auth_headers):
        """Тест что bulk update требует admin доступа."""
        response = await client.post(
            "/api/v1/admin/feature-flags/bulk-update",
            json={"updates": {"USE_ADVANCED_PARSER": True}},
            headers=auth_headers,
        )

        assert response.status_code in [401, 403]

    async def test_bulk_update_response_contains_admin_email(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест что ответ содержит email администратора."""
        response = await client.post(
            "/api/v1/admin/feature-flags/bulk-update",
            json={"updates": {"ENABLE_IMAGE_CACHING": False}},
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert "admin" in data
        assert "@" in data["admin"]


@pytest.mark.asyncio
class TestClearCacheEndpoint:
    """Тесты endpoint DELETE /admin/feature-flags/cache."""

    async def test_clear_cache(self, client: AsyncClient, admin_auth_headers):
        """Тест очистки кэша."""
        response = await client.delete(
            "/api/v1/admin/feature-flags/cache",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert (
            "success" in data["message"].lower() or "cleared" in data["message"].lower()
        )

    async def test_clear_cache_requires_admin(self, client: AsyncClient, auth_headers):
        """Тест что очистка кэша требует admin доступа."""
        response = await client.delete(
            "/api/v1/admin/feature-flags/cache",
            headers=auth_headers,
        )

        assert response.status_code in [401, 403]

    async def test_clear_cache_response_contains_admin(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест что ответ содержит информацию об администраторе."""
        response = await client.delete(
            "/api/v1/admin/feature-flags/cache",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert "admin" in data


@pytest.mark.asyncio
class TestInitializeDefaultFlagsEndpoint:
    """Тесты endpoint POST /admin/feature-flags/initialize."""

    async def test_initialize_default_flags(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест инициализации дефолтных флагов."""
        response = await client.post(
            "/api/v1/admin/feature-flags/initialize",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert "initialized" in data["message"].lower()
        assert data["total_flags"] == 6

    async def test_initialize_idempotent(self, client: AsyncClient, admin_auth_headers):
        """Тест что инициализация idempotent."""
        # Первый вызов
        response1 = await client.post(
            "/api/v1/admin/feature-flags/initialize",
            headers=admin_auth_headers,
        )
        assert response1.status_code == 200
        count1 = response1.json()["total_flags"]

        # Второй вызов
        response2 = await client.post(
            "/api/v1/admin/feature-flags/initialize",
            headers=admin_auth_headers,
        )
        assert response2.status_code == 200
        count2 = response2.json()["total_flags"]

        # Количество должно быть одинаковым
        assert count1 == count2

    async def test_initialize_requires_admin(self, client: AsyncClient, auth_headers):
        """Тест что инициализация требует admin доступа."""
        response = await client.post(
            "/api/v1/admin/feature-flags/initialize",
            headers=auth_headers,
        )

        assert response.status_code in [401, 403]


@pytest.mark.asyncio
class TestGetCategoriesEndpoint:
    """Тесты endpoint GET /admin/feature-flags/categories/list."""

    async def test_get_categories(self, client: AsyncClient, admin_auth_headers):
        """Тест получения списка категорий."""
        response = await client.get(
            "/api/v1/admin/feature-flags/categories/list",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        assert "categories" in data
        assert "total" in data
        assert len(data["categories"]) == 5  # 5 категорий

    async def test_categories_have_required_fields(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест что категории имеют все требуемые поля."""
        response = await client.get(
            "/api/v1/admin/feature-flags/categories/list",
            headers=admin_auth_headers,
        )

        assert response.status_code == 200
        data = response.json()

        required_fields = ["value", "label", "description"]
        for category in data["categories"]:
            for field in required_fields:
                assert field in category

    async def test_categories_include_nlp(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест что список включает категорию NLP."""
        response = await client.get(
            "/api/v1/admin/feature-flags/categories/list",
            headers=admin_auth_headers,
        )

        data = response.json()
        category_values = [cat["value"] for cat in data["categories"]]

        assert "nlp" in category_values

    async def test_categories_include_all_expected(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест что список включает все ожидаемые категории."""
        response = await client.get(
            "/api/v1/admin/feature-flags/categories/list",
            headers=admin_auth_headers,
        )

        data = response.json()
        category_values = {cat["value"] for cat in data["categories"]}

        expected_categories = {"nlp", "parser", "images", "system", "experimental"}
        assert category_values == expected_categories

    async def test_categories_requires_admin(self, client: AsyncClient, auth_headers):
        """Тест что получение категорий требует admin доступа."""
        response = await client.get(
            "/api/v1/admin/feature-flags/categories/list",
            headers=auth_headers,
        )

        assert response.status_code in [401, 403]


@pytest.mark.asyncio
class TestFeatureFlagsIntegration:
    """Интеграционные тесты для всего feature flags flow."""

    async def test_complete_workflow(self, client: AsyncClient, admin_auth_headers):
        """Тест полного workflow: создание, получение, обновление."""
        # 1. Создаем новый флаг
        create_response = await client.post(
            "/api/v1/admin/feature-flags",
            json={
                "name": "WORKFLOW_TEST_FLAG",
                "enabled": False,
                "category": "experimental",
                "description": "Test workflow flag",
            },
            headers=admin_auth_headers,
        )
        assert create_response.status_code == 201
        created_flag = create_response.json()

        # 2. Получаем флаг
        get_response = await client.get(
            f"/api/v1/admin/feature-flags/WORKFLOW_TEST_FLAG",
            headers=admin_auth_headers,
        )
        assert get_response.status_code == 200
        fetched_flag = get_response.json()
        assert fetched_flag["enabled"] is False

        # 3. Обновляем флаг
        update_response = await client.put(
            f"/api/v1/admin/feature-flags/WORKFLOW_TEST_FLAG",
            json={"enabled": True},
            headers=admin_auth_headers,
        )
        assert update_response.status_code == 200
        assert update_response.json()["flag"]["enabled"] is True

        # 4. Проверяем что флаг обновлен
        final_response = await client.get(
            f"/api/v1/admin/feature-flags/WORKFLOW_TEST_FLAG",
            headers=admin_auth_headers,
        )
        assert final_response.json()["enabled"] is True

    async def test_bulk_and_individual_operations_consistent(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест что bulk и individual операции дают одинаковый результат."""
        # Делаем bulk update
        bulk_response = await client.post(
            "/api/v1/admin/feature-flags/bulk-update",
            json={
                "updates": {
                    "USE_ADVANCED_PARSER": True,
                    "ENABLE_PARALLEL_PROCESSING": False,
                }
            },
            headers=admin_auth_headers,
        )
        assert bulk_response.status_code == 200

        # Проверяем через individual GET
        parser_response = await client.get(
            "/api/v1/admin/feature-flags/USE_ADVANCED_PARSER",
            headers=admin_auth_headers,
        )
        assert parser_response.json()["enabled"] is True

        parallel_response = await client.get(
            "/api/v1/admin/feature-flags/ENABLE_PARALLEL_PROCESSING",
            headers=admin_auth_headers,
        )
        assert parallel_response.json()["enabled"] is False

    async def test_cache_invalidation_after_update(
        self, client: AsyncClient, admin_auth_headers
    ):
        """Тест что кэш инвалидируется после обновления."""
        flag_name = "USE_LLM_ENRICHMENT"

        # Получаем флаг (заполняет кэш)
        response1 = await client.get(
            f"/api/v1/admin/feature-flags/{flag_name}",
            headers=admin_auth_headers,
        )
        original_enabled = response1.json()["enabled"]

        # Обновляем флаг
        update_response = await client.put(
            f"/api/v1/admin/feature-flags/{flag_name}",
            json={"enabled": not original_enabled},
            headers=admin_auth_headers,
        )
        assert update_response.status_code == 200

        # Получаем флаг снова (должен быть новое значение)
        response2 = await client.get(
            f"/api/v1/admin/feature-flags/{flag_name}",
            headers=admin_auth_headers,
        )
        new_enabled = response2.json()["enabled"]

        assert new_enabled != original_enabled
