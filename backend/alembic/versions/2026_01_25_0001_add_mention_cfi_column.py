"""add_mention_cfi_column

Revision ID: 8ccf2b499f3b
Revises: 7bbfdb388e2a
Create Date: 2026-01-25 16:45:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = '8ccf2b499f3b'
down_revision = '7bbfdb388e2a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(conn)
    
    columns = [c['name'] for c in inspector.get_columns('entity_mentions')]
    
    if 'mention_cfi' not in columns:
        op.add_column('entity_mentions', sa.Column('mention_cfi', sa.String(length=500), nullable=True))
        op.create_index('ix_entity_mentions_mention_cfi', 'entity_mentions', ['mention_cfi'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_entity_mentions_mention_cfi', table_name='entity_mentions')
    op.drop_column('entity_mentions', 'mention_cfi')
