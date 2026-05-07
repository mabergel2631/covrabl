import secrets
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func, distinct, or_, and_, delete as sa_delete
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .coverage_taxonomy import analyze_coverage_gaps, get_coverage_summary
from .db import get_db
from .models import User, Policy, Contact, PolicyDetail, Exposure
from .models_agency import AgencyMember
from .models_agent import AgentClient, AgentNote, AgentPolicyAccess
from .models_documents import Document
from .models_features import PolicyShare, CoverageScore, ComplianceCheck, LeaseRequirement, AuditLog, UserEvent, PolicyDelta, RenewalReview
from .routes_deltas import determine_delta_type, calculate_severity, TRACKED_FIELDS
from .storage import presign_put_url
from .audit_helper import log_action

router = APIRouter(prefix="/agent", tags=["agent"])


# Consumer-direct lines that most P&C agents/agencies don't write.
# Excluded from agent-side gap surfacing by default. Will move to a
# per-agency `lines_we_write` setting when the Organization model lands.
CONSUMER_ONLY_GAP_CATEGORIES: set[str] = {
    "health_insurance",
    "dental_insurance",
    "vision_insurance",
    "pet_insurance",
}

# Data-hygiene / preparedness gaps that are useful for individual consumers
# but pure noise on the agent surface (the agent is the data-keeper; they
# don't need to be told "add the claims phone number"). Always dropped in
# agent context regardless of whether the client holds a policy of that type.
AGENT_NOISE_GAP_CATEGORIES: set[str] = {
    "preparedness",       # "Missing Claims Contact" — agent is the data-keeper
    "incomplete_data",    # "Unknown Coverage Limit" — agent can fill these in directly
}


def _filter_gaps_for_agent_context(gaps: list[dict], policy_types: set[str]) -> list[dict]:
    """Drop gaps that don't add value on the agent surface.

    Two filters:
    1. Lines the agent isn't likely to write (health/dental/etc.) — kept only
       if the client already has a policy of that type.
    2. Data-hygiene / preparedness items (missing claims contact, etc.) — the
       agent is the data-keeper, not the recipient of these prompts.
    """
    filtered: list[dict] = []
    for g in gaps:
        category = g.get("category")
        if category in AGENT_NOISE_GAP_CATEGORIES:
            continue
        if category in CONSUMER_ONLY_GAP_CATEGORIES and not _category_in_policy_types(category, policy_types):
            continue
        filtered.append(g)
    return filtered


def _category_in_policy_types(category: str, policy_types: set[str]) -> bool:
    mapping = {
        "health_insurance": "health",
        "dental_insurance": "dental",
        "vision_insurance": "vision",
        "pet_insurance": "pet",
    }
    pt = mapping.get(category)
    return bool(pt and pt in policy_types)


# ── Auth helpers ────────────────────────────────────────


