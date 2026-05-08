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


def get_policy_for_user_or_agent(policy_id: int, db: Session, user: User) -> Policy:
    """Like get_policy_for_user, but ALSO allows access for agents who have an
    active AgentClient relationship with the policy's owner (directly OR via
    the same agency). Used by extract/confirm endpoints so agents can manage
    their clients' policies, not just their own.
    """
    from sqlalchemy import or_
    from .models_agent import AgentClient
    from .models_agency import AgencyMember

    # Try the standard owner-or-share path first
    policy = db.get(Policy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    if policy.user_id == user.id:
        return policy

    # Shared access (consumer-side share)
    today = date.today()
    share = db.execute(
        select(PolicyShare)
        .where(PolicyShare.policy_id == policy_id)
        .where(PolicyShare.shared_with_email == user.email)
        .where(PolicyShare.accepted == True)  # noqa: E712
        .where((PolicyShare.expires_at.is_(None)) | (PolicyShare.expires_at >= today))
    ).scalar_one_or_none()
    if share:
        return policy

    # Agent / admin access via AgentClient
    if user.role in ("agent", "admin"):
        # Find the caller's agency (if any)
        my_agency = db.execute(
            select(AgencyMember.agency_id)
            .where(AgencyMember.user_id == user.id)
            .where(AgencyMember.status == "active")
            .limit(1)
        ).scalar_one_or_none()

        rel_query = select(AgentClient).where(
            AgentClient.client_id == policy.user_id,
            AgentClient.status == "active",
        )
        if my_agency is not None:
            rel_query = rel_query.where(
                or_(
                    AgentClient.agent_id == user.id,
                    AgentClient.agency_id == my_agency,
                )
            )
        else:
            rel_query = rel_query.where(AgentClient.agent_id == user.id)

        if user.role == "admin":
            # Admin bypasses agency scoping
            rel_query = select(AgentClient).where(
                AgentClient.client_id == policy.user_id,
                AgentClient.status == "active",
            )

        rel = db.execute(rel_query).first()
        if rel:
            return policy

    raise HTTPException(status_code=404, detail="Policy not found")


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
