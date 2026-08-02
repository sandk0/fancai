"""
Dependency Injection Container для fancai.

Централизованный контейнер для управления зависимостями сервисов.
Обеспечивает:
- Фабричные функции для создания сервисов
- Интеграция с FastAPI Depends()
- Поддержка переопределения для тестов
- Protocol/Interface абстракции для тестируемости

Паттерн: Dependency Injection + Factory Method

Created: 2025-12-28
Author: fancai Team
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..services.book_parser import BookParser
    from ..services.imagen_generator import ImagenService
    from ..services.gemini_extractor import GeminiDirectExtractor
    from ..services.auth_service import AuthService
    from ..services.book.book_service import BookService
    from ..services.book.book_progress_service import BookProgressService
    from ..services.image_generator import ImageGeneratorService
    from ..services.token_blacklist import TokenBlacklist
    from ..services.email.email_service import EmailService
    from ..services.feature_flag_manager import FeatureFlagManager

from functools import lru_cache
from typing import Protocol, Dict, Any, Optional, List, runtime_checkable
from sqlalchemy.ext.asyncio import AsyncSession
from .config import settings

# ============================================================================
# PROTOCOLS (Interfaces) - Абстракции для сервисов
# ============================================================================


@runtime_checkable
class IBookParser(Protocol):
    """Protocol для парсера книг."""

    async def parse_book(self, file_path: str) -> Any:
        """Парсит книгу и возвращает ParsedBook."""
        ...

    async def detect_format(self, file_path: str) -> str:
        """Определяет формат файла книги."""
        ...

    def is_format_supported(self, file_format: str) -> bool:
        """Проверяет поддержку формата."""
        ...

    def get_supported_formats(self) -> List[str]:
        """Возвращает список поддерживаемых форматов."""
        ...


@runtime_checkable
class IImageGenerator(Protocol):
    """Protocol для генератора изображений."""

    def is_available(self) -> bool:
        """Проверяет доступность сервиса."""
        ...

    async def generate_image(
        self,
        description: str,
        description_type: str,
        genre: Optional[str],
        custom_style: Optional[str],
    ) -> Any:
        """Генерирует изображение по описанию."""
        ...

    def get_status(self) -> Dict[str, Any]:
        """Возвращает статус сервиса."""
        ...


@runtime_checkable
class IGeminiExtractor(Protocol):
    """Protocol для Gemini экстрактора описаний."""

    def is_available(self) -> bool:
        """Проверяет доступность экстрактора."""
        ...

    async def extract(self, text: str, chapter_id: Optional[str]) -> List[Any]:
        """Извлекает описания из текста."""
        ...

    def get_statistics(self) -> Dict[str, Any]:
        """Возвращает статистику экстрактора."""
        ...


@runtime_checkable
class IAuthService(Protocol):
    """Protocol для сервиса аутентификации."""

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Проверяет пароль."""
        ...

    def get_password_hash(self, password: str) -> str:
        """Создает хеш пароля."""
        ...

    def create_access_token(self, data: Dict[str, Any]) -> str:
        """Создает access токен."""
        ...

    def create_refresh_token(self, data: Dict[str, Any]) -> str:
        """Создает refresh токен."""
        ...

    def verify_token(self, token: str, token_type: str) -> Optional[Dict[str, Any]]:
        """Проверяет токен."""
        ...

    async def create_user(
        self, db: AsyncSession, email: str, password: str, full_name: Optional[str]
    ) -> Any:
        """Создает пользователя."""
        ...

    async def authenticate_user(
        self, db: AsyncSession, email: str, password: str
    ) -> Optional[Any]:
        """Аутентифицирует пользователя."""
        ...

    async def create_password_reset_token(
        self, db: AsyncSession, email: str
    ) -> Optional[str]:
        """Создаёт токен сброса пароля."""
        ...

    async def validate_and_reset_password(
        self, db: AsyncSession, token: str, new_password: str
    ) -> tuple[bool, Optional[str]]:
        """Валидирует токен и устанавливает новый пароль. Возвращает (success, user_email)."""
        ...


