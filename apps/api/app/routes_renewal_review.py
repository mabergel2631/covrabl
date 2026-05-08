"""Public read-only access to renewal reviews via share token."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Policy, User
from .models_features import PolicyDelta, RenewalReview, QuoteComparison
from .models_profile import UserProfile

router = APIRouter(prefix="/renewal-review", tags=["renewal-review-public"])
quote_router = APIRouter(prefix="/quote-comparison", tags=["quote-comparison-public"])


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

    delta_list = [
        {
            "field_key": d.field_key,
            "old_value": d.old_value,
            "new_value": d.new_value,
            "delta_type": d.delta_type,
            "severity": d.severity,
        }
        for d in deltas
    ]

    # Reuse the same observational rule engine so the public page surfaces
    # the same "items to discuss" the agent saw before sharing — but filter
    # out anything the agent dismissed before generating the share link.
    import json as _json
    from .coverage_review_rules import compute_discussion_items
    policy_brief = _serialize_policy_brief(policy)
    previous_brief = _serialize_policy_brief(previous_policy)
    raw_items = compute_discussion_items(policy_brief, previous_brief, delta_list)

    dismissed_set: set[str] = set()
    if review.dismissed_items_json:
        try:
            parsed = _json.loads(review.dismissed_items_json)
            if isinstance(parsed, list):
                dismissed_set = {str(h) for h in parsed}
        except Exception:
            dismissed_set = set()

    import hashlib
    public_items: list[dict] = []
    for text in raw_items:
        h = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        if h in dismissed_set:
            continue
        public_items.append({"text": text, "hash": h, "dismissed": False})

    return {
        "policy": policy_brief,
        "previous_policy": previous_brief,
        "deltas": delta_list,
        "summary_text": review.summary_text,
        "shared_at": review.shared_at.isoformat() if review.shared_at else None,
        "discussion_items": public_items,
        "agent": {
            "name": agent_profile or (agent.email if agent else None),
            "email": agent.email if agent else None,
        },
    }


@quote_router.get("/public/{token}")
def public_quote_comparison(token: str, db: Session = Depends(get_db)):
    """Public read-only quote comparison via share token."""
    if not token or len(token) < 10:
        raise HTTPException(status_code=404, detail="Not found")

    comparison = db.execute(
        select(QuoteComparison).where(QuoteComparison.share_token == token)
    ).scalar_one_or_none()
    if not comparison:
        raise HTTPException(status_code=404, detail="Not found")

    incumbent = db.get(Policy, comparison.incumbent_policy_id)
    quote = db.get(Policy, comparison.quote_policy_id)
    if not incumbent or not quote:
        raise HTTPException(status_code=404, detail="Not found")

    incumbent_brief = _serialize_policy_brief(incumbent)
    quote_brief = _serialize_policy_brief(quote)

    # Build deltas the same way the agent endpoint does — quote vs incumbent.
    # Reuse the shared helpers from routes_agent so the wording stays in lockstep.
    from .routes_agent import _compute_quote_deltas, _build_discussion_items
    delta_list = _compute_quote_deltas(db, incumbent, quote)

    review_shim = type("RR", (), {
        "dismissed_items_json": comparison.dismissed_items_json,
    })()
    discussion_items = _build_discussion_items(
        quote, incumbent_brief, delta_list, review_shim, public=True,
    )

    agent = db.get(User, comparison.agent_id)
    agent_profile = None
    if agent:
        agent_profile = db.execute(
            select(UserProfile.full_name).where(UserProfile.user_id == agent.id)
        ).scalar()

    return {
        "incumbent_policy": incumbent_brief,
        "quote_policy": quote_brief,
        "deltas": delta_list,
        "summary_text": comparison.summary_text,
        "shared_at": comparison.shared_at.isoformat() if comparison.shared_at else None,
        "discussion_items": discussion_items,
        "agent": {
            "name": agent_profile or (agent.email if agent else None),
            "email": agent.email if agent else None,
        },
    }
