"""rename relation_type to type and add updated_at in entity_relationships

Revision ID: ff9dd781cd6e
Revises: 2026_03_02_0001
Create Date: 2026-03-03 23:58:09.687979+00:00
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "ff9dd781cd6e"
down_revision: Union[str, None] = "2026_03_02_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename relation_type -> type
    op.alter_column(
        "entity_relationships", "relation_type",
        new_column_name="type",
        existing_type=sa.String(length=50),
        existing_nullable=False,
    )
    # Add updated_at
    op.add_column(
        "entity_relationships",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    # Change weight from DOUBLE_PRECISION to Integer
    op.alter_column(
        "entity_relationships", "weight",
        existing_type=sa.DOUBLE_PRECISION(precision=53),
        type_=sa.Integer(),
        existing_nullable=False,
        postgresql_using="weight::integer",
    )
    # Replace old GIN index with composite index
    op.drop_index("idx_entity_relationships_metadata_gin", table_name="entity_relationships", postgresql_using="gin", if_exists=True)
    op.create_index("idx_source_type", "entity_relationships", ["source_id", "type"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_source_type", table_name="entity_relationships")
    op.create_index("idx_entity_relationships_metadata_gin", "entity_relationships", ["relationship_metadata"], unique=False, postgresql_using="gin")
    op.alter_column(
        "entity_relationships", "weight",
        existing_type=sa.Integer(),
        type_=sa.DOUBLE_PRECISION(precision=53),
        existing_nullable=False,
    )
    op.drop_column("entity_relationships", "updated_at")
    op.alter_column(
        "entity_relationships", "type",
        new_column_name="relation_type",
        existing_type=sa.String(length=50),
        existing_nullable=False,
    )
