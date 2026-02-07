"""Add entity_events table

Revision ID: 2026_02_07_0001
Revises: 2026_01_31_0001
Create Date: 2026-02-07

Stores per-chapter entity events (action + inner state) for timeline and recap.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = '2026_02_07_0001'
down_revision: Union[str, None] = '2026_01_31_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'entity_events',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('entity_id', UUID(as_uuid=True), sa.ForeignKey('entities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('chapter_id', UUID(as_uuid=True), sa.ForeignKey('chapters.id', ondelete='CASCADE'), nullable=False),
        sa.Column('chapter_number', sa.Integer(), nullable=False),
        sa.Column('event_action', sa.Text(), nullable=False),
        sa.Column('event_inner_state', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_entity_events_entity_id', 'entity_events', ['entity_id'])
    op.create_index('ix_entity_events_chapter_id', 'entity_events', ['chapter_id'])
    op.create_index('idx_entity_events_entity_chapter', 'entity_events', ['entity_id', 'chapter_number'])


def downgrade() -> None:
    op.drop_index('idx_entity_events_entity_chapter', table_name='entity_events')
    op.drop_index('ix_entity_events_chapter_id', table_name='entity_events')
    op.drop_index('ix_entity_events_entity_id', table_name='entity_events')
    op.drop_table('entity_events')
