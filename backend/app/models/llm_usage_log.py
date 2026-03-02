"""
SQLAlchemy модель для логирования OpenRouter LLM вызовов.

Хранит историю расходов на AI вызовы для аналитики и мониторинга бюджета.

Таблица: llm_usage_log
Создаётся миграцией: alembic/versions/XXXX_add_llm_usage_log.py
"""

from sqlalchemy import BigInteger, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import TIMESTAMP

from app.core.database import Base


class LlmUsageLog(Base):
    """
    Лог использования OpenRouter LLM API.

    Каждая запись соответствует одному успешному API вызову.
    Используется для:
    - Мониторинга расходов (cost_dollars)
    - Анализа использования токенов
    - Атрибуции расходов по сервисам
    """

    __tablename__ = "llm_usage_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    created_at: Mapped[object] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        index=True,
        nullable=False,
    )

    model: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        index=True,
        comment="OpenRouter model ID (e.g., google/gemini-3-flash-preview)",
    )

    service: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="Calling service name (e.g., entity_synthesis, gemini_extractor)",
    )

    prompt_tokens: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="Number of input/prompt tokens",
    )

    completion_tokens: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="Number of completion/output tokens",
    )

    cost_dollars: Mapped[object] = mapped_column(
        Numeric(12, 8),
        default=0,
        nullable=False,
        comment="Cost of the API call in USD",
    )

    request_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="OpenRouter request ID for correlation",
    )
