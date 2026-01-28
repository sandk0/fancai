"""Add parsing_error and parse_attempts to chapters

Revision ID: 2026_01_29_0001
Revises: 2026_01_28_0001
Create Date: 2026-01-29

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '2026_01_29_0001'
down_revision: Union[str, None] = '2026_01_28_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('chapters', sa.Column('parsing_error', sa.Text(), nullable=True))
    op.add_column('chapters', sa.Column('parse_attempts', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('chapters', 'parse_attempts')
    op.drop_column('chapters', 'parsing_error')
