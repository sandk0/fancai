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
        True  # Development mode по умолчанию (установите DEBUG=false в production!)
    )
    SECRET_KEY: str = "dev-secret-key-change-in-production"

    # База данных
    DATABASE_URL: str = (
        "postgresql+asyncpg://postgres:postgres123@postgres:5432/bookreader_dev"
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
    REDIS_MAX_CONNECTIONS: int = Field(default=50, ge=10, le=200, env="REDIS_MAX_CONNECTIONS")

    # Безопасность (Updated 29 Dec 2025: Extended for book reading app UX)
    # Users should stay logged in for at least 2 weeks without re-authentication
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days (10080 min) - extended for reading app
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30  # 30 days - allows month-long sessions
    ALGORITHM: str = "HS256"

    # Файловые загрузки
    MAX_UPLOAD_SIZE: int = 52428800  # 50MB
    UPLOAD_DIRECTORY: str = "./uploads"
    ALLOWED_EXTENSIONS: list = [".epub", ".fb2"]

    # AI сервисы - Google Gemini & Imagen (December 2025)
    GOOGLE_API_KEY: Optional[str] = None  # Primary key for all Google services
    GEMINI_MODEL: str = "gemini-3-flash-preview"  # Dec 2025: gemini-3-flash-preview (not 3.0)
    IMAGEN_ENABLED: bool = True
    IMAGEN_MODEL: str = "imagen-4.0-generate-001"  # GA models: imagen-4.0-generate-001, imagen-4.0-fast-generate-001, imagen-4.0-ultra-generate-001
    IMAGEN_ASPECT_RATIO: str = "4:3"  # 1:1, 3:4, 4:3, 9:16, 16:9
    IMAGEN_SAFETY_LEVEL: str = "block_low_and_above"  # Only block_low_and_above is supported
    IMAGEN_TIMEOUT_SECONDS: int = 60

    # Legacy AI services (optional)
    OPENAI_API_KEY: Optional[str] = None
    MIDJOURNEY_API_KEY: Optional[str] = None

    # Платежные системы
    YOOKASSA_SHOP_ID: Optional[str] = None
    YOOKASSA_SECRET_KEY: Optional[str] = None
    CLOUDPAYMENTS_PUBLIC_ID: Optional[str] = None

    # NLP настройки
    SPACY_MODEL: str = "ru_core_news_lg"
    NLTK_DATA_PATH: str = "./nltk_data"

    # Multi-NLP Configuration (October 2025)
    MULTI_NLP_MODE: str = Field(default="ensemble", env="MULTI_NLP_MODE")
    CONSENSUS_THRESHOLD: float = Field(default=0.6, ge=0.0, le=1.0, env="CONSENSUS_THRESHOLD")
    SPACY_WEIGHT: float = Field(default=1.0, ge=0.0, le=2.0, env="SPACY_WEIGHT")
    NATASHA_WEIGHT: float = Field(default=1.2, ge=0.0, le=2.0, env="NATASHA_WEIGHT")
    STANZA_WEIGHT: float = Field(default=0.8, ge=0.0, le=2.0, env="STANZA_WEIGHT")

    # CFI Configuration (October 2025)
    CFI_MAX_LENGTH: int = Field(default=500, ge=100, le=1000, env="CFI_MAX_LENGTH")
    CFI_VALIDATION_ENABLED: bool = Field(default=True, env="CFI_VALIDATION_ENABLED")

    # Gunicorn/Uvicorn Workers Configuration (Production Optimization for 4GB RAM / 2 CPU cores)
    WORKERS_COUNT: int = Field(default=4, ge=1, le=8, env="WORKERS_COUNT")
    WORKER_TIMEOUT: int = Field(default=300, ge=60, le=600, env="WORKER_TIMEOUT")
    WORKER_MAX_REQUESTS: int = Field(default=1000, ge=100, le=5000, env="WORKER_MAX_REQUESTS")
    WORKER_MAX_REQUESTS_JITTER: int = Field(default=100, ge=0, le=500, env="WORKER_MAX_REQUESTS_JITTER")

    # Celery Configuration (Limited Resources Optimization)
    CELERY_CONCURRENCY: int = Field(default=1, ge=1, le=4, env="CELERY_CONCURRENCY")
    CELERY_MAX_TASKS_PER_CHILD: int = Field(default=100, ge=10, le=500, env="CELERY_MAX_TASKS_PER_CHILD")
    CELERY_MAX_MEMORY_PER_CHILD: int = Field(default=1572864, ge=524288, le=3145728, env="CELERY_MAX_MEMORY_PER_CHILD")  # KB (default: 1.5GB)

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

    # Web Push (VAPID) Configuration (January 2026)
    VAPID_PUBLIC_KEY: Optional[str] = None
    VAPID_PRIVATE_KEY: Optional[str] = None
    VAPID_SUBJECT: str = "mailto:admin@fancai.ru"

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
            if (
                "postgres123" in self.DATABASE_URL
                or "bookreader_dev" in self.DATABASE_URL
            ):
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

        return self

    @model_validator(mode="after")
    def validate_nlp_weights(self):
        """
        Валидация весов Multi-NLP процессоров.

        Сумма весов должна быть в разумных пределах для корректной работы
        ensemble voting алгоритма.

        Raises:
            ValueError: Если сумма весов выходит за допустимые пределы

        Returns:
            Settings: Проверенный объект настроек
        """
        total_weight = self.SPACY_WEIGHT + self.NATASHA_WEIGHT + self.STANZA_WEIGHT
        if total_weight < 0.5 or total_weight > 10.0:
            raise ValueError(
                f"❌ CONFIGURATION ERROR: Sum of Multi-NLP processor weights must be between 0.5 and 10.0, "
                f"got {total_weight:.2f} (spacy={self.SPACY_WEIGHT}, natasha={self.NATASHA_WEIGHT}, "
                f"stanza={self.STANZA_WEIGHT}). Adjust weights via environment variables."
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

        env_file = ".env"
        case_sensitive = True


# Глобальный экземпляр настроек
settings = Settings()
