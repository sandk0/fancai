"""Add llm_usage_log table for OpenRouter cost tracking.

Revision ID: 2026_03_02_0001
Revises: 2026_02_26_0001
Create Date: 2026-03-02

Создаёт таблицу llm_usage_log для хранения истории AI API вызовов:
- Каждая запись соответствует одному LLM вызову через OpenRouter
- Хранит: модель, сервис, токены, стоимость, request_id
- Индексы: created_at (временные запросы), model (фильтрация по модели)
"""
import sqlalchemy as sa
from alembic import op


revision = "2026_03_02_0001"
down_revision = "2026_02_26_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_usage_log",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("service", sa.String(64), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "completion_tokens", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "cost_dollars",
            sa.Numeric(precision=12, scale=8),
            nullable=False,
            server_default="0",
        ),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_llm_usage_log_created_at",
        "llm_usage_log",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_llm_usage_log_model",
        "llm_usage_log",
        ["model"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_llm_usage_log_model", table_name="llm_usage_log")
    op.drop_index("ix_llm_usage_log_created_at", table_name="llm_usage_log")
    op.drop_table("llm_usage_log")