@runtime_checkable
class IBookService(Protocol):
    """Protocol для сервиса книг."""

    async def create_book_from_upload(
        self,
        db: AsyncSession,
        user_id: Any,
        file_path: str,
        original_filename: str,
        parsed_book: Any,
    ) -> Any:
        """Создает книгу из загруженного файла."""
        ...

    async def get_user_books(
        self, db: AsyncSession, user_id: Any, skip: int, limit: int, sort_by: str
    ) -> List[Any]:
        """Получает список книг пользователя."""
        ...

    async def get_book_by_id(
        self, db: AsyncSession, book_id: Any, user_id: Optional[Any]
    ) -> Optional[Any]:
        """Получает книгу по ID."""
        ...

    async def delete_book(self, db: AsyncSession, book_id: Any, user_id: Any) -> bool:
        """Удаляет книгу."""
        ...


@runtime_checkable
class IImageGeneratorService(Protocol):
    """Protocol для сервиса генерации изображений."""

    async def generate_image_for_description(
        self,
        description: Any,
        user_id: str,
        book_genre: Optional[str],
        custom_style: Optional[str],
    ) -> Any:
        """Генерирует изображение для описания."""
        ...

    async def get_generation_stats(self) -> Dict[str, Any]:
        """Получает статистику генерации."""
        ...

    def queue_image_generation(
        self,
        description_id: str,
        user_id: str,
        description_content: str,
        description_type: str,
        book_genre: Optional[str],
        custom_style: Optional[str],
    ) -> Dict[str, Any]:
        """Добавляет задачу генерации в очередь."""
        ...


# ============================================================================
# FACTORY FUNCTIONS - Фабричные функции для создания сервисов
# ============================================================================


@lru_cache()
def get_book_parser() -> "BookParser":
    """
    Фабричная функция для получения BookParser.

    Использует lru_cache для singleton-поведения - один экземпляр на время жизни приложения.
    Это безопасно, так как BookParser не хранит состояние между запросами.

    Returns:
        BookParser: Экземпляр парсера книг
    """
    from ..services.book_parser import BookParser

    return BookParser()


@lru_cache()
def get_imagen_service() -> "ImagenService":
    """
    Фабричная функция для получения ImagenService.

    Использует lru_cache для singleton-поведения.
    ImagenService инициализирует API клиенты один раз.

    Returns:
        ImagenService: Экземпляр сервиса генерации изображений
    """
    from ..services.imagen_generator import ImagenService

    return ImagenService()


@lru_cache()
def get_gemini_extractor() -> "GeminiDirectExtractor":
    """
    Фабричная функция для получения GeminiDirectExtractor.

    Использует lru_cache для singleton-поведения.
    GeminiDirectExtractor инициализирует Gemini API клиент один раз.

    Returns:
        GeminiDirectExtractor: Экземпляр экстрактора описаний
    """
    from ..services.gemini_extractor import GeminiDirectExtractor

    return GeminiDirectExtractor()


@lru_cache()
def get_auth_service() -> "AuthService":
    """
    Фабричная функция для получения AuthService.

    Использует lru_cache для singleton-поведения.
    AuthService не требует внешних зависимостей при создании.

    Returns:
        AuthService: Экземпляр сервиса аутентификации
    """
    from ..services.auth_service import AuthService

    return AuthService()


@lru_cache()
def get_book_service() -> "BookService":
    """
    Фабричная функция для получения BookService.

    Использует lru_cache для singleton-поведения.
    BookService инициализирует директорию загрузок один раз.

    Returns:
        BookService: Экземпляр сервиса книг
    """
    from ..services.book.book_service import BookService

    return BookService()


@lru_cache()
def get_book_progress_service() -> "BookProgressService":
    """
    Фабричная функция для получения BookProgressService.

    Returns:
        BookProgressService: Экземпляр сервиса прогресса чтения
    """
    from ..services.book.book_progress_service import BookProgressService

    return BookProgressService()


