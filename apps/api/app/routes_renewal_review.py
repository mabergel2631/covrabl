"""Public read-only access to renewal reviews via share token."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Policy, User
from .models_features import PolicyDelta, RenewalReview
from .models_profile import UserProfile

router = APIRouter(prefix="/renewal-review", tags=["renewal-review-public"])


def _serialize_policy_brief(p: Policy | None) -> dict | None:
    if not p:
        return None
    return {
        "carrier": p.carrier,
        "policy_type": p.policy_type,
        "policy_number": p.policy_number,
        "renewal_date": str(p.renewal_date) if p.renewal_date else None,
        "premium_amount": p.premium_amount,
        "coverage_amount": p.coverage_amount,
        "deductible": p.deductible,
    }


@router.get("/public/{token}")
def public_renewal_review(token: str, db: Session = Depends(get_db)):
    """Return the renewal review for a public share token. Read-only."""
    if not token or len(token) < 10:
        raise HTTPException(status_code=404, detail="Not found")

    review = db.execute(
        select(RenewalReview).where(RenewalReview.share_token == token)
    ).scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="Not found")

    policy = db.get(Policy, review.policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Not found")

    previous_policy = None
    if policy.replaces_policy_id:
        previous_policy = db.get(Policy, policy.replaces_policy_id)

    deltas = db.execute(
        select(PolicyDelta)
        .where(PolicyDelta.policy_id == policy.id)
        .order_by(PolicyDelta.created_at.asc())
    ).scalars().all()

    agent = db.get(User, review.agent_id)
    agent_profile = None
    if agent:
        agent_profile = db.execute(
            select(UserProfile.full_name).where(UserProfile.user_id == agent.id)
        ).scalar()

    return {
        "policy": _serialize_policy_brief(policy),
        "previous_policy": _serialize_policy_brief(previous_policy),
        "deltas": [
            {
                "field_key": d.field_key,
                "old_value": d.old_value,
                "new_value": d.new_value,
                "delta_type": d.delta_type,
                "severity": d.severity,
            }
            for d in deltas
        ],
        "summary_text": review.summary_text,
        "shared_at": review.shared_at.isoformat() if review.shared_at else None,
        "agent": {
            "name": agent_profile or (agent.email if agent else None),
            "email": agent.email if agent else None,
        },
    }
