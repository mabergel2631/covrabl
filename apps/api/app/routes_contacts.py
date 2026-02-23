from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List

from .auth import get_current_user
from .db import get_db
from .models import Contact, Policy, User
from .schemas import ContactCreate, ContactUpdate, ContactOut
from .access import get_policy_for_user

router = APIRouter(prefix="/policies/{policy_id}/contacts", tags=["contacts"])


def _get_user_policy(policy_id: int, db: Session, user: User) -> Policy:
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")
    return policy


@router.get("", response_model=List[ContactOut])
def list_contacts(policy_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_policy_for_user(policy_id, db, user)
    rows = db.execute(
        select(Contact).where(Contact.policy_id == policy_id).order_by(Contact.role)
    ).scalars().all()
    return rows


@router.post("", response_model=ContactOut, status_code=201)
def create_contact(policy_id: int, payload: ContactCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_user_policy(policy_id, db, user)
    contact = Contact(**payload.model_dump(), policy_id=policy_id)
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@router.put("/{contact_id}", response_model=ContactOut)
def update_contact(policy_id: int, contact_id: int, payload: ContactUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_user_policy(policy_id, db, user)
    contact = db.get(Contact, contact_id)
    if not contact or contact.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Contact not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(contact, field, value)
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{contact_id}")
def delete_contact(policy_id: int, contact_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_user_policy(policy_id, db, user)
    contact = db.get(Contact, contact_id)
    if not contact or contact.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return {"ok": True}
