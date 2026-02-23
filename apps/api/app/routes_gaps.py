"""
Gap Analysis API routes.
Analyzes user's policies and identifies coverage gaps.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .auth import get_current_user
from .db import get_db
from .models import Policy, Contact, User
from .models_profile import UserProfile
from .coverage_taxonomy import analyze_coverage_gaps, get_coverage_summary

router = APIRouter(prefix="/gaps", tags=["gap-analysis"])


def _build_user_context(db: Session, user_id: int) -> dict:
    """Load context flags from user profile for gap analysis."""
    profile = db.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    ).scalar_one_or_none()
    if not profile:
        return {}
    return {
        "is_homeowner": profile.is_homeowner,
        "is_renter": profile.is_renter,
        "has_dependents": profile.has_dependents,
        "has_vehicle": profile.has_vehicle,
        "owns_business": profile.owns_business,
        "high_net_worth": profile.high_net_worth,
    }


@router.get("")
def get_gap_analysis(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    Analyze the user's policies and return identified coverage gaps.
    """
    policies = db.execute(
        select(Policy).where(Policy.user_id == user.id)
        .options(selectinload(Policy.contacts), selectinload(Policy.details))
    ).unique().scalars().all()

    policy_data = _serialize_policies(policies)
    user_context = _build_user_context(db, user.id)
    gaps = analyze_coverage_gaps(policy_data, user_context)
    summary = get_coverage_summary(policy_data)

    return {
        "gaps": gaps,
        "summary": summary,
        "policy_count": len(policies)
    }


@router.get("/summary")
def get_coverage_summary_only(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    Get just the coverage summary without gap analysis.
    Lighter endpoint for dashboard widgets.
    """
    policies = db.execute(
        select(Policy).where(Policy.user_id == user.id)
    ).scalars().all()

    policy_data = [{
        "id": p.id,
        "policy_type": p.policy_type,
        "coverage_amount": p.coverage_amount,
        "premium_amount": p.premium_amount,
    } for p in policies]

    return get_coverage_summary(policy_data)


def _serialize_policies(policies: list[Policy]) -> list[dict]:
    """Serialize eagerly-loaded Policy objects to dicts for gap analysis."""
    return [{
        "id": p.id,
        "policy_type": p.policy_type,
        "carrier": p.carrier,
        "policy_number": p.policy_number,
        "coverage_amount": p.coverage_amount,
        "deductible": p.deductible,
        "premium_amount": p.premium_amount,
        "renewal_date": str(p.renewal_date) if p.renewal_date else None,
        "created_at": str(p.created_at) if p.created_at else None,
        "details": [{"field_name": d.field_name, "field_value": d.field_value} for d in p.details],
        "contacts": [{"role": c.role, "phone": c.phone, "email": c.email} for c in p.contacts],
    } for p in policies]


def _load_policies_eager(db: Session, user_id: int) -> list[Policy]:
    """Load all user policies with contacts and details eagerly."""
    return db.execute(
        select(Policy).where(Policy.user_id == user_id)
        .options(selectinload(Policy.contacts), selectinload(Policy.details))
    ).unique().scalars().all()


@router.get("/business/{business_name}")
def get_business_entity_gaps(
    business_name: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Analyze coverage gaps scoped to a single business entity (by business_name)."""
    from urllib.parse import unquote
    from .models_features import Certificate

    decoded_name = unquote(business_name)

    policies = db.execute(
        select(Policy).where(
            Policy.user_id == user.id,
            Policy.business_name == decoded_name,
        )
        .options(selectinload(Policy.contacts), selectinload(Policy.details))
    ).unique().scalars().all()

    if not policies:
        raise HTTPException(status_code=404, detail="No policies found for this business entity")

    policy_data = _serialize_policies(policies)

    policy_list = [{
        "id": p.id,
        "carrier": p.carrier,
        "policy_type": p.policy_type,
        "policy_number": p.policy_number,
        "nickname": p.nickname,
        "business_name": p.business_name,
        "coverage_amount": p.coverage_amount,
        "deductible": p.deductible,
        "premium_amount": p.premium_amount,
        "status": p.status or "active",
        "renewal_date": str(p.renewal_date) if p.renewal_date else None,
    } for p in policies]

    all_contacts = []
    for p in policies:
        for c in p.contacts:
            all_contacts.append({
                "id": c.id,
                "policy_id": c.policy_id,
                "role": c.role,
                "name": c.name,
                "company": c.company,
                "phone": c.phone,
                "email": c.email,
                "notes": c.notes,
            })

    user_context = _build_user_context(db, user.id)
    gaps = analyze_coverage_gaps(policy_data, user_context)
    summary = get_coverage_summary(policy_data)

    # Certificates linked to this entity's policies
    policy_ids = [p.id for p in policies]
    certificates = db.execute(
        select(Certificate).where(
            Certificate.user_id == user.id,
            Certificate.policy_id.in_(policy_ids),
        )
    ).scalars().all()

    cert_list = [{
        "id": cert.id,
        "policy_id": cert.policy_id,
        "direction": cert.direction,
        "counterparty_name": cert.counterparty_name,
        "counterparty_type": cert.counterparty_type,
        "carrier": cert.carrier,
        "coverage_types": cert.coverage_types,
        "coverage_amount": cert.coverage_amount,
        "status": cert.status,
        "expiration_date": str(cert.expiration_date) if cert.expiration_date else None,
    } for cert in certificates]

    return {
        "business_name": decoded_name,
        "policies": policy_list,
        "gaps": gaps,
        "summary": summary,
        "contacts": all_contacts,
        "certificates": cert_list,
    }


@router.get("/policy/{policy_id}")
def get_policy_gaps(policy_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Get gaps specific to a single policy."""
    from .access import get_policy_for_user
    get_policy_for_user(policy_id, db, user)

    policies = _load_policies_eager(db, user.id)
    policy_data = _serialize_policies(policies)
    user_context = _build_user_context(db, user.id)
    gaps = analyze_coverage_gaps(policy_data, user_context)

    policy_gaps = [
        g for g in gaps
        if g.get("policy_id") == policy_id
        or (g.get("id") and f"_{policy_id}" in str(g.get("id", "")))
    ]

    return {"gaps": policy_gaps, "policy_id": policy_id}
