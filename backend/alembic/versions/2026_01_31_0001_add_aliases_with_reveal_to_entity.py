"""Add aliases_with_reveal and first_mention_chapter to entities

Revision ID: 2026_01_31_0001
Revises: 2026_01_29_0002
Create Date: 2026-01-31

Adds spoiler protection fields:
- aliases_with_reveal: JSONB array storing aliases with their reveal chapter
- first_mention_chapter: Integer for quick chapter-based filtering
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = '2026_01_31_0001'
down_revision: Union[str, None] = '2026_01_29_0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'entities',
        sa.Column(
            'aliases_with_reveal',
            JSONB,
            nullable=False,
            server_default='[]',
        )
    )
    op.add_column(
        'entities',
        sa.Column(
            'first_mention_chapter',
            sa.Integer(),
            nullable=True,
        )
    )
    op.create_index(
        'ix_entities_first_mention_chapter',
        'entities',
        ['first_mention_chapter'],
        unique=False
    )


def downgrade() -> None:
    op.drop_index('ix_entities_first_mention_chapter', table_name='entities')
    op.drop_column('entities', 'first_mention_chapter')
    op.drop_column('entities', 'aliases_with_reveal')
