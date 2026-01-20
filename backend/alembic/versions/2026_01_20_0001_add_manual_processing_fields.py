"""Add manual processing fields to books table

Revision ID: 2026_01_20_0001
Revises: 2026_01_12_0001
Create Date: 2026-01-20

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2026_01_20_0001'
down_revision = '2026_01_12_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # descriptions_extracted column
    op.add_column('books', sa.Column('descriptions_extracted', sa.Boolean(), server_default='false', nullable=False))
    
    # descriptions_processing_error column
    op.add_column('books', sa.Column('descriptions_processing_error', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('books', 'descriptions_processing_error')
    op.drop_column('books', 'descriptions_extracted')
