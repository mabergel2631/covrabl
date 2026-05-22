"""Agency-level settings endpoints. Currently exposes renewal-stage
threshold overrides; future agency-wide configuration belongs here too.

Read access: any active AgencyMember on the agency.
Write access: owners only (matches the role check used elsewhere in the
agency routes).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .models import User
from .models_agency import AgencyMember
from .models_agency_settings import AgencyRenewalThreshold
from .renewal_config import (
    DEFAULT_THRESHOLDS,
    FALLBACK_THRESHOLDS,
    _normalize_policy_type,
)


router = APIRouter(prefix="/agency", tags=["agency-settings"])


# ── helpers ────────────────────────────────────────────


def _agency_id_or_404(db: Session, user: User) -> int:
    """Return the user's primary active agency id. 404 if none — only
    agency members can read or write thresholds.
    """
    row = db.execute(
        select(AgencyMember.agency_id, AgencyMember.role)
        .where(AgencyMember.user_id == user.id)
        .where(AgencyMember.status == "active")
        .order_by(AgencyMember.created_at.asc())
        .limit(1)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="No active agency membership")
    return int(row[0])


def _owner_or_403(db: Session, user: User) -> int:
    """Return agency_id if the user is an owner; 403 otherwise."""
    row = db.execute(
        select(AgencyMember.agency_id, AgencyMember.role)
        .where(AgencyMember.user_id == user.id)
        .where(AgencyMember.status == "active")
        .order_by(AgencyMember.created_at.asc())
        .limit(1)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="No active agency membership")
    agency_id, role = int(row[0]), str(row[1] or "")
    if role != "owner":
        raise HTTPException(status_code=403, detail="Owner role required")
    return agency_id


# ── schemas ────────────────────────────────────────────


class ThresholdsOut(BaseModel):
    policy_type: str
    upcoming_days: int
    discussion_days: int
    market_days: int
    finalization_days: int
    is_override: bool  # true when an agency row exists; false = pure default


class ThresholdsIn(BaseModel):
    upcoming_days: int = Field(..., ge=1, le=365)
    discussion_days: int = Field(..., ge=1, le=365)
    market_days: int = Field(..., ge=1, le=365)
    finalization_days: int = Field(..., ge=1, le=365)


# ── routes ─────────────────────────────────────────────


@router.get("/renewal-thresholds", response_model=list[ThresholdsOut])
def list_thresholds(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ThresholdsOut]:
    """Return the effective thresholds for every known policy type, with
    agency overrides applied. An entry with is_override=False means the
    agency is using the default (no DB row); is_override=True means a
    saved override exists.
    """
    agency_id = _agency_id_or_404(db, user)

    overrides = {
        row.policy_type: row
        for row in db.execute(
            select(AgencyRenewalThreshold).where(
                AgencyRenewalThreshold.agency_id == agency_id
            )
        ).scalars().all()
    }

    out: list[ThresholdsOut] = []
    for policy_type, default in DEFAULT_THRESHOLDS.items():
        row = overrides.get(policy_type)
        if row is not None:
            out.append(ThresholdsOut(
                policy_type=policy_type,
                upcoming_days=row.upcoming_days,
                discussion_days=row.discussion_days,
                market_days=row.market_days,
                finalization_days=row.finalization_days,
                is_override=True,
            ))
        else:
            out.append(ThresholdsOut(
                policy_type=policy_type,
                upcoming_days=default["upcoming_days"],
                discussion_days=default["discussion_days"],
                market_days=default["market_days"],
                finalization_days=default["finalization_days"],
                is_override=False,
            ))
    return out


@router.put("/renewal-thresholds/{policy_type}", response_model=ThresholdsOut)
def upsert_threshold(
    policy_type: str,
    payload: ThresholdsIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ThresholdsOut:
    """Upsert an override for one policy type. Owner only.

    Validates that the four windows are monotonically decreasing so the
    classifier doesn't end up in an undefined state (e.g. finalization
    larger than market).
    """
    if not (
        payload.upcoming_days >= payload.discussion_days
        >= payload.market_days >= payload.finalization_days
    ):
        raise HTTPException(
            status_code=400,
            detail="Thresholds must be monotonically decreasing: upcoming >= discussion >= market >= finalization",
        )

    agency_id = _owner_or_403(db, user)
    slug = _normalize_policy_type(policy_type)
    if not slug:
        raise HTTPException(status_code=400, detail="Invalid policy_type")

    existing = db.execute(
        select(AgencyRenewalThreshold).where(
            AgencyRenewalThreshold.agency_id == agency_id,
            AgencyRenewalThreshold.policy_type == slug,
        )
    ).scalar_one_or_none()

    if existing is None:
        row = AgencyRenewalThreshold(
            agency_id=agency_id,
            policy_type=slug,
            upcoming_days=payload.upcoming_days,
            discussion_days=payload.discussion_days,
            market_days=payload.market_days,
            finalization_days=payload.finalization_days,
        )
        db.add(row)
    else:
        existing.upcoming_days = payload.upcoming_days
        existing.discussion_days = payload.discussion_days
        existing.market_days = payload.market_days
        existing.finalization_days = payload.finalization_days
        row = existing
    db.commit()

    return ThresholdsOut(
        policy_type=row.policy_type,
        upcoming_days=row.upcoming_days,
        discussion_days=row.discussion_days,
        market_days=row.market_days,
        finalization_days=row.finalization_days,
        is_override=True,
    )


@router.delete("/renewal-thresholds/{policy_type}")
def delete_threshold(
    policy_type: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Remove an override and fall back to the code default. Owner only."""
    agency_id = _owner_or_403(db, user)
    slug = _normalize_policy_type(policy_type)

    existing = db.execute(
        select(AgencyRenewalThreshold).where(
            AgencyRenewalThreshold.agency_id == agency_id,
            AgencyRenewalThreshold.policy_type == slug,
        )
    ).scalar_one_or_none()

    if existing is None:
        return {"ok": True, "deleted": False}
    db.delete(existing)
    db.commit()
    return {"ok": True, "deleted": True}
