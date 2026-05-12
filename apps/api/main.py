import logging
import os
logging.basicConfig(level=logging.INFO if os.getenv("RAILWAY_ENVIRONMENT") else logging.DEBUG)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.db import engine
from app.models import User, Policy, Contact, CoverageItem, PolicyDetail, PasswordReset, Exposure  # noqa: F401 — register models
from app.models_documents import Document  # noqa: F401
from app.models_features import Premium, Claim, RenewalReminder, AuditLog, PolicyShare, EmergencyCard, PremiumHistory, PolicyDelta, DeltaExplanation, CoverageScore, InboundAddress, InboundEmail, PolicyDraft, Certificate, CertificateReminder, LeaseRequirement, ComplianceCheck, DismissedRecommendation, UserEvent  # noqa: F401
from app.models_profile import UserProfile, ProfileContact  # noqa: F401
from app.models_chat import Conversation, ChatMessage  # noqa: F401
from app.models_admin import EmailLog, Announcement  # noqa: F401
from app.models_agent import AgentClient, AgentNote, AgentPolicyAccess  # noqa: F401
from app.models_agency import Agency, AgencyMember  # noqa: F401

from app.routes_auth import router as auth_router
from app.routes_policies import router as policies_router
from app.routes_documents_upload import router as documents_router
from app.routes_audit import router as audit_router
from app.routes_contacts import router as contacts_router
from app.routes_extraction import router as extraction_router
from app.routes_renewals import router as renewals_router
from app.routes_coverage import router as coverage_router
from app.routes_policy_details import router as policy_details_router
from app.routes_premiums import router as premiums_router
from app.routes_claims import router as claims_router
from app.routes_reminders import router as reminders_router
from app.routes_export import router as export_router
from app.routes_sharing import router as sharing_router
from app.routes_files import router as files_router
from app.routes_gaps import router as gaps_router
from app.routes_ice import router as ice_router
from app.routes_premium_history import router as premium_history_router
from app.routes_deltas import router as deltas_router
from app.routes_scores import router as scores_router
from app.routes_inbound import router as inbound_router
from app.routes_agent import router as agent_router
from app.routes_renewal_review import router as renewal_review_router, quote_router as quote_comparison_public_router
from app.demo_seed import router as demo_seed_router
from app.routes_admin import router as admin_router, public_router as announcements_router
from app.routes_exposures import router as exposures_router
from app.routes_certificates import router as certificates_router
from app.routes_profile import router as profile_router
from app.routes_billing import router as billing_router
from app.routes_chat import router as chat_router
from app.routes_compare_analysis import router as compare_analysis_router
from app.routes_lease_compliance import router as lease_compliance_router
from app.routes_events import router as events_router

app = FastAPI(title="Covrabl API")

ALLOWED_ORIGINS = [
    "https://covrabl.com",
    "https://www.covrabl.com",
    "https://covrabl.vercel.app",
    "https://keeps-jet.vercel.app",
    "https://keeps-app-six.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Ensure CORS headers are sent even on unhandled exceptions."""
    logging.exception("Unhandled error: %s", exc)
    origin = request.headers.get("origin", "")
    headers = {}
    if origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers=headers,
    )


@app.get("/health")
def health_check():
    from app.config import settings
    from app.storage import storage_backend
    # Diagnostic: which R2 env vars are present? Reports True/False per var,
    # NEVER the values themselves. Lets us debug "storage":"local" cases
    # without exposing credentials.
    r2_env_seen = {
        "R2_ACCESS_KEY_ID": bool(os.getenv("R2_ACCESS_KEY_ID")),
        "R2_SECRET_ACCESS_KEY": bool(os.getenv("R2_SECRET_ACCESS_KEY")),
        "R2_ACCOUNT_ID": bool(os.getenv("R2_ACCOUNT_ID")),
        "R2_BUCKET": bool(os.getenv("R2_BUCKET")),
    }
    # Sanity: does Railway inject ANY env vars to this container? If
    # railway_signals are all false, Railway may have a per-environment or
    # per-service config issue. If they're true but R2_* are false, the
    # vars were saved on the wrong service/env.
    railway_signals = {
        "RAILWAY_ENVIRONMENT_NAME": os.getenv("RAILWAY_ENVIRONMENT_NAME") or os.getenv("RAILWAY_ENVIRONMENT") or "(none)",
        "RAILWAY_SERVICE_NAME": os.getenv("RAILWAY_SERVICE_NAME") or "(none)",
        "RAILWAY_PUBLIC_DOMAIN": os.getenv("RAILWAY_PUBLIC_DOMAIN") or "(none)",
        "DATABASE_URL": bool(os.getenv("DATABASE_URL")),
        "JWT_SECRET": bool(os.getenv("JWT_SECRET")),
    }
    return {
        "status": "ok",
        "app_url": settings.app_url,
        "version": "2026-05-07-r2-diag3",
        "storage": storage_backend(),
        "r2_env": r2_env_seen,
        "railway_env": railway_signals,
    }


