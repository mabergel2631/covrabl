from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.orm import Session, selectinload
from typing import List, Optional
from collections import defaultdict

from .auth import get_current_user
from .db import get_db
from .models import Policy, Contact, CoverageItem, PolicyDetail, User, Exposure
from .models_features import Premium, PolicyShare, Certificate, Claim, RenewalReminder, PremiumHistory, PolicyDelta, DismissedRecommendation
from .schemas import PolicyCreate, PolicyUpdate, PolicyOut, BusinessGroupRename, BusinessGroupDelete
from .audit_helper import log_action
from .routes_reminders import ensure_reminders
from .access import get_policy_for_user
from datetime import datetime, timedelta, timezone
from .routes_billing import check_feature

router = APIRouter(prefix="/policies", tags=["policies"])


def _delete_policy_cascade(db: Session, policy_id: int):
    """Delete all FK-dependent records for a policy, then the policy itself.

    The live DB may lack CASCADE constraints even though models declare them,
    so we manually clean up every related table.
    """
    from .models_documents import Document

    # Tables with FK to policies.id (order doesn't matter since we delete policy last)
    for Model in (Document, Premium, Claim, RenewalReminder, PolicyShare,
                  PremiumHistory, PolicyDelta, Certificate):
        for row in db.execute(select(Model).where(Model.policy_id == policy_id)).scalars().all():
            db.delete(row)

    # Cascade-delete lease requirements and their compliance checks
    from .models_features import LeaseRequirement, ComplianceCheck
    lease_reqs = db.execute(select(LeaseRequirement).where(LeaseRequirement.policy_id == policy_id)).scalars().all()
    for lr in lease_reqs:
        for cc in db.execute(select(ComplianceCheck).where(ComplianceCheck.lease_requirement_id == lr.id)).scalars().all():
            db.delete(cc)
        db.delete(lr)

    # Child tables on Policy ORM relationships (contacts, details, coverage_items)
    for Model in (Contact, CoverageItem, PolicyDetail):
        for row in db.execute(select(Model).where(Model.policy_id == policy_id)).scalars().all():
            db.delete(row)

    policy = db.get(Policy, policy_id)
    if policy:
        db.delete(policy)


