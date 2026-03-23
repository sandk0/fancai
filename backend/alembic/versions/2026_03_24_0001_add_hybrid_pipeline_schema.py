"""add hybrid pipeline schema: pgvector, pipeline_version, chapter_embeddings

Revision ID: c3f7a2b8d901
Revises: 5b9ffe0aed0b
Create Date: 2026-03-24 00:00:01.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

# revision identifiers, used by Alembic.
revision: str = "c3f7a2b8d901"
down_revision: Union[str, None] = "5b9ffe0aed0b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # 2. pipeline_version в entities
    op.add_column(
        "entities",
        sa.Column(
            "pipeline_version",
            sa.String(50),
            nullable=True,
            comment="Pipeline version: null=legacy LLM, 'hybrid_v1'=GLiNER2+classifier",
        ),
    )
    op.create_index("ix_entities_pipeline_version", "entities", ["pipeline_version"])

    # 3. pipeline_version в descriptions
    op.add_column(
        "descriptions",
        sa.Column(
            "pipeline_version",
            sa.String(50),
            nullable=True,
            comment="Pipeline version: null=legacy LLM, 'hybrid_v1'=GLiNER2+classifier",
        ),
    )
    op.create_index(
        "ix_descriptions_pipeline_version", "descriptions", ["pipeline_version"]
    )

    # 4. chapter_embeddings таблица
    op.create_table(
        "chapter_embeddings",
        sa.Column(
            "id",
            sa.UUID(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "chapter_id",
            sa.UUID(),
            sa.ForeignKey("chapters.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("chunk_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(384), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "chapter_id", "chunk_index", name="uq_chapter_embeddings_chapter_chunk"
        ),
    )

    # 5. HNSW индекс для cosine similarity
    op.create_index(
        "ix_chapter_embeddings_embedding_hnsw",
        "chapter_embeddings",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade() -> None:
    op.drop_index(
        "ix_chapter_embeddings_embedding_hnsw", table_name="chapter_embeddings"
    )
    op.drop_table("chapter_embeddings")
    op.drop_index("ix_descriptions_pipeline_version", table_name="descriptions")
    op.drop_column("descriptions", "pipeline_version")
    op.drop_index("ix_entities_pipeline_version", table_name="entities")
    op.drop_column("entities", "pipeline_version")
    op.execute("DROP EXTENSION IF EXISTS vector")
