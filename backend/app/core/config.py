"""
Конфигурация приложения fancai.

Настройки базы данных, Redis, AI сервисов и других компонентов.
"""

import os
from pydantic_settings import BaseSettings
from pydantic import model_validator, Field
from typing import Optional


class Settings(BaseSettings):
    """Настройки приложения."""

    # Основные настройки приложения
    APP_NAME: str = "fancai"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = (
        False  # Production safe: False по умолчанию (установите DEBUG=true для разработки)
    )
    SECRET_KEY: str = "dev-secret-key-change-in-production"

    # База данных
    DATABASE_URL: str = (
        "postgresql+asyncpg://postgres:postgres123@postgres:5432/fancai_dev"
    )
    TEST_DATABASE_URL: str = (
        ""  # Override via env; if empty, derived from DATABASE_URL in conftest
    )

    # Database Connection Pool Settings (October 2025 - Production Optimization)
    DB_POOL_SIZE: int = Field(default=20, ge=5, le=50, env="DB_POOL_SIZE")
    DB_MAX_OVERFLOW: int = Field(default=40, ge=10, le=100, env="DB_MAX_OVERFLOW")
    DB_POOL_RECYCLE: int = Field(default=3600, ge=600, le=7200, env="DB_POOL_RECYCLE")
    DB_POOL_TIMEOUT: int = Field(default=30, ge=10, le=60, env="DB_POOL_TIMEOUT")

    # Redis
    REDIS_URL: str = "redis://:redis123@redis:6379"
    REDIS_CACHE_ENABLED: bool = True  # Enable/disable Redis caching
    REDIS_CACHE_DEFAULT_TTL: int = 3600  # Default TTL in seconds (1 hour)
    REDIS_MAX_CONNECTIONS: int = Field(
        default=50, ge=10, le=200, env="REDIS_MAX_CONNECTIONS"
    )

    # Безопасность (Updated 29 Dec 2025: Extended for book reading app UX)
    # Users should stay logged in for at least 2 weeks without re-authentication
    ACCESS_TOKEN_EXPIRE_MINUTES: int = (
        10080  # 7 days (10080 min) - extended for reading app
    )
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30  # 30 days - allows month-long sessions
    ALGORITHM: str = "HS256"

    # Файловые загрузки
    MAX_UPLOAD_SIZE: int = 52428800  # 50MB
    ALLOWED_EXTENSIONS: list = [".epub", ".fb2"]

    # AI сервисы - OpenRouter (Phase 3: migration from google-genai)
    OPENROUTER_API_KEY: str = ""  # OpenRouter API key — все AI-сервисы (LLM + images)
    OPENROUTER_IMAGE_MODEL: str = (
        "black-forest-labs/flux.2-klein-4b"  # FLUX.2 Klein 4B — быстрая/дешёвая ($0.014/MP, <1 сек), подтверждена доступной 2026-03-01
    )

    # AI сервисы - Gemini Direct (Stage A migration, 2026-06)
    GEMINI_API_KEY: str = ""  # Google Gemini Developer API key (paid tier)
    AI_PROVIDER: str = "openrouter"  # gemini | openrouter — рубильник миграции
    GEMINI_EXTRACTION_MODEL: str = "gemini-3.5-flash"
    GEMINI_LITE_MODEL: str = (
        "gemini-3.1-flash-lite"  # зарезервировано для tiering Этапа B
    )
    GEMINI_IMAGE_MODEL: str = (
        "gemini-3.1-flash-image"  # Nano Banana 2; ID подтвердить smoke-тестом A3.1
    )

    # Vertex AI backend (под-режим Gemini-провайдера) — задействует $300 GCP trial
    GEMINI_BACKEND: str = "developer"  # developer | vertex
    GCP_PROJECT: str = ""  # Vertex: ID проекта Google Cloud
    GCP_LOCATION: str = "europe-west4"  # Vertex: регион (Нидерланды)

    # Legacy: kept for secrets validation compatibility, not used at runtime
    OPENAI_API_KEY: Optional[str] = None
    MIDJOURNEY_API_KEY: Optional[str] = None

    # Платежные системы
    YOOKASSA_SHOP_ID: Optional[str] = None
    YOOKASSA_SECRET_KEY: Optional[str] = None
    CLOUDPAYMENTS_PUBLIC_ID: Optional[str] = None

    # CFI Configuration (October 2025)
    CFI_MAX_LENGTH: int = Field(default=500, ge=100, le=1000, env="CFI_MAX_LENGTH")
    CFI_VALIDATION_ENABLED: bool = Field(default=True, env="CFI_VALIDATION_ENABLED")

    # Gunicorn/Uvicorn Workers Configuration (Production Optimization for 4GB RAM / 2 CPU cores)
    WORKERS_COUNT: int = Field(default=4, ge=1, le=8, env="WORKERS_COUNT")
    WORKER_TIMEOUT: int = Field(default=300, ge=60, le=600, env="WORKER_TIMEOUT")
    WORKER_MAX_REQUESTS: int = Field(
        default=1000, ge=100, le=5000, env="WORKER_MAX_REQUESTS"
    )
    WORKER_MAX_REQUESTS_JITTER: int = Field(
        default=100, ge=0, le=500, env="WORKER_MAX_REQUESTS_JITTER"
    )

    # Celery Configuration (Limited Resources Optimization)
    CELERY_CONCURRENCY: int = Field(default=1, ge=1, le=4, env="CELERY_CONCURRENCY")
    CELERY_MAX_TASKS_PER_CHILD: int = Field(
        default=100, ge=10, le=500, env="CELERY_MAX_TASKS_PER_CHILD"
    )
    CELERY_MAX_MEMORY_PER_CHILD: int = Field(
        default=1572864, ge=524288, le=3145728, env="CELERY_MAX_MEMORY_PER_CHILD"
    )  # KB (default: 1.5GB)

    # Лимиты подписок
    FREE_BOOKS_LIMIT: int = 3
    FREE_GENERATIONS_LIMIT: int = 50
    PREMIUM_BOOKS_LIMIT: int = 50
    PREMIUM_GENERATIONS_LIMIT: int = 500

    # Логирование
    LOG_LEVEL: str = "INFO"

    # Metrics Authentication (for /health/metrics endpoint)
    METRICS_USER: str = "admin"
    METRICS_PASSWORD: str = "metrics_secure_password"  # Override via env in production

    # Мониторинг ошибок (Hawk Tracker)
    HAWK_TOKEN: Optional[str] = None  # hawk-tracker.ru: Python проект Integration Token

    # Web Push (VAPID) Configuration (January 2026)
    VAPID_PUBLIC_KEY: Optional[str] = None
    VAPID_PRIVATE_KEY: Optional[str] = None
    VAPID_SUBJECT: str = "mailto:admin@fancai.ru"

    # Password Reset
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30
    PASSWORD_RESET_BASE_URL: str = "http://localhost:5173/reset-password"

    # Email (Yandex Cloud Postbox — AWS SES v2 compatible)
    EMAIL_ENABLED: bool = False
    EMAIL_FROM: str = "noreply@fancai.ru"
    EMAIL_FROM_NAME: str = "fancai"
    YANDEX_POSTBOX_ACCESS_KEY: Optional[str] = None
    YANDEX_POSTBOX_SECRET_KEY: Optional[str] = None
    YANDEX_POSTBOX_ENDPOINT: str = "https://postbox.cloud.yandex.net"
    YANDEX_POSTBOX_REGION: str = "ru-central1"

    # CORS - загружается из .env (docker-compose передает полный список)
    CORS_ORIGINS: str = (
        "http://localhost:3000,http://localhost:5173,http://localhost:5174"  # Development: React (3000), Vite (5173, 5174)
    )

    @model_validator(mode="after")
    def validate_production_settings(self):
        """
        Валидация критических настроек для production режима.

        В production (DEBUG=False) требуются безопасные значения для:
        - SECRET_KEY (не может быть дефолтным)
        - DATABASE_URL (не может содержать тестовые пароли)
        - REDIS_URL (не может содержать тестовые пароли)

        Валидация пропускается в CI/CD окружениях (GitHub Actions, GitLab CI и т.д.)
        для возможности запуска тестов с development credentials.
        """
        # Проверка на CI/CD окружение
        is_ci = os.getenv("CI") == "true" or os.getenv("GITHUB_ACTIONS") == "true"

        # Валидация только для production (не DEBUG и не CI/CD)
        if not self.DEBUG and not is_ci:
            # Проверка SECRET_KEY
            if self.SECRET_KEY == "dev-secret-key-change-in-production":
                raise ValueError(
                    "❌ SECURITY ERROR: SECRET_KEY must be set via environment variable in production mode. "
                    "Default development secret key is not allowed in production."
                )

            # Проверка DATABASE_URL
            if "postgres123" in self.DATABASE_URL or "fancai_dev" in self.DATABASE_URL:
                raise ValueError(
                    "❌ SECURITY ERROR: DATABASE_URL contains default development credentials. "
                    "Production database must use secure credentials set via environment variable."
                )

            # Проверка REDIS_URL
            if "redis123" in self.REDIS_URL:
                raise ValueError(
                    "❌ SECURITY ERROR: REDIS_URL contains default development password. "
                    "Production Redis must use secure credentials set via environment variable."
                )

            # Проверка METRICS_PASSWORD
            if self.METRICS_PASSWORD == "metrics_secure_password":
                raise ValueError(
                    "❌ SECURITY ERROR: METRICS_PASSWORD must be overridden in production. "
                    "Default metrics password is not allowed in production."
                )

        return self

    @property
    def cors_origins_list(self) -> list:
        """Возвращает список CORS origins из строки."""
        if isinstance(self.CORS_ORIGINS, str):
            return [
                origin.strip()
                for origin in self.CORS_ORIGINS.split(",")
                if origin.strip()
            ]
        return self.CORS_ORIGINS

    class Config:
        """Настройка загрузки переменных окружения."""

        # Ищем .env в текущей директории и в родительской (для запуска тестов из backend/)
        env_file = (".env", "../.env")
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = (
            "ignore"  # Игнорируем неизвестные переменные (DB_NAME, DB_PASSWORD и т.п.)
        )


# Глобальный экземпляр настроек
settings = Settings()