@app.on_event("startup")
def on_startup():
    logging.info("Starting up — running Alembic migrations")
    try:
        from alembic.config import Config
        from alembic import command

        base_dir = os.path.dirname(os.path.abspath(__file__))
        alembic_cfg = Config(os.path.join(base_dir, "alembic.ini"))
        alembic_cfg.set_main_option("script_location", os.path.join(base_dir, "alembic"))
        command.upgrade(alembic_cfg, "head")
        logging.info("Alembic migrations complete")
    except Exception as e:
        logging.error("Alembic migration failed: %s — falling back to create_all", e)
        from app.db import Base
        Base.metadata.create_all(bind=engine)
        logging.info("Fallback create_all complete")

    # Ensure new columns exist (idempotent — safe to run every startup)
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    existing_cols = [c["name"] for c in insp.get_columns("lease_requirements")]
    with engine.begin() as conn:
        if "source_doc_name" not in existing_cols:
            conn.execute(text("ALTER TABLE lease_requirements ADD COLUMN source_doc_name VARCHAR(255)"))
            logging.info("Added source_doc_name column")
        if "source_doc_data" not in existing_cols:
            conn.execute(text("ALTER TABLE lease_requirements ADD COLUMN source_doc_data BYTEA"))
            logging.info("Added source_doc_data column")

    # Ensure uploaded_by_user_id column exists on documents
    doc_cols = [c["name"] for c in insp.get_columns("documents")]
    with engine.begin() as conn:
        if "uploaded_by_user_id" not in doc_cols:
            conn.execute(text("ALTER TABLE documents ADD COLUMN uploaded_by_user_id INTEGER"))
            logging.info("Added uploaded_by_user_id column to documents")

    # Ensure agent_policy_access table exists
    existing_tables = set(insp.get_table_names())
    if "agent_policy_access" not in existing_tables:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE agent_policy_access (
                    id SERIAL PRIMARY KEY,
                    agent_id INTEGER NOT NULL REFERENCES users(id),
                    client_id INTEGER NOT NULL REFERENCES users(id),
                    policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
                    agency_id INTEGER REFERENCES agencies(id),
                    visible BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_agent_policy UNIQUE (agent_id, policy_id)
                )
            """))
            conn.execute(text("CREATE INDEX ix_agent_policy_access_agent_id ON agent_policy_access(agent_id)"))
            conn.execute(text("CREATE INDEX ix_agent_policy_access_client_id ON agent_policy_access(client_id)"))
            conn.execute(text("CREATE INDEX ix_agent_policy_access_policy_id ON agent_policy_access(policy_id)"))
            conn.execute(text("CREATE INDEX ix_agent_policy_access_agency_id ON agent_policy_access(agency_id)"))
            logging.info("Created agent_policy_access table")
    else:
        # Idempotent: ensure agency_id column exists on already-created table
        apa_cols = [c["name"] for c in insp.get_columns("agent_policy_access")]
        if "agency_id" not in apa_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE agent_policy_access ADD COLUMN agency_id INTEGER REFERENCES agencies(id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_agent_policy_access_agency_id ON agent_policy_access(agency_id)"))
                logging.info("Added agency_id column to agent_policy_access")

    # Ensure report_text column exists on compliance_checks
    cc_cols = [c["name"] for c in insp.get_columns("compliance_checks")]
    if "report_text" not in cc_cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE compliance_checks ADD COLUMN report_text TEXT"))
            logging.info("Added report_text column to compliance_checks")

    # ─── Agency model self-heal (covers cases where the alembic migration
    # didn't fully apply ALTERs on Postgres) ───────────────────────────
    insp = inspect(engine)  # refresh
    existing_tables = set(insp.get_table_names())

    # 1. agencies + agency_members tables
    if "agencies" not in existing_tables:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE agencies (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(200) NOT NULL,
                    slug VARCHAR(80) NOT NULL UNIQUE,
                    brand_logo_url VARCHAR(500),
                    brand_color VARCHAR(20),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("CREATE INDEX ix_agencies_id ON agencies(id)"))
            logging.info("Self-heal: created agencies table")

    if "agency_members" not in existing_tables:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE agency_members (
                    id SERIAL PRIMARY KEY,
                    agency_id INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
                    user_id INTEGER REFERENCES users(id),
                    role VARCHAR(20) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'active',
                    invited_email VARCHAR(255),
                    invite_token VARCHAR(100) UNIQUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    removed_at TIMESTAMP,
                    CONSTRAINT uq_agency_member_user UNIQUE (agency_id, user_id)
                )
            """))
            conn.execute(text("CREATE INDEX ix_agency_members_agency_id ON agency_members(agency_id)"))
            conn.execute(text("CREATE INDEX ix_agency_members_user_id ON agency_members(user_id)"))
            logging.info("Self-heal: created agency_members table")

    # 2. agent_clients new columns
    ac_cols = [c["name"] for c in insp.get_columns("agent_clients")] if "agent_clients" in existing_tables else []
    with engine.begin() as conn:
        if "agent_clients" in existing_tables:
            if "agency_id" not in ac_cols:
                conn.execute(text("ALTER TABLE agent_clients ADD COLUMN agency_id INTEGER REFERENCES agencies(id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_agent_clients_agency_id ON agent_clients(agency_id)"))
                logging.info("Self-heal: added agency_id to agent_clients")
            if "producer_member_id" not in ac_cols:
                conn.execute(text("ALTER TABLE agent_clients ADD COLUMN producer_member_id INTEGER REFERENCES agency_members(id)"))
                logging.info("Self-heal: added producer_member_id to agent_clients")

    # 3. agent_notes new column
    an_cols = [c["name"] for c in insp.get_columns("agent_notes")] if "agent_notes" in existing_tables else []
    with engine.begin() as conn:
        if "agent_notes" in existing_tables and "agency_id" not in an_cols:
            conn.execute(text("ALTER TABLE agent_notes ADD COLUMN agency_id INTEGER REFERENCES agencies(id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_agent_notes_agency_id ON agent_notes(agency_id)"))
            logging.info("Self-heal: added agency_id to agent_notes")

    # 4. renewal_reviews new columns
    rr_cols = [c["name"] for c in insp.get_columns("renewal_reviews")] if "renewal_reviews" in existing_tables else []
    with engine.begin() as conn:
        if "renewal_reviews" in existing_tables and "agency_id" not in rr_cols:
            conn.execute(text("ALTER TABLE renewal_reviews ADD COLUMN agency_id INTEGER REFERENCES agencies(id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_renewal_reviews_agency_id ON renewal_reviews(agency_id)"))
            logging.info("Self-heal: added agency_id to renewal_reviews")
        if "renewal_reviews" in existing_tables and "dismissed_items_json" not in rr_cols:
            conn.execute(text("ALTER TABLE renewal_reviews ADD COLUMN dismissed_items_json TEXT"))
            logging.info("Self-heal: added dismissed_items_json to renewal_reviews")

    # 5. Agency-of-One backfill — idempotent. For every User with role='agent'
    # who has no AgencyMember row, create their agency and Owner membership,
    # then stamp agency_id on their agent_clients / agent_notes / renewal_reviews.
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT u.id, u.email FROM users u
            WHERE u.role = 'agent'
              AND NOT EXISTS (
                SELECT 1 FROM agency_members am WHERE am.user_id = u.id AND am.status = 'active'
              )
        """))
        agentless = list(result)
        for row in agentless:
            uid, email = row[0], row[1]
            # Create agency
            aresult = conn.execute(
                text("""
                    INSERT INTO agencies (name, slug, created_at)
                    VALUES (:name, :slug, NOW())
                    RETURNING id
                """),
                {"name": email or f"Agency {uid}", "slug": f"agency-{uid}"},
            )
            aid = aresult.scalar()
            # Create Owner membership
            conn.execute(
                text("""
                    INSERT INTO agency_members (agency_id, user_id, role, status, created_at)
                    VALUES (:aid, :uid, 'owner', 'active', NOW())
                """),
                {"aid": aid, "uid": uid},
            )
            # Stamp existing agent-side rows
            conn.execute(
                text("UPDATE agent_clients SET agency_id = :aid WHERE agent_id = :uid AND agency_id IS NULL"),
                {"aid": aid, "uid": uid},
            )
            conn.execute(
                text("UPDATE agent_notes SET agency_id = :aid WHERE agent_id = :uid AND agency_id IS NULL"),
                {"aid": aid, "uid": uid},
            )
            conn.execute(
                text("UPDATE renewal_reviews SET agency_id = :aid WHERE agent_id = :uid AND agency_id IS NULL"),
                {"aid": aid, "uid": uid},
            )
            try:
                conn.execute(
                    text("UPDATE agent_policy_access SET agency_id = :aid WHERE agent_id = :uid AND agency_id IS NULL"),
                    {"aid": aid, "uid": uid},
                )
            except Exception:
                pass  # table or column may not exist yet on a stripped-down install
            logging.info("Self-heal: created Agency-of-One for user %s (%s)", uid, email)

    # MFA / 2FA columns on users table — added 2026-05-08
    insp = inspect(engine)
    user_cols = [c["name"] for c in insp.get_columns("users")]
    with engine.begin() as conn:
        if "mfa_enabled" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE NOT NULL"))
            logging.info("Self-heal: added mfa_enabled to users")
        if "mfa_secret" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN mfa_secret VARCHAR(64)"))
            logging.info("Self-heal: added mfa_secret to users")
        if "mfa_recovery_codes" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN mfa_recovery_codes VARCHAR(2000)"))
            logging.info("Self-heal: added mfa_recovery_codes to users")
        if "mfa_enrolled_at" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN mfa_enrolled_at TIMESTAMP"))
            logging.info("Self-heal: added mfa_enrolled_at to users")

    # Phase 6 — Quote Comparison: is_quote flag on policies + quote_comparisons table
    insp = inspect(engine)
    existing_tables = insp.get_table_names()
    policy_cols = [c["name"] for c in insp.get_columns("policies")] if "policies" in existing_tables else []
    with engine.begin() as conn:
        if "policies" in existing_tables and "is_quote" not in policy_cols:
            conn.execute(text("ALTER TABLE policies ADD COLUMN is_quote BOOLEAN DEFAULT FALSE NOT NULL"))
            logging.info("Self-heal: added is_quote to policies")
    if "quote_comparisons" not in existing_tables:
        # Use SQLAlchemy DDL so the table is created with the correct syntax
        # for whatever dialect is in use (Postgres on Railway, SQLite locally).
        # Raw SQL with SERIAL/NOW() blows up on SQLite at startup.
        from app.models_features import QuoteComparison
        QuoteComparison.__table__.create(engine, checkfirst=True)
        logging.info("Self-heal: created quote_comparisons table via SQLAlchemy DDL")

    # Idempotent data normalization
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET email = lower(email) WHERE email != lower(email)"))
        conn.execute(text("UPDATE policy_shares SET shared_with_email = lower(shared_with_email) WHERE shared_with_email != lower(shared_with_email)"))


app.include_router(files_router)
app.include_router(auth_router)
app.include_router(export_router)
app.include_router(sharing_router)
app.include_router(policies_router)
app.include_router(documents_router)
app.include_router(contacts_router)
app.include_router(extraction_router)
app.include_router(audit_router)
app.include_router(renewals_router)
app.include_router(coverage_router)
app.include_router(policy_details_router)
app.include_router(premiums_router)
app.include_router(claims_router)
app.include_router(reminders_router)
app.include_router(gaps_router)
app.include_router(ice_router)
app.include_router(premium_history_router)
app.include_router(deltas_router)
app.include_router(scores_router)
app.include_router(inbound_router)
app.include_router(agent_router)
app.include_router(renewal_review_router)
app.include_router(quote_comparison_public_router)
app.include_router(demo_seed_router)
app.include_router(admin_router)
app.include_router(announcements_router)
app.include_router(exposures_router)
app.include_router(certificates_router)
app.include_router(profile_router)
app.include_router(billing_router)
app.include_router(chat_router)
app.include_router(compare_analysis_router)
app.include_router(lease_compliance_router)
app.include_router(events_router)
