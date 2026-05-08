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

    from .access import get_policy_for_user
    get_policy_for_user(doc.policy_id, db, user)

    download_url = presign_get_url(doc.object_key)
    return {"download_url": download_url}


@router.delete("/{document_id}")
def delete_document(document_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Delete a document. Owner or any agent with access to the parent policy.

    Removes the DB row and (best-effort) the file from storage.
    """
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Permission via access helper — works for both consumer (own policy) and
    # agent-side (verified via _verify_client_access in the agent caller path,
    # but get_policy_for_user covers the simpler owner case).
    from .access import get_policy_for_user
    get_policy_for_user(doc.policy_id, db, user)

    # Best-effort: delete the file from storage. Failures don't block the row delete.
    try:
        from .storage import _get_r2, UPLOAD_DIR
        r2 = _get_r2()
        if r2 is not None and doc.object_key:
            client, bucket = r2
            try:
                client.delete_object(Bucket=bucket, Key=doc.object_key)
            except Exception:
                pass  # best-effort
        elif doc.object_key:
            local = UPLOAD_DIR / doc.object_key
            if local.exists():
                try:
                    local.unlink()
                except Exception:
                    pass
    except Exception:
        pass  # never block on storage cleanup

    log_action(db, user.id, "deleted", "document", doc.id)
    db.delete(doc)
    db.commit()
    return {"ok": True, "document_id": document_id}


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
