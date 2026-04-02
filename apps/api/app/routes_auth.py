import logging
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .auth import hash_password, verify_password, create_access_token, get_current_user
from .config import settings
from .db import get_db
from .email import send_reset_email, log_email_send
from .models import User, PasswordReset, Policy, Exposure, PolicyDetail, Contact, CoverageItem
from .models_features import (
    Premium, Claim, RenewalReminder, AuditLog, PolicyShare, EmergencyCard,
    PremiumHistory, PolicyDelta, DeltaExplanation, CoverageScore,
    InboundAddress, InboundEmail, PolicyDraft, Certificate, CertificateReminder, UserEvent,
    ComplianceCheck, LeaseRequirement,
)
from .models_profile import UserProfile, ProfileContact
from .models_chat import Conversation, ChatMessage
from .models_documents import Document
from .models_agent import AgentClient, AgentNote
from .schemas import UserCreate, UserOut, Token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Login rate limiting ───────────────────────────────
# Track failed attempts per IP: {ip: [(timestamp, ...), ...]}
_failed_attempts: dict[str, list[float]] = defaultdict(list)
MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 900  # 15 minutes


def _get_client_ip(request: Request) -> str:
    """Get real client IP, respecting X-Forwarded-For behind proxies."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(request: Request) -> None:
    ip = _get_client_ip(request)
    now = datetime.now(timezone.utc).timestamp()
    # Prune old attempts outside the lockout window
    _failed_attempts[ip] = [t for t in _failed_attempts[ip] if now - t < LOCKOUT_SECONDS]
    if len(_failed_attempts[ip]) >= MAX_ATTEMPTS:
        logger.warning("Login rate limit exceeded for IP %s", ip)
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again in 15 minutes.",
        )


def _record_failure(request: Request) -> None:
    ip = _get_client_ip(request)
    _failed_attempts[ip].append(datetime.now(timezone.utc).timestamp())


def _clear_failures(request: Request) -> None:
    ip = _get_client_ip(request)
    _failed_attempts.pop(ip, None)


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed = hash_password(payload.password)
    # Defensive: verify the hash round-trips before saving
    if not verify_password(payload.password, hashed):
        logger.error("Password hash round-trip failed during registration for %s", email)
        raise HTTPException(status_code=500, detail="Registration error — please try again")

    user = User(
        email=email,
        hashed_password=hashed,
        plan="free",
        role="agent" if payload.role == "broker" else "individual",
    )
    db.add(user)
    db.flush()

    # Claim any pending agent invites for this email
    pending_invites = db.execute(
        select(AgentClient).where(
            AgentClient.invited_email == email,
            AgentClient.status == "invited",
            AgentClient.client_id.is_(None),
        )
    ).scalars().all()
    for inv in pending_invites:
        inv.client_id = user.id
        inv.status = "active"
        inv.invite_token = None

    db.commit()
    db.refresh(user)
    return Token(access_token=create_access_token(user.id))


@router.post("/login", response_model=Token)
def login(payload: UserCreate, request: Request, db: Session = Depends(get_db)):
    _check_rate_limit(request)
    email = payload.email.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or not verify_password(payload.password, user.hashed_password):
        _record_failure(request)
        logger.info("Login failed for %s (user_exists=%s)", email, user is not None)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    _clear_failures(request)
    return Token(access_token=create_access_token(user.id))


# ── Password reset ────────────────────────────────────


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user:
        token = secrets.token_urlsafe(32)
        reset = PasswordReset(
            user_id=user.id,
            token=token,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db.add(reset)
        db.commit()
        reset_url = f"{settings.app_url}/reset-password?token={token}"
        try:
            await send_reset_email(user.email, reset_url)
            log_email_send(db, user.email, "password_reset", "Reset your Covrabl password")
        except Exception as e:
            log_email_send(db, user.email, "password_reset", "Reset your Covrabl password", "failed", str(e))
        db.commit()
    # Always return success to prevent email enumeration
    return {"ok": True, "message": "If an account exists with that email, we've sent a reset link."}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    reset = db.execute(
        select(PasswordReset).where(
            PasswordReset.token == payload.token,
            PasswordReset.used == False,  # noqa: E712
        )
    ).scalar_one_or_none()

    if not reset:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    if reset.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset link has expired")

    user = db.get(User, reset.user_id)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    hashed = hash_password(payload.password)
    if not verify_password(payload.password, hashed):
        logger.error("Password hash round-trip failed during reset for user_id=%s", user.id)
        raise HTTPException(status_code=500, detail="Password reset error — please try again")
    user.hashed_password = hashed
    reset.used = True
    db.commit()
    return {"ok": True}


def delete_user_cascade(db: Session, uid: int) -> None:
    """Delete all data for a user. Caller must commit afterward."""
    policy_ids = [
        pid for (pid,) in db.execute(select(Policy.id).where(Policy.user_id == uid)).all()
    ]
    convo_ids = [
        cid for (cid,) in db.execute(select(Conversation.id).where(Conversation.user_id == uid)).all()
    ]
    cert_ids = [
        cid for (cid,) in db.execute(select(Certificate.id).where(Certificate.user_id == uid)).all()
    ]

    # Phase 1: deepest leaf tables
    if policy_ids:
        delta_ids = [
            did for (did,) in db.execute(
                select(PolicyDelta.id).where(PolicyDelta.policy_id.in_(policy_ids))
            ).all()
        ]
        if delta_ids:
            db.execute(delete(DeltaExplanation).where(DeltaExplanation.delta_id.in_(delta_ids)))
        for model in (
            PolicyDelta, PremiumHistory, Premium, Claim, RenewalReminder,
            PolicyDetail, Contact, CoverageItem, PolicyShare, Document,
        ):
            db.execute(delete(model).where(model.policy_id.in_(policy_ids)))

    if convo_ids:
        db.execute(delete(ChatMessage).where(ChatMessage.conversation_id.in_(convo_ids)))
    if cert_ids:
        db.execute(delete(CertificateReminder).where(CertificateReminder.certificate_id.in_(cert_ids)))

    # Phase 2: user-level tables (compliance before lease requirements due to FK)
    db.execute(delete(ComplianceCheck).where(ComplianceCheck.user_id == uid))
    db.execute(delete(LeaseRequirement).where(LeaseRequirement.user_id == uid))
    db.execute(delete(PolicyDraft).where(PolicyDraft.user_id == uid))
    db.execute(delete(InboundEmail).where(InboundEmail.user_id == uid))
    db.execute(delete(InboundAddress).where(InboundAddress.user_id == uid))
    db.execute(delete(Certificate).where(Certificate.user_id == uid))
    db.execute(delete(PolicyShare).where(PolicyShare.owner_id == uid))
    db.execute(delete(CoverageScore).where(CoverageScore.user_id == uid))
    db.execute(delete(AuditLog).where(AuditLog.user_id == uid))
    db.execute(delete(Conversation).where(Conversation.user_id == uid))
    db.execute(delete(EmergencyCard).where(EmergencyCard.user_id == uid))
    db.execute(delete(ProfileContact).where(ProfileContact.user_id == uid))
    db.execute(delete(UserProfile).where(UserProfile.user_id == uid))

    # Phase 3: policies & exposures
    if policy_ids:
        db.execute(delete(Policy).where(Policy.id.in_(policy_ids)))
    db.execute(delete(Exposure).where(Exposure.user_id == uid))

    # Phase 3b: agent tables
    db.execute(delete(AgentNote).where(AgentNote.agent_id == uid))
    db.execute(delete(AgentNote).where(AgentNote.client_id == uid))
    db.execute(delete(AgentClient).where(AgentClient.agent_id == uid))
    db.execute(delete(AgentClient).where(AgentClient.client_id == uid))

    # Phase 4: events, auth tables & user
    db.execute(delete(UserEvent).where(UserEvent.user_id == uid))
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == uid))
    # Also clean up email logs referencing this user's email
    user = db.get(User, uid)
    if user:
        from .models_admin import EmailLog
        db.execute(delete(EmailLog).where(EmailLog.recipient == user.email))
    db.execute(delete(User).where(User.id == uid))


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.put("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change the authenticated user's password."""
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=403, detail="Current password is incorrect")

    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    hashed = hash_password(payload.new_password)
    if not verify_password(payload.new_password, hashed):
        logger.error("Password hash round-trip failed during change for user_id=%s", user.id)
        raise HTTPException(status_code=500, detail="Password change error — please try again")

    user.hashed_password = hashed
    db.commit()
    logger.info("Password changed for user_id=%s", user.id)
    return {"ok": True}


