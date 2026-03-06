"""add text_color to bookmarks

Revision ID: 5b9ffe0aed0b
Revises: a8e2f3b1c456
Create Date: 2026-03-06 15:44:01.505566+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "5b9ffe0aed0b"
down_revision: Union[str, None] = "a8e2f3b1c456"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bookmarks", sa.Column("text_color", sa.String(length=20), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("bookmarks", "text_color")