@router.get("")
def list_policies(status: Optional[str] = Query(None), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Eager load contacts, details, and exposure in a single query
    query = select(Policy).where(Policy.user_id == user.id).where(Policy.carrier != "Pending extraction...")
    if status:
        query = query.where(Policy.status == status)
    policies = db.execute(
        query
        .options(
            selectinload(Policy.contacts),
            selectinload(Policy.details),
            selectinload(Policy.exposure),
        )
        .order_by(Policy.id.desc())
    ).unique().scalars().all()

    # Batch load shares for all policies in one query
    policy_ids = [p.id for p in policies]
    shares_map: dict[int, list[str]] = defaultdict(list)
    if policy_ids:
        shares = db.execute(
            select(PolicyShare).where(PolicyShare.policy_id.in_(policy_ids))
        ).scalars().all()
        for s in shares:
            shares_map[s.policy_id].append(s.shared_with_email)

    # Batch load certificates (COI) for all policies in one query
    coi_map: dict[int, dict] = {}
    if policy_ids:
        certs = db.execute(
            select(Certificate).where(Certificate.policy_id.in_(policy_ids))
        ).scalars().all()
        certs_by_policy: dict[int, list] = defaultdict(list)
        for c in certs:
            certs_by_policy[c.policy_id].append(c)
        status_priority = {"active": 0, "expiring": 1, "pending": 2, "expired": 3}
        for pid, cert_list in certs_by_policy.items():
            best = min(cert_list, key=lambda c: status_priority.get(c.status, 99))
            coi_map[pid] = {"status": best.status, "count": len(cert_list)}

    result = []
    for p in policies:
        key_contacts = {}
        for c in p.contacts:
            if c.role in ("claims", "broker", "agent") and c.role not in key_contacts:
                key_contacts[c.role] = {
                    "name": c.name,
                    "company": c.company,
                    "phone": c.phone,
                    "email": c.email,
                }

        key_details = {d.field_name: d.field_value for d in p.details}

        result.append({
            "id": p.id,
            "user_id": p.user_id,
            "scope": p.scope,
            "policy_type": p.policy_type,
            "carrier": p.carrier,
            "policy_number": p.policy_number,
            "nickname": p.nickname,
            "business_name": p.business_name,
            "coverage_amount": p.coverage_amount,
            "deductible": p.deductible,
            "premium_amount": p.premium_amount,
            "renewal_date": str(p.renewal_date) if p.renewal_date else None,
            "created_at": str(p.created_at),
            "key_contacts": key_contacts,
            "key_details": key_details,
            "shared_with": shares_map.get(p.id, []),
            "exposure_id": p.exposure_id,
            "exposure_name": p.exposure.name if p.exposure else None,
            "status": p.status or "active",
            # Health-specific
            "plan_subtype": p.plan_subtype,
            "out_of_pocket_max": p.out_of_pocket_max,
            "family_deductible": p.family_deductible,
            "family_oop_max": p.family_oop_max,
            # Deductible tracking
            "deductible_type": p.deductible_type,
            "deductible_period_start": str(p.deductible_period_start) if p.deductible_period_start else None,
            "deductible_applied": p.deductible_applied,
            # COI summary (only present when certificates exist)
            "coi_summary": coi_map.get(p.id),
            # Version chain
            "replaces_policy_id": p.replaces_policy_id,
        })

    return result


@router.get("/business-names")
def list_business_names(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "business_grouping")
    from sqlalchemy import distinct
    names = db.execute(
        select(distinct(Policy.business_name))
        .where(Policy.user_id == user.id)
        .where(Policy.business_name.isnot(None))
        .where(Policy.business_name != "")
        .where(Policy.status != "archived")
        .where(Policy.carrier != "Pending extraction...")
    ).scalars().all()
    return sorted(names)


@router.put("/business-names/rename")
def rename_business_group(payload: BusinessGroupRename, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "business_grouping")
    old_val = payload.old_name if payload.old_name else None
    new_val = payload.new_name if payload.new_name else None

    if old_val is None:
        # Ungrouped: match NULL or empty string
        policies = db.execute(
            select(Policy).where(
                Policy.user_id == user.id,
                (Policy.business_name.is_(None)) | (Policy.business_name == ""),
            )
        ).scalars().all()
    else:
        policies = db.execute(
            select(Policy).where(Policy.user_id == user.id, Policy.business_name == old_val)
        ).scalars().all()

    for p in policies:
        p.business_name = new_val

    log_action(db, user.id, "renamed_business_group", "policy", 0,
               details=f"{payload.old_name or '(ungrouped)'} -> {payload.new_name or '(ungrouped)'}")
    db.commit()
    return {"ok": True, "updated": len(policies)}


@router.get("/business-names/{name}/stats")
def business_group_stats(name: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "business_grouping")
    policies = db.execute(
        select(Policy).where(
            Policy.user_id == user.id,
            Policy.business_name == name,
            Policy.carrier != "Pending extraction...",
        )
    ).scalars().all()
    policy_ids = [p.id for p in policies]
    cert_count = 0
    if policy_ids:
        cert_count = len(db.execute(
            select(Certificate).where(Certificate.policy_id.in_(policy_ids))
        ).scalars().all())
    return {"policy_count": len(policies), "certificate_count": cert_count}


@router.delete("/business-names/delete")
def delete_business_group(payload: BusinessGroupDelete, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "business_grouping")
    policies = db.execute(
        select(Policy).where(Policy.user_id == user.id, Policy.business_name == payload.name)
    ).scalars().all()
    if not policies:
        raise HTTPException(status_code=404, detail="No policies found in this group")

    count = len(policies)
    for p in policies:
        _delete_policy_cascade(db, p.id)

    log_action(db, user.id, "deleted_business_group", "policy", 0,
               details=f"Deleted group '{payload.name}': {count} policies")
    db.commit()
    return {"ok": True, "policies_deleted": count}


@router.get("/active-by-type")
def active_by_type(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    policies = db.execute(
        select(Policy).where(
            Policy.user_id == user.id,
            Policy.status == "active",
            Policy.carrier != "Pending extraction...",
        )
    ).scalars().all()
    return [{"id": p.id, "carrier": p.carrier, "policy_type": p.policy_type,
             "policy_number": p.policy_number, "nickname": p.nickname,
             "scope": p.scope} for p in policies]


@router.delete("/cleanup-drafts")
def cleanup_drafts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    stale = db.execute(
        select(Policy).where(
            Policy.user_id == user.id,
            Policy.carrier == "Pending extraction...",
            Policy.created_at < cutoff,
        )
    ).scalars().all()
    for p in stale:
        _delete_policy_cascade(db, p.id)
    db.commit()
    return {"cleaned": len(stale)}


@router.get("/compare")
def compare_policies(ids: str = Query(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        id_list = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ids format")

    if len(id_list) < 2 or len(id_list) > 4:
        raise HTTPException(status_code=400, detail="Provide 2-4 policy ids")

    # Eager-load all requested policies with relationships in one query
    policies = db.execute(
        select(Policy).where(Policy.id.in_(id_list), Policy.user_id == user.id)
        .options(
            selectinload(Policy.contacts),
            selectinload(Policy.coverage_items),
            selectinload(Policy.details),
        )
    ).unique().scalars().all()

    policy_map = {p.id: p for p in policies}
    for pid in id_list:
        if pid not in policy_map:
            raise HTTPException(status_code=404, detail=f"Policy {pid} not found")

    # Batch-load premiums for all policies
    all_premiums = db.execute(
        select(Premium).where(Premium.policy_id.in_(id_list))
    ).scalars().all()
    premium_map: dict[int, list] = defaultdict(list)
    for p in all_premiums:
        premium_map[p.policy_id].append(p)

    bundles = []
    for pid in id_list:
        policy = policy_map[pid]
        premiums = premium_map.get(pid, [])

        bundles.append({
            "policy": {
                "id": policy.id, "scope": policy.scope, "policy_type": policy.policy_type,
                "carrier": policy.carrier, "policy_number": policy.policy_number,
                "nickname": policy.nickname, "business_name": policy.business_name, "coverage_amount": policy.coverage_amount,
                "deductible": policy.deductible,
                "renewal_date": str(policy.renewal_date) if policy.renewal_date else None,
            },
            "contacts": [{"id": c.id, "role": c.role, "name": c.name, "company": c.company, "phone": c.phone, "email": c.email} for c in policy.contacts],
            "coverage_items": [{"id": ci.id, "item_type": ci.item_type, "description": ci.description, "limit": ci.limit} for ci in policy.coverage_items],
            "details": [{"id": d.id, "field_name": d.field_name, "field_value": d.field_value} for d in policy.details],
            "premiums": [{"id": p.id, "amount": p.amount, "frequency": p.frequency, "due_date": str(p.due_date), "paid_date": str(p.paid_date) if p.paid_date else None} for p in premiums],
        })

    return bundles


@router.post("", response_model=PolicyOut, status_code=201)
def create_policy(payload: PolicyCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # TEMPORARILY DISABLED — all limits open until public launch
    # from .routes_billing import get_policy_limit, get_effective_plan
    # limit = get_policy_limit(user)
    # active_count = db.execute(
    #     select(Policy).where(Policy.user_id == user.id, Policy.status == "active")
    # ).scalars().all()
    # if len(active_count) >= limit:
    #     plan = get_effective_plan(user)
    #     raise HTTPException(
    #         status_code=403,
    #         detail=f"Your {plan} plan allows up to {limit} active policies. Upgrade to add more.",
    #     )

    policy = Policy(**payload.model_dump(), user_id=user.id)
    db.add(policy)
    db.flush()
    log_action(db, user.id, "created", "policy", policy.id)
    if policy.renewal_date:
        ensure_reminders(policy.id, policy.renewal_date, db)
    # Auto-archive the replaced policy and reset dismissed recommendations
    if payload.replaces_policy_id:
        old = db.execute(
            select(Policy).where(
                Policy.id == payload.replaces_policy_id,
                Policy.user_id == user.id
            )
        ).scalar_one_or_none()
        if old:
            old.status = "archived"
            log_action(db, user.id, "archived", "policy", old.id)
            # Reset dismissed recommendations for this scope so user gets a fresh look
            renewal_scope = policy.scope or old.scope  # "personal" or "business"
            if renewal_scope:
                db.execute(
                    sa_delete(DismissedRecommendation).where(
                        DismissedRecommendation.user_id == user.id,
                        DismissedRecommendation.scope == renewal_scope,
                    )
                )
    db.commit()
    db.refresh(policy)
    return policy


@router.get("/{policy_id}")
def get_policy(policy_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from .access import get_policy_with_permission
    policy, permission = get_policy_with_permission(policy_id, db, user)
    out = PolicyOut.model_validate(policy)
    result = out.model_dump()
    # permission: null = owner (full access), "view" or "edit" = shared access
    result["permission"] = permission
    return result


@router.get("/{policy_id}/versions")
def policy_versions(policy_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    # Walk backward to find the oldest ancestor
    current = policy
    while current.replaces_policy_id:
        prev = db.get(Policy, current.replaces_policy_id)
        if not prev or prev.user_id != user.id:
            break
        current = prev

    # Walk forward from oldest, collecting the chain
    chain = [current]
    visited = {current.id}
    while True:
        successors = db.execute(
            select(Policy).where(
                Policy.replaces_policy_id == current.id,
                Policy.user_id == user.id
            )
        ).scalars().all()
        next_policy = None
        for s in successors:
            if s.id not in visited:
                next_policy = s
                break
        if not next_policy:
            break
        chain.append(next_policy)
        visited.add(next_policy.id)
        current = next_policy

    if len(chain) <= 1:
        return []

    return [{
        "id": p.id,
        "carrier": p.carrier,
        "policy_type": p.policy_type,
        "policy_number": p.policy_number,
        "nickname": p.nickname,
        "status": p.status or "active",
        "renewal_date": str(p.renewal_date) if p.renewal_date else None,
        "created_at": str(p.created_at),
        "replaces_policy_id": p.replaces_policy_id,
    } for p in chain]


@router.put("/{policy_id}", response_model=PolicyOut)
def update_policy(policy_id: int, payload: PolicyUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    old_renewal = policy.renewal_date
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(policy, field, value)

    log_action(db, user.id, "updated", "policy", policy.id)

    if policy.renewal_date != old_renewal:
        ensure_reminders(policy.id, policy.renewal_date, db)

    db.commit()
    db.refresh(policy)
    return policy


@router.delete("/{policy_id}")
def delete_policy(policy_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")
    log_action(db, user.id, "deleted", "policy", policy.id)
    _delete_policy_cascade(db, policy_id)
    db.commit()
    return {"ok": True}