def require_agent(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("agent", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Agent role required")
    return user


def _agency_id_for(db: Session, user_id: int) -> int | None:
    """Return the agency_id of the user's primary active membership, or None.

    For phase 1 (Agency of One), each agent has exactly one membership.
    """
    return db.execute(
        select(AgencyMember.agency_id)
        .where(AgencyMember.user_id == user_id)
        .where(AgencyMember.status == "active")
        .order_by(AgencyMember.created_at.asc())
        .limit(1)
    ).scalar_one_or_none()


def _member_for(db: Session, user_id: int) -> AgencyMember | None:
    """Like _agency_id_for but returns the full AgencyMember row (for role checks)."""
    return db.execute(
        select(AgencyMember)
        .where(AgencyMember.user_id == user_id)
        .where(AgencyMember.status == "active")
        .order_by(AgencyMember.created_at.asc())
        .limit(1)
    ).scalar_one_or_none()


def _agency_client_filter(db: Session, agent: User):
    """Return a SQLAlchemy where-clause that scopes AgentClient rows to the
    caller's agency, falling back to the caller's agent_id if no membership
    exists yet (transitional safety for any rows pre-dating phase 1).

    Admins are NOT scoped — caller must handle that separately.
    """
    aid = _agency_id_for(db, agent.id)
    if aid is not None:
        # Belt-and-suspenders: include legacy rows where agent_id matches but
        # agency_id is somehow NULL (shouldn't happen post-backfill but cheap to keep).
        return or_(
            AgentClient.agency_id == aid,
            and_(AgentClient.agency_id.is_(None), AgentClient.agent_id == agent.id),
        )
    return AgentClient.agent_id == agent.id


def require_write_role(member: AgencyMember | None) -> AgencyMember:
    """Require an active membership with a non-Viewer role. Use on write endpoints."""
    if member is None:
        raise HTTPException(status_code=403, detail="Agency membership required")
    if member.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewer role cannot perform write actions")
    return member


def require_owner_role(member: AgencyMember | None) -> AgencyMember:
    """Require an active membership with the Owner role. Use on agency-management endpoints."""
    if member is None:
        raise HTTPException(status_code=403, detail="Agency membership required")
    if member.role != "owner":
        raise HTTPException(status_code=403, detail="Owner role required")
    return member


def _check_write_role(db: Session, agent: User) -> None:
    """Enforce write-role on the caller. Bypasses for platform admins.

    Agents with no membership (legacy users somehow not backfilled) are allowed
    through with a warning-equivalent: they retain their previous behavior.
    Once the backfill is verified everywhere, this fallback can be tightened.
    """
    if agent.role == "admin":
        return
    member = _member_for(db, agent.id)
    if member is None:
        return  # transitional fallback — no membership means no role to enforce
    require_write_role(member)


def _check_owner_role(db: Session, agent: User) -> None:
    """Enforce owner-role on the caller. Bypasses for platform admins."""
    if agent.role == "admin":
        return
    require_owner_role(_member_for(db, agent.id))


def _verify_client_access(db: Session, agent: User, client_id: int) -> User:
    """Verify agent has active relationship with client (via their agency), return client User."""
    # Admins can access any client
    if agent.role != "admin":
        rel = db.execute(
            select(AgentClient).where(
                _agency_client_filter(db, agent),
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
    """Get distinct client IDs visible to this agent.

    Admins see all non-admin, non-agent users.
    Agents see all clients of their agency (every member sees the same book).
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
            db.add(AgentClient(
                agent_id=agent.id, client_id=owner_id, status="active",
                agency_id=_agency_id_for(db, agent.id),
            ))
    if legacy_owner_ids:
        db.commit()

    rows = db.execute(
        select(distinct(AgentClient.client_id)).where(
            _agency_client_filter(db, agent),
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

    # Check if any visibility rows exist for this agency+client
    aid = _agency_id_for(db, agent.id)
    if aid is not None:
        access_filter = or_(
            AgentPolicyAccess.agency_id == aid,
            and_(AgentPolicyAccess.agency_id.is_(None), AgentPolicyAccess.agent_id == agent.id),
        )
    else:
        access_filter = AgentPolicyAccess.agent_id == agent.id
    access_rows = db.execute(
        select(AgentPolicyAccess).where(
            access_filter,
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

    agency_id = _agency_id_for(db, agent_id)
    for pid in policy_ids:
        if pid not in existing_set:
            db.add(AgentPolicyAccess(
                agent_id=agent_id, client_id=client_id,
                policy_id=pid, visible=True, agency_id=agency_id,
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
        return f"Renewal review needed: {expired[0]['title'].replace(' expired', '')} policy"

    compliance = [f for f in flagged_items if f.get("category") == "compliance_fail"]
    if compliance:
        return f"Discuss with broker: {compliance[0]['detail']}"

    urgent_renewals = [f for f in flagged_items if f.get("category") == "upcoming_renewal" and f.get("severity") == "high"]
    if urgent_renewals:
        return f"Renewal review: {urgent_renewals[0]['title']}"

    if gaps:
        return f"Review with broker: {gaps[0].get('name', 'coverage item')}"

    other_renewals = [f for f in flagged_items if f.get("category") == "upcoming_renewal"]
    if other_renewals:
        return f"Renewal review: {other_renewals[0]['title']}"

    return "On track — no review items at this time"


def _compute_what_to_do(flagged_items: list[dict], gaps: list[dict]) -> list[str]:
    """Return 2-4 actionable steps for the client detail page."""
    actions: list[str] = []

    for f in flagged_items:
        if f.get("category") == "expired_policy":
            actions.append(f"Renewal review needed: {f['title'].replace(' expired', '')} policy")
        elif f.get("category") == "compliance_fail":
            actions.append(f"Discuss with client: {f['detail']}")
        elif f.get("category") == "upcoming_renewal":
            actions.append(f"Renewal review: {f['title']}")

    # Only surface gaps with real signal — drop "info" severity to avoid
    # padding the list with generic "they don't have X" suggestions.
    for g in gaps:
        if g.get("severity") == "info":
            continue
        name = g.get("name", "coverage item")
        actions.append(f"Discuss with client: {name}")

    # Deduplicate while preserving order, cap at 4
    seen: set[str] = set()
    unique: list[str] = []
    for a in actions:
        if a not in seen:
            seen.add(a)
            unique.append(a)
        if len(unique) >= 4:
            break

    return unique if unique else ["Nothing flagged right now — review at next renewal"]


def _flagged_items_for_client(db: Session, client_id: int, policies: list[Policy]) -> list[dict]:
    """Aggregate flagged items for a client: expired policies, upcoming renewals, compliance failures."""
    items = []
    today = datetime.now().date()

    # Skip flagging expired policies that have been renewed (they're historical
    # predecessors in a replaces_policy_id chain — being expired is by design,
    # not an outstanding issue).
    replaced_ids = {p.replaces_policy_id for p in policies if p.replaces_policy_id}

    for p in policies:
        # Expired policies — only flag if it's an orphan (not the prior version
        # of a renewal chain).
        if p.status == "expired" and p.id not in replaced_ids:
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
        role = lr.role if lr else "unknown"
        if role == "landlord":
            role_desc = "Tenant does not meet"
        elif role == "tenant":
            role_desc = "Does not meet landlord's"
        else:
            role_desc = "Does not meet"
        items.append({
            "category": "compliance_fail",
            "severity": "high",
            "title": f"{role_desc} requirements: {label}",
            "detail": f"{check.fail_count} of {check.fail_count + check.pass_count} requirement(s) not met",
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

    # Also include invited and pending clients (agency-wide)
    non_active = db.execute(
        select(AgentClient).where(
            _agency_client_filter(db, agent),
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
        client_policy_types = {(p.policy_type or "").lower() for p in policies}
        gaps = _filter_gaps_for_agent_context(gaps, client_policy_types)

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

    # Enrich with producer assignment (agency-scoped)
    if clients:
        from .models_profile import UserProfile
        active_rels = db.execute(
            select(AgentClient).where(
                _agency_client_filter(db, agent),
                AgentClient.status == "active",
                AgentClient.client_id.in_([c["id"] for c in clients]),
            )
        ).scalars().all()
        producer_by_client = {r.client_id: r.producer_member_id for r in active_rels if r.producer_member_id}
        # Resolve producer member -> user -> display name
        producer_names: dict[int, str] = {}
        if producer_by_client:
            for member_id in set(producer_by_client.values()):
                m = db.get(AgencyMember, member_id)
                if m and m.user_id:
                    name = db.execute(
                        select(UserProfile.full_name).where(UserProfile.user_id == m.user_id)
                    ).scalar()
                    if not name:
                        u = db.get(User, m.user_id)
                        name = u.email if u else None
                    if name:
                        producer_names[member_id] = name
        for c in clients:
            pmid = producer_by_client.get(c["id"])
            c["producer_member_id"] = pmid
            c["producer_name"] = producer_names.get(pmid) if pmid else None

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
            "producer_member_id": None,
            "producer_name": None,
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
    _check_write_role(db, agent)
    email = payload.email.strip().lower()
    if email == agent.email:
        raise HTTPException(status_code=400, detail="Cannot invite yourself")

    existing_user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()

    if existing_user:
        # Check if relationship already exists
        existing_rel = db.execute(
            select(AgentClient).where(
                _agency_client_filter(db, agent),
                AgentClient.client_id == existing_user.id,
                AgentClient.status.in_(["active", "pending", "invited"]),
            )
        ).scalar_one_or_none()
        if existing_rel:
            raise HTTPException(status_code=400, detail="Already a client")

        # Set to "pending" — client must accept before agent can see data
        rel = AgentClient(
            agent_id=agent.id, client_id=existing_user.id, status="pending",
            invited_email=email, agency_id=_agency_id_for(db, agent.id),
        )
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
        rel = AgentClient(
            agent_id=agent.id, client_id=None, status="invited",
            invited_email=email, invite_token=invite_token,
            agency_id=_agency_id_for(db, agent.id),
        )
        db.add(rel)
        log_action(db, agent.id, "created", "agent_client_invite", 0, f"Invited {email}")
        db.commit()

        # Send invite email
        _raw_url = settings.app_url.rstrip("/")
        app_url = _raw_url if "localhost" not in _raw_url and "127.0.0.1" not in _raw_url else "https://covrabl.vercel.app"
        invite_url = f"{app_url}/login?invite={invite_token}"

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
            "replaces_policy_id": p.replaces_policy_id,
        })

    score_row = db.execute(
        select(CoverageScore.score_total).where(
            CoverageScore.user_id == client_id,
            CoverageScore.category == "overall",
        )
    ).scalar()

    gaps = analyze_coverage_gaps(policy_dicts)
    client_policy_types = {(p.policy_type or "").lower() for p in policies}
    gaps = _filter_gaps_for_agent_context(gaps, client_policy_types)
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

    # Producer assignment (agency-scoped)
    producer_member_id: int | None = None
    producer_name: str | None = None
    rel = db.execute(
        select(AgentClient).where(
            _agency_client_filter(db, agent),
            AgentClient.client_id == client_id,
            AgentClient.status == "active",
        )
    ).scalar_one_or_none()
    if rel and rel.producer_member_id:
        producer_member_id = rel.producer_member_id
        m = db.get(AgencyMember, rel.producer_member_id)
        if m and m.user_id:
            from .models_profile import UserProfile
            name = db.execute(
                select(UserProfile.full_name).where(UserProfile.user_id == m.user_id)
            ).scalar()
            if not name:
                u = db.get(User, m.user_id)
                if u:
                    name = u.email
            producer_name = name

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
        "producer_member_id": producer_member_id,
        "producer_name": producer_name,
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
        from .storage import presign_get_url
        download_url = presign_get_url(doc.object_key) if doc.object_key else None
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
            "download_url": download_url,
            "uploaded_by": uploaded_by,
        })

    return results


@router.post("/clients/{client_id}/documents/init")
def init_client_upload(client_id: int, payload: ClientUploadInit, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _check_write_role(db, agent)
    _verify_client_access(db, agent, client_id)

    p = db.get(Policy, payload.policy_id)
    if not p or p.user_id != client_id:
        raise HTTPException(status_code=404, detail="Policy not found for this client")

    object_key = f"policies/{p.scope}/{payload.policy_id}/{uuid.uuid4()}-{payload.filename}"
    upload_url = presign_put_url(object_key, payload.content_type)
    return {"upload_url": upload_url, "object_key": object_key}


@router.post("/clients/{client_id}/documents/finalize")
def finalize_client_upload(client_id: int, payload: ClientUploadFinalize, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _check_write_role(db, agent)
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

    aid = _agency_id_for(db, agent.id)
    if aid is not None:
        note_filter = or_(
            AgentNote.agency_id == aid,
            and_(AgentNote.agency_id.is_(None), AgentNote.agent_id == agent.id),
        )
    else:
        note_filter = AgentNote.agent_id == agent.id
    rows = db.execute(
        select(AgentNote).where(
            note_filter,
            AgentNote.client_id == client_id,
        ).order_by(AgentNote.created_at.desc())
    ).scalars().all()

    # Resolve author display names (lightweight — single round trip)
    author_ids = {n.agent_id for n in rows}
    author_names: dict[int, str] = {}
    if author_ids:
        from .models_profile import UserProfile
        for uid in author_ids:
            profile_name = db.execute(
                select(UserProfile.full_name).where(UserProfile.user_id == uid)
            ).scalar()
            if profile_name:
                author_names[uid] = profile_name
            else:
                u = db.get(User, uid)
                if u:
                    author_names[uid] = u.email

    return [
        {
            "id": n.id,
            "content": n.content,
            "created_at": str(n.created_at) if n.created_at else None,
            "author_id": n.agent_id,
            "author_name": author_names.get(n.agent_id),
        }
        for n in rows
    ]


@router.post("/clients/{client_id}/notes")
def add_note(client_id: int, payload: NoteRequest, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _check_write_role(db, agent)
    _verify_client_access(db, agent, client_id)

    note = AgentNote(
        agent_id=agent.id, client_id=client_id,
        content=payload.content.strip(),
        agency_id=_agency_id_for(db, agent.id),
    )
    db.add(note)
    db.flush()
    log_action(db, agent.id, "created", "agent_note", note.id)
    db.commit()
    db.refresh(note)
    return {"id": note.id, "content": note.content, "created_at": str(note.created_at)}


@router.delete("/clients/{client_id}/notes/{note_id}")
def delete_note(client_id: int, note_id: int, agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    _check_write_role(db, agent)
    _verify_client_access(db, agent, client_id)

    note = db.get(AgentNote, note_id)
    if not note or note.client_id != client_id:
        raise HTTPException(status_code=404, detail="Note not found")
    # Author can always delete; Owners can delete any note in their agency
    member = _member_for(db, agent.id)
    aid = member.agency_id if member else None
    is_author = note.agent_id == agent.id
    is_owner_in_agency = member is not None and member.role == "owner" and (
        note.agency_id == aid or (note.agency_id is None and note.agent_id == agent.id)
    )
    if not (is_author or is_owner_in_agency or agent.role == "admin"):
        raise HTTPException(status_code=403, detail="Only the author or an Owner can delete this note")

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
    _check_write_role(db, agent)
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
            agency_id=_agency_id_for(db, agent.id),
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
                agency_id=rel.agency_id,
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
            agency_id=_agency_id_for(db, agent_id),
        ))

    log_action(db, user.id, "updated", "policy_visibility", policy_id,
               f"Set visible={payload.visible} for agent {agent_id}")
    db.commit()
    return {"ok": True, "visible": payload.visible}


# ── Client activity feed ───────────────────────────────


def _humanize_audit_event(action: str, entity_type: str) -> str | None:
    """Map (action, entity_type) -> human label for the agent's view of client activity.
    Return None to skip noisy or agent-side events.
    """
    a, t = (action or "").lower(), (entity_type or "").lower()
    if a == "uploaded" and t in ("document", "policy_document"):
        return "Uploaded a document"
    if a == "created" and t == "policy":
        return "Added a policy"
    if a == "created" and t == "claim":
        return "Filed a claim"
    if a == "created" and t == "compliance_check":
        return "Ran a compliance check"
    if a == "created" and t == "emergency_card":
        return "Created an ICE card"
    if a == "updated" and t == "policy":
        return "Updated a policy"
    return None


def _humanize_user_event(event_name: str, page_path: str | None) -> str | None:
    """Map UserEvent -> human label. Return None for noisy/internal events."""
    name = (event_name or "").lower()
    path = page_path or ""
    if name in ("login_success", "session_start"):
        return "Logged in"
    if name == "chat_send":
        return "Asked Covrabl a question"
    if name in ("chat_view", "page_view") and "/chat" in path:
        return "Opened the Ask Covrabl chat"
    if name == "page_view" and "/compliance-report/" in path:
        return "Viewed their compliance report"
    if name == "page_view" and "/policies/" in path:
        return "Viewed a policy"
    if name == "page_view" and "/ice/" in path:
        return "Opened their ICE card"
    return None


@router.get("/clients/{client_id}/activity")
def client_activity(
    client_id: int,
    limit: int = 8,
    days: int = 60,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Recent activity for a client — upload/policy events plus behavioral signals.
    Used to give agents talking points for the next call.
    """
    _verify_client_access(db, agent, client_id)
    cutoff = datetime.now() - timedelta(days=max(1, min(days, 365)))
    items: list[dict] = []

    audit_rows = db.execute(
        select(AuditLog).where(
            AuditLog.user_id == client_id,
            AuditLog.created_at >= cutoff,
        ).order_by(AuditLog.created_at.desc()).limit(50)
    ).scalars().all()
    for row in audit_rows:
        label = _humanize_audit_event(row.action, row.entity_type)
        if not label:
            continue
        items.append({
            "type": "action",
            "label": label,
            "timestamp": row.created_at.isoformat() if row.created_at else None,
        })

    event_rows = db.execute(
        select(UserEvent).where(
            UserEvent.user_id == client_id,
            UserEvent.created_at >= cutoff,
        ).order_by(UserEvent.created_at.desc()).limit(150)
    ).scalars().all()
    seen_buckets: set[tuple[str, str]] = set()
    for row in event_rows:
        label = _humanize_user_event(row.event_name, row.page_path)
        if not label:
            continue
        # Collapse duplicates that occur the same calendar day so a flurry of
        # page views doesn't drown out other signals.
        bucket_day = row.created_at.date().isoformat() if row.created_at else ""
        bucket = (label, bucket_day)
        if bucket in seen_buckets:
            continue
        seen_buckets.add(bucket)
        items.append({
            "type": "behavior",
            "label": label,
            "timestamp": row.created_at.isoformat() if row.created_at else None,
        })

    items.sort(key=lambda x: x["timestamp"] or "", reverse=True)
    last_seen = items[0]["timestamp"] if items else None
    return {
        "items": items[:limit],
        "last_seen": last_seen,
        "total": len(items),
    }


# ── Renewal review ─────────────────────────────────────


class LinkRenewalRequest(BaseModel):
    previous_policy_id: int


class RenewalReviewUpdate(BaseModel):
    summary_text: str | None = None


def _serialize_policy_brief(p: Policy) -> dict:
    return {
        "id": p.id,
        "carrier": p.carrier,
        "policy_type": p.policy_type,
        "policy_number": p.policy_number,
        "renewal_date": str(p.renewal_date) if p.renewal_date else None,
        "premium_amount": p.premium_amount,
        "coverage_amount": p.coverage_amount,
        "deductible": p.deductible,
    }


def _renewal_review_payload(db: Session, policy: Policy) -> dict:
    """Build the renewal-review response payload for a renewing policy."""
    review = db.execute(
        select(RenewalReview).where(RenewalReview.policy_id == policy.id)
    ).scalar_one_or_none()

    deltas = db.execute(
        select(PolicyDelta)
        .where(PolicyDelta.policy_id == policy.id)
        .order_by(PolicyDelta.created_at.asc())
    ).scalars().all()

    previous_policy_brief: dict | None = None
    previous_policy_obj: Policy | None = None
    if policy.replaces_policy_id:
        prev = db.get(Policy, policy.replaces_policy_id)
        if prev:
            previous_policy_obj = prev
            previous_policy_brief = _serialize_policy_brief(prev)

    delta_list = [
        {
            "id": d.id,
            "field_key": d.field_key,
            "old_value": d.old_value,
            "new_value": d.new_value,
            "delta_type": d.delta_type,
            "severity": d.severity,
        }
        for d in deltas
    ]

    # Compute observational "Items to Discuss" from the delta pattern
    from .coverage_review_rules import compute_discussion_items
    discussion_items = compute_discussion_items(
        _serialize_policy_brief(policy),
        previous_policy_brief,
        delta_list,
    )

    return {
        "policy": _serialize_policy_brief(policy),
        "previous_policy": previous_policy_brief,
        "deltas": delta_list,
        "summary_text": review.summary_text if review else None,
        "share_token": review.share_token if review else None,
        "shared_at": review.shared_at.isoformat() if (review and review.shared_at) else None,
        "discussion_items": discussion_items,
    }


@router.post("/clients/{client_id}/policies/{policy_id}/link-renewal")
def link_renewal(
    client_id: int,
    policy_id: int,
    payload: LinkRenewalRequest,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Mark policy_id as a renewal of payload.previous_policy_id.

    Sets Policy.replaces_policy_id, computes PolicyDelta rows comparing the
    renewing policy's tracked fields against the prior policy, and creates
    an empty RenewalReview the agent can author against.
    """
    _check_write_role(db, agent)
    _verify_client_access(db, agent, client_id)

    new_policy = db.get(Policy, policy_id)
    if not new_policy or new_policy.user_id != client_id:
        raise HTTPException(status_code=404, detail="Policy not found for this client")
    old_policy = db.get(Policy, payload.previous_policy_id)
    if not old_policy or old_policy.user_id != client_id:
        raise HTTPException(status_code=404, detail="Previous policy not found for this client")
    if old_policy.id == new_policy.id:
        raise HTTPException(status_code=400, detail="Cannot link a policy to itself")

    new_policy.replaces_policy_id = old_policy.id

    # Replace any existing renewal-deltas for the new policy so re-linking
    # gives a clean diff and we don't accumulate stale comparisons.
    db.execute(
        sa_delete(PolicyDelta).where(PolicyDelta.policy_id == new_policy.id)
    )

    for field in TRACKED_FIELDS:
        old_value = getattr(old_policy, field, None)
        new_value = getattr(new_policy, field, None)
        if old_value is None and new_value is None:
            continue
        old_str = str(old_value) if old_value is not None else None
        new_str = str(new_value) if new_value is not None else None
        if old_str == new_str:
            continue
        delta_type = determine_delta_type(field, old_str, new_str)
        severity = calculate_severity(field, old_str, new_str, delta_type)
        db.add(PolicyDelta(
            policy_id=new_policy.id,
            field_key=field,
            old_value=old_str,
            new_value=new_str,
            delta_type=delta_type,
            severity=severity,
        ))

    review = db.execute(
        select(RenewalReview).where(RenewalReview.policy_id == new_policy.id)
    ).scalar_one_or_none()
    if not review:
        db.add(RenewalReview(
            policy_id=new_policy.id,
            agent_id=agent.id,
            agency_id=_agency_id_for(db, agent.id),
            summary_text=None,
        ))

    log_action(
        db, client_id, "linked_renewal", "policy", new_policy.id,
        f"Linked as renewal of policy {old_policy.id} by agent {agent.id}",
    )
    db.commit()
    db.refresh(new_policy)
    return _renewal_review_payload(db, new_policy)


@router.delete("/clients/{client_id}/policies/{policy_id}/link-renewal")
def unlink_renewal(
    client_id: int,
    policy_id: int,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Remove the renewal linkage and clear computed deltas + review row."""
    _check_write_role(db, agent)
    _verify_client_access(db, agent, client_id)
    new_policy = db.get(Policy, policy_id)
    if not new_policy or new_policy.user_id != client_id:
        raise HTTPException(status_code=404, detail="Policy not found for this client")

    new_policy.replaces_policy_id = None
    db.execute(sa_delete(PolicyDelta).where(PolicyDelta.policy_id == policy_id))
    db.execute(sa_delete(RenewalReview).where(RenewalReview.policy_id == policy_id))
    log_action(db, client_id, "unlinked_renewal", "policy", policy_id, f"By agent {agent.id}")
    db.commit()
    return {"ok": True}


@router.get("/policies/{policy_id}/renewal-review")
def get_renewal_review(
    policy_id: int,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Get the renewal review for a policy: deltas + agent summary + share state."""
    policy = db.get(Policy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    _verify_client_access(db, agent, policy.user_id)
    return _renewal_review_payload(db, policy)


@router.put("/policies/{policy_id}/renewal-review")
def update_renewal_review(
    policy_id: int,
    payload: RenewalReviewUpdate,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Upsert the agent-authored summary on a renewal review."""
    _check_write_role(db, agent)
    policy = db.get(Policy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    _verify_client_access(db, agent, policy.user_id)

    review = db.execute(
        select(RenewalReview).where(RenewalReview.policy_id == policy_id)
    ).scalar_one_or_none()
    if not review:
        review = RenewalReview(
            policy_id=policy_id,
            agent_id=agent.id,
            agency_id=_agency_id_for(db, agent.id),
        )
        db.add(review)

    review.summary_text = (payload.summary_text or "").strip() or None
    db.commit()
    db.refresh(policy)
    return _renewal_review_payload(db, policy)


@router.post("/policies/{policy_id}/renewal-review/share")
def share_renewal_review(
    policy_id: int,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Generate (or return existing) share token for the renewal review."""
    _check_write_role(db, agent)
    policy = db.get(Policy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    _verify_client_access(db, agent, policy.user_id)

    review = db.execute(
        select(RenewalReview).where(RenewalReview.policy_id == policy_id)
    ).scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="No renewal review yet")
    if not review.share_token:
        review.share_token = secrets.token_urlsafe(24)
        review.shared_at = datetime.now()
    db.commit()
    return {
        "share_token": review.share_token,
        "shared_at": review.shared_at.isoformat() if review.shared_at else None,
    }


@router.delete("/policies/{policy_id}/renewal-review/share")
def revoke_renewal_share(
    policy_id: int,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Revoke the public share link."""
    _check_write_role(db, agent)
    policy = db.get(Policy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    _verify_client_access(db, agent, policy.user_id)
    review = db.execute(
        select(RenewalReview).where(RenewalReview.policy_id == policy_id)
    ).scalar_one_or_none()
    if review:
        review.share_token = None
        review.shared_at = None
        db.commit()
    return {"ok": True}


# ── Agency: producer assignment ─────────────────────────


class ProducerAssignmentRequest(BaseModel):
    producer_member_id: int | None  # null = unassign


@router.put("/clients/{client_id}/producer")
def assign_producer(
    client_id: int,
    payload: ProducerAssignmentRequest,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Set or clear the producer (agency_member) responsible for this client.

    Owner-only for now; phase 3 may extend to producers managing their own
    book if requested.
    """
    _check_owner_role(db, agent)
    _verify_client_access(db, agent, client_id)

    aid = _agency_id_for(db, agent.id)
    rel = db.execute(
        select(AgentClient).where(
            _agency_client_filter(db, agent),
            AgentClient.client_id == client_id,
            AgentClient.status == "active",
        )
    ).scalar_one_or_none()
    if not rel:
        raise HTTPException(status_code=404, detail="No active client relationship")

    if payload.producer_member_id is not None:
        member = db.get(AgencyMember, payload.producer_member_id)
        if not member or member.agency_id != aid or member.status != "active":
            raise HTTPException(status_code=400, detail="Producer is not an active member of your agency")
        rel.producer_member_id = payload.producer_member_id
    else:
        rel.producer_member_id = None
    db.commit()
    return {
        "client_id": client_id,
        "producer_member_id": rel.producer_member_id,
    }


# ── Demo: seed prior-year sample (admin/owner only) ────


@router.post("/clients/{client_id}/policies/{policy_id}/seed-prior-year")
def seed_prior_year_sample(
    client_id: int,
    policy_id: int,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Create a realistic prior-year version of an existing policy and link it
    as the renewal anchor. Owner/admin only — for demo and testing.

    Generates deterministic adjustments (premium ~10% lower, deductible ~50%
    lower or equivalent, possibly a different carrier) so the resulting
    renewal review has meaningful deltas to display.
    """
    _check_owner_role(db, agent)
    _verify_client_access(db, agent, client_id)

    current = db.get(Policy, policy_id)
    if not current or current.user_id != client_id:
        raise HTTPException(status_code=404, detail="Policy not found for this client")

    if current.replaces_policy_id:
        raise HTTPException(status_code=400, detail="Policy already has a prior-year linked")

    from datetime import date as date_type
    from .routes_deltas import TRACKED_FIELDS, determine_delta_type, calculate_severity

    # Adjust fields for a realistic prior year
    prior_carrier_map = {
        "chubb": "Travelers", "travelers": "Liberty Mutual", "state farm": "GEICO",
        "geico": "Progressive", "progressive": "State Farm", "liberty mutual": "Allstate",
        "allstate": "Travelers",
    }
    prior_carrier = prior_carrier_map.get(
        (current.carrier or "").lower().strip(),
        current.carrier or "Prior Carrier",
    )
    prior_premium = int((current.premium_amount or 1000) * 0.90)
    prior_coverage = int((current.coverage_amount or 100000) * 0.85) if current.coverage_amount else None
    prior_deductible = int((current.deductible or 1000) * 0.5) if current.deductible else None
    prior_renewal_date = current.renewal_date - timedelta(days=365) if current.renewal_date else (date_type.today() - timedelta(days=200))

    prior = Policy(
        user_id=current.user_id,
        exposure_id=current.exposure_id,
        scope=current.scope,
        policy_type=current.policy_type,
        carrier=prior_carrier,
        policy_number=f"{(current.policy_number or 'POL').rstrip('0123456789-_')}-PRIOR",
        nickname=current.nickname,
        coverage_amount=prior_coverage,
        deductible=prior_deductible,
        premium_amount=prior_premium,
        renewal_date=prior_renewal_date,
        status="expired",
    )
    db.add(prior)
    db.flush()

    # Link current → prior
    current.replaces_policy_id = prior.id

    # Compute deltas (clear any existing first, in case of re-runs)
    db.execute(sa_delete(PolicyDelta).where(PolicyDelta.policy_id == current.id))
    for field in TRACKED_FIELDS:
        old_v = getattr(prior, field)
        new_v = getattr(current, field)
        if old_v == new_v or (not old_v and not new_v):
            continue
        old_str = str(old_v) if old_v is not None else None
        new_str = str(new_v) if new_v is not None else None
        if old_str == new_str:
            continue
        dt = determine_delta_type(field, old_str, new_str)
        sev = calculate_severity(field, old_str, new_str, dt)
        db.add(PolicyDelta(
            policy_id=current.id,
            field_key=field,
            old_value=old_str,
            new_value=new_str,
            delta_type=dt,
            severity=sev,
        ))

    # Create empty RenewalReview for the agent to author against
    existing_review = db.execute(
        select(RenewalReview).where(RenewalReview.policy_id == current.id)
    ).scalar_one_or_none()
    if not existing_review:
        db.add(RenewalReview(
            policy_id=current.id,
            agent_id=agent.id,
            agency_id=_agency_id_for(db, agent.id),
        ))

    db.commit()
    db.refresh(current)
    return {
        "ok": True,
        "prior_policy_id": prior.id,
        "current_policy_id": current.id,
    }


# ── Agency: introspection ───────────────────────────────


@router.get("/agency/me")
def get_my_agency_membership(agent: User = Depends(require_agent), db: Session = Depends(get_db)):
    """Return the caller's primary agency context (or null fields if none).

    UI uses this to know whether to surface owner-only affordances and to
    display the agency name on team-aware screens.
    """
    member = _member_for(db, agent.id)
    if member is None:
        return {
            "member_id": None,
            "agency_id": None,
            "agency_name": None,
            "role": None,
        }
    from .models_agency import Agency
    agency = db.get(Agency, member.agency_id)
    return {
        "member_id": member.id,
        "agency_id": member.agency_id,
        "agency_name": agency.name if agency else None,
        "role": member.role,
    }


@router.get("/agency/members")
def list_agency_members(
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
    include_invited: bool = True,
):
    """List members of the caller's agency. By default returns active + invited
    (removed members always excluded). Display order: status (active first),
    then role priority, then name.
    """
    aid = _agency_id_for(db, agent.id)
    if aid is None:
        return []

    statuses = ["active", "invited"] if include_invited else ["active"]
    members = db.execute(
        select(AgencyMember).where(
            AgencyMember.agency_id == aid,
            AgencyMember.status.in_(statuses),
        )
    ).scalars().all()

    from .models_profile import UserProfile
    out: list[dict] = []
    for m in members:
        name = None
        email = m.invited_email
        if m.user_id:
            name = db.execute(
                select(UserProfile.full_name).where(UserProfile.user_id == m.user_id)
            ).scalar()
            u = db.get(User, m.user_id)
            if u:
                email = u.email
                if not name:
                    name = u.email
        out.append({
            "member_id": m.id,
            "user_id": m.user_id,
            "name": name,
            "email": email,
            "role": m.role,
            "status": m.status,
        })

    # Active first, then by role priority, then alphabetical by name
    status_order = {"active": 0, "invited": 1}
    role_order = {"owner": 0, "producer": 1, "csr": 2, "viewer": 3}
    out.sort(key=lambda x: (
        status_order.get(x["status"], 99),
        role_order.get(x["role"], 99),
        (x["name"] or x["email"] or "").lower(),
    ))
    return out


# ── Agency: team management (Owner-only writes) ─────────


VALID_ROLES = {"owner", "producer", "csr", "viewer"}


class MemberInviteRequest(BaseModel):
    email: str
    role: str  # owner | producer | csr | viewer


class MemberRoleUpdate(BaseModel):
    role: str


class AcceptInviteRequest(BaseModel):
    token: str


class AgencyUpdateRequest(BaseModel):
    name: str | None = None
    brand_logo_url: str | None = None
    brand_color: str | None = None


def _count_active_owners(db: Session, agency_id: int) -> int:
    return db.execute(
        select(func.count(AgencyMember.id)).where(
            AgencyMember.agency_id == agency_id,
            AgencyMember.role == "owner",
            AgencyMember.status == "active",
        )
    ).scalar() or 0


@router.post("/agency/members/invite")
async def invite_agency_member(
    payload: MemberInviteRequest,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Invite a new member to the caller's agency. Owner-only."""
    _check_owner_role(db, agent)

    role = payload.role.strip().lower()
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")

    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    if email == agent.email:
        raise HTTPException(status_code=400, detail="You're already a member")

    aid = _agency_id_for(db, agent.id)
    if aid is None:
        raise HTTPException(status_code=403, detail="No agency membership")

    # Check for existing active or invited member with same email
    existing_user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing_user:
        active = db.execute(
            select(AgencyMember).where(
                AgencyMember.agency_id == aid,
                AgencyMember.user_id == existing_user.id,
                AgencyMember.status.in_(("active", "invited")),
            )
        ).scalar_one_or_none()
        if active:
            raise HTTPException(status_code=400, detail="Already a member or invited")

    # Check for outstanding invite by email
    outstanding = db.execute(
        select(AgencyMember).where(
            AgencyMember.agency_id == aid,
            AgencyMember.invited_email == email,
            AgencyMember.status == "invited",
        )
    ).scalar_one_or_none()
    if outstanding:
        raise HTTPException(status_code=400, detail="Invite already pending for this email")

    invite_token = secrets.token_urlsafe(32)
    new_member = AgencyMember(
        agency_id=aid,
        user_id=existing_user.id if existing_user else None,
        role=role,
        # If user already exists, mark active immediately so they don't have to accept
        status="active" if existing_user else "invited",
        invited_email=email,
        invite_token=invite_token if not existing_user else None,
    )
    db.add(new_member)
    db.commit()
    db.refresh(new_member)

    # Promote User.role to "agent" if they were an individual user — they're now staff
    if existing_user and existing_user.role == "individual":
        existing_user.role = "agent"
        db.commit()

    # Send email if not already a member
    if not existing_user:
        from .models_agency import Agency
        agency = db.get(Agency, aid)
        agency_name = agency.name if agency else "your agency"
        _raw_url = settings.app_url.rstrip("/")
        app_url = _raw_url if "localhost" not in _raw_url and "127.0.0.1" not in _raw_url else "https://covrabl.vercel.app"
        invite_url = f"{app_url}/login?team_invite={invite_token}"
        try:
            from .email import send_agency_member_invite_email
            await send_agency_member_invite_email(email, agent.email, agency_name, role, invite_url)
        except Exception:
            pass  # email failure shouldn't block

    return {
        "member_id": new_member.id,
        "status": new_member.status,
        "email": email,
        "role": role,
    }


@router.put("/agency/members/{member_id}/role")
def update_member_role(
    member_id: int,
    payload: MemberRoleUpdate,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Change a member's role. Owner-only. Cannot demote the last Owner."""
    _check_owner_role(db, agent)
    role = payload.role.strip().lower()
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")

    aid = _agency_id_for(db, agent.id)
    member = db.get(AgencyMember, member_id)
    if not member or member.agency_id != aid:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.status != "active":
        raise HTTPException(status_code=400, detail="Cannot change role of a non-active member")

    if member.role == "owner" and role != "owner":
        # Demoting an owner — protect last Owner
        if _count_active_owners(db, aid) <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last Owner")

    member.role = role
    db.commit()
    return {"member_id": member.id, "role": member.role}


@router.delete("/agency/members/{member_id}")
def remove_member(
    member_id: int,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Soft-delete a member (sets status='removed'). Owner-only. Cannot remove last Owner."""
    _check_owner_role(db, agent)
    aid = _agency_id_for(db, agent.id)
    member = db.get(AgencyMember, member_id)
    if not member or member.agency_id != aid:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.status == "removed":
        return {"ok": True, "already_removed": True}

    if member.role == "owner" and _count_active_owners(db, aid) <= 1:
        raise HTTPException(status_code=400, detail="Cannot remove the last Owner")

    member.status = "removed"
    member.removed_at = datetime.now()
    db.commit()
    return {"ok": True, "member_id": member.id}


@router.post("/agency/members/accept-invite")
def accept_team_invite(
    payload: AcceptInviteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bind an invited AgencyMember row to the calling user. Auth required."""
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token required")

    member = db.execute(
        select(AgencyMember).where(
            AgencyMember.invite_token == token,
            AgencyMember.status == "invited",
        )
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Invite not found or already accepted")

    if member.invited_email and member.invited_email.lower() != user.email.lower():
        raise HTTPException(status_code=403, detail="This invite was sent to a different email")

    member.user_id = user.id
    member.status = "active"
    member.invite_token = None
    # Promote to "agent" role if user was an individual
    if user.role == "individual":
        user.role = "agent"
    db.commit()

    from .models_agency import Agency
    agency = db.get(Agency, member.agency_id)
    return {
        "member_id": member.id,
        "agency_id": member.agency_id,
        "agency_name": agency.name if agency else None,
        "role": member.role,
    }


class CreateAgencyRequest(BaseModel):
    name: str | None = None  # defaults to email if omitted


@router.post("/agency")
def create_agency(
    payload: CreateAgencyRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create an Agency-of-One for the calling user and make them Owner.

    Idempotent: if the user is already a member of any agency, returns that
    agency's context instead of creating a new one. Lets any registered user
    self-serve into the agency model — useful for users (incl. admins) whose
    accounts pre-dated the agency-model migration.
    """
    existing = _member_for(db, user.id)
    if existing is not None:
        from .models_agency import Agency
        agency = db.get(Agency, existing.agency_id)
        return {
            "agency_id": existing.agency_id,
            "agency_name": agency.name if agency else None,
            "role": existing.role,
            "created": False,
        }

    name = (payload.name or "").strip() or (user.email or f"Agency {user.id}")
    slug_base = f"agency-{user.id}"
    # Ensure slug uniqueness (defensive — should already be unique by user_id)
    from .models_agency import Agency
    slug = slug_base
    counter = 1
    while db.execute(select(Agency).where(Agency.slug == slug)).scalar_one_or_none():
        counter += 1
        slug = f"{slug_base}-{counter}"

    agency = Agency(name=name, slug=slug)
    db.add(agency)
    db.flush()
    member = AgencyMember(
        agency_id=agency.id,
        user_id=user.id,
        role="owner",
        status="active",
    )
    db.add(member)

    # Stamp existing agent-side rows so the user's previously-collected
    # clients/notes/reviews fall under the new agency
    db.execute(
        AgentClient.__table__.update()
        .where(AgentClient.agent_id == user.id)
        .where(AgentClient.agency_id.is_(None))
        .values(agency_id=agency.id)
    )
    db.execute(
        AgentNote.__table__.update()
        .where(AgentNote.agent_id == user.id)
        .where(AgentNote.agency_id.is_(None))
        .values(agency_id=agency.id)
    )
    db.execute(
        RenewalReview.__table__.update()
        .where(RenewalReview.agent_id == user.id)
        .where(RenewalReview.agency_id.is_(None))
        .values(agency_id=agency.id)
    )
    # Also promote User.role to "agent" if they were "individual"
    if user.role == "individual":
        user.role = "agent"
    db.commit()

    return {
        "agency_id": agency.id,
        "agency_name": agency.name,
        "role": "owner",
        "created": True,
    }


@router.put("/agency")
def update_agency(
    payload: AgencyUpdateRequest,
    agent: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Update agency name + brand. Owner-only."""
    _check_owner_role(db, agent)
    aid = _agency_id_for(db, agent.id)
    from .models_agency import Agency
    agency = db.get(Agency, aid)
    if not agency:
        raise HTTPException(status_code=404, detail="Agency not found")

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        agency.name = name
    if payload.brand_logo_url is not None:
        agency.brand_logo_url = payload.brand_logo_url.strip() or None
    if payload.brand_color is not None:
        agency.brand_color = payload.brand_color.strip() or None
    db.commit()
    return {
        "agency_id": agency.id,
        "name": agency.name,
        "brand_logo_url": agency.brand_logo_url,
        "brand_color": agency.brand_color,
    }
