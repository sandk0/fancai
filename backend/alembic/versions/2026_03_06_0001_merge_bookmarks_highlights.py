"""merge bookmarks and highlights into unified bookmarks

Revision ID: a8e2f3b1c456
Revises: c01994cc9354
Create Date: 2026-03-06 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a8e2f3b1c456"
down_revision: Union[str, None] = "c01994cc9354"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Drop old bookmarks table (position-only, created 05.03, minimal data)
    op.drop_index(op.f("ix_bookmarks_book_id"), table_name="bookmarks")
    op.drop_index(op.f("ix_bookmarks_user_id"), table_name="bookmarks")
    op.drop_index(op.f("ix_bookmarks_id"), table_name="bookmarks")
    op.drop_constraint("uq_bookmark_user_book_cfi", "bookmarks", type_="unique")
    op.drop_table("bookmarks")

    # 2. Add style column to highlights before rename
    op.add_column(
        "highlights",
        sa.Column("style", sa.String(length=20), nullable=False, server_default="none"),
    )

    # 3. Make color nullable (NULL = no visual annotation color)
    op.alter_column(
        "highlights",
        "color",
        existing_type=sa.String(length=20),
        nullable=True,
        server_default=None,
    )

    # 4. Rename highlights -> bookmarks
    op.rename_table("highlights", "bookmarks")

    # 5. Rename indexes to match new table name
    op.drop_index("ix_highlight_user_book_chapter", table_name="bookmarks")
    op.drop_index(op.f("ix_highlights_id"), table_name="bookmarks")
    op.drop_index(op.f("ix_highlights_user_id"), table_name="bookmarks")
    op.drop_index(op.f("ix_highlights_book_id"), table_name="bookmarks")

    op.create_index(op.f("ix_bookmarks_id"), "bookmarks", ["id"], unique=False)
    op.create_index(
        op.f("ix_bookmarks_user_id"), "bookmarks", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_bookmarks_book_id"), "bookmarks", ["book_id"], unique=False
    )
    op.create_index(
        "ix_bookmark_user_book_chapter",
        "bookmarks",
        ["user_id", "book_id", "chapter_number"],
        unique=False,
    )


def downgrade() -> None:
    # 1. Rename bookmarks back to highlights
    op.drop_index("ix_bookmark_user_book_chapter", table_name="bookmarks")
    op.drop_index(op.f("ix_bookmarks_book_id"), table_name="bookmarks")
    op.drop_index(op.f("ix_bookmarks_user_id"), table_name="bookmarks")
    op.drop_index(op.f("ix_bookmarks_id"), table_name="bookmarks")

    op.rename_table("bookmarks", "highlights")

    # 2. Restore indexes
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

    # 3. Make color non-nullable again
    op.execute("UPDATE highlights SET color = '#fbbf24' WHERE color IS NULL")
    op.alter_column(
        "highlights",
        "color",
        existing_type=sa.String(length=20),
        nullable=False,
        server_default="#fbbf24",
    )

    # 4. Drop style column
    op.drop_column("highlights", "style")

    # 5. Re-create old bookmarks table
    from sqlalchemy.dialects import postgresql

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
