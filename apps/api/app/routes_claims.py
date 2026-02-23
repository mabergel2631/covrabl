import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .models import Policy, User
from .models_features import Claim
from .schemas import ClaimCreate, ClaimUpdate, ClaimOut
from .audit_helper import log_action
from .extraction import get_extractor
from .access import get_policy_for_user

router = APIRouter(prefix="/policies/{policy_id}/claims", tags=["claims"])


def _get_user_policy(policy_id: int, db: Session, user: User) -> Policy:
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")
    return policy


@router.get("", response_model=list[ClaimOut])
def list_claims(policy_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_policy_for_user(policy_id, db, user)
    rows = db.execute(
        select(Claim).where(Claim.policy_id == policy_id).order_by(Claim.date_filed.desc())
    ).scalars().all()
    return rows


@router.post("", response_model=ClaimOut, status_code=201)
def create_claim(policy_id: int, payload: ClaimCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_user_policy(policy_id, db, user)
    claim = Claim(policy_id=policy_id, **payload.model_dump())
    db.add(claim)
    db.flush()
    log_action(db, user.id, "created", "claim", claim.id)
    db.commit()
    db.refresh(claim)
    return claim


@router.put("/{claim_id}", response_model=ClaimOut)
def update_claim(policy_id: int, claim_id: int, payload: ClaimUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_user_policy(policy_id, db, user)
    claim = db.get(Claim, claim_id)
    if not claim or claim.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Claim not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(claim, field, value)
    log_action(db, user.id, "updated", "claim", claim.id)
    db.commit()
    db.refresh(claim)
    return claim


@router.delete("/{claim_id}")
def delete_claim(policy_id: int, claim_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_user_policy(policy_id, db, user)
    claim = db.get(Claim, claim_id)
    if not claim or claim.policy_id != policy_id:
        raise HTTPException(status_code=404, detail="Claim not found")
    db.delete(claim)
    db.commit()
    return {"ok": True}


@router.post("/extract")
async def extract_claim_from_pdf(
    policy_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload a claim document PDF and extract claim fields via LLM."""
    _get_user_policy(policy_id, db, user)

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    import pdfplumber
    text = ""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"

    extractor = get_extractor()

    if text.strip():
        result = extractor.extract_claim(text)
    else:
        import fitz
        images: list[bytes] = []
        pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page in pdf_doc:
            pix = page.get_pixmap(dpi=200)
            images.append(pix.tobytes("png"))
        pdf_doc.close()
        if not images:
            raise HTTPException(status_code=422, detail="Could not extract content from PDF")
        result = extractor.extract_claim_images(images)

    return {
        "ok": True,
        "extraction": {
            "claim_number": result.claim_number or "",
            "status": result.status or "open",
            "date_filed": result.date_filed,
            "date_resolved": result.date_resolved,
            "amount_claimed": result.amount_claimed,
            "amount_paid": result.amount_paid,
            "description": result.description or "",
            "notes": result.notes,
        },
    }
