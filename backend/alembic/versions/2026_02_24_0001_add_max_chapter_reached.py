"""Add max_chapter_reached column to reading_progress table

Revision ID: 2026_02_24_0001
Revises: 2026_02_08_0001
Create Date: 2026-02-24

Adds:
- reading_progress.max_chapter_reached (int, NOT NULL, server_default='1')
  Tracks the highest chapter a user has ever read for spoiler protection.
  Monotonically increasing — never goes down when user navigates back.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '2026_02_24_0001'
down_revision: Union[str, None] = '2026_02_08_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'reading_progress',
        sa.Column(
            'max_chapter_reached',
            sa.Integer(),
            nullable=False,
            server_default='1',
        ),
    )
    op.execute(
        "UPDATE reading_progress SET max_chapter_reached = current_chapter "
        "WHERE max_chapter_reached < current_chapter"
    )


def downgrade() -> None:
    op.drop_column('reading_progress', 'max_chapter_reached')
