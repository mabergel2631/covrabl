"""Lease compliance routes — extract requirements, compare, share."""

import json
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Optional

from .auth import get_current_user
from .config import settings
from .db import get_db
from .models import User, Policy
from .models_features import LeaseRequirement, ComplianceCheck, Certificate
from .schemas import (
    LeaseRequirementCreate,
    LeaseRequirementUpdate,
    LeaseRequirementOut,
    ComplianceCheckOut,
)
from .routes_billing import check_feature
from .lease_compliance import (
    compare_requirements,
    build_evidence_from_certificate,
    build_evidence_from_policies,
    generate_broker_email,
)
from .extraction import get_extractor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lease-compliance", tags=["lease-compliance"])


# ── Extraction ──────────────────────────────────────

class ExtractRequest(BaseModel):
    text: str


@router.post("/extract")
def extract_lease_text(
    payload: ExtractRequest,
    user: User = Depends(get_current_user),
):
    check_feature(user, "lease_compliance")
    extractor = get_extractor()
    try:
        result = extractor.extract_lease(payload.text)
    except Exception as e:
        logger.exception("Lease extraction failed")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")

    return {
        "ok": True,
        "extraction": {
            "property_address": result.property_address,
            "landlord_name": result.landlord_name,
            "tenant_name": result.tenant_name,
            "requirements": result.requirements,
            "certificate_holder_text": result.certificate_holder_text,
            "notice_address": result.notice_address,
            "deadline": result.deadline,
            "raw_summary": result.raw_summary,
        },
    }