class SetRoleRequest(BaseModel):
    role: Literal["broker"]


@router.put("/set-role")
def set_role(
    payload: SetRoleRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Allow an individual user to upgrade to broker role."""
    if user.role != "individual":
        raise HTTPException(status_code=400, detail="Role already set")
    user.role = "agent"  # "broker" maps to "agent" internally
    db.commit()
    return {"ok": True, "role": "agent"}


class DeleteAccountRequest(BaseModel):
    password: str


@router.delete("/me")
def delete_account(
    payload: DeleteAccountRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Permanently delete the authenticated user's account and all associated data."""
    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=403, detail="Incorrect password")

    delete_user_cascade(db, user.id)
    db.commit()
    logger.info("Account deleted for user_id=%s", user.id)
    return {"ok": True}


@router.get("/me")
def get_me(user: User = Depends(get_current_user)):
    # Determine effective plan (trial expires → free)
    plan = user.plan or "free"
    trial_active = False
    trial_days_left = 0
    if plan == "trial" and user.trial_ends_at:
        now = datetime.now(timezone.utc)
        trial_end = user.trial_ends_at.replace(tzinfo=timezone.utc) if user.trial_ends_at.tzinfo is None else user.trial_ends_at
        if trial_end > now:
            trial_active = True
            trial_days_left = max(0, (trial_end - now).days)
        else:
            plan = "free"

    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "plan": plan,
        "trial_active": trial_active,
        "trial_days_left": trial_days_left,
    }
