import logging
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

logger = logging.getLogger("alembic.env")

# Import all models so Base.metadata is fully populated
from app.db import Base, get_database_url  # noqa: E402
from app.models import User, Exposure, Policy, PolicyDetail, Contact, PasswordReset, CoverageItem  # noqa: E402, F401
from app.models_features import (  # noqa: E402, F401
    Premium, Claim, RenewalReminder, AuditLog, PolicyShare, EmergencyCard,
    PremiumHistory, PolicyDelta, DeltaExplanation, CoverageScore,
    InboundAddress, InboundEmail, PolicyDraft, Certificate, CertificateReminder,
    LeaseRequirement, ComplianceCheck, DismissedRecommendation, UserEvent,
)
from app.models_documents import Document  # noqa: E402, F401
from app.models_profile import UserProfile, ProfileContact  # noqa: E402, F401
from app.models_chat import Conversation, ChatMessage  # noqa: E402, F401
from app.models_admin import EmailLog, Announcement  # noqa: E402, F401

target_metadata = Base.metadata

# Override sqlalchemy.url from app config
config.set_main_option("sqlalchemy.url", get_database_url())


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
