"""add user_events table

Revision ID: ea0569985f81
Revises: 4d14d3fbed8e
Create Date: 2026-03-09 19:40:08.000172

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ea0569985f81'
down_revision: Union[str, None] = '4d14d3fbed8e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('user_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('session_id', sa.String(length=50), nullable=True),
    sa.Column('event_name', sa.String(length=80), nullable=False),
    sa.Column('event_category', sa.String(length=40), nullable=True),
    sa.Column('properties', sa.Text(), nullable=True),
    sa.Column('page_path', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('user_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_user_events_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_user_events_event_name'), ['event_name'], unique=False)
        batch_op.create_index(batch_op.f('ix_user_events_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_user_events_session_id'), ['session_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_user_events_user_id'), ['user_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('user_events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_user_events_user_id'))
        batch_op.drop_index(batch_op.f('ix_user_events_session_id'))
        batch_op.drop_index(batch_op.f('ix_user_events_id'))
        batch_op.drop_index(batch_op.f('ix_user_events_event_name'))
        batch_op.drop_index(batch_op.f('ix_user_events_created_at'))

    op.drop_table('user_events')
