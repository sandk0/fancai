"""Add first_interaction_cfi and first_interaction_chapter to entity_relationships

Revision ID: 2026_01_29_0002
Revises: 2026_01_29_0001
Create Date: 2026-01-29

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '2026_01_29_0002'
down_revision: Union[str, None] = '2026_01_29_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('entity_relationships', sa.Column('first_interaction_cfi', sa.String(500), nullable=True))
    op.add_column('entity_relationships', sa.Column('first_interaction_chapter', sa.Integer(), nullable=True))
    op.create_index('ix_entity_relationships_first_interaction_cfi', 'entity_relationships', ['first_interaction_cfi'])


def downgrade() -> None:
    op.drop_index('ix_entity_relationships_first_interaction_cfi', table_name='entity_relationships')
    op.drop_column('entity_relationships', 'first_interaction_chapter')
    op.drop_column('entity_relationships', 'first_interaction_cfi')
