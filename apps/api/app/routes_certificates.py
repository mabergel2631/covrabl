import io
import uuid as _uuid
from datetime import date, timedelta
from pathlib import Path

import pdfplumber
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response, FileResponse
from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .extraction import get_extractor
from .models import Policy, User
from .models_features import Certificate, CertificateReminder
from .schemas import CertificateCreate, CertificateUpdate
from .audit_helper import log_action
from .routes_billing import check_feature

router = APIRouter(prefix="/certificates", tags=["certificates"])

_temp_pdf_cache: dict[str, bytes] = {}  # file_token -> pdf_bytes


def ensure_certificate_reminders(certificate_id: int, expiration_date: date | None, db: Session):
    """Delete old reminders and create new ones at 90/60/30 days before expiration."""
    db.execute(delete(CertificateReminder).where(CertificateReminder.certificate_id == certificate_id))
    if not expiration_date:
        return
    today = date.today()
    for days_before in [90, 60, 30]:
        remind_at = expiration_date - timedelta(days=days_before)
        if remind_at >= today:
            db.add(CertificateReminder(certificate_id=certificate_id, remind_at=remind_at))


def _update_status(cert: Certificate, today: date):
    """Auto-update status based on expiration date."""
    if not cert.expiration_date:
        return
    days_until = (cert.expiration_date - today).days
    if days_until < 0:
        cert.status = "expired"
    elif days_until <= 30:
        cert.status = "expiring"
    elif cert.status in ("expired", "expiring"):
        cert.status = "active"


def _enrich(cert: Certificate, db: Session, policy_map: dict[int, Policy] | None = None) -> dict:
    """Build response dict with joined policy info."""
    policy_carrier = None
    policy_type = None
    if cert.policy_id:
        policy = policy_map.get(cert.policy_id) if policy_map is not None else db.get(Policy, cert.policy_id)
        if policy:
            policy_carrier = policy.carrier
            policy_type = policy.policy_type
    return {
        "id": cert.id,
        "user_id": cert.user_id,
        "direction": cert.direction,
        "policy_id": cert.policy_id,
        "counterparty_name": cert.counterparty_name,
        "counterparty_type": cert.counterparty_type,
        "counterparty_email": cert.counterparty_email,
        "carrier": cert.carrier,
        "policy_number": cert.policy_number,
        "coverage_types": cert.coverage_types,
        "coverage_amount": cert.coverage_amount,
        "additional_insured": cert.additional_insured,
        "waiver_of_subrogation": cert.waiver_of_subrogation,
        "minimum_coverage": cert.minimum_coverage,
        "effective_date": str(cert.effective_date) if cert.effective_date else None,
        "expiration_date": str(cert.expiration_date) if cert.expiration_date else None,
        "status": cert.status,
        "notes": cert.notes,
        "has_document": bool(cert.coi_file_key),
        "created_at": str(cert.created_at),
        "policy_carrier": policy_carrier,
        "policy_type": policy_type,
    }


@router.post("", status_code=201)
def create_certificate(payload: CertificateCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "certificates")
    cert = Certificate(**payload.model_dump(exclude={"file_token"}), user_id=user.id)
    db.add(cert)
    db.flush()
    # Attach PDF from temporary cache if file_token was provided
    if payload.file_token and payload.file_token in _temp_pdf_cache:
        pdf_bytes = _temp_pdf_cache.pop(payload.file_token)
        file_key = f"coi-cert/{cert.id}/{_uuid.uuid4()}.pdf"
        upload_dir = Path(__file__).resolve().parent.parent / "uploads"
        dest = upload_dir / file_key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(pdf_bytes)
        cert.coi_file_key = file_key
        cert.coi_file_data = pdf_bytes
    ensure_certificate_reminders(cert.id, cert.expiration_date, db)
    log_action(db, user.id, "created", "certificate", cert.id)
    db.commit()
    db.refresh(cert)
    return _enrich(cert, db)


