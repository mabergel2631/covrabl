"""add renewal_reviews table

Revision ID: f7c91ad5b620
Revises: ea0569985f81
Create Date: 2026-05-07 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7c91ad5b620'
down_revision: Union[str, None] = 'ea0569985f81'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'renewal_reviews',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('policy_id', sa.Integer(), nullable=False),
        sa.Column('agent_id', sa.Integer(), nullable=False),
        sa.Column('summary_text', sa.Text(), nullable=True),
        sa.Column('share_token', sa.String(length=60), nullable=True),
        sa.Column('shared_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['agent_id'], ['users.id']),
        sa.ForeignKeyConstraint(['policy_id'], ['policies.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('renewal_reviews', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_renewal_reviews_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_renewal_reviews_policy_id'), ['policy_id'], unique=True)
        batch_op.create_index(batch_op.f('ix_renewal_reviews_agent_id'), ['agent_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_renewal_reviews_share_token'), ['share_token'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('renewal_reviews', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_renewal_reviews_share_token'))
        batch_op.drop_index(batch_op.f('ix_renewal_reviews_agent_id'))
        batch_op.drop_index(batch_op.f('ix_renewal_reviews_policy_id'))
        batch_op.drop_index(batch_op.f('ix_renewal_reviews_id'))

    op.drop_table('renewal_reviews')
