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
from app.models_agent import AgentClient, AgentNote  # noqa: F401

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
    return {"status": "ok", "app_url": settings.app_url, "version": "2026-04-02-v5-density"}


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
                    visible BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_agent_policy UNIQUE (agent_id, policy_id)
                )
            """))
            conn.execute(text("CREATE INDEX ix_agent_policy_access_agent_id ON agent_policy_access(agent_id)"))
            conn.execute(text("CREATE INDEX ix_agent_policy_access_client_id ON agent_policy_access(client_id)"))
            conn.execute(text("CREATE INDEX ix_agent_policy_access_policy_id ON agent_policy_access(policy_id)"))
            logging.info("Created agent_policy_access table")

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
