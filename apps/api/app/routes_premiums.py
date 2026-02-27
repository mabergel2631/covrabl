from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .models import Policy, User
from .models_features import Premium
from .schemas import PremiumCreate, PremiumUpdate, PremiumOut
from .audit_helper import log_action
from .routes_billing import check_feature

router = APIRouter(tags=["premiums"])

FREQ_MULTIPLIER = {"monthly": 12, "quarterly": 4, "semi_annual": 2, "annual": 1}


def _get_user_policy(policy_id: int, db: Session, user: User) -> Policy:
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")
    return policy


@router.get("/policies/{policy_id}/premiums", response_model=list[PremiumOut])
def list_premiums(policy_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "premiums")
    _get_user_policy(policy_id, db, user)
    rows = db.execute(
        select(Premium).where(Premium.policy_id == policy_id).order_by(Premium.due_date.desc())
    ).scalars().all()
    return rows


@router.post("/policies/{policy_id}/premiums", response_model=PremiumOut, status_code=201)
def create_premium(policy_id: int, payload: PremiumCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "premiums")
    _get_user_policy(policy_id, db, user)
    premium = Premium(policy_id=policy_id, **payload.model_dump())
    db.add(premium)
    db.flush()
    log_action(db, user.id, "created", "premium", premium.id)
    db.commit()
    db.refresh(premium)
    return premium


@router.put("/policies/{policy_id}/premiums/{premium_id}", response_model=PremiumOut)
def update_premium(policy_id: int, premium_id: int, payload: PremiumUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "premiums")
    _get_user_policy(policy_id, db, user)
    premium = db.get(Premium, premium_id)
    if not premium or premium.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Premium not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(premium, field, value)
    log_action(db, user.id, "updated", "premium", premium.id)
    db.commit()
    db.refresh(premium)
    return premium


@router.delete("/policies/{policy_id}/premiums/{premium_id}")
def delete_premium(policy_id: int, premium_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "premiums")
    _get_user_policy(policy_id, db, user)
    premium = db.get(Premium, premium_id)
    if not premium or premium.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Premium not found")
    db.delete(premium)
    db.commit()
    return {"ok": True}


@router.get("/premiums/annual-spend")
def annual_spend(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "premiums")
    rows = db.execute(
        select(Premium).join(Policy, Premium.policy_id == Policy.id).where(Policy.user_id == user.id)
    ).scalars().all()

    total_cents = 0
    for p in rows:
        mult = FREQ_MULTIPLIER.get(p.frequency, 1)
        total_cents += p.amount * mult

    return {"annual_spend_cents": total_cents}
