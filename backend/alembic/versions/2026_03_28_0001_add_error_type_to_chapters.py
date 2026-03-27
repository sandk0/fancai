"""Add error_type to chapters for error classification (OBS-01)

Revision ID: a1e2f3b4c5d6
Revises: b094a7b42ccb
Create Date: 2026-03-28 00:00:01.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a1e2f3b4c5d6"
down_revision: Union[str, None] = "b094a7b42ccb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # nullable=True without default -> PG17 metadata-only ADD COLUMN (instant, no table rewrite)
    op.add_column("chapters", sa.Column("error_type", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("chapters", "error_type")