@router.post("/extract-pdf")
async def extract_lease_pdf(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    check_feature(user, "lease_compliance")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    # Convert PDF to images
    try:
        import fitz
        doc = fitz.open(stream=content, filetype="pdf")
        images = []
        for page_num in range(min(len(doc), 20)):
            page = doc[page_num]
            pix = page.get_pixmap(dpi=200)
            images.append(pix.tobytes("png"))
        doc.close()
    except Exception as e:
        logger.exception("PDF conversion failed")
        raise HTTPException(status_code=400, detail=f"Could not process PDF: {str(e)}")

    extractor = get_extractor()
    try:
        result = extractor.extract_lease_images(images)
    except Exception as e:
        logger.exception("Lease PDF extraction failed")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")

    return {
        "ok": True,
        "extraction": {
            "property_address": result.property_address,
            "landlord_name": result.landlord_name,
            "tenant_name": result.tenant_name,
            "requirements": result.requirements,
            "certificate_holder_text": result.certificate_holder_text,
            "notice_address": result.notice_address,
            "deadline": result.deadline,
            "raw_summary": result.raw_summary,
        },
    }


# ── CRUD ────────────────────────────────────────────

def _generate_access_code() -> str:
    return secrets.token_urlsafe(12)[:16]


@router.post("/requirements")
def create_requirement(
    payload: LeaseRequirementCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    # Validate JSON
    try:
        json.loads(payload.requirements_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="requirements_json must be valid JSON")

    req = LeaseRequirement(
        user_id=user.id,
        label=payload.label,
        role=payload.role,
        counterparty_name=payload.counterparty_name,
        counterparty_email=payload.counterparty_email,
        property_address=payload.property_address,
        lease_clause_text=payload.lease_clause_text,
        requirements_json=payload.requirements_json,
        access_code=_generate_access_code(),
        status="active",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return _requirement_to_dict(req, db)


@router.get("/requirements")
def list_requirements(
    role: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    query = select(LeaseRequirement).where(
        LeaseRequirement.user_id == user.id,
        LeaseRequirement.status == "active",
    )
    if role and role in ("tenant", "landlord"):
        query = query.where(LeaseRequirement.role == role)
    query = query.order_by(LeaseRequirement.created_at.desc())
    reqs = db.execute(query).scalars().all()
    return [_requirement_to_dict(r, db) for r in reqs]


@router.get("/requirements/{req_id}")
def get_requirement(
    req_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.id == req_id,
            LeaseRequirement.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Lease requirement not found")
    return _requirement_to_dict(req, db)


@router.put("/requirements/{req_id}")
def update_requirement(
    req_id: int,
    payload: LeaseRequirementUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.id == req_id,
            LeaseRequirement.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Lease requirement not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "requirements_json" in update_data and update_data["requirements_json"] is not None:
        try:
            json.loads(update_data["requirements_json"])
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="requirements_json must be valid JSON")

    for key, value in update_data.items():
        setattr(req, key, value)

    db.commit()
    db.refresh(req)
    return _requirement_to_dict(req, db)


@router.delete("/requirements/{req_id}")
def delete_requirement(
    req_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.id == req_id,
            LeaseRequirement.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Lease requirement not found")
    db.delete(req)
    db.commit()
    return {"ok": True}


# ── Compliance Checks ───────────────────────────────

class CheckRequest(BaseModel):
    against: str  # "policies" or "certificate"
    certificate_id: Optional[int] = None


@router.post("/requirements/{req_id}/check")
def run_compliance_check(
    req_id: int,
    payload: CheckRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.id == req_id,
            LeaseRequirement.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Lease requirement not found")

    requirements = json.loads(req.requirements_json)

    if payload.against == "certificate":
        if not payload.certificate_id:
            raise HTTPException(status_code=400, detail="certificate_id required")
        cert = db.execute(
            select(Certificate).where(
                Certificate.id == payload.certificate_id,
                Certificate.user_id == user.id,
            )
        ).scalar_one_or_none()
        if not cert:
            raise HTTPException(status_code=404, detail="Certificate not found")
        evidence = build_evidence_from_certificate(cert)
        checked_against = "certificate"
    else:
        policies = db.execute(
            select(Policy).where(
                Policy.user_id == user.id,
                Policy.status != "archived",
            )
        ).scalars().all()
        evidence = build_evidence_from_policies(policies)
        checked_against = "policies"

    results = compare_requirements(requirements, evidence)

    pass_count = sum(1 for r in results if r["status"] == "pass")
    fail_count = sum(1 for r in results if r["status"] == "fail")
    unclear_count = sum(1 for r in results if r["status"] == "unclear")

    check = ComplianceCheck(
        user_id=user.id,
        lease_requirement_id=req_id,
        certificate_id=payload.certificate_id if payload.against == "certificate" else None,
        checked_against=checked_against,
        results_json=json.dumps(results),
        pass_count=pass_count,
        fail_count=fail_count,
        unclear_count=unclear_count,
    )
    db.add(check)
    db.commit()
    db.refresh(check)

    return {
        "id": check.id,
        "results": results,
        "pass_count": pass_count,
        "fail_count": fail_count,
        "unclear_count": unclear_count,
        "checked_against": checked_against,
        "created_at": check.created_at.isoformat() if check.created_at else None,
    }


@router.get("/requirements/{req_id}/checks")
def list_compliance_checks(
    req_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    checks = db.execute(
        select(ComplianceCheck).where(
            ComplianceCheck.lease_requirement_id == req_id,
            ComplianceCheck.user_id == user.id,
        ).order_by(ComplianceCheck.created_at.desc())
    ).scalars().all()
    return [
        {
            "id": c.id,
            "checked_against": c.checked_against,
            "results_json": c.results_json,
            "pass_count": c.pass_count,
            "fail_count": c.fail_count,
            "unclear_count": c.unclear_count,
            "submitted_at": c.submitted_at.isoformat() if c.submitted_at else None,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in checks
    ]


# ── Broker Email ────────────────────────────────────

@router.post("/requirements/{req_id}/broker-email")
def generate_broker_email_route(
    req_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.id == req_id,
            LeaseRequirement.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Lease requirement not found")

    requirements = json.loads(req.requirements_json)

    # Get latest check results if available
    latest_check = db.execute(
        select(ComplianceCheck).where(
            ComplianceCheck.lease_requirement_id == req_id,
            ComplianceCheck.user_id == user.id,
        ).order_by(ComplianceCheck.created_at.desc())
    ).scalar_one_or_none()

    results = json.loads(latest_check.results_json) if latest_check else []

    # Try to get broker info from profile
    from .models_profile import ProfileContact
    broker = db.execute(
        select(ProfileContact).where(
            ProfileContact.user_id == user.id,
            ProfileContact.contact_type == "broker",
        )
    ).scalar_one_or_none()

    email_data = generate_broker_email(
        requirements=requirements,
        results=results,
        property_address=req.property_address,
        landlord_name=req.counterparty_name if req.role == "tenant" else None,
        broker_name=broker.name if broker else None,
    )

    return {
        "subject": email_data["subject"],
        "body": email_data["body"],
        "broker_name": broker.name if broker else None,
        "broker_email": broker.email if broker else None,
    }


# ── Sharing ─────────────────────────────────────────

class SendToTenantRequest(BaseModel):
    tenant_email: str
    tenant_name: Optional[str] = None


@router.post("/requirements/{req_id}/send-to-tenant")
async def send_to_tenant(
    req_id: int,
    payload: SendToTenantRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.id == req_id,
            LeaseRequirement.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Lease requirement not found")

    # Update counterparty info
    if payload.tenant_email:
        req.counterparty_email = payload.tenant_email
    if payload.tenant_name:
        req.counterparty_name = payload.tenant_name
    db.commit()

    # Send email
    public_url = f"{settings.app_url}/lease-compliance/{req.access_code}"
    from .email import send_lease_requirements_email

    # Get user's name for the email
    from .models_profile import UserProfile
    profile = db.execute(
        select(UserProfile).where(UserProfile.user_id == user.id)
    ).scalar_one_or_none()
    from_name = profile.full_name if profile and profile.full_name else user.email

    await send_lease_requirements_email(
        to_email=payload.tenant_email,
        from_name=from_name,
        property_address=req.property_address,
        public_url=public_url,
    )

    from .email import log_email_send
    log_email_send(db, payload.tenant_email, "lease_requirements", f"Lease requirements shared", "sent")
    db.commit()

    return {"ok": True, "public_url": public_url}


# ── Public Endpoints ────────────────────────────────

@router.get("/public/{code}")
def get_public_requirement(
    code: str,
    db: Session = Depends(get_db),
):
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.access_code == code,
            LeaseRequirement.status == "active",
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Requirements not found or link expired")

    return {
        "label": req.label,
        "role": req.role,
        "counterparty_name": req.counterparty_name,
        "property_address": req.property_address,
        "requirements": json.loads(req.requirements_json),
        "created_at": req.created_at.isoformat() if req.created_at else None,
    }


@router.post("/public/{code}/submit-coi")
async def submit_coi_public(
    code: str,
    file: UploadFile = File(...),
    tenant_name: str = Form(""),
    tenant_email: str = Form(""),
    db: Session = Depends(get_db),
):
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.access_code == code,
            LeaseRequirement.status == "active",
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Requirements not found or link expired")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    # Extract COI from PDF
    try:
        import fitz
        doc = fitz.open(stream=content, filetype="pdf")
        images = []
        for page_num in range(min(len(doc), 20)):
            page = doc[page_num]
            pix = page.get_pixmap(dpi=200)
            images.append(pix.tobytes("png"))
        doc.close()
    except Exception as e:
        logger.exception("PDF conversion failed")
        raise HTTPException(status_code=400, detail=f"Could not process PDF: {str(e)}")

    extractor = get_extractor()
    try:
        coi_result = extractor.extract_coi_images(images)
    except Exception as e:
        logger.exception("COI extraction failed")
        raise HTTPException(status_code=500, detail=f"Certificate extraction failed: {str(e)}")

    # Build evidence from the extracted COI
    evidence = []
    for ct in (coi_result.coverage_types or []):
        ct_lower = ct.lower()
        type_map = {
            "general liability": "general_liability",
            "auto": "commercial_auto",
            "commercial auto": "commercial_auto",
            "workers comp": "workers_comp",
            "workers compensation": "workers_comp",
            "umbrella": "umbrella",
            "professional liability": "professional_liability",
            "property": "property",
        }
        category = type_map.get(ct_lower, "other")
        entry = {"category": category, "carrier": coi_result.carrier}
        if coi_result.primary_coverage_amount:
            entry["coverage_amount"] = coi_result.primary_coverage_amount
        evidence.append(entry)

        if coi_result.additional_insured:
            evidence.append({"category": category, "endorsement": "additional_insured", "value": True})
        if coi_result.waiver_of_subrogation:
            evidence.append({"category": category, "endorsement": "waiver_of_subrogation", "value": True})

    # Run compliance check
    requirements = json.loads(req.requirements_json)
    results = compare_requirements(requirements, evidence)

    pass_count = sum(1 for r in results if r["status"] == "pass")
    fail_count = sum(1 for r in results if r["status"] == "fail")
    unclear_count = sum(1 for r in results if r["status"] == "unclear")

    # Save the check
    check = ComplianceCheck(
        user_id=req.user_id,
        lease_requirement_id=req.id,
        checked_against="certificate",
        results_json=json.dumps(results),
        pass_count=pass_count,
        fail_count=fail_count,
        unclear_count=unclear_count,
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(check)
    db.commit()
    db.refresh(check)

    # Email the landlord
    owner = db.execute(select(User).where(User.id == req.user_id)).scalar_one_or_none()
    if owner and owner.email:
        from .email import send_coi_submission_email
        review_url = f"{settings.app_url}/lease-compliance"
        submitter_name = tenant_name or tenant_email or "A tenant"
        await send_coi_submission_email(
            to_email=owner.email,
            tenant_name=submitter_name,
            property_address=req.property_address,
            pass_count=pass_count,
            fail_count=fail_count,
            unclear_count=unclear_count,
            review_url=review_url,
        )
        from .email import log_email_send
        log_email_send(db, owner.email, "coi_submission", f"COI submitted by {submitter_name}", "sent")
        db.commit()

    return {
        "ok": True,
        "results": results,
        "pass_count": pass_count,
        "fail_count": fail_count,
        "unclear_count": unclear_count,
    }


# ── Helpers ─────────────────────────────────────────

def _requirement_to_dict(req: LeaseRequirement, db: Session) -> dict:
    """Convert a LeaseRequirement to a response dict with latest check info."""
    latest_check = db.execute(
        select(ComplianceCheck).where(
            ComplianceCheck.lease_requirement_id == req.id,
        ).order_by(ComplianceCheck.created_at.desc())
    ).scalar_one_or_none()

    result = {
        "id": req.id,
        "user_id": req.user_id,
        "label": req.label,
        "role": req.role,
        "counterparty_name": req.counterparty_name,
        "counterparty_email": req.counterparty_email,
        "property_address": req.property_address,
        "lease_clause_text": req.lease_clause_text,
        "requirements_json": req.requirements_json,
        "access_code": req.access_code,
        "status": req.status,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
        "latest_check": None,
    }

    if latest_check:
        result["latest_check"] = {
            "id": latest_check.id,
            "pass_count": latest_check.pass_count,
            "fail_count": latest_check.fail_count,
            "unclear_count": latest_check.unclear_count,
            "checked_against": latest_check.checked_against,
            "created_at": latest_check.created_at.isoformat() if latest_check.created_at else None,
        }

    return result
