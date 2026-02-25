from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .email import send_share_email, log_email_send
from .models import Policy, User
from .models_features import PolicyShare
from .audit_helper import log_action
from .schemas import ShareCreate, ShareOut, BulkShareCreate, BulkShareResult

router = APIRouter(tags=["sharing"])


@router.post("/policies/share-bulk", response_model=BulkShareResult)
def bulk_share(payload: BulkShareCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    payload.shared_with_email = payload.shared_with_email.strip().lower()
    if payload.shared_with_email == user.email:
        raise HTTPException(status_code=400, detail="Cannot share with yourself")

    if not payload.policy_ids:
        raise HTTPException(status_code=400, detail="No policies selected")

    # Batch-validate all policy_ids belong to current user
    owned = db.execute(
        select(Policy.id).where(Policy.id.in_(payload.policy_ids), Policy.user_id == user.id)
    ).scalars().all()
    owned_set = set(owned)
    invalid = [pid for pid in payload.policy_ids if pid not in owned_set]
    if invalid:
        raise HTTPException(status_code=404, detail=f"Policies not found: {invalid}")

    # Batch-query existing shares to skip duplicates
    existing = db.execute(
        select(PolicyShare.policy_id)
        .where(PolicyShare.policy_id.in_(payload.policy_ids))
        .where(PolicyShare.shared_with_email == payload.shared_with_email)
    ).scalars().all()
    existing_set = set(existing)

    created = 0
    for pid in payload.policy_ids:
        if pid in existing_set:
            continue
        share = PolicyShare(
            policy_id=pid,
            owner_id=user.id,
            shared_with_email=payload.shared_with_email,
            permission=payload.permission,
            role_label=payload.role_label,
            expires_at=payload.expires_at,
        )
        db.add(share)
        created += 1

    db.commit()

    log_action(db, user.id, "bulk_share", "policy_share", 0,
               f"Shared {created} policies with {payload.shared_with_email}")
    db.commit()

    if created > 0:
        background_tasks.add_task(
            send_share_email, payload.shared_with_email, user.email, created, payload.permission,
        )
        subject = f"{user.email} shared insurance coverage with you on Covrabl"
        log_email_send(db, payload.shared_with_email, "share_notification", subject)
        db.commit()

    return BulkShareResult(created=created, skipped=len(existing_set), total=len(payload.policy_ids))


@router.post("/policies/{policy_id}/share", response_model=ShareOut, status_code=201)
def share_policy(policy_id: int, payload: ShareCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    payload.shared_with_email = payload.shared_with_email.strip().lower()
    # Don't share with yourself
    if payload.shared_with_email == user.email:
        raise HTTPException(status_code=400, detail="Cannot share with yourself")

    # Check for existing share
    existing = db.execute(
        select(PolicyShare)
        .where(PolicyShare.policy_id == policy_id)
        .where(PolicyShare.shared_with_email == payload.shared_with_email)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Already shared with this user")

    share = PolicyShare(
        policy_id=policy_id,
        owner_id=user.id,
        shared_with_email=payload.shared_with_email,
        permission=payload.permission,
        role_label=payload.role_label if hasattr(payload, 'role_label') else None,
        expires_at=payload.expires_at if hasattr(payload, 'expires_at') else None,
    )
    db.add(share)
    db.commit()
    db.refresh(share)

    background_tasks.add_task(
        send_share_email, payload.shared_with_email, user.email, 1, payload.permission,
    )
    subject = f"{user.email} shared insurance coverage with you on Covrabl"
    log_email_send(db, payload.shared_with_email, "share_notification", subject)
    db.commit()

    return share


@router.get("/policies/{policy_id}/shares", response_model=list[ShareOut])
def list_shares(policy_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from .access import get_policy_for_user
    get_policy_for_user(policy_id, db, user)

    rows = db.execute(
        select(PolicyShare).where(PolicyShare.policy_id == policy_id)
    ).scalars().all()
    return rows


@router.get("/policies/shared-with-me")
def shared_with_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    today = date.today()
    rows = db.execute(
        select(PolicyShare, Policy)
        .join(Policy, PolicyShare.policy_id == Policy.id)
        .where(PolicyShare.shared_with_email == user.email)
        .where(PolicyShare.accepted == True)  # noqa: E712
        .where(
            (PolicyShare.expires_at.is_(None)) | (PolicyShare.expires_at >= today)
        )
    ).all()

    return [
        {
            "share_id": s.id,
            "permission": s.permission,
            "policy": {
                "id": p.id,
                "user_id": p.user_id,
                "scope": p.scope,
                "policy_type": p.policy_type,
                "carrier": p.carrier,
                "policy_number": p.policy_number,
                "nickname": p.nickname,
                "coverage_amount": p.coverage_amount,
                "deductible": p.deductible,
                "renewal_date": str(p.renewal_date) if p.renewal_date else None,
                "created_at": str(p.created_at),
            },
        }
        for s, p in rows
    ]


@router.get("/shares/pending")
def pending_shares(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    today = date.today()
    rows = db.execute(
        select(PolicyShare, Policy)
        .join(Policy, PolicyShare.policy_id == Policy.id)
        .where(PolicyShare.shared_with_email == user.email)
        .where(PolicyShare.accepted == False)  # noqa: E712
        .where(
            (PolicyShare.expires_at.is_(None)) | (PolicyShare.expires_at >= today)
        )
    ).all()

    return [
        {
            "share_id": s.id,
            "permission": s.permission,
            "owner_id": s.owner_id,
            "policy": {
                "id": p.id,
                "carrier": p.carrier,
                "policy_type": p.policy_type,
                "nickname": p.nickname,
            },
        }
        for s, p in rows
    ]


@router.put("/shares/{share_id}/accept")
def accept_share(share_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    share = db.get(PolicyShare, share_id)
    if not share or share.shared_with_email != user.email:
        raise HTTPException(status_code=404, detail="Share not found")

    share.accepted = True
    db.commit()
    return {"ok": True}


@router.delete("/shares/{share_id}")
def revoke_share(share_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    share = db.get(PolicyShare, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    # Owner or shared-with user can revoke
    if share.owner_id != user.id and share.shared_with_email != user.email:
        raise HTTPException(status_code=404, detail="Share not found")

    db.delete(share)
    db.commit()
    return {"ok": True}
