"""add bookmarks and highlights tables

Revision ID: c01994cc9354
Revises: ff9dd781cd6e
Create Date: 2026-03-05 11:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c01994cc9354"
down_revision: Union[str, None] = "ff9dd781cd6e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Bookmarks table
    op.create_table(
        "bookmarks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("book_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cfi", sa.String(length=500), nullable=False),
        sa.Column("chapter_number", sa.Integer(), nullable=False),
        sa.Column("text_excerpt", sa.String(length=500), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "book_id", "cfi", name="uq_bookmark_user_book_cfi"
        ),
    )
    op.create_index(op.f("ix_bookmarks_id"), "bookmarks", ["id"], unique=False)
    op.create_index(
        op.f("ix_bookmarks_user_id"), "bookmarks", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_bookmarks_book_id"), "bookmarks", ["book_id"], unique=False
    )

    # Highlights table
    op.create_table(
        "highlights",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("book_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cfi_range", sa.String(length=1000), nullable=False),
        sa.Column("chapter_number", sa.Integer(), nullable=False),
        sa.Column("text", sa.String(length=2000), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False),
        sa.Column("note", sa.String(length=5000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_highlights_id"), "highlights", ["id"], unique=False)
    op.create_index(
        op.f("ix_highlights_user_id"), "highlights", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_highlights_book_id"), "highlights", ["book_id"], unique=False
    )
    op.create_index(
        "ix_highlight_user_book_chapter",
        "highlights",
        ["user_id", "book_id", "chapter_number"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_highlight_user_book_chapter", table_name="highlights")
    op.drop_index(op.f("ix_highlights_book_id"), table_name="highlights")
    op.drop_index(op.f("ix_highlights_user_id"), table_name="highlights")
    op.drop_index(op.f("ix_highlights_id"), table_name="highlights")
    op.drop_table("highlights")

    op.drop_index(op.f("ix_bookmarks_book_id"), table_name="bookmarks")
    op.drop_index(op.f("ix_bookmarks_user_id"), table_name="bookmarks")
    op.drop_index(op.f("ix_bookmarks_id"), table_name="bookmarks")
    op.drop_table("bookmarks")
