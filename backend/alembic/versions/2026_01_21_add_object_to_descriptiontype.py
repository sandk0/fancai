"""Add OBJECT value to descriptiontype enum

Revision ID: 2026_01_21_0001
Revises: 2026_01_20_0001
Create Date: 2026-01-21

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = '2026_01_21_0001'
down_revision = '4311e80fcf3d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add 'object' value to descriptiontype enum in PostgreSQL."""
    # PostgreSQL requires special handling for adding enum values
    # Using raw SQL with EXECUTE to add the value
    op.execute("ALTER TYPE descriptiontype ADD VALUE IF NOT EXISTS 'object'")


def downgrade() -> None:
    """
    Note: PostgreSQL does not support removing enum values directly.
    A full enum recreation would be required, which is risky.
    This is a no-op for safety.
    """
    pass
