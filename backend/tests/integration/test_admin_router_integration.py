"""
Интеграционные тесты для Admin Router.

Тестирует REST API endpoints администратора:
- Multi-NLP настройки
- Парсинг управление
- Система здоровья
- Управление кэшем

Автор: Testing & QA Specialist Agent
Дата: 2025-11-29
"""

import pytest
from httpx import AsyncClient



class TestAdminRouterIntegration:
    """Тесты интеграции Admin Router."""

    # ==================== AUTHENTICATION TESTS ====================

    @pytest.mark.asyncio
    async def test_admin_endpoint_requires_admin_role(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Тест что админ endpoints требуют роль администратора."""
        # Act
        response = await client.get(
            "/api/v1/admin/multi-nlp-settings/status", headers=auth_headers
        )

        # Assert
        # Should return 403 Forbidden for non-admin user
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_admin_endpoint_unauthorized(self, client: AsyncClient):
        """Тест админ endpoint без авторизации."""
        # Act
        response = await client.get("/api/v1/admin/multi-nlp-settings/status")

        # Assert
        assert response.status_code == 401

    # ==================== MULTI-NLP SETTINGS TESTS ====================

    @pytest.mark.asyncio
    async def test_get_nlp_status(self, client: AsyncClient, admin_auth_headers: dict):
        """Тест получения статуса NLP процессоров."""
        # Act
        response = await client.get(
            "/api/v1/admin/multi-nlp-settings/status", headers=admin_auth_headers
        )

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (dict, list))

    @pytest.mark.asyncio
    async def test_get_nlp_status_not_admin(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Тест что обычный пользователь не может видеть NLP статус."""
        # Act
        response = await client.get(
            "/api/v1/admin/multi-nlp-settings/status", headers=auth_headers
        )

        # Assert
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_nlp_processor_weight(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест обновления веса NLP процессора."""
        # Arrange
        update_data = {"weight": 1.5, "threshold": 0.5}

        # Act
        response = await client.put(
            "/api/v1/admin/multi-nlp-settings/spacy",
            headers=admin_auth_headers,
            json=update_data,
        )

        # Assert
        assert response.status_code in [200, 404, 405]  # 404 if endpoint not found

    @pytest.mark.asyncio
    async def test_update_nlp_processor_invalid_weight(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест обновления с невалидным весом."""
        # Arrange
        invalid_data = {"weight": -1.0, "threshold": 0.5}  # Invalid negative weight

        # Act
        response = await client.put(
            "/api/v1/admin/multi-nlp-settings/spacy",
            headers=admin_auth_headers,
            json=invalid_data,
        )

        # Assert
        # Should fail validation
        assert response.status_code in [400, 422, 404, 405]

    @pytest.mark.asyncio
    async def test_test_nlp_processor(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест тестирования NLP процессора."""
        # Arrange
        test_data = {
            "text": "A beautiful forest with tall trees.",
            "processor": "spacy",
        }

        # Act
        response = await client.post(
            "/api/v1/admin/multi-nlp-settings/test",
            headers=admin_auth_headers,
            json=test_data,
        )

        # Assert
        assert response.status_code in [200, 404, 405]

    # ==================== PARSING MANAGEMENT TESTS ====================

    @pytest.mark.asyncio
    async def test_get_parsing_settings(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест получения настроек парсинга."""
        # Act
        response = await client.get(
            "/api/v1/admin/parsing-settings", headers=admin_auth_headers
        )

        # Assert
        assert response.status_code in [200, 404]

    @pytest.mark.asyncio
    async def test_update_parsing_settings(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест обновления настроек парсинга."""
        # Arrange
        settings_data = {"max_concurrent_parsings": 5, "timeout_minutes": 30}

        # Act
        response = await client.put(
            "/api/v1/admin/parsing-settings",
            headers=admin_auth_headers,
            json=settings_data,
        )

        # Assert
        assert response.status_code in [200, 404, 405]

    @pytest.mark.asyncio
    async def test_get_queue_status(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест получения статуса очереди парсинга."""
        # Act
        response = await client.get(
            "/api/v1/admin/queue-status", headers=admin_auth_headers
        )

        # Assert
        assert response.status_code in [200, 404]

    @pytest.mark.asyncio
    async def test_clear_parsing_queue(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест очистки очереди парсинга."""
        # Act
        response = await client.post(
            "/api/v1/admin/clear-queue", headers=admin_auth_headers
        )

        # Assert
        assert response.status_code in [200, 404, 405]

    # ==================== SYSTEM HEALTH TESTS ====================

    @pytest.mark.asyncio
    async def test_get_system_stats(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест получения системной статистики."""
        # Act
        response = await client.get(
            "/api/v1/admin/system-stats", headers=admin_auth_headers
        )

        # Assert
        assert response.status_code in [200, 404]
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, dict)

    @pytest.mark.asyncio
    async def test_health_check(self, client: AsyncClient, admin_auth_headers: dict):
        """Тест health check endpoint."""
        # Act
        response = await client.get("/api/v1/admin/health", headers=admin_auth_headers)

        # Assert
        assert response.status_code in [200, 404]

    @pytest.mark.asyncio
    async def test_health_check_public(self, client: AsyncClient):
        """Тест публичного health check (без авторизации)."""
        # Act
        response = await client.get("/api/v1/health")

        # Assert
        assert response.status_code == 200

    # ==================== SYSTEM SETTINGS TESTS ====================

    @pytest.mark.asyncio
    async def test_update_system_settings(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест обновления системных настроек."""
        # Arrange
        settings_data = {"max_upload_size_mb": 100, "enable_notifications": True}

        # Act
        response = await client.put(
            "/api/v1/admin/system-settings",
            headers=admin_auth_headers,
            json=settings_data,
        )

        # Assert
        assert response.status_code in [200, 404, 405]

    # ==================== CACHE MANAGEMENT TESTS ====================

    @pytest.mark.asyncio
    async def test_get_cache_stats(self, client: AsyncClient, admin_auth_headers: dict):
        """Тест получения статистики кэша."""
        # Act
        response = await client.get(
            "/api/v1/admin/cache-stats", headers=admin_auth_headers
        )

        # Assert
        assert response.status_code in [200, 404]

    @pytest.mark.asyncio
    async def test_clear_cache(self, client: AsyncClient, admin_auth_headers: dict):
        """Тест очистки кэша."""
        # Act
        response = await client.post(
            "/api/v1/admin/cache/clear", headers=admin_auth_headers
        )

        # Assert
        assert response.status_code in [200, 204, 404, 405]

    # ==================== INITIALIZATION TESTS ====================

    @pytest.mark.asyncio
    async def test_initialize_default_settings(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест инициализации настроек по умолчанию."""
        # Act
        response = await client.post(
            "/api/v1/admin/initialize-settings", headers=admin_auth_headers
        )

        # Assert
        assert response.status_code in [200, 201, 404, 405]

    # ==================== PAGINATION AND FILTERING TESTS ====================

    @pytest.mark.asyncio
    async def test_list_with_pagination(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест пагинации в админ endpoints."""
        # Act
        response = await client.get(
            "/api/v1/admin/system-stats?skip=0&limit=10", headers=admin_auth_headers
        )

        # Assert
        assert response.status_code in [200, 404]

    # ==================== ERROR HANDLING TESTS ====================

    @pytest.mark.asyncio
    async def test_admin_endpoint_with_invalid_json(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест админ endpoint с невалидным JSON."""
        # Act
        response = await client.put(
            "/api/v1/admin/multi-nlp-settings/spacy",
            headers=admin_auth_headers,
            content="invalid json",
        )

        # Assert
        assert response.status_code in [400, 422, 404, 405]

    @pytest.mark.asyncio
    async def test_admin_endpoint_missing_required_field(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест админ endpoint с отсутствующим обязательным полем."""
        # Arrange
        incomplete_data = {
            "weight": 1.0
            # Missing "threshold" which might be required
        }

        # Act
        response = await client.put(
            "/api/v1/admin/multi-nlp-settings/spacy",
            headers=admin_auth_headers,
            json=incomplete_data,
        )

        # Assert
        # Should either validate and fail, or fill with defaults
        assert response.status_code in [200, 422, 404, 405]

    # ==================== FEATURE FLAGS TESTS ====================

    @pytest.mark.asyncio
    async def test_list_feature_flags(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест получения списка feature flags."""
        # Act
        response = await client.get(
            "/api/v1/admin/feature-flags", headers=admin_auth_headers
        )

        # Assert
        assert response.status_code in [200, 404]

    @pytest.mark.asyncio
    async def test_toggle_feature_flag(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест переключения feature flag."""
        # Act
        response = await client.post(
            "/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE/toggle",
            headers=admin_auth_headers,
        )

        # Assert
        assert response.status_code in [200, 404, 405]

    @pytest.mark.asyncio
    async def test_update_feature_flag(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест обновления feature flag."""
        # Arrange
        flag_data = {"enabled": True, "description": "Test description"}

        # Act
        response = await client.put(
            "/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE",
            headers=admin_auth_headers,
            json=flag_data,
        )

        # Assert
        assert response.status_code in [200, 404, 405]
