"""Shared policy access helpers — ownership + share checks."""

from datetime import date
from typing import Tuple, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Policy, User
from .models_features import PolicyShare


def get_policy_for_user(policy_id: int, db: Session, user: User) -> Policy:
    """Return the policy if the user owns it OR has an accepted, non-expired share."""
    policy, _ = get_policy_with_permission(policy_id, db, user)
    return policy


def get_policy_with_permission(policy_id: int, db: Session, user: User) -> Tuple[Policy, Optional[str]]:
    """Return (policy, permission) — permission is None for owner, 'view'/'edit' for shared users."""
    policy = db.get(Policy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    # Owner access
    if policy.user_id == user.id:
        return policy, None  # None = owner (full access)

    # Shared access
    today = date.today()
    share = db.execute(
        select(PolicyShare)
        .where(PolicyShare.policy_id == policy_id)
        .where(PolicyShare.shared_with_email == user.email)
        .where(PolicyShare.accepted == True)  # noqa: E712
        .where(
            (PolicyShare.expires_at.is_(None)) | (PolicyShare.expires_at >= today)
        )
    ).scalar_one_or_none()
    if share:
        return policy, share.permission  # 'view' or 'edit'

    raise HTTPException(status_code=404, detail="Policy not found")