@lru_cache()
def get_image_generator_service() -> "ImageGeneratorService":
    """
    Фабричная функция для получения ImageGeneratorService.

    Использует lru_cache для singleton-поведения.
    ImageGeneratorService управляет очередью генерации.

    Returns:
        ImageGeneratorService: Экземпляр сервиса генерации изображений
    """
    from ..services.image_generator import ImageGeneratorService

    return ImageGeneratorService()


@lru_cache()
def get_token_blacklist() -> "TokenBlacklist":
    """
    Фабричная функция для получения TokenBlacklist.

    Returns:
        TokenBlacklist: Экземпляр сервиса черного списка токенов
    """
    from ..services.token_blacklist import TokenBlacklist

    return TokenBlacklist()


@lru_cache()
def get_email_service() -> "EmailService":
    """Фабричная функция для EmailService."""
    from ..services.email.email_service import EmailService

    from ..services.email.provider import EmailProvider

    provider: EmailProvider
    if settings.EMAIL_ENABLED:
        from ..services.email.yandex_postbox import YandexPostboxProvider

        provider = YandexPostboxProvider()
    else:
        from ..services.email.log_provider import LogEmailProvider

        provider = LogEmailProvider()
    return EmailService(provider)


@lru_cache()
def get_feature_flag_manager_singleton() -> "type[FeatureFlagManager]":
    """
    Фабричная функция для получения FeatureFlagManager.

    Note: FeatureFlagManager требует db session, поэтому
    для использования в роутерах используйте get_feature_flag_manager().

    Returns:
        FeatureFlagManager: Экземпляр менеджера feature flags
    """
    from ..services.feature_flag_manager import FeatureFlagManager

    # FeatureFlagManager requires db session, return class for factory pattern
    return FeatureFlagManager


# ============================================================================
# DEPENDENCY INJECTION FUNCTIONS - Функции для FastAPI Depends()
# ============================================================================


def get_book_parser_dep() -> "BookParser":
    """
    FastAPI Dependency для BookParser.

    Используется в роутерах через Depends(get_book_parser_dep).

    Returns:
        BookParser: Экземпляр парсера книг
    """
    return get_book_parser()


def get_imagen_service_dep() -> "ImagenService":
    """
    FastAPI Dependency для ImagenService.

    Returns:
        ImagenService: Экземпляр сервиса Imagen
    """
    return get_imagen_service()


def get_gemini_extractor_dep() -> "GeminiDirectExtractor":
    """
    FastAPI Dependency для GeminiDirectExtractor.

    Returns:
        GeminiDirectExtractor: Экземпляр экстрактора Gemini
    """
    return get_gemini_extractor()


def get_auth_service_dep() -> "AuthService":
    """
    FastAPI Dependency для AuthService.

    Returns:
        AuthService: Экземпляр сервиса аутентификации
    """
    return get_auth_service()


def get_book_service_dep() -> "BookService":
    """
    FastAPI Dependency для BookService.

    Returns:
        BookService: Экземпляр сервиса книг
    """
    return get_book_service()


def get_book_progress_service_dep() -> "BookProgressService":
    """
    FastAPI Dependency для BookProgressService.

    Returns:
        BookProgressService: Экземпляр сервиса прогресса
    """
    return get_book_progress_service()


def get_image_generator_service_dep() -> "ImageGeneratorService":
    """
    FastAPI Dependency для ImageGeneratorService.

    Returns:
        ImageGeneratorService: Экземпляр сервиса генерации изображений
    """
    return get_image_generator_service()


def get_token_blacklist_dep() -> "TokenBlacklist":
    """
    FastAPI Dependency для TokenBlacklist.

    Returns:
        TokenBlacklist: Экземпляр сервиса черного списка
    """
    return get_token_blacklist()


def get_email_service_dep() -> "EmailService":
    """FastAPI Dependency для EmailService."""
    return get_email_service()


