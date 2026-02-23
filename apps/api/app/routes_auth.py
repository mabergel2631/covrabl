import logging
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import hash_password, verify_password, create_access_token, get_current_user
from .config import settings
from .db import get_db
from .email import send_reset_email
from .models import User, PasswordReset
from .schemas import UserCreate, UserOut, Token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Login rate limiting ───────────────────────────────
# Track failed attempts per IP: {ip: [(timestamp, ...), ...]}
_failed_attempts: dict[str, list[float]] = defaultdict(list)
MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 900  # 15 minutes


def _check_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
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
    ip = request.client.host if request.client else "unknown"
    _failed_attempts[ip].append(datetime.now(timezone.utc).timestamp())


def _clear_failures(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    _failed_attempts.pop(ip, None)


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=email,
        hashed_password=hash_password(payload.password),
        plan="trial",
        trial_ends_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db.add(user)
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
        await send_reset_email(user.email, reset_url)
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

    user.hashed_password = hash_password(payload.password)
    reset.used = True
    db.commit()
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
