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
from .models_agent import AgentClient, AgentNote
from .models_documents import Document
from .models_features import PolicyShare, CoverageScore, ComplianceCheck, LeaseRequirement
from .storage import presign_put_url
from .audit_helper import log_action

router = APIRouter(prefix="/agent", tags=["agent"])


# ── Auth helpers ────────────────────────────────────────


def require_agent(user: User = Depends(get_current_user)) -> User:
    if user.role != "agent":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Agent role required")
    return user


def _verify_client_access(db: Session, agent: User, client_id: int) -> User:
    """Verify agent has active relationship with client, return client User."""
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

    Also migrates any legacy PolicyShare broker relationships into AgentClient rows.
    """
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

    # Also include invited (pending) clients
    invited = db.execute(
        select(AgentClient).where(
            AgentClient.agent_id == agent.id,
            AgentClient.status == "invited",
        )
    ).scalars().all()

    clients = []

    for cid in client_ids:
        user = db.get(User, cid)
        if not user:
            continue

        policy_count = db.execute(
            select(func.count(Policy.id)).where(Policy.user_id == cid)
        ).scalar() or 0

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

        # Count flagged items
        expired_count = db.execute(
            select(func.count(Policy.id)).where(
                Policy.user_id == cid,
                Policy.status == "expired",
            )
        ).scalar() or 0
        renewal_soon = db.execute(
            select(func.count(Policy.id)).where(
                Policy.user_id == cid,
                Policy.renewal_date >= today,
                Policy.renewal_date <= today + timedelta(days=30),
            )
        ).scalar() or 0
        compliance_fails = db.execute(
            select(func.count(ComplianceCheck.id)).where(
                ComplianceCheck.user_id == cid,
                ComplianceCheck.fail_count > 0,
            )
        ).scalar() or 0
        flagged_count = expired_count + renewal_soon + compliance_fails

        clients.append({
            "id": user.id,
            "email": user.email,
            "full_name": None,  # will be populated from profile if available
            "status": "active",
            "policy_count": policy_count,
            "protection_score": score_row,
            "next_renewal": str(next_renewal) if next_renewal else None,
            "flagged_count": flagged_count,
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

    # Add invited (pending) clients
    for inv in invited:
        clients.append({
            "id": None,
            "email": inv.invited_email,
            "full_name": None,
            "status": "invited",
            "policy_count": 0,
            "protection_score": None,
            "next_renewal": None,
            "flagged_count": 0,
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
                AgentClient.status.in_(["active", "invited"]),
            )
        ).scalar_one_or_none()
        if existing_rel:
            raise HTTPException(status_code=400, detail="Already a client")

        rel = AgentClient(agent_id=agent.id, client_id=existing_user.id, status="active", invited_email=email)
        db.add(rel)
        log_action(db, agent.id, "created", "agent_client", existing_user.id, f"Linked existing user {email}")
        db.commit()
        return {"ok": True, "status": "active", "client_id": existing_user.id}
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

    policies = db.execute(
        select(Policy).where(Policy.user_id == client_id)
    ).scalars().all()

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

    return {
        "client": {"id": client.id, "email": client.email},
        "protection_score": score_row,
        "policies": policy_list,
        "gaps": gaps,
        "summary": summary,
        "upcoming_renewals": renewals,
        "flagged_items": flagged,
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
