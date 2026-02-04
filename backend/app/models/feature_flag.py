"""
Модель для feature flags системы fancai.

Feature flags позволяют включать/выключать функциональность без перезапуска приложения.
Используется для безопасного rollout новых функций и A/B тестирования.
"""

from datetime import datetime
from uuid import UUID
import uuid as uuid_module
import enum

from sqlalchemy import String, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base


class FeatureFlagCategory(enum.Enum):
    """Категории feature flags."""

    NLP = "nlp"
    PARSER = "parser"
    IMAGES = "images"
    SYSTEM = "system"
    EXPERIMENTAL = "experimental"


class FeatureFlag(Base):
    """
    Модель feature flag для управления функциональностью.

    Feature flags используются для:
    - Безопасного rollout новых функций
    - A/B тестирования
    - Временного отключения проблемных компонентов
    - Постепенной миграции между архитектурами
    """

    __tablename__ = "feature_flags"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4, index=True
    )

    name: Mapped[str] = mapped_column(
        String(100), unique=True, index=True, nullable=False
    )

    enabled: Mapped[bool] = mapped_column(
        default=False, server_default="false", nullable=False, index=True
    )

    category: Mapped[str] = mapped_column(
        String(50), default=FeatureFlagCategory.SYSTEM.value, nullable=False, index=True
    )

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    default_value: Mapped[bool] = mapped_column(
        default=False, server_default="false", nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        """String representation."""
        return (
            f"<FeatureFlag(name='{self.name}', enabled={self.enabled}, "
            f"category='{self.category}')>"
        )

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "name": self.name,
            "enabled": self.enabled,
            "category": self.category,
            "description": self.description,
            "default_value": self.default_value,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


# Предопределенные feature flags для системы
DEFAULT_FEATURE_FLAGS = [
    {
        "name": "USE_NEW_NLP_ARCHITECTURE",
        "enabled": True,  # Already in production
        "category": FeatureFlagCategory.NLP.value,
        "description": "Enable Strategy Pattern Multi-NLP architecture (v2.0)",
        "default_value": True,
    },
    {
        "name": "USE_ADVANCED_PARSER",
        "enabled": False,  # Not integrated yet
        "category": FeatureFlagCategory.PARSER.value,
        "description": "Enable Advanced Parser with dependency parsing",
        "default_value": False,
    },
    {
        "name": "USE_LLM_ENRICHMENT",
        "enabled": False,  # Needs API key
        "category": FeatureFlagCategory.NLP.value,
        "description": "Enable LangExtract LLM-based semantic enrichment",
        "default_value": False,
    },
    {
        "name": "ENABLE_ENSEMBLE_VOTING",
        "enabled": True,
        "category": FeatureFlagCategory.NLP.value,
        "description": "Enable ensemble voting in NLP processing",
        "default_value": True,
    },
    {
        "name": "ENABLE_PARALLEL_PROCESSING",
        "enabled": True,
        "category": FeatureFlagCategory.NLP.value,
        "description": "Enable parallel NLP processor execution",
        "default_value": True,
    },
    {
        "name": "ENABLE_IMAGE_CACHING",
        "enabled": True,
        "category": FeatureFlagCategory.IMAGES.value,
        "description": "Enable image generation caching",
        "default_value": True,
    },
]
