"""add_entity_mentions_and_file_path

Revision ID: 7bbfdb388e2a
Revises: 2026_01_23_0001
Create Date: 2026-01-24 02:20:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '7bbfdb388e2a'
down_revision = '2026_01_23_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add 'file_path' to 'chapters'
    # Используем inspector для проверки наличия колонки, чтобы избежать ошибок при повторном накате
    conn = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('chapters')]
    
    if 'file_path' not in columns:
        op.add_column('chapters', sa.Column('file_path', sa.String(length=500), nullable=True))
        op.create_index(op.f('ix_chapters_file_path'), 'chapters', ['file_path'], unique=False)

    # 2. Create 'entity_mentions' table
    tables = inspector.get_table_names()
    if 'entity_mentions' not in tables:
        op.create_table(
            'entity_mentions',
            sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('chapter_id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('mention_text', sa.String(length=500), nullable=False),
            sa.Column('context', sa.Text(), nullable=True),
            sa.Column('start_index', sa.Integer(), nullable=True),
            sa.Column('end_index', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['entity_id'], ['entities.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id')
        )
        
        # Indexes for fast lookups
        op.create_index(op.f('ix_entity_mentions_id'), 'entity_mentions', ['id'], unique=False)
        op.create_index(op.f('ix_entity_mentions_chapter_id'), 'entity_mentions', ['chapter_id'], unique=False)
        op.create_index(op.f('ix_entity_mentions_entity_id'), 'entity_mentions', ['entity_id'], unique=False)


def downgrade() -> None:
    # Reverse order
    op.drop_index(op.f('ix_entity_mentions_entity_id'), table_name='entity_mentions')
    op.drop_index(op.f('ix_entity_mentions_chapter_id'), table_name='entity_mentions')
    op.drop_index(op.f('ix_entity_mentions_id'), table_name='entity_mentions')
    op.drop_table('entity_mentions')
    
    op.drop_index(op.f('ix_chapters_file_path'), table_name='chapters')
    op.drop_column('chapters', 'file_path')
