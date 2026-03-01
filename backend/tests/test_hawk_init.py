"""
Тесты инициализации Hawk Tracker для FastAPI и Celery.

TDD RED фаза: тесты написаны до реализации.
"""

import pytest
from unittest.mock import MagicMock, patch, call


class TestInitHawkFastapi:
    """Тесты init_hawk() для FastAPI."""

    def test_init_hawk_with_token_returns_hawk_fastapi(self):
        """init_hawk с HAWK_TOKEN создаёт экземпляр HawkFastapi."""
        mock_app = MagicMock()
        mock_hawk_fastapi_instance = MagicMock()

        with patch("app.core.hawk.settings") as mock_settings, patch(
            "app.core.hawk.HawkFastapi"
        ) as mock_hawk_fastapi_cls:
            mock_settings.HAWK_TOKEN = "test-token-123"
            mock_settings.APP_VERSION = "0.1.0"
            mock_hawk_fastapi_cls.return_value = mock_hawk_fastapi_instance

            from app.core.hawk import init_hawk

            result = init_hawk(mock_app)

        assert result is mock_hawk_fastapi_instance
        mock_hawk_fastapi_cls.assert_called_once_with(
            {
                "app_instance": mock_app,
                "token": "test-token-123",
                "release": "fancai@0.1.0",
            }
        )

    def test_init_hawk_without_token_returns_none(self):
        """init_hawk без HAWK_TOKEN возвращает None (graceful skip)."""
        mock_app = MagicMock()

        with patch("app.core.hawk.settings") as mock_settings, patch(
            "app.core.hawk.HawkFastapi"
        ) as mock_hawk_fastapi_cls:
            mock_settings.HAWK_TOKEN = None

            from app.core.hawk import init_hawk

            result = init_hawk(mock_app)

        assert result is None
        mock_hawk_fastapi_cls.assert_not_called()

    def test_init_hawk_with_empty_token_returns_none(self):
        """init_hawk с пустым HAWK_TOKEN возвращает None."""
        mock_app = MagicMock()

        with patch("app.core.hawk.settings") as mock_settings, patch(
            "app.core.hawk.HawkFastapi"
        ) as mock_hawk_fastapi_cls:
            mock_settings.HAWK_TOKEN = ""

            from app.core.hawk import init_hawk

            result = init_hawk(mock_app)

        assert result is None
        mock_hawk_fastapi_cls.assert_not_called()


class TestInitHawkCelery:
    """Тесты init_hawk_celery() для Celery workers."""

    def test_init_hawk_celery_with_token_returns_hawk(self):
        """init_hawk_celery с HAWK_TOKEN создаёт экземпляр Hawk."""
        mock_celery_app = MagicMock()
        mock_hawk_instance = MagicMock()

        with patch("app.core.hawk.settings") as mock_settings, patch(
            "app.core.hawk.Hawk"
        ) as mock_hawk_cls, patch("app.core.hawk.task_failure") as mock_task_failure:
            mock_settings.HAWK_TOKEN = "test-token-celery"
            mock_hawk_cls.return_value = mock_hawk_instance

            from app.core.hawk import init_hawk_celery

            result = init_hawk_celery(mock_celery_app)

        assert result is mock_hawk_instance
        mock_hawk_cls.assert_called_once_with({"token": "test-token-celery"})

    def test_init_hawk_celery_without_token_returns_none(self):
        """init_hawk_celery без HAWK_TOKEN возвращает None."""
        mock_celery_app = MagicMock()

        with patch("app.core.hawk.settings") as mock_settings, patch(
            "app.core.hawk.Hawk"
        ) as mock_hawk_cls:
            mock_settings.HAWK_TOKEN = None

            from app.core.hawk import init_hawk_celery

            result = init_hawk_celery(mock_celery_app)

        assert result is None
        mock_hawk_cls.assert_not_called()

    def test_init_hawk_celery_connects_task_failure_signal(self):
        """init_hawk_celery подключает task_failure сигнал для перехвата ошибок задач."""
        mock_celery_app = MagicMock()
        mock_hawk_instance = MagicMock()

        with patch("app.core.hawk.settings") as mock_settings, patch(
            "app.core.hawk.Hawk"
        ) as mock_hawk_cls, patch("app.core.hawk.task_failure") as mock_task_failure:
            mock_settings.HAWK_TOKEN = "test-token"
            mock_hawk_cls.return_value = mock_hawk_instance

            from app.core.hawk import init_hawk_celery

            init_hawk_celery(mock_celery_app)

        # task_failure.connect должен быть вызван для регистрации обработчика
        mock_task_failure.connect.assert_called_once()


class TestOnTaskFailureHandler:
    """Тесты обработчика on_task_failure для Celery task_failure signal."""

    def test_on_task_failure_sends_to_hawk_when_exception(self):
        """on_task_failure вызывает hawk.send() при наличии исключения."""
        mock_celery_app = MagicMock()
        mock_hawk_instance = MagicMock()
        test_exception = ValueError("Test Celery task error")

        with patch("app.core.hawk.settings") as mock_settings, patch(
            "app.core.hawk.Hawk"
        ) as mock_hawk_cls, patch("app.core.hawk.task_failure") as mock_task_failure:
            mock_settings.HAWK_TOKEN = "test-token"
            mock_hawk_cls.return_value = mock_hawk_instance

            captured_handler = None

            def capture_connect(handler, **kwargs):
                nonlocal captured_handler
                captured_handler = handler

            mock_task_failure.connect.side_effect = capture_connect

            from app.core.hawk import init_hawk_celery

            init_hawk_celery(mock_celery_app)

        assert captured_handler is not None, "task_failure.connect handler not captured"

        # Вызываем обработчик напрямую с исключением
        mock_sender = MagicMock()
        mock_sender.name = "app.tasks.some_task"
        captured_handler(
            sender=mock_sender,
            exception=test_exception,
            traceback=None,
            task_id="task-123",
            args=["arg1"],
            kwargs={},
        )

        # Проверяем что hawk.send() вызван с правильными аргументами
        mock_hawk_instance.send.assert_called_once()
        call_args = mock_hawk_instance.send.call_args
        assert call_args[0][0] is test_exception

    def test_on_task_failure_skips_send_without_exception(self):
        """on_task_failure не вызывает hawk.send() если exception=None."""
        mock_celery_app = MagicMock()
        mock_hawk_instance = MagicMock()

        with patch("app.core.hawk.settings") as mock_settings, patch(
            "app.core.hawk.Hawk"
        ) as mock_hawk_cls, patch("app.core.hawk.task_failure") as mock_task_failure:
            mock_settings.HAWK_TOKEN = "test-token"
            mock_hawk_cls.return_value = mock_hawk_instance

            captured_handler = None

            def capture_connect(handler, **kwargs):
                nonlocal captured_handler
                captured_handler = handler

            mock_task_failure.connect.side_effect = capture_connect

            from app.core.hawk import init_hawk_celery

            init_hawk_celery(mock_celery_app)

        assert captured_handler is not None

        # Вызываем без исключения
        captured_handler(
            sender=None,
            exception=None,
            traceback=None,
            task_id="task-456",
            args=[],
            kwargs={},
        )

        # hawk.send() не должен быть вызван
        mock_hawk_instance.send.assert_not_called()
