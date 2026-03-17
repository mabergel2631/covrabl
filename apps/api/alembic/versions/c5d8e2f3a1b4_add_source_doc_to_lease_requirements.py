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
    with op.batch_alter_table("lease_requirements") as batch_op:
        batch_op.add_column(sa.Column("source_doc_name", sa.String(255), nullable=True))
        batch_op.add_column(sa.Column("source_doc_data", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("lease_requirements") as batch_op:
        batch_op.drop_column("source_doc_data")
        batch_op.drop_column("source_doc_name")
