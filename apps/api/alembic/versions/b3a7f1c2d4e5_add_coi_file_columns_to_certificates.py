"""add coi_file columns to certificates

Revision ID: b3a7f1c2d4e5
Revises: ea0569985f81
Create Date: 2026-03-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3a7f1c2d4e5'
down_revision: Union[str, None] = 'ea0569985f81'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('certificates', schema=None) as batch_op:
        batch_op.add_column(sa.Column('coi_file_key', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('coi_file_data', sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('certificates', schema=None) as batch_op:
        batch_op.drop_column('coi_file_data')
        batch_op.drop_column('coi_file_key')
