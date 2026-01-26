"""Add GIN indexes for entity JSONB columns.

Revision ID: 2026_01_26_0001
Revises: 2026_01_25_0006
Create Date: 2026-01-26

Adds GIN indexes for JSONB columns in:
- entities.entity_metadata
- entity_relationships.relationship_metadata

These columns were added in 4311e80fcf3d without GIN indexes.
GIN indexes enable fast JSONB queries (100x faster for containment checks).
"""

from alembic import op

revision = "2026_01_26_0001"
down_revision = "2026_01_25_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_entities_metadata_gin",
        "entities",
        ["entity_metadata"],
        unique=False,
        postgresql_using="gin",
    )

    op.create_index(
        "idx_entity_relationships_metadata_gin",
        "entity_relationships",
        ["relationship_metadata"],
        unique=False,
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("idx_entity_relationships_metadata_gin", table_name="entity_relationships")
    op.drop_index("idx_entities_metadata_gin", table_name="entities")
