"""Add first_mention_cfi column to entities table.

Revision ID: 2026_01_28_0001
Revises: 2026_01_26_0001
Create Date: 2026-01-28

Adds first_mention_cfi column to Entity for spoiler protection.
This denormalized field stores the CFI of the first mention
of an entity in a book, enabling quick client-side filtering.
"""

from alembic import op
import sqlalchemy as sa

revision = "2026_01_28_0001"
down_revision = "2026_01_26_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "entities",
        sa.Column(
            "first_mention_cfi",
            sa.String(500),
            nullable=True,
            comment="CFI of first mention for spoiler protection",
        ),
    )
    op.create_index(
        "ix_entities_first_mention_cfi",
        "entities",
        ["first_mention_cfi"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_entities_first_mention_cfi", table_name="entities")
    op.drop_column("entities", "first_mention_cfi")
