from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, cast, Date
from sqlalchemy.orm import Session

from .auth import require_admin
from .db import get_db
from .models import User, Policy
from .models_documents import Document
from .models_features import PolicyDraft, AuditLog

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats")
def admin_stats(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    total_users = db.execute(select(func.count(User.id))).scalar() or 0

    week_ago = datetime.utcnow() - timedelta(days=7)
    recent_signups = db.execute(
        select(func.count(User.id)).where(User.created_at >= week_ago)
    ).scalar() or 0

    # Plan breakdown
    plan_rows = db.execute(
        select(User.plan, func.count(User.id)).group_by(User.plan)
    ).all()
    plans = {row[0] or "trial": row[1] for row in plan_rows}

    total_policies = db.execute(select(func.count(Policy.id))).scalar() or 0

    pending_drafts = db.execute(
        select(func.count(PolicyDraft.id)).where(PolicyDraft.status == "pending")
    ).scalar() or 0

    return {
        "total_users": total_users,
        "recent_signups": recent_signups,
        "plans": plans,
        "total_policies": total_policies,
        "pending_drafts": pending_drafts,
    }


@router.get("/users")
def admin_users(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    search: str = Query("", max_length=200),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = select(User)
    if search:
        q = q.where(User.email.ilike(f"%{search}%"))
    total = db.execute(
        select(func.count()).select_from(q.subquery())
    ).scalar() or 0

    users = db.execute(
        q.order_by(User.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).scalars().all()

    user_ids = [u.id for u in users]
    # Batch policy counts
    policy_counts: dict[int, int] = {}
    if user_ids:
        rows = db.execute(
            select(Policy.user_id, func.count(Policy.id))
            .where(Policy.user_id.in_(user_ids))
            .group_by(Policy.user_id)
        ).all()
        policy_counts = {row[0]: row[1] for row in rows}

    items = []
    for u in users:
        items.append({
            "id": u.id,
            "email": u.email,
            "role": u.role or "individual",
            "plan": u.plan or "trial",
            "policy_count": policy_counts.get(u.id, 0),
            "created_at": str(u.created_at) if u.created_at else None,
        })

    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/users/{user_id}")
def admin_user_detail(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    policies = db.execute(
        select(Policy)
        .where(Policy.user_id == user_id)
        .order_by(Policy.created_at.desc())
        .limit(20)
    ).scalars().all()

    recent_docs = db.execute(
        select(Document)
        .join(Policy, Document.policy_id == Policy.id)
        .where(Policy.user_id == user_id)
        .order_by(Document.created_at.desc())
        .limit(10)
    ).scalars().all()

    drafts = db.execute(
        select(PolicyDraft)
        .where(PolicyDraft.user_id == user_id)
        .order_by(PolicyDraft.created_at.desc())
        .limit(10)
    ).scalars().all()

    return {
        "id": user.id,
        "email": user.email,
        "role": user.role or "individual",
        "plan": user.plan or "trial",
        "created_at": str(user.created_at) if user.created_at else None,
        "policies": [
            {
                "id": p.id,
                "carrier": p.carrier,
                "policy_type": p.policy_type,
                "policy_number": p.policy_number,
                "status": p.status or "active",
                "created_at": str(p.created_at) if p.created_at else None,
            }
            for p in policies
        ],
        "recent_documents": [
            {
                "id": d.id,
                "filename": d.filename,
                "doc_type": d.doc_type,
                "created_at": str(d.created_at) if d.created_at else None,
            }
            for d in recent_docs
        ],
        "drafts": [
            {
                "id": dr.id,
                "carrier": dr.carrier,
                "policy_number": dr.policy_number,
                "policy_type": dr.policy_type,
                "original_filename": dr.original_filename,
                "status": dr.status,
                "created_at": str(dr.created_at) if dr.created_at else None,
            }
            for dr in drafts
        ],
    }


@router.get("/recent-activity")
def admin_recent_activity(
    limit: int = Query(30, ge=1, le=100),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    # Recent document uploads
    docs = db.execute(
        select(Document, Policy.user_id)
        .join(Policy, Document.policy_id == Policy.id)
        .order_by(Document.created_at.desc())
        .limit(limit)
    ).all()

    # Gather user emails for the docs
    doc_user_ids = list({row[1] for row in docs})
    user_map: dict[int, str] = {}
    if doc_user_ids:
        user_rows = db.execute(
            select(User.id, User.email).where(User.id.in_(doc_user_ids))
        ).all()
        user_map = {r[0]: r[1] for r in user_rows}

    # Recent drafts
    drafts = db.execute(
        select(PolicyDraft)
        .order_by(PolicyDraft.created_at.desc())
        .limit(limit)
    ).scalars().all()

    draft_user_ids = list({dr.user_id for dr in drafts})
    if draft_user_ids:
        extra = db.execute(
            select(User.id, User.email).where(User.id.in_(draft_user_ids))
        ).all()
        for r in extra:
            user_map[r[0]] = r[1]

    activity = []
    for doc, uid in docs:
        activity.append({
            "type": "upload",
            "user_email": user_map.get(uid, "unknown"),
            "filename": doc.filename,
            "doc_type": doc.doc_type,
            "created_at": str(doc.created_at) if doc.created_at else None,
        })
    for dr in drafts:
        activity.append({
            "type": "draft",
            "user_email": user_map.get(dr.user_id, "unknown"),
            "carrier": dr.carrier,
            "policy_type": dr.policy_type,
            "original_filename": dr.original_filename,
            "status": dr.status,
            "created_at": str(dr.created_at) if dr.created_at else None,
        })

    activity.sort(key=lambda a: a.get("created_at") or "", reverse=True)
    return activity[:limit]


@router.get("/signups")
def admin_signups(
    days: int = Query(30, ge=1, le=365),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    since = datetime.utcnow() - timedelta(days=days)
    rows = db.execute(
        select(
            cast(User.created_at, Date).label("day"),
            func.count(User.id),
        )
        .where(User.created_at >= since)
        .group_by("day")
        .order_by("day")
    ).all()

    return [{"date": str(row[0]), "count": row[1]} for row in rows]
