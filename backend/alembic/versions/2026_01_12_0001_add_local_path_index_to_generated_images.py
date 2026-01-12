"""Add index on local_path column in generated_images table.

Revision ID: 2026_01_12_0001
Revises: 2026_01_09_0001
Create Date: 2026-01-12

Problem: Every image request by local_path performs a full table scan.
Solution: Add index on local_path column to optimize lookups.

Expected improvements:
- Image lookup by local_path: O(n) -> O(log n)
- Faster image serving for cached/stored images
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "2026_01_12_0001"
down_revision = "2026_01_09_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add index on local_path column for faster image lookups."""
    op.create_index(
        "ix_generated_images_local_path",
        "generated_images",
        ["local_path"],
        unique=False,
    )


def downgrade() -> None:
    """Remove local_path index."""
    op.drop_index(
        "ix_generated_images_local_path",
        table_name="generated_images",
    )
