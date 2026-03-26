"""add image_prompt_en, usage_records, modal flag

Revision ID: a1b2c3d4e5f6
Revises: c3f7a2b8d901
Create Date: 2026-03-27 00:00:01.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "c3f7a2b8d901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Добавляем колонку image_prompt_en в таблицу descriptions
    op.add_column(
        "descriptions",
        sa.Column(
            "image_prompt_en",
            sa.Text(),
            nullable=True,
            comment="Pre-computed English image prompt from LLM extraction",
        ),
    )

    # Создаём таблицу usage_records для учёта затрат на GPU-инференс Modal
    op.create_table(
        "usage_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("book_id", sa.String(length=36), nullable=True),
        sa.Column("chapter_idx", sa.Integer(), nullable=True),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("operation", sa.String(length=50), nullable=False),
        sa.Column("gpu_seconds", sa.Float(), nullable=False),
        sa.Column("estimated_cost_usd", sa.Float(), nullable=False),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_usage_records_book_id"), "usage_records", ["book_id"], unique=False
    )
    op.create_index(
        op.f("ix_usage_records_created_at"),
        "usage_records",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    # Удаляем индекс и таблицу usage_records
    op.drop_index(op.f("ix_usage_records_created_at"), table_name="usage_records")
    op.drop_index(op.f("ix_usage_records_book_id"), table_name="usage_records")
    op.drop_table("usage_records")

    # Удаляем колонку image_prompt_en из descriptions
    op.drop_column("descriptions", "image_prompt_en")
