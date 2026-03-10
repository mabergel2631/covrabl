"""add status and error_message to compliance_checks

Revision ID: 4d14d3fbed8e
Revises: 956eb32c2e91
Create Date: 2026-03-09 15:23:01.578442

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4d14d3fbed8e'
down_revision: Union[str, None] = '956eb32c2e91'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('compliance_checks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('status', sa.String(length=20), server_default='complete', nullable=False))
        batch_op.add_column(sa.Column('error_message', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('compliance_checks', schema=None) as batch_op:
        batch_op.drop_column('error_message')
        batch_op.drop_column('status')
