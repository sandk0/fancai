"""v16_schema_upgrade: importance, graph, assets

Revision ID: 2026_01_23_0001
Revises: 2026_01_21_0001
Create Date: 2026-01-23 00:50:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '2026_01_23_0001'
down_revision = '2026_01_21_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    import sqlalchemy as sa
    from sqlalchemy import inspect
    inspector = inspect(conn)

    # 1. Add 'importance' column to 'entities'
    columns = [c['name'] for c in inspector.get_columns('entities')]
    if 'importance' not in columns:
        op.add_column('entities', sa.Column('importance', sa.Integer(), nullable=True))
    
    # 2. Add 'linked_entity_ids' column to 'entities'
    if 'linked_entity_ids' not in columns:
        # JSONB default needs explicit text/sql handling regarding server default
        op.add_column('entities', sa.Column('linked_entity_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=True, server_default='[]'))
    
    # 3. Create 'entity_relationships' table
    tables = inspector.get_table_names()
    if 'entity_relationships' not in tables:
        op.create_table('entity_relationships',
            sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('source_id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('target_id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('type', sa.String(length=50), nullable=False),
            sa.Column('weight', sa.Integer(), nullable=True),
            sa.Column('relationship_metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint(['source_id'], ['entities.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['target_id'], ['entities.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id')
        )
        
        # 4. Create index for fast graph traversal
        op.create_index('idx_source_type', 'entity_relationships', ['source_id', 'type'], unique=False)
        
        # 5. Create basic indexes for FKs (best practice)
        op.create_index(op.f('ix_entity_relationships_id'), 'entity_relationships', ['id'], unique=False)
        op.create_index(op.f('ix_entity_relationships_source_id'), 'entity_relationships', ['source_id'], unique=False)
        op.create_index(op.f('ix_entity_relationships_target_id'), 'entity_relationships', ['target_id'], unique=False)


def downgrade() -> None:
    # Reverse order
    op.drop_index(op.f('ix_entity_relationships_target_id'), table_name='entity_relationships')
    op.drop_index(op.f('ix_entity_relationships_source_id'), table_name='entity_relationships')
    op.drop_index(op.f('ix_entity_relationships_id'), table_name='entity_relationships')
    op.drop_index('idx_source_type', table_name='entity_relationships')
    op.drop_table('entity_relationships')
    op.drop_column('entities', 'linked_entity_ids')
    op.drop_column('entities', 'importance')
