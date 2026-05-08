"""TOTP-based two-factor authentication helpers.

Schema fields on User:
  mfa_enabled (bool)
  mfa_secret (str | None)              — base32-encoded TOTP secret
  mfa_recovery_codes (str | None)      — JSON array of bcrypt hashes (10 codes)
  mfa_enrolled_at (datetime | None)

Login flow when MFA is enabled:
  1. POST /auth/login with email+password -> { mfa_required: True, mfa_token: <jti> }
  2. POST /auth/login/mfa with { mfa_token, code } -> { access_token: <jwt> }
  mfa_token is a short-lived (5 min) JWT with claim mfa_pending=True; cannot
  be used as a regular access token.
"""

import json
import secrets
import time
from datetime import datetime, timedelta, timezone

import pyotp
from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import settings
from .models import User

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=10)

# Short-lived MFA challenge token TTL (the user has 5 minutes after entering
# their password to enter their TOTP code before the challenge expires).
MFA_CHALLENGE_TTL_SECONDS = 300


def generate_secret() -> str:
    """Generate a fresh base32 TOTP secret (160 bits)."""
    return pyotp.random_base32()


def otpauth_uri(secret: str, account_email: str, issuer: str = "Covrabl") -> str:
    """Build the otpauth:// URI that authenticator apps consume via QR scan."""
    return pyotp.totp.TOTP(secret).provisioning_uri(name=account_email, issuer_name=issuer)


def verify_totp(secret: str, code: str, *, window: int = 1) -> bool:
    """Check a 6-digit code against the secret. Window=1 allows a 30s clock drift."""
    if not secret or not code:
        return False
    try:
        code = code.strip().replace(" ", "")
        if not code.isdigit() or len(code) != 6:
            return False
        return pyotp.TOTP(secret).verify(code, valid_window=window)
    except Exception:
        return False


def generate_recovery_codes(count: int = 10) -> list[str]:
    """Generate plaintext one-time recovery codes (shown to user once)."""
    # Format: "XXXX-XXXX-XXXX" — 12 alphanumeric chars in 4-char groups.
    out: list[str] = []
    alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # avoid 0/O/1/I confusion
    for _ in range(count):
        chars = [secrets.choice(alphabet) for _ in range(12)]
        out.append("-".join(["".join(chars[0:4]), "".join(chars[4:8]), "".join(chars[8:12])]))
    return out


def hash_recovery_codes(codes: list[str]) -> str:
    """Return a JSON list of bcrypt hashes for storage in mfa_recovery_codes."""
    return json.dumps([_pwd.hash(c) for c in codes])


def consume_recovery_code(stored_json: str | None, supplied: str) -> tuple[bool, str | None]:
    """Check if `supplied` matches one of the stored recovery code hashes.
    If yes: return (True, new_json_with_used_one_removed).
    If no:  return (False, None).
    """
    if not stored_json or not supplied:
        return False, None
    supplied = supplied.strip().upper().replace(" ", "")
    try:
        hashes = json.loads(stored_json)
    except Exception:
        return False, None
    if not isinstance(hashes, list):
        return False, None
    for i, h in enumerate(hashes):
        try:
            if _pwd.verify(supplied, h):
                remaining = hashes[:i] + hashes[i + 1:]
                return True, json.dumps(remaining)
        except Exception:
            continue
    return False, None


def issue_mfa_challenge_token(user_id: int) -> str:
    """Short-lived JWT proving the user passed password but still owes TOTP."""
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "mfa_pending": True,
        "iat": now,
        "exp": now + MFA_CHALLENGE_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.jwt_key, algorithm=settings.jwt_algorithm)


def decode_mfa_challenge_token(token: str) -> int | None:
    """Return user_id if the token is a valid challenge token, else None."""
    try:
        payload = jwt.decode(token, settings.jwt_key, algorithms=[settings.jwt_algorithm])
        if not payload.get("mfa_pending"):
            return None
        return int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None
