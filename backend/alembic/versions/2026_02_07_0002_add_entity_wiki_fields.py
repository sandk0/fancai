"""Add entity wiki fields: biography_milestones, base_role, relationship_milestones, is_focus

Revision ID: 2026_02_07_0002
Revises: 2026_02_07_0001
Create Date: 2026-02-07

Adds fields for entity wiki: milestones JSONB on Entity and EntityRelationship,
base_role on Entity, is_focus on DescriptionEntity.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = '2026_02_07_0002'
down_revision: Union[str, None] = '2026_02_07_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Task 2: Entity — biography_milestones + base_role
    op.add_column('entities', sa.Column('biography_milestones', JSONB, nullable=True))
    op.add_column('entities', sa.Column('base_role', sa.String(50), nullable=True))
    op.create_index('ix_entities_base_role', 'entities', ['base_role'])

    # Task 3: EntityRelationship — relationship_milestones
    op.add_column('entity_relationships', sa.Column('relationship_milestones', JSONB, nullable=True))

    # Task 4: DescriptionEntity — is_focus
    op.add_column('description_entities', sa.Column('is_focus', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('description_entities', 'is_focus')
    op.drop_column('entity_relationships', 'relationship_milestones')
    op.drop_index('ix_entities_base_role', table_name='entities')
    op.drop_column('entities', 'base_role')
    op.drop_column('entities', 'biography_milestones')
