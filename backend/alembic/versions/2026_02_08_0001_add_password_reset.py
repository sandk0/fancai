"""Add password_reset_tokens table and users.tokens_invalidated_at column

Revision ID: 2026_02_08_0001
Revises: 2026_02_07_0002
Create Date: 2026-02-08

Adds:
- password_reset_tokens table (OWASP-compliant password recovery)
- users.tokens_invalidated_at column (Option A session invalidation)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = '2026_02_08_0001'
down_revision: Union[str, None] = '2026_02_07_0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create password_reset_tokens table
    op.create_table(
        'password_reset_tokens',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(64), unique=True, nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_password_reset_tokens_user_id', 'password_reset_tokens', ['user_id'])
    op.create_index('ix_password_reset_tokens_token_hash', 'password_reset_tokens', ['token_hash'], unique=True)

    # 2. Add tokens_invalidated_at to users (Option A session invalidation)
    op.add_column('users', sa.Column('tokens_invalidated_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'tokens_invalidated_at')
    op.drop_index('ix_password_reset_tokens_token_hash', table_name='password_reset_tokens')
    op.drop_index('ix_password_reset_tokens_user_id', table_name='password_reset_tokens')
    op.drop_table('password_reset_tokens')
