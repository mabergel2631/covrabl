"""add agencies, agency_members, and agency_id on agent-side tables

Revision ID: 7d3b9e8a4c52
Revises: b3a7f1c2d4e5, c5d8e2f3a1b4, f7c91ad5b620
Create Date: 2026-05-07 14:00:00.000000

Phase 1 of the agency-as-tenant migration. Also serves as merge point for
three pre-existing branch heads (b3a7f1c2d4e5 coi_file_columns,
c5d8e2f3a1b4 source_doc_columns, f7c91ad5b620 renewal_reviews) that all
forked from ea0569985f81 without ever being merged.

- Creates `agencies` and `agency_members` tables
- Adds `agency_id` to agent_clients, agent_policy_access, agent_notes, renewal_reviews
- Adds `producer_member_id` to agent_clients (column added pre-emptively for phase 3)
- Backfills "Agency of One": one agency per existing User with role='agent', that user as Owner
- Stamps agency_id on existing agent-side rows
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7d3b9e8a4c52'
down_revision: Union[str, Sequence[str], None] = ('b3a7f1c2d4e5', 'c5d8e2f3a1b4', 'f7c91ad5b620')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. agencies
    op.create_table(
        'agencies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('slug', sa.String(length=80), nullable=False),
        sa.Column('brand_logo_url', sa.String(length=500), nullable=True),
        sa.Column('brand_color', sa.String(length=20), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('agencies', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_agencies_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_agencies_slug'), ['slug'], unique=True)

    # 2. agency_members
    op.create_table(
        'agency_members',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('agency_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('invited_email', sa.String(length=255), nullable=True),
        sa.Column('invite_token', sa.String(length=100), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('removed_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['agency_id'], ['agencies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('agency_id', 'user_id', name='uq_agency_member_user'),
    )
    with op.batch_alter_table('agency_members', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_agency_members_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_agency_members_agency_id'), ['agency_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_agency_members_user_id'), ['user_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_agency_members_invite_token'), ['invite_token'], unique=True)

    # 3. agent_clients — create-if-missing then ALTER. This table is not in the
    # alembic baseline (historically created via Base.metadata.create_all). On
    # fresh installs we create it here with agency_id pre-included; on existing
    # DBs we add the columns to the existing table.
    if not insp.has_table('agent_clients'):
        op.create_table(
            'agent_clients',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('agent_id', sa.Integer(), nullable=False),
            sa.Column('client_id', sa.Integer(), nullable=True),
            sa.Column('agency_id', sa.Integer(), nullable=True),
            sa.Column('producer_member_id', sa.Integer(), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='invited'),
            sa.Column('invited_email', sa.String(length=255), nullable=True),
            sa.Column('invite_token', sa.String(length=100), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
            sa.ForeignKeyConstraint(['agent_id'], ['users.id']),
            sa.ForeignKeyConstraint(['client_id'], ['users.id']),
            sa.ForeignKeyConstraint(['agency_id'], ['agencies.id']),
            sa.ForeignKeyConstraint(['producer_member_id'], ['agency_members.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('agent_id', 'client_id', name='uq_agent_client'),
        )
        with op.batch_alter_table('agent_clients', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_agent_clients_id'), ['id'], unique=False)
            batch_op.create_index(batch_op.f('ix_agent_clients_agent_id'), ['agent_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_agent_clients_client_id'), ['client_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_agent_clients_invite_token'), ['invite_token'], unique=True)
            batch_op.create_index('ix_agent_clients_agency_id', ['agency_id'], unique=False)
    else:
        with op.batch_alter_table('agent_clients', schema=None) as batch_op:
            batch_op.add_column(sa.Column('agency_id', sa.Integer(), nullable=True))
            batch_op.add_column(sa.Column('producer_member_id', sa.Integer(), nullable=True))
            batch_op.create_index('ix_agent_clients_agency_id', ['agency_id'], unique=False)
            batch_op.create_foreign_key('fk_agent_clients_agency', 'agencies', ['agency_id'], ['id'])
            batch_op.create_foreign_key('fk_agent_clients_producer', 'agency_members', ['producer_member_id'], ['id'])

    # 4. agent_policy_access — same pattern: create with agency_id if missing, else ALTER
    if not insp.has_table('agent_policy_access'):
        op.create_table(
            'agent_policy_access',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('agent_id', sa.Integer(), nullable=False),
            sa.Column('client_id', sa.Integer(), nullable=False),
            sa.Column('policy_id', sa.Integer(), nullable=False),
            sa.Column('agency_id', sa.Integer(), nullable=True),
            sa.Column('visible', sa.Boolean(), nullable=False, server_default=sa.text('1')),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
            sa.ForeignKeyConstraint(['agent_id'], ['users.id']),
            sa.ForeignKeyConstraint(['client_id'], ['users.id']),
            sa.ForeignKeyConstraint(['policy_id'], ['policies.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['agency_id'], ['agencies.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('agent_id', 'policy_id', name='uq_agent_policy'),
        )
        with op.batch_alter_table('agent_policy_access', schema=None) as batch_op:
            batch_op.create_index('ix_agent_policy_access_agent_id', ['agent_id'], unique=False)
            batch_op.create_index('ix_agent_policy_access_client_id', ['client_id'], unique=False)
            batch_op.create_index('ix_agent_policy_access_policy_id', ['policy_id'], unique=False)
            batch_op.create_index('ix_agent_policy_access_agency_id', ['agency_id'], unique=False)
    else:
        with op.batch_alter_table('agent_policy_access', schema=None) as batch_op:
            batch_op.add_column(sa.Column('agency_id', sa.Integer(), nullable=True))
            batch_op.create_index('ix_agent_policy_access_agency_id', ['agency_id'], unique=False)
            batch_op.create_foreign_key('fk_agent_policy_access_agency', 'agencies', ['agency_id'], ['id'])

    # 5. agent_notes — same pattern
    if not insp.has_table('agent_notes'):
        op.create_table(
            'agent_notes',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('agent_id', sa.Integer(), nullable=False),
            sa.Column('client_id', sa.Integer(), nullable=False),
            sa.Column('agency_id', sa.Integer(), nullable=True),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
            sa.ForeignKeyConstraint(['agent_id'], ['users.id']),
            sa.ForeignKeyConstraint(['client_id'], ['users.id']),
            sa.ForeignKeyConstraint(['agency_id'], ['agencies.id']),
            sa.PrimaryKeyConstraint('id'),
        )
        with op.batch_alter_table('agent_notes', schema=None) as batch_op:
            batch_op.create_index('ix_agent_notes_agent_id', ['agent_id'], unique=False)
            batch_op.create_index('ix_agent_notes_client_id', ['client_id'], unique=False)
            batch_op.create_index('ix_agent_notes_agency_id', ['agency_id'], unique=False)
    else:
        with op.batch_alter_table('agent_notes', schema=None) as batch_op:
            batch_op.add_column(sa.Column('agency_id', sa.Integer(), nullable=True))
            batch_op.create_index('ix_agent_notes_agency_id', ['agency_id'], unique=False)
            batch_op.create_foreign_key('fk_agent_notes_agency', 'agencies', ['agency_id'], ['id'])

    # 6. renewal_reviews
    with op.batch_alter_table('renewal_reviews', schema=None) as batch_op:
        batch_op.add_column(sa.Column('agency_id', sa.Integer(), nullable=True))
        batch_op.create_index('ix_renewal_reviews_agency_id', ['agency_id'], unique=False)
        batch_op.create_foreign_key('fk_renewal_reviews_agency', 'agencies', ['agency_id'], ['id'])

    # 7. Backfill — Agency of One. Create one agency per existing agent user.
    op.execute("""
        INSERT INTO agencies (name, slug, created_at)
        SELECT
            COALESCE(NULLIF(email, ''), 'Agency ' || CAST(id AS VARCHAR)),
            'agency-' || CAST(id AS VARCHAR),
            CURRENT_TIMESTAMP
        FROM users
        WHERE role = 'agent'
    """)

    # 8. Backfill — Owner membership for each agent.
    op.execute("""
        INSERT INTO agency_members (agency_id, user_id, role, status, created_at)
        SELECT a.id, u.id, 'owner', 'active', CURRENT_TIMESTAMP
        FROM users u
        JOIN agencies a ON a.slug = 'agency-' || CAST(u.id AS VARCHAR)
        WHERE u.role = 'agent'
    """)

    # 9. Backfill — stamp agency_id on existing agent-side rows.
    op.execute("""
        UPDATE agent_clients
        SET agency_id = (
            SELECT id FROM agencies WHERE slug = 'agency-' || CAST(agent_clients.agent_id AS VARCHAR)
        )
        WHERE agency_id IS NULL
    """)
    if insp.has_table('agent_policy_access'):
        op.execute("""
            UPDATE agent_policy_access
            SET agency_id = (
                SELECT id FROM agencies WHERE slug = 'agency-' || CAST(agent_policy_access.agent_id AS VARCHAR)
            )
            WHERE agency_id IS NULL
        """)
    op.execute("""
        UPDATE agent_notes
        SET agency_id = (
            SELECT id FROM agencies WHERE slug = 'agency-' || CAST(agent_notes.agent_id AS VARCHAR)
        )
        WHERE agency_id IS NULL
    """)
    op.execute("""
        UPDATE renewal_reviews
        SET agency_id = (
            SELECT id FROM agencies WHERE slug = 'agency-' || CAST(renewal_reviews.agent_id AS VARCHAR)
        )
        WHERE agency_id IS NULL
    """)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    with op.batch_alter_table('renewal_reviews', schema=None) as batch_op:
        batch_op.drop_constraint('fk_renewal_reviews_agency', type_='foreignkey')
        batch_op.drop_index('ix_renewal_reviews_agency_id')
        batch_op.drop_column('agency_id')

    with op.batch_alter_table('agent_notes', schema=None) as batch_op:
        batch_op.drop_constraint('fk_agent_notes_agency', type_='foreignkey')
        batch_op.drop_index('ix_agent_notes_agency_id')
        batch_op.drop_column('agency_id')

    if insp.has_table('agent_policy_access'):
        with op.batch_alter_table('agent_policy_access', schema=None) as batch_op:
            batch_op.drop_constraint('fk_agent_policy_access_agency', type_='foreignkey')
            batch_op.drop_index('ix_agent_policy_access_agency_id')
            batch_op.drop_column('agency_id')

    with op.batch_alter_table('agent_clients', schema=None) as batch_op:
        batch_op.drop_constraint('fk_agent_clients_producer', type_='foreignkey')
        batch_op.drop_constraint('fk_agent_clients_agency', type_='foreignkey')
        batch_op.drop_index('ix_agent_clients_agency_id')
        batch_op.drop_column('producer_member_id')
        batch_op.drop_column('agency_id')

    with op.batch_alter_table('agency_members', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_agency_members_invite_token'))
        batch_op.drop_index(batch_op.f('ix_agency_members_user_id'))
        batch_op.drop_index(batch_op.f('ix_agency_members_agency_id'))
        batch_op.drop_index(batch_op.f('ix_agency_members_id'))
    op.drop_table('agency_members')

    with op.batch_alter_table('agencies', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_agencies_slug'))
        batch_op.drop_index(batch_op.f('ix_agencies_id'))
    op.drop_table('agencies')
