"""
Модель сгенерированных изображений для fancai.

Содержит информацию о изображениях, созданных AI-сервисами.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID
import uuid as uuid_module
import enum

from sqlalchemy import Integer, String, Text, Float, ForeignKey
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base

if TYPE_CHECKING:
    from .description import Description
    from .chapter import Chapter
    from .user import User


class ImageService(enum.Enum):
    """AI сервисы для генерации изображений."""

    POLLINATIONS = "pollinations"  # pollinations.ai (legacy)
    OPENAI_DALLE = "openai_dalle"  # OpenAI DALL-E 3
    MIDJOURNEY = "midjourney"  # Midjourney API
    STABLE_DIFFUSION = "stable_diffusion"  # Stable Diffusion
    IMAGEN = "imagen"  # Google Imagen 4 (основной)


class ImageStatus(enum.Enum):
    """Статусы генерации изображений."""

    PENDING = "pending"  # В очереди на генерацию
    GENERATING = "generating"  # Генерируется в данный момент
    COMPLETED = "completed"  # Успешно сгенерировано
    FAILED = "failed"  # Ошибка генерации
    MODERATED = "moderated"  # Отклонено модерацией


class GeneratedImage(Base):
    """
    Модель сгенерированного изображения.

    Attributes:
        id: Уникальный идентификатор изображения
        description_id: ID описания (внешний ключ)
        service_used: AI сервис, использованный для генерации
        status: Статус генерации
        image_url: URL сгенерированного изображения
        local_path: Локальный путь к файлу изображения
        prompt_used: Промпт, отправленный в AI сервис
        generation_parameters: Параметры генерации (размер, стиль, etc.)
        generation_time_seconds: Время генерации в секундах
        file_size: Размер файла изображения в байтах
        image_width: Ширина изображения в пикселях
        image_height: Высота изображения в пикселях
        quality_score: Оценка качества изображения (если есть)
        is_moderated: Прошло ли модерацию
        moderation_result: Результат модерации
    """

    __tablename__ = "generated_images"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )

    description_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("descriptions.id"), nullable=False, index=True
    )

    # Direct chapter linking (для быстрого доступа)
    chapter_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("chapters.id"), nullable=True, index=True
    )

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # Информация о генерации
    service_used: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # pollinations, openai_dalle, etc.
    status: Mapped[str] = mapped_column(
        String(20), default=ImageStatus.PENDING.value, nullable=False, index=True
    )

    # Результат генерации
    image_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)  # URL от сервиса
    local_path: Mapped[str | None] = mapped_column(String(1000), nullable=True, index=True)  # Локальный путь
    prompt_used: Mapped[str] = mapped_column(Text, nullable=False)  # Использованный промпт

    # Параметры генерации
    generation_parameters: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )  # {"width": 512, "height": 512, "style": "fantasy"} - JSONB для быстрого поиска
    generation_time_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Информация о файле
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)  # размер в байтах
    image_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_format: Mapped[str | None] = mapped_column(String(10), nullable=True)  # jpg, png, webp

    # Качество и модерация
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0.0-1.0
    is_moderated: Mapped[bool] = mapped_column(default=False, nullable=False)
    moderation_result: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )  # Результат проверки на NSFW, etc. - JSONB для индексации
    moderation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Статистика использования
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    download_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Ошибки
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Временные метки
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now(), onupdate=func.now()
    )
    generated_at: Mapped[datetime | None] = mapped_column(nullable=True)

    # Отношения
    # lazy="raise" предотвращает случайные N+1 queries - требует явного eager loading
    description: Mapped["Description"] = relationship("Description", back_populates="generated_images", lazy="raise")
    chapter: Mapped["Chapter | None"] = relationship("Chapter", back_populates="generated_images", lazy="raise")
    user: Mapped["User"] = relationship("User", back_populates="generated_images", lazy="raise")

    def __repr__(self) -> str:
        return f"<GeneratedImage(id={self.id}, service={self.service_used}, status={self.status})>"

    def is_ready_for_display(self) -> bool:
        """
        Проверяет, готово ли изображение для отображения пользователю.

        Returns:
            True если изображение успешно сгенерировано и прошло модерацию
        """
        return (
            self.status == ImageStatus.COMPLETED.value
            and self.is_moderated
            and (self.image_url is not None or self.local_path is not None)
        )

    def get_display_url(self, base_url: str = "") -> str:
        """
        Получает URL для отображения изображения.

        Args:
            base_url: Базовый URL сервера для локальных файлов

        Returns:
            URL для отображения изображения
        """
        if self.image_url:
            return self.image_url
        elif self.local_path and base_url:
            return f"{base_url.rstrip('/')}/images/{self.local_path}"
        else:
            return ""

    def get_generation_info(self) -> dict[str, Any]:
        """
        Получает информацию о генерации для отображения пользователю.

        Returns:
            Словарь с информацией о генерации
        """
        return {
            "service": self.service_used,
            "status": self.status,
            "generated_at": (
                self.generated_at.isoformat() if self.generated_at else None
            ),
            "generation_time": self.generation_time_seconds,
            "dimensions": (
                f"{self.image_width}x{self.image_height}"
                if self.image_width and self.image_height
                else None
            ),
            "file_size_kb": round(self.file_size / 1024) if self.file_size else None,
            "quality_score": self.quality_score,
        }
