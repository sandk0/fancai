"""
Интеграционные тесты для Admin Router.

Тестирует REST API endpoints администратора: доступ по роли, настройки
парсинга и системы, очередь, кэш, статистику.

Из набора убраны все проверки `/api/v1/admin/multi-nlp-settings/*`:
подсистема Multi-NLP удалена (`0c110210`), маршрутов нет, и тесты
проверяли 404 отсутствующего маршрута вместо поведения API. Заодно
убраны утверждения вида `assert status in [200, 404]` — они проходили
независимо от того, существует endpoint или нет; список действующих
маршрутов сверен с `/openapi.json`.

Автор: Testing & QA Specialist Agent
Дата: 2025-11-29
"""

import pytest
from httpx import AsyncClient


class TestAdminAccessControl:
    """Доступ к админским endpoints."""

    @pytest.mark.asyncio
    async def test_admin_endpoint_requires_admin_role(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Обычный пользователь получает 403."""
        response = await client.get("/api/v1/admin/stats", headers=auth_headers)
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_admin_endpoint_unauthorized(self, client: AsyncClient):
        """Без токена — 401."""
        response = await client.get("/api/v1/admin/stats")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_admin_stats_for_admin(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Администратор получает статистику."""
        response = await client.get("/api/v1/admin/stats", headers=admin_auth_headers)
        assert response.status_code == 200
        assert isinstance(response.json(), dict)

    @pytest.mark.asyncio
    async def test_admin_users_list(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Список пользователей содержит самого администратора."""
        response = await client.get("/api/v1/admin/users", headers=admin_auth_headers)
        assert response.status_code == 200
        payload = response.json()
        users = payload["users"] if isinstance(payload, dict) else payload
        assert any(u["email"] == "test_admin@example.com" for u in users)


class TestAdminSettings:
    """Настройки парсинга и системы."""

    @pytest.mark.asyncio
    async def test_get_parsing_settings(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест получения настроек парсинга."""
        response = await client.get(
            "/api/v1/admin/parsing-settings", headers=admin_auth_headers
        )
        assert response.status_code == 200
        assert "max_concurrent_parsing" in response.json()

    @pytest.mark.asyncio
    async def test_update_parsing_settings(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест обновления настроек парсинга.

        Схема `ParsingSettings` требует все четыре поля, а обработчик читает
        `queue_priority_weights` по ключам free/premium/ultimate. Прежний тест
        посылал `max_concurrent_parsings` (лишняя «s») и принимал 422 как успех.
        """
        settings_data = {
            "max_concurrent_parsing": 5,
            "queue_priority_weights": {"free": 1, "premium": 5, "ultimate": 10},
            "timeout_minutes": 30,
            "retry_attempts": 3,
        }

        response = await client.put(
            "/api/v1/admin/parsing-settings",
            headers=admin_auth_headers,
            json=settings_data,
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_update_parsing_settings_rejects_incomplete_body(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Неполное тело — 422, а не молчаливое применение части полей."""
        response = await client.put(
            "/api/v1/admin/parsing-settings",
            headers=admin_auth_headers,
            json={"max_concurrent_parsing": 5},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_update_parsing_settings_rejects_partial_weights(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Неполный `queue_priority_weights` — 400, а не 500 от KeyError."""
        response = await client.put(
            "/api/v1/admin/parsing-settings",
            headers=admin_auth_headers,
            json={
                "max_concurrent_parsing": 5,
                "queue_priority_weights": {"free": 1},
                "timeout_minutes": 30,
                "retry_attempts": 3,
            },
        )
        assert response.status_code == 400
        assert "premium" in response.text and "ultimate" in response.text

    @pytest.mark.asyncio
    async def test_get_system_settings(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест получения системных настроек."""
        response = await client.get(
            "/api/v1/admin/system-settings", headers=admin_auth_headers
        )
        assert response.status_code == 200
        assert "max_upload_size_mb" in response.json()

    @pytest.mark.asyncio
    async def test_update_system_settings(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест обновления системных настроек."""
        settings_data = {
            "maintenance_mode": False,
            "max_upload_size_mb": 100,
            "supported_book_formats": ["epub", "fb2"],
            "enable_debug_mode": False,
        }

        response = await client.put(
            "/api/v1/admin/system-settings",
            headers=admin_auth_headers,
            json=settings_data,
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_initialize_default_settings(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест инициализации настроек по умолчанию."""
        response = await client.post(
            "/api/v1/admin/initialize-settings", headers=admin_auth_headers
        )
        assert response.status_code == 200


class TestAdminQueueAndCache:
    """Очередь парсинга и кэш."""

    @pytest.mark.asyncio
    async def test_get_queue_status(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест получения статуса очереди парсинга."""
        response = await client.get(
            "/api/v1/admin/queue-status", headers=admin_auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_clear_parsing_queue(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Тест очистки очереди парсинга."""
        response = await client.post(
            "/api/v1/admin/clear-queue", headers=admin_auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_get_cache_stats(self, client: AsyncClient, admin_auth_headers: dict):
        """Тест получения статистики кэша."""
        response = await client.get(
            "/api/v1/admin/cache/stats", headers=admin_auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_clear_cache_requires_available_redis(
        self, client: AsyncClient, admin_auth_headers: dict
    ):
        """Недоступный Redis — честный 503, а не 500 и не мнимый успех.

        В тестовом стенде lifespan не выполняется (`ASGITransport`), поэтому
        `cache_manager.is_available` False. Успешный путь здесь не проверяем
        намеренно: он делает FLUSHDB и снёс бы кэш dev-стенда.
        """
        response = await client.delete(
            "/api/v1/admin/cache/clear", headers=admin_auth_headers
        )
        assert response.status_code == 503

        wrong_method = await client.post(
            "/api/v1/admin/cache/clear", headers=admin_auth_headers
        )
        assert wrong_method.status_code == 405


class TestPublicHealth:
    """Публичный health check."""

    @pytest.mark.asyncio
    async def test_health_check_public(self, client: AsyncClient):
        """Тест публичного health check (без авторизации)."""
        response = await client.get("/api/v1/health")
        assert response.status_code == 200
