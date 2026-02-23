from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .models import Policy, PolicyDetail, User
from .schemas import PolicyDetailCreate, PolicyDetailUpdate, PolicyDetailOut
from .access import get_policy_for_user

router = APIRouter(prefix="/policies", tags=["policy-details"])


@router.get("/{policy_id}/details", response_model=list[PolicyDetailOut])
def list_details(policy_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_policy_for_user(policy_id, db, user)

    rows = db.execute(
        select(PolicyDetail).where(PolicyDetail.policy_id == policy_id).order_by(PolicyDetail.id)
    ).scalars().all()
    return rows


@router.post("/{policy_id}/details", response_model=PolicyDetailOut, status_code=201)
def create_detail(policy_id: int, payload: PolicyDetailCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    detail = PolicyDetail(policy_id=policy_id, **payload.model_dump())
    db.add(detail)
    db.commit()
    db.refresh(detail)
    return detail


@router.put("/{policy_id}/details/{detail_id}", response_model=PolicyDetailOut)
def update_detail(policy_id: int, detail_id: int, payload: PolicyDetailUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    detail = db.get(PolicyDetail, detail_id)
    if not detail or detail.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Detail not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(detail, field, value)
    db.commit()
    db.refresh(detail)
    return detail


@router.delete("/{policy_id}/details/{detail_id}")
def delete_detail(policy_id: int, detail_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    detail = db.get(PolicyDetail, detail_id)
    if not detail or detail.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Detail not found")

    db.delete(detail)
    db.commit()
    return {"ok": True}
