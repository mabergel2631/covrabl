import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .models import Policy, User
from .models_documents import Document
from .storage import presign_put_url, presign_get_url
from .audit_helper import log_action

router = APIRouter(prefix="/documents", tags=["documents"])


class UploadInit(BaseModel):
    policy_id: int
    filename: str
    content_type: str
    doc_type: str = "policy"  # policy, insurance_card, endorsement, other


class UploadInitOut(BaseModel):
    upload_url: str
    object_key: str


class UploadFinalize(BaseModel):
    policy_id: int
    filename: str
    content_type: str
    object_key: str
    doc_type: str = "policy"


@router.post("/init", response_model=UploadInitOut)
def init_upload(payload: UploadInit, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = db.get(Policy, payload.policy_id)
    if not p or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    object_key = f"policies/{p.scope}/{payload.policy_id}/{uuid.uuid4()}-{payload.filename}"
    upload_url = presign_put_url(object_key, payload.content_type)
    return UploadInitOut(upload_url=upload_url, object_key=object_key)


@router.post("/finalize")
def finalize_upload(payload: UploadFinalize, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = db.get(Policy, payload.policy_id)
    if not p or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    doc = Document(
        policy_id=payload.policy_id,
        filename=payload.filename,
        content_type=payload.content_type,
        object_key=payload.object_key,
        doc_type=payload.doc_type,
    )
    db.add(doc)
    db.flush()
    log_action(db, user.id, "uploaded", "document", doc.id)
    db.commit()
    db.refresh(doc)
    return {"ok": True, "document_id": doc.id}


@router.get("/{document_id}/download")
def download_document(document_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    policy = db.get(Policy, doc.policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found")

    download_url = presign_get_url(doc.object_key)
    return {"download_url": download_url}


@router.get("/by-policy/{policy_id}")
def list_docs(policy_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from .access import get_policy_for_user
    get_policy_for_user(policy_id, db, user)

    rows = db.execute(
        select(Document).where(Document.policy_id == policy_id).order_by(Document.id.desc())
    ).scalars().all()

    return [
        {
            "id": r.id,
            "policy_id": r.policy_id,
            "filename": r.filename,
            "content_type": r.content_type,
            "object_key": r.object_key,
            "doc_type": r.doc_type,
            "extraction_status": r.extraction_status,
            "created_at": str(r.created_at),
        }
        for r in rows
    ]
