import io
from datetime import date
from typing import Optional

import httpx
import pdfplumber
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from sqlalchemy import select

from .auth import get_current_user
from .db import get_db
from .extraction import get_extractor
from .models import Policy, Contact, CoverageItem, PolicyDetail, User
from .models_documents import Document
from .storage import presign_get_url
from .audit_helper import log_action
from .routes_billing import check_extraction_limit
from .routes_deltas import detect_deltas

router = APIRouter(prefix="/documents", tags=["extraction"])


# ── Extract (preview only, does NOT save) ─────────────

@router.post("/{document_id}/extract")
def extract_document(document_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    policy = db.get(Policy, doc.policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found")

    check_extraction_limit(user, db)

    doc.extraction_status = "pending"
    db.commit()

    try:
        # Read file directly from disk instead of HTTP
        from pathlib import Path
        upload_dir = Path(__file__).resolve().parent.parent / "uploads"
        file_path = upload_dir / doc.object_key
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found on disk")
        pdf_bytes = file_path.read_bytes()

        text = ""
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"

        extractor = get_extractor()

        if text.strip():
            result = extractor.extract(text)
        else:
            # Scanned PDF — convert pages to images and use vision API
            import fitz  # PyMuPDF
            images: list[bytes] = []
            pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            for page in pdf_doc:
                pix = page.get_pixmap(dpi=200)
                images.append(pix.tobytes("png"))
            pdf_doc.close()
            if not images:
                doc.extraction_status = "failed"
                db.commit()
                raise HTTPException(status_code=422, detail="Could not extract content from PDF")
            result = extractor.extract_images(images)

        # Mark as extracted but NOT confirmed yet
        doc.extraction_status = "review"
        db.commit()

        # Check for potential renewal matches
        potential_renewals = []
        if result.policy_type:
            existing = db.execute(
                select(Policy).where(
                    Policy.user_id == user.id,
                    Policy.policy_type == result.policy_type,
                    Policy.status == "active",
                    Policy.id != policy.id,
                )
            ).scalars().all()

            # Smart filtering: cross-reference extracted details to exclude obvious non-matches
            DIFFERENTIATING_FIELDS = {
                "home": "property_address",
                "renters": "property_address",
                "auto": "vehicle_1_VIN",
                "life": "insured_name",
                "disability": "insured_name",
            }
            # Commercial types use business_name from the Policy model directly
            COMMERCIAL_TYPES = {
                "general_liability", "commercial_property", "bop",
                "workers_comp", "professional_liability", "commercial_auto",
                "cyber", "epli", "dno",
            }

            diff_field = DIFFERENTIATING_FIELDS.get(result.policy_type)
            is_commercial = result.policy_type in COMMERCIAL_TYPES

            # Build lookup of new extraction's detail values
            new_details = {d.field_name.lower(): d.field_value for d in result.details}

            filtered = []
            for p in existing:
                # Exposure shortcut: same asset = definite match, always keep
                if policy.exposure_id and p.exposure_id and policy.exposure_id == p.exposure_id:
                    filtered.append(p)
                    continue

                if is_commercial:
                    # Compare business_name from Policy model
                    new_biz = policy.business_name
                    old_biz = p.business_name
                    if new_biz and old_biz and new_biz.strip().lower() != old_biz.strip().lower():
                        continue  # Different businesses — exclude

                elif diff_field:
                    new_val = new_details.get(diff_field.lower())
                    # Look up candidate's PolicyDetail records
                    candidate_details = db.execute(
                        select(PolicyDetail).where(PolicyDetail.policy_id == p.id)
                    ).scalars().all()
                    old_val = next(
                        (d.field_value for d in candidate_details if d.field_name.lower() == diff_field.lower()),
                        None,
                    )
                    if new_val and old_val and new_val.strip().lower() != old_val.strip().lower():
                        continue  # Different property/vehicle/person — exclude

                filtered.append(p)

            potential_renewals = [
                {"id": p.id, "carrier": p.carrier, "policy_type": p.policy_type,
                 "policy_number": p.policy_number, "renewal_date": str(p.renewal_date) if p.renewal_date else None,
                 "premium_amount": p.premium_amount, "nickname": p.nickname}
                for p in filtered
            ]

        return {
            "ok": True,
            "document_id": doc.id,
            "extraction": {
                "carrier": result.carrier,
                "policy_number": result.policy_number,
                "policy_type": result.policy_type,
                "scope": result.scope,
                "coverage_amount": result.coverage_amount,
                "deductible": result.deductible,
                "premium_amount": result.premium_amount,
                "renewal_date": result.renewal_date,
                "contacts": [
                    {"role": c.role, "name": c.name, "company": c.company, "phone": c.phone, "email": c.email}
                    for c in result.contacts
                ],
                "coverage_items": [
                    {"item_type": ci.item_type, "description": ci.description, "limit": ci.limit}
                    for ci in result.coverage_items
                ],
                "details": [
                    {"field_name": d.field_name, "field_value": d.field_value}
                    for d in result.details
                ],
            },
            "potential_renewals": potential_renewals,
        }

    except HTTPException:
        raise
    except Exception as e:
        doc.extraction_status = "failed"
        db.commit()
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")


# ── Confirm (user reviewed, now save) ─────────────────

class ConfirmContact(BaseModel):
    role: str
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class ConfirmCoverageItem(BaseModel):
    item_type: str
    description: str
    limit: Optional[str] = None


class ConfirmDetail(BaseModel):
    field_name: str
    field_value: str


class ConfirmExtraction(BaseModel):
    carrier: Optional[str] = None
    policy_number: Optional[str] = None
    policy_type: Optional[str] = None
    scope: Optional[str] = None
    coverage_amount: Optional[int] = None
    deductible: Optional[int] = None
    premium_amount: Optional[int] = None
    renewal_date: Optional[str] = None
    contacts: list[ConfirmContact] = []
    coverage_items: list[ConfirmCoverageItem] = []
    details: list[ConfirmDetail] = []
    replaces_policy_id: Optional[int] = None


@router.post("/{document_id}/extract/confirm")
def confirm_extraction(document_id: int, payload: ConfirmExtraction, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    policy = db.get(Policy, doc.policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found")

    # Detect deltas BEFORE applying changes (compare new vs current)
    new_data = {
        "carrier": payload.carrier,
        "policy_number": payload.policy_number,
        "policy_type": payload.policy_type,
        "scope": payload.scope,
        "coverage_amount": payload.coverage_amount,
        "deductible": payload.deductible,
        "premium_amount": payload.premium_amount,
        "renewal_date": payload.renewal_date,
    }
    deltas = detect_deltas(db, policy, new_data, document_id=doc.id)

    # Apply user-reviewed fields
    if payload.carrier:
        policy.carrier = payload.carrier
    if payload.policy_number:
        policy.policy_number = payload.policy_number
    if payload.policy_type:
        policy.policy_type = payload.policy_type
    if payload.scope:
        policy.scope = payload.scope
    if payload.coverage_amount is not None:
        policy.coverage_amount = payload.coverage_amount
    if payload.deductible is not None:
        policy.deductible = payload.deductible
    if payload.premium_amount is not None:
        policy.premium_amount = payload.premium_amount
    if payload.renewal_date:
        try:
            policy.renewal_date = date.fromisoformat(payload.renewal_date)
        except ValueError:
            pass

    # Handle renewal linking
    if payload.replaces_policy_id:
        old = db.execute(
            select(Policy).where(
                Policy.id == payload.replaces_policy_id,
                Policy.user_id == user.id,
            )
        ).scalar_one_or_none()
        if old:
            old.status = "archived"
            policy.replaces_policy_id = payload.replaces_policy_id
            log_action(db, user.id, "archived", "policy", old.id)

    # Auto-record premium history
    if payload.premium_amount is not None:
        from .routes_premium_history import record_premium_change
        effective = None
        if payload.renewal_date:
            try:
                effective = date.fromisoformat(payload.renewal_date)
            except ValueError:
                pass
        record_premium_change(policy.id, payload.premium_amount, db, source="extraction", effective=effective)

    for c in payload.contacts:
        contact = Contact(
            policy_id=policy.id,
            role=c.role,
            name=c.name,
            company=c.company,
            phone=c.phone,
            email=c.email,
        )
        db.add(contact)

    for ci in payload.coverage_items:
        item = CoverageItem(
            policy_id=policy.id,
            item_type=ci.item_type,
            description=ci.description,
            limit=ci.limit,
        )
        db.add(item)

    for d in payload.details:
        detail = PolicyDetail(
            policy_id=policy.id,
            field_name=d.field_name,
            field_value=d.field_value,
        )
        db.add(detail)

    doc.extraction_status = "done"
    log_action(db, user.id, "confirmed", "extraction", doc.id)
    db.commit()

    return {"ok": True, "deltas_detected": len(deltas)}
