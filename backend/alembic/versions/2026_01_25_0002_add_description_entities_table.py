"""Add description_entities table for M:N relationship

Revision ID: 2026_01_25_0002
Revises: 2026_01_25_0001
Create Date: 2026-01-25

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '2026_01_25_0002'
down_revision = '8ccf2b499f3b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'description_entities',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('description_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('descriptions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('entities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False, default=1.0),
        sa.Column('mention_cfi', sa.String(500), nullable=True),
        sa.Column('mention_text', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('description_id', 'entity_id', name='uq_description_entity'),
    )
    
    op.create_index('idx_description_entities_description', 'description_entities', ['description_id'])
    op.create_index('idx_description_entities_entity', 'description_entities', ['entity_id'])


def downgrade() -> None:
    op.drop_index('idx_description_entities_entity', table_name='description_entities')
    op.drop_index('idx_description_entities_description', table_name='description_entities')
    op.drop_table('description_entities')
