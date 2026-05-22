"""add agency_renewal_thresholds + index policies.renewal_date

Revision ID: g1a2b3c4d5e6
Revises: f7c91ad5b620
Create Date: 2026-05-21 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'g1a2b3c4d5e6'
down_revision: Union[str, None] = 'f7c91ad5b620'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'agency_renewal_thresholds',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('agency_id', sa.Integer(), nullable=False),
        sa.Column('policy_type', sa.String(length=60), nullable=False),
        sa.Column('upcoming_days', sa.Integer(), nullable=False),
        sa.Column('discussion_days', sa.Integer(), nullable=False),
        sa.Column('market_days', sa.Integer(), nullable=False),
        sa.Column('finalization_days', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['agency_id'], ['agencies.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('agency_id', 'policy_type', name='uq_agency_policy_type'),
    )
    with op.batch_alter_table('agency_renewal_thresholds', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_agency_renewal_thresholds_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_agency_renewal_thresholds_agency_id'), ['agency_id'], unique=False)

    # The 120-day renewal window in outreach.compute_this_week scans a much
    # wider slice than the old 60-day window — index renewal_date to keep
    # the per-agent feed query fast as the book grows.
    with op.batch_alter_table('policies', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_policies_renewal_date'), ['renewal_date'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('policies', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_policies_renewal_date'))

    with op.batch_alter_table('agency_renewal_thresholds', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_agency_renewal_thresholds_agency_id'))
        batch_op.drop_index(batch_op.f('ix_agency_renewal_thresholds_id'))

    op.drop_table('agency_renewal_thresholds')
