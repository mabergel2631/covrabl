import json
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, select, func, cast, Date
from sqlalchemy.orm import Session

from .auth import require_admin
from .config import settings
from .db import get_db
from .email import send_reset_email, log_email_send
from .models import User, Policy, PasswordReset
from .models_features import UserEvent
from .models_documents import Document
from .models_features import PolicyDraft, AuditLog
from .models_admin import EmailLog, Announcement

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# Also create a public router for announcements (no auth)
public_router = APIRouter(tags=["announcements"])

# ── Plan pricing for MRR calculation (cents/month) ───
PLAN_MONTHLY_CENTS = {"basic": 900, "pro": 2900}


# ═══════════════════════════════════════════════════════
#  OVERVIEW
# ═══════════════════════════════════════════════════════

@router.get("/stats")
def admin_stats(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    total_users = db.execute(select(func.count(User.id))).scalar() or 0

    week_ago = datetime.utcnow() - timedelta(days=7)
    recent_signups = db.execute(
        select(func.count(User.id)).where(User.created_at >= week_ago)
    ).scalar() or 0

    plan_rows = db.execute(
        select(User.plan, func.count(User.id)).group_by(User.plan)
    ).all()
    plans = {row[0] or "trial": row[1] for row in plan_rows}

    total_policies = db.execute(select(func.count(Policy.id))).scalar() or 0

    pending_drafts = db.execute(
        select(func.count(PolicyDraft.id)).where(PolicyDraft.status == "pending")
    ).scalar() or 0

    total_documents = db.execute(select(func.count(Document.id))).scalar() or 0
    storage_estimate_mb = round(total_documents * 0.5, 1)

    # Approximate active sessions: distinct users with audit_log in last 15 min
    fifteen_min_ago = datetime.utcnow() - timedelta(minutes=15)
    active_sessions = db.execute(
        select(func.count(func.distinct(AuditLog.user_id)))
        .where(AuditLog.created_at >= fifteen_min_ago)
    ).scalar() or 0

    # MRR breakdown
    mrr_breakdown = {}
    for plan_name, price_cents in PLAN_MONTHLY_CENTS.items():
        count = plans.get(plan_name, 0)
        mrr_breakdown[plan_name] = {"count": count, "mrr_cents": count * price_cents}

    return {
        "total_users": total_users,
        "recent_signups": recent_signups,
        "plans": plans,
        "total_policies": total_policies,
        "pending_drafts": pending_drafts,
        "total_documents": total_documents,
        "storage_estimate_mb": storage_estimate_mb,
        "active_sessions_approx": active_sessions,
        "mrr_breakdown": mrr_breakdown,
    }


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


@router.get("/recent-activity")
def admin_recent_activity(
    limit: int = Query(30, ge=1, le=100),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    docs = db.execute(
        select(Document, Policy.user_id)
        .join(Policy, Document.policy_id == Policy.id)
        .order_by(Document.created_at.desc())
        .limit(limit)
    ).all()

    doc_user_ids = list({row[1] for row in docs})
    user_map: dict[int, str] = {}
    if doc_user_ids:
        user_rows = db.execute(
            select(User.id, User.email).where(User.id.in_(doc_user_ids))
        ).all()
        user_map = {r[0]: r[1] for r in user_rows}

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


# ═══════════════════════════════════════════════════════
#  USERS
# ═══════════════════════════════════════════════════════

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
            "is_suspended": bool(u.is_suspended),
            "trial_ends_at": str(u.trial_ends_at) if u.trial_ends_at else None,
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
        "is_suspended": bool(user.is_suspended),
        "trial_ends_at": str(user.trial_ends_at) if user.trial_ends_at else None,
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


# ── User management actions ──────────────────────────

class UpdateRoleRequest(BaseModel):
    role: str  # individual, agent, admin


@router.patch("/users/{user_id}/role")
def admin_update_role(
    user_id: int,
    payload: UpdateRoleRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    if payload.role not in ("individual", "agent", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = payload.role
    db.commit()
    return {"ok": True, "role": user.role}


class UpdatePlanRequest(BaseModel):
    plan: str  # trial, free, basic, pro


@router.patch("/users/{user_id}/plan")
def admin_update_plan(
    user_id: int,
    payload: UpdatePlanRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if payload.plan not in ("trial", "free", "basic", "pro"):
        raise HTTPException(status_code=400, detail="Invalid plan")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.plan = payload.plan
    db.commit()
    return {"ok": True, "plan": user.plan}


class ExtendTrialRequest(BaseModel):
    days: int


@router.patch("/users/{user_id}/extend-trial")
def admin_extend_trial(
    user_id: int,
    payload: ExtendTrialRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if payload.days < 1 or payload.days > 365:
        raise HTTPException(status_code=400, detail="Days must be between 1 and 365")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    now = datetime.now(timezone.utc)
    base = user.trial_ends_at
    if base:
        base = base.replace(tzinfo=timezone.utc) if base.tzinfo is None else base
        if base < now:
            base = now
    else:
        base = now
    user.trial_ends_at = base + timedelta(days=payload.days)
    if user.plan != "trial":
        user.plan = "trial"
    db.commit()
    return {"ok": True, "trial_ends_at": str(user.trial_ends_at)}


class SuspendRequest(BaseModel):
    suspended: bool


@router.patch("/users/{user_id}/suspend")
def admin_suspend_user(
    user_id: int,
    payload: SuspendRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot suspend yourself")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_suspended = payload.suspended
    db.commit()
    return {"ok": True, "is_suspended": user.is_suspended}


@router.post("/users/{user_id}/send-reset")
async def admin_send_reset(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    token = secrets.token_urlsafe(32)
    reset = PasswordReset(
        user_id=user.id,
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    db.add(reset)
    db.commit()

    reset_url = f"{settings.app_url}/reset-password?token={token}"
    subject = "Reset your Covrabl password"
    try:
        await send_reset_email(user.email, reset_url)
        log_email_send(db, user.email, "admin_password_reset", subject)
    except Exception as e:
        log_email_send(db, user.email, "admin_password_reset", subject, "failed", str(e))
    db.commit()

    return {"ok": True}


@router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    from .routes_auth import delete_user_cascade
    delete_user_cascade(db, user_id)
    db.commit()
    logger.info("Admin %s deleted user_id=%s", admin.email, user_id)
    return {"ok": True}


# ═══════════════════════════════════════════════════════
#  ACTIVITY (AUDIT LOGS)
# ═══════════════════════════════════════════════════════

@router.get("/audit-logs")
def admin_audit_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user_email: str = Query("", max_length=200),
    action: str = Query("", max_length=50),
    entity_type: str = Query("", max_length=50),
    date_from: str = Query("", max_length=20),
    date_to: str = Query("", max_length=20),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = select(AuditLog, User.email).join(User, AuditLog.user_id == User.id)

    if user_email:
        q = q.where(User.email.ilike(f"%{user_email}%"))
    if action:
        q = q.where(AuditLog.action == action)
    if entity_type:
        q = q.where(AuditLog.entity_type == entity_type)
    if date_from:
        q = q.where(AuditLog.created_at >= date_from)
    if date_to:
        q = q.where(AuditLog.created_at <= date_to + " 23:59:59")

    count_q = select(func.count()).select_from(q.subquery())
    total = db.execute(count_q).scalar() or 0

    rows = db.execute(
        q.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()

    items = []
    for log, email in rows:
        items.append({
            "id": log.id,
            "user_id": log.user_id,
            "user_email": email,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "details": log.details,
            "created_at": str(log.created_at) if log.created_at else None,
        })

    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/audit-logs/filters")
def admin_audit_log_filters(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    actions = [r[0] for r in db.execute(select(func.distinct(AuditLog.action))).all() if r[0]]
    entity_types = [r[0] for r in db.execute(select(func.distinct(AuditLog.entity_type))).all() if r[0]]
    return {"actions": sorted(actions), "entity_types": sorted(entity_types)}


# ═══════════════════════════════════════════════════════
#  EMAILS
# ═══════════════════════════════════════════════════════

@router.get("/emails")
def admin_emails(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    email_type: str = Query("", max_length=50),
    recipient: str = Query("", max_length=200),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = select(EmailLog)
    if email_type:
        q = q.where(EmailLog.email_type == email_type)
    if recipient:
        q = q.where(EmailLog.recipient.ilike(f"%{recipient}%"))

    total = db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0

    logs = db.execute(
        q.order_by(EmailLog.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).scalars().all()

    return {
        "items": [
            {
                "id": e.id,
                "recipient": e.recipient,
                "email_type": e.email_type,
                "subject": e.subject,
                "status": e.status,
                "error": e.error,
                "created_at": str(e.created_at) if e.created_at else None,
            }
            for e in logs
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }


# ═══════════════════════════════════════════════════════
#  DRAFTS
# ═══════════════════════════════════════════════════════

@router.get("/drafts")
def admin_drafts(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    status: str = Query("", max_length=20),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = select(PolicyDraft, User.email).join(User, PolicyDraft.user_id == User.id)
    if status:
        q = q.where(PolicyDraft.status == status)

    total = db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0

    rows = db.execute(
        q.order_by(PolicyDraft.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()

    return {
        "items": [
            {
                "id": dr.id,
                "user_id": dr.user_id,
                "user_email": email,
                "carrier": dr.carrier,
                "policy_number": dr.policy_number,
                "policy_type": dr.policy_type,
                "original_filename": dr.original_filename,
                "status": dr.status,
                "created_at": str(dr.created_at) if dr.created_at else None,
            }
            for dr, email in rows
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }


class AdminApproveDraftRequest(BaseModel):
    scope: str = "personal"
    policy_type: str | None = None


@router.post("/drafts/{draft_id}/approve")
def admin_approve_draft(
    draft_id: int,
    payload: AdminApproveDraftRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    draft = db.get(PolicyDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status != "pending":
        raise HTTPException(status_code=400, detail="Draft already processed")

    extraction = json.loads(draft.extraction_data) if draft.extraction_data else {}

    if draft.matched_policy_id:
        policy = db.get(Policy, draft.matched_policy_id)
        if policy:
            if extraction.get("carrier"):
                policy.carrier = extraction["carrier"]
            if extraction.get("coverage_amount"):
                policy.coverage_amount = extraction["coverage_amount"]
            if extraction.get("deductible"):
                policy.deductible = extraction["deductible"]
            if extraction.get("premium_amount"):
                policy.premium_amount = extraction["premium_amount"]
            draft.status = "approved"
            db.commit()
            return {"ok": True, "policy_id": policy.id, "action": "updated"}

    policy = Policy(
        user_id=draft.user_id,
        scope=payload.scope,
        policy_type=payload.policy_type or draft.policy_type or "other",
        carrier=draft.carrier or extraction.get("carrier") or "Unknown",
        policy_number=draft.policy_number or extraction.get("policy_number") or "TBD",
        coverage_amount=extraction.get("coverage_amount"),
        deductible=extraction.get("deductible"),
        premium_amount=extraction.get("premium_amount"),
    )
    db.add(policy)
    db.flush()

    if draft.object_key:
        doc = Document(
            policy_id=policy.id,
            filename=draft.original_filename or "document.pdf",
            content_type="application/pdf",
            object_key=draft.object_key,
            doc_type="policy",
            extraction_status="done",
        )
        db.add(doc)

    draft.status = "approved"
    draft.matched_policy_id = policy.id
    db.commit()
    return {"ok": True, "policy_id": policy.id, "action": "created"}


@router.post("/drafts/{draft_id}/reject")
def admin_reject_draft(
    draft_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    draft = db.get(PolicyDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status != "pending":
        raise HTTPException(status_code=400, detail="Draft already processed")
    draft.status = "rejected"
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════
#  ANNOUNCEMENTS
# ═══════════════════════════════════════════════════════

class AnnouncementCreate(BaseModel):
    title: str
    message: str
    type: str = "info"
    is_active: bool = True
    starts_at: str | None = None
    ends_at: str | None = None


class AnnouncementUpdate(BaseModel):
    title: str | None = None
    message: str | None = None
    type: str | None = None
    is_active: bool | None = None
    starts_at: str | None = None
    ends_at: str | None = None


def _announcement_dict(a: Announcement) -> dict:
    return {
        "id": a.id,
        "title": a.title,
        "message": a.message,
        "type": a.type,
        "is_active": a.is_active,
        "starts_at": str(a.starts_at) if a.starts_at else None,
        "ends_at": str(a.ends_at) if a.ends_at else None,
        "created_by": a.created_by,
        "created_at": str(a.created_at) if a.created_at else None,
    }


@router.get("/announcements")
def admin_list_announcements(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Announcement).order_by(Announcement.created_at.desc())
    ).scalars().all()
    return [_announcement_dict(a) for a in rows]


@router.post("/announcements")
def admin_create_announcement(
    payload: AnnouncementCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if payload.type not in ("info", "warning", "maintenance"):
        raise HTTPException(status_code=400, detail="Invalid type")
    ann = Announcement(
        title=payload.title,
        message=payload.message,
        type=payload.type,
        is_active=payload.is_active,
        starts_at=datetime.fromisoformat(payload.starts_at) if payload.starts_at else None,
        ends_at=datetime.fromisoformat(payload.ends_at) if payload.ends_at else None,
        created_by=admin.id,
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return _announcement_dict(ann)


@router.patch("/announcements/{announcement_id}")
def admin_update_announcement(
    announcement_id: int,
    payload: AnnouncementUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ann = db.get(Announcement, announcement_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")
    if payload.title is not None:
        ann.title = payload.title
    if payload.message is not None:
        ann.message = payload.message
    if payload.type is not None:
        if payload.type not in ("info", "warning", "maintenance"):
            raise HTTPException(status_code=400, detail="Invalid type")
        ann.type = payload.type
    if payload.is_active is not None:
        ann.is_active = payload.is_active
    if payload.starts_at is not None:
        ann.starts_at = datetime.fromisoformat(payload.starts_at) if payload.starts_at else None
    if payload.ends_at is not None:
        ann.ends_at = datetime.fromisoformat(payload.ends_at) if payload.ends_at else None
    db.commit()
    db.refresh(ann)
    return _announcement_dict(ann)


@router.delete("/announcements/{announcement_id}")
def admin_delete_announcement(
    announcement_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ann = db.get(Announcement, announcement_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")
    db.execute(delete(Announcement).where(Announcement.id == announcement_id))
    db.commit()
    return {"ok": True}


# ── Public announcements endpoint (no auth) ──────────

@public_router.get("/announcements/active")
def get_active_announcements(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    q = (
        select(Announcement)
        .where(Announcement.is_active == True)  # noqa: E712
    )
    rows = db.execute(q).scalars().all()

    # Filter by date range in Python for SQLite compatibility
    active = []
    for a in rows:
        if a.starts_at and a.starts_at > now:
            continue
        if a.ends_at and a.ends_at < now:
            continue
        active.append({
            "id": a.id,
            "title": a.title,
            "message": a.message,
            "type": a.type,
        })
    return active


# ═══════════════════════════════════════════════════════
#  DATA CLEANUP
# ═══════════════════════════════════════════════════════

@router.delete("/cleanup-pending-extractions")
def admin_cleanup_pending(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delete all 'Pending extraction...' placeholder policies across all users."""
    from .routes_policies import _delete_policy_cascade

    stale = db.execute(
        select(Policy).where(Policy.carrier == "Pending extraction...")
    ).scalars().all()

    count = len(stale)
    for p in stale:
        _delete_policy_cascade(db, p.id)
    db.commit()

    return {"ok": True, "deleted": count}


@router.delete("/cleanup-lease-requirements")
def admin_cleanup_lease_requirements(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delete all lease requirements and their compliance checks for the admin's account."""
    from .models_features import LeaseRequirement, ComplianceCheck

    reqs = db.execute(
        select(LeaseRequirement).where(LeaseRequirement.user_id == admin.id)
    ).scalars().all()

    count = len(reqs)
    for req in reqs:
        db.execute(delete(ComplianceCheck).where(ComplianceCheck.lease_requirement_id == req.id))
        db.delete(req)
    db.commit()

    return {"ok": True, "deleted": count}


@router.get("/events")
def admin_list_events(
    limit: int = Query(100, le=500),
    event_name: str | None = None,
    user_id: int | None = None,
    category: str | None = None,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Query user events for analytics."""
    q = select(UserEvent).order_by(UserEvent.created_at.desc())
    if event_name:
        q = q.where(UserEvent.event_name == event_name)
    if user_id:
        q = q.where(UserEvent.user_id == user_id)
    if category:
        q = q.where(UserEvent.event_category == category)
    q = q.limit(limit)
    rows = db.execute(q).scalars().all()

    # Also get user emails for display
    user_ids = {r.user_id for r in rows if r.user_id}
    user_map: dict[int, str] = {}
    if user_ids:
        users = db.execute(select(User.id, User.email).where(User.id.in_(user_ids))).all()
        user_map = {u.id: u.email for u in users}

    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "user_email": user_map.get(r.user_id, None) if r.user_id else None,
            "session_id": r.session_id,
            "event_name": r.event_name,
            "event_category": r.event_category,
            "properties": r.properties,
            "page_path": r.page_path,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