# ============================================================================
# CONTAINER CLASS - Централизованный контейнер зависимостей
# ============================================================================


class DependencyContainer:
    """
    Централизованный контейнер для управления зависимостями.

    Позволяет:
    - Регистрировать пользовательские реализации сервисов
    - Переопределять зависимости для тестов
    - Сбрасывать кэш singleton-ов

    Usage:
        # В тестах
        container = DependencyContainer()
        container.override(get_book_parser, lambda: MockBookParser())

        # В приложении
        container.reset_all()  # Сброс всех переопределений
    """

    _overrides: Dict[Any, Any] = {}

    @classmethod
    def override(cls, original: Any, replacement: Any) -> None:
        """
        Переопределяет зависимость.

        Args:
            original: Оригинальная фабричная функция
            replacement: Функция-замена или экземпляр
        """
        cls._overrides[original] = replacement

    @classmethod
    def get(cls, factory: Any) -> Any:
        """
        Получает зависимость с учетом переопределений.

        Args:
            factory: Фабричная функция

        Returns:
            Экземпляр сервиса (переопределенный или оригинальный)
        """
        if factory in cls._overrides:
            override = cls._overrides[factory]
            if callable(override):
                return override()
            return override
        return factory()

    @classmethod
    def reset(cls, factory: Any) -> None:
        """
        Сбрасывает переопределение для конкретной зависимости.

        Args:
            factory: Фабричная функция для сброса
        """
        if factory in cls._overrides:
            del cls._overrides[factory]

    @classmethod
    def reset_all(cls) -> None:
        """Сбрасывает все переопределения."""
        cls._overrides.clear()

    @classmethod
    def clear_caches(cls) -> None:
        """
        Очищает lru_cache для всех фабричных функций.

        Полезно для тестов, когда нужно пересоздать singleton-ы.
        """
        get_book_parser.cache_clear()
        get_imagen_service.cache_clear()
        get_gemini_extractor.cache_clear()
        get_auth_service.cache_clear()
        get_book_service.cache_clear()
        get_book_progress_service.cache_clear()
        get_image_generator_service.cache_clear()
        get_token_blacklist.cache_clear()
        get_email_service.cache_clear()


# ============================================================================
# TEST HELPERS - Утилиты для тестирования
# ============================================================================


def create_test_overrides() -> Dict[Any, Any]:
    """
    Создает словарь переопределений для FastAPI dependency_overrides.

    Использование:
        app.dependency_overrides.update(create_test_overrides())

    Returns:
        Dict с маппингом оригинальных зависимостей на тестовые
    """
    return {
        get_book_parser_dep: lambda: DependencyContainer.get(get_book_parser),
        get_imagen_service_dep: lambda: DependencyContainer.get(get_imagen_service),
        get_gemini_extractor_dep: lambda: DependencyContainer.get(get_gemini_extractor),
        get_auth_service_dep: lambda: DependencyContainer.get(get_auth_service),
        get_book_service_dep: lambda: DependencyContainer.get(get_book_service),
        get_book_progress_service_dep: lambda: DependencyContainer.get(
            get_book_progress_service
        ),
        get_image_generator_service_dep: lambda: DependencyContainer.get(
            get_image_generator_service
        ),
        get_token_blacklist_dep: lambda: DependencyContainer.get(get_token_blacklist),
        get_email_service_dep: lambda: DependencyContainer.get(get_email_service),
    }


# ============================================================================
# BACKWARD COMPATIBILITY - Обратная совместимость с глобальными экземплярами
# ============================================================================

# Примечание: Глобальные экземпляры в сервисах (auth_service, book_parser, etc.)
# остаются для обратной совместимости. Новый код должен использовать DI через
# Depends(get_*_dep) в роутерах.
#
# Миграция:
# OLD: from app.services.auth_service import auth_service
# NEW: def endpoint(..., auth: AuthService = Depends(get_auth_service_dep)):
