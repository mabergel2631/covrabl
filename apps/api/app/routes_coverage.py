from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List

from .auth import get_current_user
from .db import get_db
from .models import CoverageItem, Policy, User
from .schemas import CoverageItemCreate, CoverageItemUpdate, CoverageItemOut
from .access import get_policy_for_user

router = APIRouter(prefix="/policies/{policy_id}/coverage", tags=["coverage"])


def _get_user_policy(policy_id: int, db: Session, user: User) -> Policy:
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")
    return policy


@router.get("", response_model=List[CoverageItemOut])
def list_coverage(policy_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_policy_for_user(policy_id, db, user)
    rows = db.execute(
        select(CoverageItem).where(CoverageItem.policy_id == policy_id).order_by(CoverageItem.item_type, CoverageItem.id)
    ).scalars().all()
    return rows


@router.post("", response_model=CoverageItemOut, status_code=201)
def create_coverage(policy_id: int, payload: CoverageItemCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_user_policy(policy_id, db, user)
    item = CoverageItem(**payload.model_dump(), policy_id=policy_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{item_id}", response_model=CoverageItemOut)
def update_coverage(policy_id: int, item_id: int, payload: CoverageItemUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_user_policy(policy_id, db, user)
    item = db.get(CoverageItem, item_id)
    if not item or item.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Coverage item not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}")
def delete_coverage(policy_id: int, item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_user_policy(policy_id, db, user)
    item = db.get(CoverageItem, item_id)
    if not item or item.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Coverage item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
