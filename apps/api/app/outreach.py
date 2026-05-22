"""Phase 7: "This Week" outreach feed.

Computes a ranked list of clients an agent should contact next, with reasons
that are strictly observational (document- or behavior-grounded — never
predictive scoring or AI-flagged urgency).

Per locked memory `project_outreach_feed.md`:
- Reasons must trace back to a real event in the DB (renewal date, document
  upload, share-token view, etc.)
- Banned framings: "low engagement", "likely to churn", "AI score elevated"
- Suggested actions use approved verbs: "Schedule renewal call",
  "Review with client", "Discuss", "Re-engage", "Review"
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from .models import Policy, User
from .models_features import AuditLog, UserEvent
from .renewal_config import (
    STAGE_LABELS,
    STAGE_COLORS,
    STAGE_SEVERITY,
    STAGE_REASON_TEMPLATES,
    STAGE_SUGGESTED_ACTIONS,
    classify_stage,
    resolve_thresholds,
    _normalize_policy_type,
)


# ── Tunable thresholds ──────────────────────────────────


# Hard cap on the wider renewal window — covers commercial 120/90/60/30
# defaults so a single DB query pulls everything the classifier might
# care about. classify_stage() does the per-policy-type filtering after.
RENEWAL_MAX_WINDOW_DAYS = 120
STALLED_DAYS = 90               # client with no recent activity
RECENT_UPLOAD_DAYS = 14         # client uploaded a doc in last N days
RECENT_SHARE_VIEW_DAYS = 7      # client opened a share link in last N days

MAX_ITEMS = 7                   # cap returned rows so the dashboard stays focused
MIN_ITEMS_TO_SHOW = 1           # if zero items, return [] and the UI hides the section


def compute_this_week(
    db: Session,
    client_ids: list[int],
    *,
    agency_id: int | None = None,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """Return ranked outreach items for the given list of client user ids.

    Each item is a dict with:
      client_id, client_email, client_name (optional),
      category (renewal | upload | share_view | stalled),
      reason       (observational, no AI scoring),
      suggested_action (approved-verb phrasing),
      severity     (high | medium | low — for visual sort),
      date         (the underlying event date as ISO string)
    """
    if not client_ids:
        return []

    today = today or date.today()
    items: list[dict[str, Any]] = []

    # Resolve client name lookups in one go for nicer rendering
    from .models_profile import UserProfile
    name_rows = db.execute(
        select(UserProfile.user_id, UserProfile.full_name)
        .where(UserProfile.user_id.in_(client_ids))
        .where(UserProfile.full_name.isnot(None))
    ).all()
    names: dict[int, str] = {row[0]: row[1] for row in name_rows}
    email_rows = db.execute(
        select(User.id, User.email).where(User.id.in_(client_ids))
    ).all()
    emails: dict[int, str] = {row[0]: row[1] for row in email_rows}

    def _make_row(client_id: int, **kw) -> dict[str, Any]:
        return {
            "client_id": client_id,
            "client_email": emails.get(client_id),
            "client_name": names.get(client_id),
            **kw,
        }

    # ── 1. Upcoming renewals ─────────────────────────────
    # Pull every renewal within the widest possible window (120 days);
    # classify_stage() filters per policy-type threshold below.
    cutoff = today + timedelta(days=RENEWAL_MAX_WINDOW_DAYS)
    upcoming = db.execute(
        select(Policy).where(
            Policy.user_id.in_(client_ids),
            Policy.renewal_date >= today,
            Policy.renewal_date <= cutoff,
            Policy.status == "active",
        ).order_by(Policy.renewal_date.asc())
    ).scalars().all()

    for p in upcoming:
        days = (p.renewal_date - today).days
        thresholds = resolve_thresholds(db, agency_id, p.policy_type)
        stage = classify_stage(days, thresholds)
        if stage is None:
            # Outside this policy-type's watched window — skip.
            continue
        reason = STAGE_REASON_TEMPLATES[stage].format(
            carrier=p.carrier or "",
            policy_type=p.policy_type or "policy",
            days=days,
        ).strip()
        items.append(_make_row(
            p.user_id,
            category="renewal",
            reason=reason,
            suggested_action=STAGE_SUGGESTED_ACTIONS[stage],
            severity=STAGE_SEVERITY[stage],
            date=str(p.renewal_date),
            entity_id=p.id,
            stage=stage,
            stage_label=STAGE_LABELS[stage],
            stage_color=STAGE_COLORS[stage],
            policy_type=_normalize_policy_type(p.policy_type),
        ))

    # ── 2. Recent client uploads ──────────────────────────
    # A document where uploaded_by_user_id is the CLIENT (not the agent) =
    # the client took an action. Worth noting.
    from .models_documents import Document
    upload_cutoff = datetime.now() - timedelta(days=RECENT_UPLOAD_DAYS)
    recent_uploads = db.execute(
        select(Document, Policy)
        .join(Policy, Document.policy_id == Policy.id)
        .where(
            Policy.user_id.in_(client_ids),
            Document.created_at >= upload_cutoff,
            # uploaded_by_user_id matching the policy's owner = client uploaded it
            Document.uploaded_by_user_id == Policy.user_id,
        )
        .order_by(Document.created_at.desc())
    ).all()
    seen_clients_for_upload: set[int] = set()
    for doc, pol in recent_uploads:
        if pol.user_id in seen_clients_for_upload:
            continue  # one upload row per client
        seen_clients_for_upload.add(pol.user_id)
        items.append(_make_row(
            pol.user_id,
            category="upload",
            reason=f"Client uploaded {doc.filename} on {doc.created_at.strftime('%b %d')}",
            suggested_action="Review document with client",
            severity="medium",
            date=str(doc.created_at.date()),
            entity_id=doc.id,
        ))

    # ── 3. Recent share-link views ────────────────────────
    # User opened a renewal-review share page recently — high-intent signal.
    share_cutoff = datetime.now() - timedelta(days=RECENT_SHARE_VIEW_DAYS)
    share_views = db.execute(
        select(UserEvent.user_id, func.count(UserEvent.id).label("ct"), func.max(UserEvent.created_at).label("last"))
        .where(
            UserEvent.user_id.in_(client_ids),
            UserEvent.event_name.in_(("renewal_review_public_view", "renewal_review_view")),
            UserEvent.created_at >= share_cutoff,
        )
        .group_by(UserEvent.user_id)
    ).all()
    seen_clients_for_view: set[int] = set()
    for row in share_views:
        cid = row[0]
        ct = row[1]
        if cid in seen_clients_for_view:
            continue
        seen_clients_for_view.add(cid)
        items.append(_make_row(
            cid,
            category="share_view",
            reason=f"Opened a coverage review share link {ct} time{'s' if ct != 1 else ''} this week",
            suggested_action="Follow up — likely has questions",
            severity="medium",
            date=str(row[2].date()) if row[2] else None,
            entity_id=None,
        ))

    # ── 4. Stalled clients (no activity in N+ days) ────────
    # Approximation: max(audit_log.created_at) for actions targeting this user.
    stall_cutoff = datetime.now() - timedelta(days=STALLED_DAYS)
    last_activity = db.execute(
        select(AuditLog.user_id, func.max(AuditLog.created_at).label("last"))
        .where(AuditLog.user_id.in_(client_ids))
        .group_by(AuditLog.user_id)
    ).all()
    last_by_client: dict[int, datetime] = {row[0]: row[1] for row in last_activity if row[1] is not None}
    for cid in client_ids:
        last = last_by_client.get(cid)
        # Only flag clients we have ANY record of (skip never-touched accounts to avoid noise)
        if last is None or last >= stall_cutoff:
            continue
        # Don't double-report a client that's already in the list for renewal/upload/view
        already = next((it for it in items if it["client_id"] == cid), None)
        if already:
            continue
        days_since = (datetime.now() - last).days
        items.append(_make_row(
            cid,
            category="stalled",
            reason=f"No interaction in {days_since} days",
            suggested_action="Re-engage — annual check-in",
            severity="low",
            date=str(last.date()),
            entity_id=None,
        ))

    # ── Rank ─────────────────────────────────────────────
    # Severity drives priority. Within severity, renewal stage rank keeps
    # finalization above market above discussion above upcoming so the
    # things needing decision-time aren't pushed off the 7-row cap by
    # 110-day-out planning rows.
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    category_rank = {"renewal": 0, "upload": 1, "share_view": 1, "stalled": 2}
    stage_rank = {
        "finalization": 0,
        "market_active": 1,
        "client_discussion": 2,
        "upcoming_review": 3,
    }
    items.sort(key=lambda x: (
        severity_rank.get(x.get("severity", "low"), 9),
        category_rank.get(x.get("category", ""), 9),
        stage_rank.get(x.get("stage") or "", 9),
        x.get("date") or "9999",
    ))

    # Deduplicate per client — only the highest-priority item per client
    seen_dedup: set[int] = set()
    deduped: list[dict[str, Any]] = []
    for it in items:
        cid = it["client_id"]
        if cid in seen_dedup:
            continue
        seen_dedup.add(cid)
        deduped.append(it)

    return deduped[:MAX_ITEMS]
