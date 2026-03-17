"""Add source_doc columns to lease_requirements

Revision ID: c5d8e2f3a1b4
Revises: ea0569985f81
Create Date: 2026-03-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c5d8e2f3a1b4"
down_revision: Union[str, None] = "ea0569985f81"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = [c["name"] for c in inspector.get_columns("lease_requirements")]
    if "source_doc_name" not in existing:
        op.add_column("lease_requirements", sa.Column("source_doc_name", sa.String(255), nullable=True))
    if "source_doc_data" not in existing:
        op.add_column("lease_requirements", sa.Column("source_doc_data", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("lease_requirements", "source_doc_data")
    op.drop_column("lease_requirements", "source_doc_name")
