"""
Premium History routes for tracking price changes over time.
"""

from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from .auth import get_current_user
from .db import get_db
from .models import Policy, User
from .models_features import PremiumHistory
from .routes_billing import check_feature

router = APIRouter(prefix="/policies/{policy_id}/premium-history", tags=["premium-history"])


class PremiumHistoryCreate(BaseModel):
    amount: int  # dollars (annual premium)
    effective_date: str  # YYYY-MM-DD
    notes: Optional[str] = None


class PremiumHistoryUpdate(BaseModel):
    amount: Optional[int] = None
    effective_date: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
def list_premium_history(
    policy_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get premium history for a policy, ordered by date."""
    check_feature(user, "premium_history")
    from .access import get_policy_for_user
    get_policy_for_user(policy_id, db, user)

    history = db.execute(
        select(PremiumHistory)
        .where(PremiumHistory.policy_id == policy_id)
        .order_by(PremiumHistory.effective_date.asc())
    ).scalars().all()

    # Calculate price changes
    result = []
    prev_amount = None
    for h in history:
        change_pct = None
        if prev_amount and prev_amount > 0:
            change_pct = round(((h.amount - prev_amount) / prev_amount) * 100, 1)

        result.append({
            "id": h.id,
            "amount": h.amount,
            "effective_date": str(h.effective_date),
            "source": h.source,
            "notes": h.notes,
            "change_pct": change_pct,
            "created_at": str(h.created_at),
        })
        prev_amount = h.amount

    # Add summary stats
    if result:
        first_amount = result[0]["amount"]
        last_amount = result[-1]["amount"]
        total_change_pct = round(((last_amount - first_amount) / first_amount) * 100, 1) if first_amount > 0 else 0
    else:
        total_change_pct = 0

    return {
        "history": result,
        "total_change_pct": total_change_pct,
        "entry_count": len(result),
    }


@router.post("")
def add_premium_history(
    policy_id: int,
    payload: PremiumHistoryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Add a premium history entry."""
    check_feature(user, "premium_history")
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    entry = PremiumHistory(
        policy_id=policy_id,
        amount=payload.amount,
        effective_date=date.fromisoformat(payload.effective_date),
        source="manual",
        notes=payload.notes,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    return {
        "id": entry.id,
        "amount": entry.amount,
        "effective_date": str(entry.effective_date),
    }


@router.put("/{entry_id}")
def update_premium_history(
    policy_id: int,
    entry_id: int,
    payload: PremiumHistoryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Update a premium history entry."""
    check_feature(user, "premium_history")
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    entry = db.get(PremiumHistory, entry_id)
    if not entry or entry.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Entry not found")

    if payload.amount is not None:
        entry.amount = payload.amount
    if payload.effective_date is not None:
        entry.effective_date = date.fromisoformat(payload.effective_date)
    if payload.notes is not None:
        entry.notes = payload.notes

    db.commit()
    return {"ok": True}


@router.delete("/{entry_id}")
def delete_premium_history(
    policy_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Delete a premium history entry."""
    check_feature(user, "premium_history")
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    entry = db.get(PremiumHistory, entry_id)
    if not entry or entry.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Entry not found")

    db.delete(entry)
    db.commit()
    return {"ok": True}


# Auto-record premium when policy is updated
def record_premium_change(policy_id: int, amount: int, db: Session, source: str = "extraction"):
    """Record a premium change in history. Called when policy premium is updated."""
    # Check if we already have this exact entry
    existing = db.execute(
        select(PremiumHistory)
        .where(PremiumHistory.policy_id == policy_id)
        .where(PremiumHistory.amount == amount)
        .where(PremiumHistory.effective_date == date.today())
    ).scalar_one_or_none()

    if existing:
        return  # Don't duplicate

    entry = PremiumHistory(
        policy_id=policy_id,
        amount=amount,
        effective_date=date.today(),
        source=source,
    )
    db.add(entry)
