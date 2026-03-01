"""
Тесты безопасности конфигурации — SEC-01, SEC-02.

Проверяет:
- SEC-01: DEBUG=False по умолчанию
- SEC-02: Приложение отказывается стартовать с дефолтным SECRET_KEY в не-debug режиме
- Удаление NLP-валидатора (мёртвый код, блокировал запуск)
"""

import os
import pytest


class TestSEC01DebugDefault:
    """SEC-01: DEBUG должен быть False по умолчанию."""

    def test_debug_default_is_false(self, monkeypatch):
        """DEBUG=False по умолчанию без переменных окружения."""
        # Убираем возможные env vars, которые могут переопределить DEBUG
        monkeypatch.delenv("DEBUG", raising=False)
        # Сбрасываем кэш settings, пересоздаём объект
        from app.core import config as config_module
        from importlib import reload

        # Временно устанавливаем DEBUG=false чтобы проверить дефолтное поведение
        # Тест проверяет, что дефолтное значение в классе Settings — False
        import inspect

        source = inspect.getsource(config_module.Settings)
        # Ищем строку с DEBUG: bool = ... в коде класса
        assert (
            "DEBUG: bool = False" in source
            or "DEBUG: bool = (\n        False" in source
        ), (
            "SEC-01 FAIL: DEBUG должен быть False по умолчанию в Settings. "
            "Найдено True — это нарушение безопасности в продакшене!"
        )

    def test_debug_default_value_is_false(self, monkeypatch):
        """Объект Settings без env vars имеет DEBUG=False."""
        monkeypatch.delenv("DEBUG", raising=False)
        # В CI/тестах может быть установлен DEBUG=true через .env
        # Этот тест проверяет, что дефолтное значение поля в классе = False,
        # а не реальное runtime значение (которое может переопределяться через .env)
        from app.core.config import Settings
        import pydantic_settings

        # Получаем default value из model fields
        field_info = Settings.model_fields.get("DEBUG")
        assert field_info is not None, "Поле DEBUG не найдено в Settings"
        default = field_info.default
        assert default is False, (
            f"SEC-01 FAIL: Дефолтное значение DEBUG={default!r}, ожидается False. "
            "В продакшене без .env файла приложение запускается в DEBUG=True режиме!"
        )


class TestSEC02SecretKeyValidation:
    """SEC-02: Дефолтный SECRET_KEY должен быть отклонён в production режиме."""

    def test_default_secret_key_rejected_in_production(self, monkeypatch):
        """В production режиме (DEBUG=False) дефолтный SECRET_KEY вызывает ValueError."""
        # Устанавливаем production-подобные условия
        monkeypatch.setenv("DEBUG", "false")
        monkeypatch.setenv("SECRET_KEY", "dev-secret-key-change-in-production")
        # Устанавливаем безопасные DB и Redis URL чтобы не триггерить другие ошибки
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql+asyncpg://user:SecurePass123@postgres:5432/fancai_prod",
        )
        monkeypatch.setenv("REDIS_URL", "redis://:SecureRedis456@redis:6379")
        # Убираем CI маркеры
        monkeypatch.delenv("CI", raising=False)
        monkeypatch.delenv("GITHUB_ACTIONS", raising=False)

        from pydantic import ValidationError
        from app.core.config import Settings

        with pytest.raises((ValueError, ValidationError)) as exc_info:
            Settings()
        error_text = str(exc_info.value)
        assert (
            "SECRET_KEY" in error_text or "secret" in error_text.lower()
        ), f"SEC-02 FAIL: Ожидалась ошибка о SECRET_KEY, получено: {error_text}"

    def test_default_secret_key_allowed_in_debug_mode(self, monkeypatch):
        """В debug режиме (DEBUG=True) дефолтный SECRET_KEY разрешён."""
        monkeypatch.setenv("DEBUG", "true")
        monkeypatch.setenv("SECRET_KEY", "dev-secret-key-change-in-production")
        monkeypatch.delenv("CI", raising=False)
        monkeypatch.delenv("GITHUB_ACTIONS", raising=False)

        from app.core.config import Settings

        # Не должно вызывать исключение
        settings = Settings()
        assert settings.DEBUG is True
        assert settings.SECRET_KEY == "dev-secret-key-change-in-production"

    def test_strong_secret_key_works_in_production(self, monkeypatch):
        """В production режиме надёжный SECRET_KEY принимается."""
        monkeypatch.setenv("DEBUG", "false")
        monkeypatch.setenv("SECRET_KEY", "SuperSecretKey123!@#$%VerySafe456AbcXyz789")
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql+asyncpg://user:SecurePass123@postgres:5432/fancai_prod",
        )
        monkeypatch.setenv("REDIS_URL", "redis://:SecureRedis456@redis:6379")
        monkeypatch.delenv("CI", raising=False)
        monkeypatch.delenv("GITHUB_ACTIONS", raising=False)

        from app.core.config import Settings

        # Не должно вызывать исключение
        settings = Settings()
        assert settings.DEBUG is False
        assert settings.SECRET_KEY == "SuperSecretKey123!@#$%VerySafe456AbcXyz789"


class TestNLPValidatorRemoved:
    """Проверяет, что NLP-валидатор не блокирует запуск."""

    def test_settings_loads_without_nlp_env_vars(self, monkeypatch):
        """Settings создаётся без NLP env vars (SPACY_WEIGHT, NATASHA_WEIGHT, STANZA_WEIGHT)."""
        # Удаляем все NLP env vars
        monkeypatch.delenv("SPACY_WEIGHT", raising=False)
        monkeypatch.delenv("NATASHA_WEIGHT", raising=False)
        monkeypatch.delenv("STANZA_WEIGHT", raising=False)
        monkeypatch.delenv("MULTI_NLP_MODE", raising=False)
        monkeypatch.delenv("CONSENSUS_THRESHOLD", raising=False)
        # В dev режиме для безопасного создания
        monkeypatch.setenv("DEBUG", "true")

        from app.core.config import Settings

        # Должно работать без ошибок
        settings = Settings()
        assert settings is not None

    def test_validate_nlp_weights_not_in_validators(self):
        """validate_nlp_weights удалён из Settings."""
        from app.core.config import Settings
        import inspect

        source = inspect.getsource(Settings)
        assert "validate_nlp_weights" not in source, (
            "NLP-валидатор validate_nlp_weights всё ещё присутствует в Settings! "
            "Он должен быть удалён, так как NLP удалён из проекта."
        )

    def test_nlp_fields_removed_from_settings(self):
        """NLP-поля (SPACY_WEIGHT, NATASHA_WEIGHT, STANZA_WEIGHT) удалены из Settings."""
        from app.core.config import Settings

        # Эти поля должны быть удалены из модели
        fields = Settings.model_fields
        nlp_fields = ["SPACY_WEIGHT", "NATASHA_WEIGHT", "STANZA_WEIGHT"]
        remaining = [f for f in nlp_fields if f in fields]

        assert len(remaining) == 0, (
            f"NLP-поля всё ещё присутствуют в Settings: {remaining}. "
            "Они должны быть удалены вместе с validate_nlp_weights."
        )
