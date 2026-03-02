import logging
import os
logging.basicConfig(level=logging.INFO if os.getenv("RAILWAY_ENVIRONMENT") else logging.DEBUG)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.db import engine, Base
from app.models import User, Policy, Contact, CoverageItem, PolicyDetail, PasswordReset, Exposure  # noqa: F401 — register models
from app.models_documents import Document  # noqa: F401
from app.models_features import Premium, Claim, RenewalReminder, AuditLog, PolicyShare, EmergencyCard, PremiumHistory, PolicyDelta, DeltaExplanation, CoverageScore, InboundAddress, InboundEmail, PolicyDraft, Certificate, CertificateReminder, LeaseRequirement, ComplianceCheck  # noqa: F401
from app.models_profile import UserProfile, ProfileContact  # noqa: F401
from app.models_chat import Conversation, ChatMessage  # noqa: F401
from app.models_admin import EmailLog, Announcement  # noqa: F401

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
from app.routes_lease_compliance import router as lease_compliance_router

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


@app.on_event("startup")
def on_startup():
    logging.info("Starting up — creating tables if needed")
    Base.metadata.create_all(bind=engine)
    # Add nickname column to existing policies table if missing
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    if "policies" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("policies")]
        with engine.begin() as conn:
            if "nickname" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN nickname VARCHAR(200)"))
            if "premium_amount" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN premium_amount INTEGER"))
            if "business_name" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN business_name VARCHAR(200)"))
            if "exposure_id" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN exposure_id INTEGER"))
            if "status" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN status VARCHAR(20) DEFAULT 'active'"))
            # Health-specific fields
            if "plan_subtype" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN plan_subtype VARCHAR(30)"))
            if "out_of_pocket_max" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN out_of_pocket_max INTEGER"))
            if "family_deductible" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN family_deductible INTEGER"))
            if "family_oop_max" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN family_oop_max INTEGER"))
            # Deductible tracking
            if "deductible_type" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN deductible_type VARCHAR(20)"))
            if "deductible_period_start" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN deductible_period_start DATE"))
            if "deductible_applied" not in cols:
                conn.execute(text("ALTER TABLE policies ADD COLUMN deductible_applied INTEGER"))
    if "users" in insp.get_table_names():
        user_cols = [c["name"] for c in insp.get_columns("users")]
        with engine.begin() as conn:
            if "role" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'individual'"))
            if "plan" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN plan VARCHAR(20) DEFAULT 'free'"))
            if "stripe_customer_id" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(100)"))
            if "stripe_subscription_id" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN stripe_subscription_id VARCHAR(100)"))
            if "trial_ends_at" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN trial_ends_at TIMESTAMP"))
            if "is_suspended" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_suspended BOOLEAN DEFAULT FALSE"))
    if "documents" in insp.get_table_names():
        doc_cols = [c["name"] for c in insp.get_columns("documents")]
        with engine.begin() as conn:
            if "cached_text" not in doc_cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN cached_text TEXT"))
    if "policy_shares" in insp.get_table_names():
        share_cols = [c["name"] for c in insp.get_columns("policy_shares")]
        with engine.begin() as conn:
            if "role_label" not in share_cols:
                conn.execute(text("ALTER TABLE policy_shares ADD COLUMN role_label VARCHAR(30)"))
            if "expires_at" not in share_cols:
                conn.execute(text("ALTER TABLE policy_shares ADD COLUMN expires_at DATE"))
    # One-time migration: normalize all emails to lowercase
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
app.include_router(lease_compliance_router)