@router.get("")
def list_certificates(direction: str | None = None, policy_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "certificates")
    q = select(Certificate).where(Certificate.user_id == user.id)
    if direction:
        q = q.where(Certificate.direction == direction)
    if policy_id is not None:
        q = q.where(Certificate.policy_id == policy_id)
    certs = db.execute(q.order_by(Certificate.id.desc())).scalars().all()
    today = date.today()
    for c in certs:
        _update_status(c, today)
    db.commit()

    # Batch-load linked policies to avoid N+1
    linked_policy_ids = {c.policy_id for c in certs if c.policy_id}
    policy_map: dict[int, Policy] = {}
    if linked_policy_ids:
        policies = db.execute(
            select(Policy).where(Policy.id.in_(linked_policy_ids))
        ).scalars().all()
        policy_map = {p.id: p for p in policies}

    return [_enrich(c, db, policy_map) for c in certs]


@router.post("/extract-pdf")
async def extract_coi_pdf(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """Upload a COI PDF and extract certificate fields via LLM."""
    check_feature(user, "certificates")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    text = ""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"

    extractor = get_extractor()

    if text.strip():
        result = extractor.extract_coi(text)
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
        result = extractor.extract_coi_images(images)

    coverage_types_str = ", ".join(result.coverage_types) if result.coverage_types else None
    coverage_cents = result.primary_coverage_amount * 100 if result.primary_coverage_amount else None

    # Cache PDF bytes so they can be attached when the certificate is created
    file_token = str(_uuid.uuid4())
    _temp_pdf_cache[file_token] = pdf_bytes

    return {
        "ok": True,
        "file_token": file_token,
        "extraction": {
            "counterparty_name": result.certificate_holder_name or "",
            "counterparty_type": result.certificate_holder_type or "other",
            "counterparty_email": result.certificate_holder_email,
            "carrier": result.carrier,
            "policy_number": result.policy_number,
            "coverage_types": coverage_types_str,
            "coverage_amount": coverage_cents,
            "additional_insured": result.additional_insured,
            "waiver_of_subrogation": result.waiver_of_subrogation,
            "effective_date": result.effective_date,
            "expiration_date": result.expiration_date,
            "notes": result.description_of_operations,
            "insured_name": result.insured_name,
            "producer_name": result.producer_name,
            "producer_phone": result.producer_phone,
            "producer_email": result.producer_email,
        },
    }


@router.get("/{cert_id}")
def get_certificate(cert_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "certificates")
    cert = db.get(Certificate, cert_id)
    if not cert or cert.user_id != user.id:
        raise HTTPException(status_code=404, detail="Certificate not found")
    return _enrich(cert, db)


@router.put("/{cert_id}")
def update_certificate(cert_id: int, payload: CertificateUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "certificates")
    cert = db.get(Certificate, cert_id)
    if not cert or cert.user_id != user.id:
        raise HTTPException(status_code=404, detail="Certificate not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cert, field, value)
    ensure_certificate_reminders(cert.id, cert.expiration_date, db)
    log_action(db, user.id, "updated", "certificate", cert.id)
    db.commit()
    db.refresh(cert)
    return _enrich(cert, db)


@router.delete("/{cert_id}")
def delete_certificate(cert_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_feature(user, "certificates")
    cert = db.get(Certificate, cert_id)
    if not cert or cert.user_id != user.id:
        raise HTTPException(status_code=404, detail="Certificate not found")
    log_action(db, user.id, "deleted", "certificate", cert.id)
    db.delete(cert)
    db.commit()
    return {"ok": True}


@router.get("/{cert_id}/document")
def download_certificate_document(cert_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Serve the stored COI PDF for a certificate."""
    check_feature(user, "certificates")
    cert = db.get(Certificate, cert_id)
    if not cert or cert.user_id != user.id:
        raise HTTPException(status_code=404, detail="Certificate not found")
    if not cert.coi_file_key:
        raise HTTPException(status_code=404, detail="No document attached")
    # Prefer in-DB bytes; fall back to file on disk
    if cert.coi_file_data:
        filename = Path(cert.coi_file_key).name
        return Response(
            content=cert.coi_file_data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    upload_dir = Path(__file__).resolve().parent.parent / "uploads"
    file_path = upload_dir / cert.coi_file_key
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Document file not found")
    return FileResponse(path=str(file_path), media_type="application/pdf", filename=file_path.name)
