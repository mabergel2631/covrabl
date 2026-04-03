import secrets
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func, distinct, or_
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .coverage_taxonomy import analyze_coverage_gaps, get_coverage_summary
from .db import get_db
from .models import User, Policy, Contact, PolicyDetail, Exposure
from .models_agent import AgentClient, AgentNote, AgentPolicyAccess
from .models_documents import Document
from .models_features import PolicyShare, CoverageScore, ComplianceCheck, LeaseRequirement
from .storage import presign_put_url
from .audit_helper import log_action

router = APIRouter(prefix="/agent", tags=["agent"])


# ── Auth helpers ────────────────────────────────────────


def require_agent(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("agent", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Agent role required")
    return user


def _verify_client_access(db: Session, agent: User, client_id: int) -> User:
    """Verify agent has active relationship with client, return client User."""
    # Admins can access any client
    if agent.role != "admin":
        rel = db.execute(
            select(AgentClient).where(
                AgentClient.agent_id == agent.id,
                AgentClient.client_id == client_id,
                AgentClient.status == "active",
            )
        ).scalar_one_or_none()
        if not rel:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this client")
    client = db.get(User, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


def _policy_to_dict(p: Policy, contacts: list | None = None, details: list | None = None) -> dict:
    d = {
        "id": p.id,
        "user_id": p.user_id,
        "scope": p.scope,
        "policy_type": p.policy_type,
        "carrier": p.carrier,
        "policy_number": p.policy_number,
        "nickname": p.nickname,
        "coverage_amount": p.coverage_amount,
        "deductible": p.deductible,
        "premium_amount": p.premium_amount,
        "renewal_date": str(p.renewal_date) if p.renewal_date else None,
        "created_at": str(p.created_at) if p.created_at else None,
        "exposure_id": p.exposure_id,
        "status": p.status or "active",
    }
    if contacts is not None:
        d["contacts"] = [{"role": c.role, "name": c.name, "phone": c.phone, "email": c.email} for c in contacts]
    if details is not None:
        d["details"] = [{"field_name": dd.field_name, "field_value": dd.field_value} for dd in details]
    return d


def _get_client_ids(db: Session, agent: User) -> list[int]:
    """Get distinct client IDs for this agent from AgentClient table.

    Admins see all non-admin, non-agent users. Agents see their own clients.
    Also migrates any legacy PolicyShare broker relationships into AgentClient rows.
    """
    # Admins see all regular users as clients
    if agent.role == "admin":
        rows = db.execute(
            select(User.id).where(
                User.role.notin_(["admin", "agent"]),
            )
        ).scalars().all()
        return list(rows)

    # Check for legacy PolicyShare broker relationships not yet in AgentClient
    legacy_owner_ids = db.execute(
        select(distinct(PolicyShare.owner_id)).where(
            PolicyShare.shared_with_email == agent.email,
            PolicyShare.role_label == "broker",
            PolicyShare.accepted == True,  # noqa: E712
        )
    ).scalars().all()

    for owner_id in legacy_owner_ids:
        existing = db.execute(
            select(AgentClient).where(
                AgentClient.agent_id == agent.id,
                AgentClient.client_id == owner_id,
            )
        ).scalar_one_or_none()
        if not existing:
            db.add(AgentClient(agent_id=agent.id, client_id=owner_id, status="active"))
    if legacy_owner_ids:
        db.commit()

    rows = db.execute(
        select(AgentClient.client_id).where(
            AgentClient.agent_id == agent.id,
            AgentClient.status == "active",
            AgentClient.client_id.isnot(None),
        )
    ).scalars().all()
    return list(rows)


def _get_visible_policies(db: Session, agent: User, client_id: int) -> list[Policy]:
    """Get policies the agent is allowed to see for a client.

    If visibility rows exist, filter by visible=True.
    If no visibility rows exist (legacy or admin), return all policies.
    Admins always see everything.
    """
    all_policies = db.execute(
        select(Policy).where(Policy.user_id == client_id)
    ).scalars().all()

    if agent.role == "admin":
        return list(all_policies)

    # Check if any visibility rows exist for this agent+client
    access_rows = db.execute(
        select(AgentPolicyAccess).where(
            AgentPolicyAccess.agent_id == agent.id,
            AgentPolicyAccess.client_id == client_id,
        )
    ).scalars().all()

    if not access_rows:
        # No visibility records = legacy relationship, show all
        return list(all_policies)

    visible_ids = {r.policy_id for r in access_rows if r.visible}
    return [p for p in all_policies if p.id in visible_ids]


def _ensure_policy_access_rows(db: Session, agent_id: int, client_id: int) -> None:
    """Create AgentPolicyAccess rows for any policies that don't have one yet.

    New policies default to visible=True.
    """
    policy_ids = db.execute(
        select(Policy.id).where(Policy.user_id == client_id)
    ).scalars().all()

    existing = db.execute(
        select(AgentPolicyAccess.policy_id).where(
            AgentPolicyAccess.agent_id == agent_id,
            AgentPolicyAccess.client_id == client_id,
        )
    ).scalars().all()
    existing_set = set(existing)

    for pid in policy_ids:
        if pid not in existing_set:
            db.add(AgentPolicyAccess(
                agent_id=agent_id, client_id=client_id,
                policy_id=pid, visible=True,
            ))
    if set(policy_ids) - existing_set:
        db.flush()


def _compute_coverage_status(flagged_items: list[dict], gaps: list[dict]) -> str:
    """Return 'gaps', 'review', or 'good' based on flagged items and coverage gaps."""
    has_high = any(f.get("severity") == "high" for f in flagged_items)
    has_gaps = len(gaps) > 0
    if has_high or has_gaps:
        return "gaps"
    if len(flagged_items) > 0:
        return "review"
    return "good"


def _compute_next_action(flagged_items: list[dict], gaps: list[dict]) -> str:
    """Return the single highest-priority next action string.

    Priority:
      1. Expired policy
      2. Compliance failure
      3. Renewal < 14 days
      4. Coverage gap
      5. Renewal < 30 days
      6. No action needed
    """
    expired = [f for f in flagged_items if f.get("category") == "expired_policy"]
    if expired:
        return f"Renew {expired[0]['title'].replace(' expired', '')} policy"

    compliance = [f for f in flagged_items if f.get("category") == "compliance_fail"]
    if compliance:
        return f"Address {compliance[0]['detail']}"

    urgent_renewals = [f for f in flagged_items if f.get("category") == "upcoming_renewal" and f.get("severity") == "high"]
    if urgent_renewals:
        return f"Review {urgent_renewals[0]['title']}"

    if gaps:
        return f"Review {gaps[0].get('name', 'coverage gap')}"

    other_renewals = [f for f in flagged_items if f.get("category") == "upcoming_renewal"]
    if other_renewals:
        return f"Review {other_renewals[0]['title']}"

    return "No action needed"


def _compute_what_to_do(flagged_items: list[dict], gaps: list[dict]) -> list[str]:
    """Return 2-4 actionable steps for the client detail page."""
    actions: list[str] = []

    for f in flagged_items:
        if f.get("category") == "expired_policy":
            actions.append(f"Renew {f['title'].replace(' expired', '')} policy")
        elif f.get("category") == "compliance_fail":
            actions.append(f"Address {f['detail']}")
        elif f.get("category") == "upcoming_renewal":
            actions.append(f"Review {f['title']}")

    for g in gaps:
        rec = g.get("recommendation", g.get("name", "coverage gap"))
        actions.append(rec)

    # Deduplicate while preserving order, cap at 4
    seen: set[str] = set()
    unique: list[str] = []
    for a in actions:
        if a not in seen:
            seen.add(a)
            unique.append(a)
        if len(unique) >= 4:
            break

    return unique if unique else ["No action needed"]


def _flagged_items_for_client(db: Session, client_id: int, policies: list[Policy]) -> list[dict]:
    """Aggregate flagged items for a client: expired policies, upcoming renewals, compliance failures."""
    items = []
    today = datetime.now().date()

    for p in policies:
        # Expired policies
        if p.status == "expired":
            items.append({
                "category": "expired_policy",
                "severity": "high",
                "title": f"{p.carrier} {p.policy_type} expired",
                "detail": f"Policy {p.policy_number} is expired",
                "entity_id": p.id,
            })
        # Upcoming renewals within 30 days
        if p.renewal_date and today <= p.renewal_date <= today + timedelta(days=30):
            days = (p.renewal_date - today).days
            items.append({
                "category": "upcoming_renewal",
                "severity": "medium" if days > 14 else "high",
                "title": f"{p.carrier} {p.policy_type} renews in {days} days",
                "detail": f"Renewal date: {p.renewal_date}",
                "entity_id": p.id,
            })

    # Compliance failures
    checks = db.execute(
        select(ComplianceCheck).where(
            ComplianceCheck.user_id == client_id,
            ComplianceCheck.fail_count > 0,
        )
    ).scalars().all()
    for check in checks:
        lr = db.get(LeaseRequirement, check.lease_requirement_id) if check.lease_requirement_id else None
        label = lr.label if lr else "Requirement"
        items.append({
            "category": "compliance_fail",
            "severity": "high",
            "title": f"Compliance failure: {label}",
            "detail": f"{check.fail_count} requirement(s) not met",
            "entity_id": check.id,
        })

    return items


# ── Request schemas ─────────────────────────────────────


class InviteRequest(BaseModel):
    email: str


class NoteRequest(BaseModel):
    content: str


class CreatePolicyForClient(BaseModel):
    scope: str = "personal"
    policy_type: str
    carrier: str
    policy_number: str = ""
    coverage_amount: int | None = None
    deductible: int | None = None
    premium_amount: int | None = None
    renewal_date: str | None = None
    business_name: str | None = None


class InviteResponse(BaseModel):
    action: str  # "accept" or "decline"
    shared_policy_ids: list[int] | None = None  # policy IDs to share (only used on accept)


class VisibilityToggle(BaseModel):
    visible: bool


class ClientUploadInit(BaseModel):
    policy_id: int
    filename: str
    content_type: str
    doc_type: str = "policy"


class ClientUploadFinalize(BaseModel):
    policy_id: int
    filename: str
    content_type: str
    object_key: str
    doc_type: str = "policy"


# ── Endpoints ───────────────────────────────────────────


@router.get("/clients")
def list_clients(agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    client_ids = _get_client_ids(db, agent)

    # Also include invited and pending clients
    non_active = db.execute(
        select(AgentClient).where(
            AgentClient.agent_id == agent.id,
            AgentClient.status.in_(["invited", "pending"]),
        )
    ).scalars().all()

    clients = []

    for cid in client_ids:
        user = db.get(User, cid)
        if not user:
            continue

        policies = db.execute(
            select(Policy).where(Policy.user_id == cid)
        ).scalars().all()

        policy_count = len(policies)

        score_row = db.execute(
            select(CoverageScore.score_total).where(
                CoverageScore.user_id == cid,
                CoverageScore.category == "overall",
            )
        ).scalar()

        today = datetime.now().date()
        next_renewal = db.execute(
            select(func.min(Policy.renewal_date)).where(
                Policy.user_id == cid,
                Policy.renewal_date >= today,
            )
        ).scalar()

        # Compute flagged items and gaps for next_action
        flagged = _flagged_items_for_client(db, cid, policies)
        policy_dicts = [_policy_to_dict(p) for p in policies]
        gaps = analyze_coverage_gaps(policy_dicts)

        coverage_status = _compute_coverage_status(flagged, gaps)
        next_action = _compute_next_action(flagged, gaps)

        clients.append({
            "id": user.id,
            "email": user.email,
            "full_name": None,  # will be populated from profile if available
            "status": "active",
            "policy_count": policy_count,
            "protection_score": score_row,
            "next_renewal": str(next_renewal) if next_renewal else None,
            "flagged_count": len(flagged),
            "coverage_status": coverage_status,
            "next_action": next_action,
        })

    # Try to populate full_name from profiles
    if clients:
        from .models_profile import UserProfile
        for c in clients:
            profile = db.execute(
                select(UserProfile.full_name).where(UserProfile.user_id == c["id"])
            ).scalar()
            if profile:
                c["full_name"] = profile

    # Add invited and pending clients
    for inv in non_active:
        action = "Awaiting client signup" if inv.status == "invited" else "Awaiting client approval"
        clients.append({
            "id": inv.client_id,
            "email": inv.invited_email,
            "full_name": None,
            "status": inv.status,
            "policy_count": 0,
            "protection_score": None,
            "next_renewal": None,
            "flagged_count": 0,
            "coverage_status": "good",
            "next_action": action,
        })

    return clients


@router.get("/overview")
def agent_overview(agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    client_ids = _get_client_ids(db, agent)

    total_clients = len(client_ids)
    if total_clients == 0:
        return {
            "total_clients": 0,
            "total_policies": 0,
            "avg_protection_score": None,
            "upcoming_renewals": 0,
            "flagged_count": 0,
        }

    total_policies = db.execute(
        select(func.count(Policy.id)).where(Policy.user_id.in_(client_ids))
    ).scalar() or 0

    scores = db.execute(
        select(CoverageScore.score_total).where(
            CoverageScore.user_id.in_(client_ids),
            CoverageScore.category == "overall",
        )
    ).scalars().all()
    avg_score = round(sum(scores) / len(scores)) if scores else None

    today = datetime.now().date()
    cutoff = today + timedelta(days=60)
    upcoming = db.execute(
        select(func.count(Policy.id)).where(
            Policy.user_id.in_(client_ids),
            Policy.renewal_date >= today,
            Policy.renewal_date <= cutoff,
        )
    ).scalar() or 0

    # Total flagged across all clients
    expired_count = db.execute(
        select(func.count(Policy.id)).where(
            Policy.user_id.in_(client_ids),
            Policy.status == "expired",
        )
    ).scalar() or 0
    compliance_fails = db.execute(
        select(func.count(ComplianceCheck.id)).where(
            ComplianceCheck.user_id.in_(client_ids),
            ComplianceCheck.fail_count > 0,
        )
    ).scalar() or 0

    return {
        "total_clients": total_clients,
        "total_policies": total_policies,
        "avg_protection_score": avg_score,
        "upcoming_renewals": upcoming,
        "flagged_count": expired_count + upcoming + compliance_fails,
    }


# ── Invite ──────────────────────────────────────────────


@router.post("/clients/invite")
async def invite_client(payload: InviteRequest, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if email == agent.email:
        raise HTTPException(status_code=400, detail="Cannot invite yourself")

    existing_user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()

    if existing_user:
        # Check if relationship already exists
        existing_rel = db.execute(
            select(AgentClient).where(
                AgentClient.agent_id == agent.id,
                AgentClient.client_id == existing_user.id,
                AgentClient.status.in_(["active", "pending", "invited"]),
            )
        ).scalar_one_or_none()
        if existing_rel:
            raise HTTPException(status_code=400, detail="Already a client")

        # Set to "pending" — client must accept before agent can see data
        rel = AgentClient(agent_id=agent.id, client_id=existing_user.id, status="pending", invited_email=email)
        db.add(rel)
        log_action(db, agent.id, "created", "agent_client", existing_user.id, f"Invite sent to existing user {email}")
        db.commit()

        # Send notification email to the existing user
        try:
            from .email import send_agent_link_request_email
            _raw_url = settings.app_url.rstrip("/")
            app_url = _raw_url if "localhost" not in _raw_url and "127.0.0.1" not in _raw_url else "https://covrabl.vercel.app"
            await send_agent_link_request_email(email, agent.email, app_url)
        except Exception:
            pass  # email failure shouldn't block

        return {"ok": True, "status": "pending", "client_id": existing_user.id}
    else:
        # User doesn't exist yet — create invite
        invite_token = secrets.token_urlsafe(32)
        rel = AgentClient(agent_id=agent.id, client_id=None, status="invited", invited_email=email, invite_token=invite_token)
        db.add(rel)
        log_action(db, agent.id, "created", "agent_client_invite", 0, f"Invited {email}")
        db.commit()

        # Send invite email
        _raw_url = settings.app_url.rstrip("/")
        app_url = _raw_url if "localhost" not in _raw_url and "127.0.0.1" not in _raw_url else "https://covrabl.vercel.app"
        invite_url = f"{app_url}/register?invite={invite_token}"

        try:
            from .email import send_agent_invite_email
            await send_agent_invite_email(email, agent.email, invite_url)
        except Exception:
            pass  # email failure shouldn't block invite creation

        return {"ok": True, "status": "invited", "invite_token": invite_token}


# ── Client summary ──────────────────────────────────────


@router.get("/clients/{client_id}/summary")
def client_summary(client_id: int, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    client = _verify_client_access(db, agent, client_id)

    policies = _get_visible_policies(db, agent, client_id)

    policy_dicts = []
    policy_list = []
    for p in policies:
        contacts = db.execute(select(Contact).where(Contact.policy_id == p.id)).scalars().all()
        details = db.execute(select(PolicyDetail).where(PolicyDetail.policy_id == p.id)).scalars().all()
        d = _policy_to_dict(p, contacts, details)
        policy_dicts.append(d)
        exposure_name = None
        if p.exposure_id:
            exp = db.get(Exposure, p.exposure_id)
            if exp:
                exposure_name = exp.name
        policy_list.append({
            "id": p.id,
            "carrier": p.carrier,
            "policy_type": p.policy_type,
            "policy_number": p.policy_number,
            "nickname": p.nickname,
            "coverage_amount": p.coverage_amount,
            "deductible": p.deductible,
            "premium_amount": p.premium_amount,
            "renewal_date": str(p.renewal_date) if p.renewal_date else None,
            "exposure_id": p.exposure_id,
            "exposure_name": exposure_name,
            "status": p.status or "active",
            "scope": p.scope,
        })

    score_row = db.execute(
        select(CoverageScore.score_total).where(
            CoverageScore.user_id == client_id,
            CoverageScore.category == "overall",
        )
    ).scalar()

    gaps = analyze_coverage_gaps(policy_dicts)
    summary = get_coverage_summary(policy_dicts)

    today = datetime.now().date()
    renewals = []
    for p in policies:
        if p.renewal_date and p.renewal_date >= today:
            renewals.append({
                "policy_id": p.id,
                "carrier": p.carrier,
                "policy_type": p.policy_type,
                "renewal_date": str(p.renewal_date),
            })
    renewals.sort(key=lambda r: r["renewal_date"])

    flagged = _flagged_items_for_client(db, client_id, policies)
    coverage_status = _compute_coverage_status(flagged, gaps)
    what_to_do = _compute_what_to_do(flagged, gaps)

    return {
        "client": {"id": client.id, "email": client.email},
        "protection_score": score_row,
        "coverage_status": coverage_status,
        "policies": policy_list,
        "gaps": gaps,
        "summary": summary,
        "upcoming_renewals": renewals,
        "flagged_items": flagged,
        "what_to_do": what_to_do,
    }


# ── Documents ───────────────────────────────────────────


@router.get("/clients/{client_id}/documents")
def client_documents(client_id: int, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _verify_client_access(db, agent, client_id)

    rows = db.execute(
        select(Document, Policy.carrier, Policy.policy_type).join(
            Policy, Document.policy_id == Policy.id
        ).where(
            Policy.user_id == client_id,
        ).order_by(Document.created_at.desc())
    ).all()

    results = []
    for doc, carrier, policy_type in rows:
        uploaded_by = None
        if doc.uploaded_by_user_id:
            uploader = db.get(User, doc.uploaded_by_user_id)
            uploaded_by = uploader.email if uploader else "unknown"
        results.append({
            "id": doc.id,
            "policy_id": doc.policy_id,
            "filename": doc.filename,
            "content_type": doc.content_type,
            "doc_type": doc.doc_type,
            "extraction_status": doc.extraction_status,
            "created_at": str(doc.created_at) if doc.created_at else None,
            "carrier": carrier,
            "policy_type": policy_type,
            "uploaded_by": uploaded_by,
        })

    return results


@router.post("/clients/{client_id}/documents/init")
def init_client_upload(client_id: int, payload: ClientUploadInit, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _verify_client_access(db, agent, client_id)

    p = db.get(Policy, payload.policy_id)
    if not p or p.user_id != client_id:
        raise HTTPException(status_code=404, detail="Policy not found for this client")

    object_key = f"policies/{p.scope}/{payload.policy_id}/{uuid.uuid4()}-{payload.filename}"
    upload_url = presign_put_url(object_key, payload.content_type)
    return {"upload_url": upload_url, "object_key": object_key}


@router.post("/clients/{client_id}/documents/finalize")
def finalize_client_upload(client_id: int, payload: ClientUploadFinalize, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _verify_client_access(db, agent, client_id)

    p = db.get(Policy, payload.policy_id)
    if not p or p.user_id != client_id:
        raise HTTPException(status_code=404, detail="Policy not found for this client")

    doc = Document(
        policy_id=payload.policy_id,
        filename=payload.filename,
        content_type=payload.content_type,
        object_key=payload.object_key,
        doc_type=payload.doc_type,
        uploaded_by_user_id=agent.id,
    )
    db.add(doc)
    db.flush()
    log_action(db, agent.id, "uploaded", "document", doc.id, f"Agent upload for client {client_id}")
    db.commit()
    db.refresh(doc)
    return {"ok": True, "document_id": doc.id}


# ── Flagged items ───────────────────────────────────────


@router.get("/clients/{client_id}/flagged")
def client_flagged(client_id: int, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _verify_client_access(db, agent, client_id)

    policies = db.execute(
        select(Policy).where(Policy.user_id == client_id)
    ).scalars().all()

    return _flagged_items_for_client(db, client_id, policies)


# ── Notes ───────────────────────────────────────────────


@router.get("/clients/{client_id}/notes")
def list_notes(client_id: int, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _verify_client_access(db, agent, client_id)

    rows = db.execute(
        select(AgentNote).where(
            AgentNote.agent_id == agent.id,
            AgentNote.client_id == client_id,
        ).order_by(AgentNote.created_at.desc())
    ).scalars().all()

    return [
        {
            "id": n.id,
            "content": n.content,
            "created_at": str(n.created_at) if n.created_at else None,
        }
        for n in rows
    ]


@router.post("/clients/{client_id}/notes")
def add_note(client_id: int, payload: NoteRequest, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _verify_client_access(db, agent, client_id)

    note = AgentNote(agent_id=agent.id, client_id=client_id, content=payload.content.strip())
    db.add(note)
    db.flush()
    log_action(db, agent.id, "created", "agent_note", note.id)
    db.commit()
    db.refresh(note)
    return {"id": note.id, "content": note.content, "created_at": str(note.created_at)}


@router.delete("/clients/{client_id}/notes/{note_id}")
def delete_note(client_id: int, note_id: int, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _verify_client_access(db, agent, client_id)

    note = db.get(AgentNote, note_id)
    if not note or note.agent_id != agent.id or note.client_id != client_id:
        raise HTTPException(status_code=404, detail="Note not found")

    db.delete(note)
    log_action(db, agent.id, "deleted", "agent_note", note_id)
    db.commit()
    return {"ok": True}


# ── Agent creates policy for client ────────────────────


@router.post("/clients/{client_id}/policies")
def create_policy_for_client(
    client_id: int,
    payload: CreatePolicyForClient,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    client = _verify_client_access(db, agent, client_id)

    from datetime import date as date_type
    renewal = None
    if payload.renewal_date:
        try:
            renewal = date_type.fromisoformat(payload.renewal_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid renewal_date format (use YYYY-MM-DD)")

    policy = Policy(
        user_id=client_id,
        scope=payload.scope,
        policy_type=payload.policy_type,
        carrier=payload.carrier,
        policy_number=payload.policy_number,
        coverage_amount=payload.coverage_amount,
        deductible=payload.deductible,
        premium_amount=payload.premium_amount,
        renewal_date=renewal,
        business_name=payload.business_name,
        status="active",
    )
    db.add(policy)
    db.flush()

    # Create visibility row for this agent
    if agent.role != "admin":
        db.add(AgentPolicyAccess(
            agent_id=agent.id, client_id=client_id,
            policy_id=policy.id, visible=True,
        ))

    log_action(db, agent.id, "created", "policy", policy.id, f"Agent created policy for client {client_id}")
    db.commit()
    db.refresh(policy)

    return {
        "ok": True,
        "policy_id": policy.id,
        "carrier": policy.carrier,
        "policy_type": policy.policy_type,
    }


# ═══════════════════════════════════════════════════════
#  CLIENT-FACING ENDPOINTS (for managing agent access)
# ═══════════════════════════════════════════════════════


@router.get("/my-invites")
def my_agent_invites(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """List pending agent invites for the current user."""
    rows = db.execute(
        select(AgentClient).where(
            AgentClient.client_id == user.id,
            AgentClient.status == "pending",
        )
    ).scalars().all()

    invites = []
    for r in rows:
        agent = db.get(User, r.agent_id)
        agent_email = agent.email if agent else "unknown"
        # Try to get agent name
        from .models_profile import UserProfile
        agent_profile = db.execute(
            select(UserProfile.full_name).where(UserProfile.user_id == r.agent_id)
        ).scalar()
        invites.append({
            "id": r.id,
            "agent_id": r.agent_id,
            "agent_email": agent_email,
            "agent_name": agent_profile,
            "created_at": str(r.created_at) if r.created_at else None,
        })

    return invites


@router.post("/my-invites/{invite_id}/respond")
def respond_to_invite(
    invite_id: int,
    payload: InviteResponse,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Accept or decline a pending agent invite."""
    rel = db.get(AgentClient, invite_id)
    if not rel or rel.client_id != user.id or rel.status != "pending":
        raise HTTPException(status_code=404, detail="Invite not found")

    if payload.action == "accept":
        rel.status = "active"
        # Create visibility rows based on selected policies
        all_policy_ids = [
            pid for (pid,) in db.execute(
                select(Policy.id).where(Policy.user_id == user.id)
            ).all()
        ]
        shared_ids = set(payload.shared_policy_ids) if payload.shared_policy_ids else set(all_policy_ids)
        for pid in all_policy_ids:
            db.add(AgentPolicyAccess(
                agent_id=rel.agent_id, client_id=user.id,
                policy_id=pid, visible=(pid in shared_ids),
            ))
        log_action(db, user.id, "accepted", "agent_client", rel.agent_id,
                   f"Accepted agent invite, shared {len(shared_ids)}/{len(all_policy_ids)} policies")
        db.commit()
        return {"ok": True, "status": "active"}
    elif payload.action == "decline":
        rel.status = "removed"
        log_action(db, user.id, "declined", "agent_client", rel.agent_id, f"Declined agent invite")
        db.commit()
        return {"ok": True, "status": "removed"}
    else:
        raise HTTPException(status_code=400, detail="action must be 'accept' or 'decline'")


@router.get("/my-agents")
def my_agents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """List active agent relationships for the current user."""
    rows = db.execute(
        select(AgentClient).where(
            AgentClient.client_id == user.id,
            AgentClient.status == "active",
        )
    ).scalars().all()

    agents = []
    for r in rows:
        agent = db.get(User, r.agent_id)
        agent_email = agent.email if agent else "unknown"
        from .models_profile import UserProfile
        agent_profile = db.execute(
            select(UserProfile.full_name).where(UserProfile.user_id == r.agent_id)
        ).scalar()
        agents.append({
            "id": r.id,
            "agent_id": r.agent_id,
            "agent_email": agent_email,
            "agent_name": agent_profile,
            "created_at": str(r.created_at) if r.created_at else None,
        })

    return agents


@router.get("/my-policy-visibility/{agent_id}")
def my_policy_visibility(
    agent_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all policies with their visibility status for a given agent."""
    # Verify active relationship
    rel = db.execute(
        select(AgentClient).where(
            AgentClient.agent_id == agent_id,
            AgentClient.client_id == user.id,
            AgentClient.status == "active",
        )
    ).scalar_one_or_none()
    if not rel:
        raise HTTPException(status_code=403, detail="No active agent relationship")

    # Ensure access rows exist for all policies
    _ensure_policy_access_rows(db, agent_id, user.id)
    db.commit()

    policies = db.execute(
        select(Policy).where(Policy.user_id == user.id)
    ).scalars().all()

    access_map: dict[int, bool] = {}
    access_rows = db.execute(
        select(AgentPolicyAccess).where(
            AgentPolicyAccess.agent_id == agent_id,
            AgentPolicyAccess.client_id == user.id,
        )
    ).scalars().all()
    for a in access_rows:
        access_map[a.policy_id] = a.visible

    result = []
    for p in policies:
        result.append({
            "policy_id": p.id,
            "carrier": p.carrier,
            "policy_type": p.policy_type,
            "policy_number": p.policy_number,
            "status": p.status or "active",
            "visible": access_map.get(p.id, True),
        })

    return result


@router.put("/my-policy-visibility/{agent_id}/{policy_id}")
def toggle_policy_visibility(
    agent_id: int,
    policy_id: int,
    payload: VisibilityToggle,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle whether a specific policy is visible to an agent."""
    # Verify active relationship
    rel = db.execute(
        select(AgentClient).where(
            AgentClient.agent_id == agent_id,
            AgentClient.client_id == user.id,
            AgentClient.status == "active",
        )
    ).scalar_one_or_none()
    if not rel:
        raise HTTPException(status_code=403, detail="No active agent relationship")

    # Verify policy belongs to user
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    # Upsert visibility row
    access = db.execute(
        select(AgentPolicyAccess).where(
            AgentPolicyAccess.agent_id == agent_id,
            AgentPolicyAccess.policy_id == policy_id,
        )
    ).scalar_one_or_none()

    if access:
        access.visible = payload.visible
    else:
        db.add(AgentPolicyAccess(
            agent_id=agent_id, client_id=user.id,
            policy_id=policy_id, visible=payload.visible,
        ))

    log_action(db, user.id, "updated", "policy_visibility", policy_id,
               f"Set visible={payload.visible} for agent {agent_id}")
    db.commit()
    return {"ok": True, "visible": payload.visible}
