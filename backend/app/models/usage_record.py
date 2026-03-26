"""Учёт затрат на GPU-инференс Modal."""

from datetime import datetime
from typing import Optional

from sqlalchemy import Float, Integer, String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True, index=True
    )
    chapter_idx: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    provider: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # modal_llm, modal_image, openrouter
    operation: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # extract, reduce, generate_image
    gpu_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    estimated_cost_usd: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0
    )
    tokens_in: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
