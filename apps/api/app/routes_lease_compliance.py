"""Lease compliance routes — extract requirements, compare, share."""

import asyncio
import json
import logging
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from typing import Optional

from .auth import get_current_user
from .config import settings
from .db import get_db, SessionLocal
from .models import User, Policy, Contact
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
        result = await asyncio.to_thread(extractor.extract_lease_images, images)
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

    # Validate policy_id ownership
    if payload.policy_id:
        pol = db.execute(
            select(Policy).where(Policy.id == payload.policy_id, Policy.user_id == user.id)
        ).scalar_one_or_none()
        if not pol:
            raise HTTPException(status_code=404, detail="Policy not found")

    req = LeaseRequirement(
        user_id=user.id,
        policy_id=payload.policy_id,
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
    policy_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    query = select(LeaseRequirement).where(
        LeaseRequirement.user_id == user.id,
        LeaseRequirement.status == "active",
        LeaseRequirement.policy_id.isnot(None),  # exclude orphaned (policy deleted)
    )
    if role and role in ("tenant", "landlord"):
        query = query.where(LeaseRequirement.role == role)
    if policy_id is not None:
        query = query.where(LeaseRequirement.policy_id == policy_id)
    query = query.order_by(LeaseRequirement.created_at.desc())
    reqs = db.execute(query).scalars().all()

    # Filter out any reqs whose policy no longer exists (extra safety)
    valid_reqs = []
    for r in reqs:
        if r.policy_id and db.get(Policy, r.policy_id):
            valid_reqs.append(r)
    return [_requirement_to_dict(r, db) for r in valid_reqs]


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
    # Manually cascade-delete compliance checks (live DB may lack CASCADE constraint)
    db.execute(
        delete(ComplianceCheck).where(ComplianceCheck.lease_requirement_id == req_id)
    )
    db.delete(req)
    db.commit()
    return {"ok": True}


# ── Compliance Checks ───────────────────────────────

class CheckRequest(BaseModel):
    against: str  # "policies", "policy", or "certificate"
    certificate_id: Optional[int] = None
    policy_id: Optional[int] = None


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
    elif payload.against == "policy":
        pid = payload.policy_id
        if not pid:
            raise HTTPException(status_code=400, detail="policy_id required for single-policy check")
        pol = db.execute(
            select(Policy).where(
                Policy.id == pid,
                Policy.user_id == user.id,
            )
        ).scalar_one_or_none()
        if not pol:
            raise HTTPException(status_code=404, detail="Policy not found")
        evidence = build_evidence_from_policies([pol])
        checked_against = "policy"
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


def _build_evidence_from_coi(coi_result) -> list[dict]:
    """Build evidence list from a COIExtractionResult."""
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
        entry: dict = {"category": category, "carrier": coi_result.carrier}
        if coi_result.primary_coverage_amount:
            entry["coverage_amount"] = coi_result.primary_coverage_amount
        evidence.append(entry)
        if coi_result.additional_insured:
            evidence.append({"category": category, "endorsement": "additional_insured", "value": True})
        if coi_result.waiver_of_subrogation:
            evidence.append({"category": category, "endorsement": "waiver_of_subrogation", "value": True})
    return evidence


def _process_coi_check(check_id: int, requirements_json: str, content: bytes,
                        tenant_name: str | None = None, tenant_email: str | None = None,
                        notify_owner_id: int | None = None, property_address: str | None = None,
                        policy_id: int | None = None, tenant_notes: str | None = None):
    """Background task: extract COI, compare, and update the ComplianceCheck row."""
    db = SessionLocal()
    try:
        check = db.execute(
            select(ComplianceCheck).where(ComplianceCheck.id == check_id)
        ).scalar_one_or_none()
        if not check:
            logger.error("Background COI processing: check %s not found", check_id)
            return

        check.status = "processing"
        db.commit()

        # PDF -> images
        import fitz
        doc = fitz.open(stream=content, filetype="pdf")
        images = []
        for page_num in range(min(len(doc), 20)):
            page = doc[page_num]
            pix = page.get_pixmap(dpi=200)
            images.append(pix.tobytes("png"))
        doc.close()

        # Extract COI data
        extractor = get_extractor()
        coi_result = extractor.extract_coi_images(images)

        # Build evidence and compare
        evidence = _build_evidence_from_coi(coi_result)
        requirements = json.loads(requirements_json)
        results = compare_requirements(requirements, evidence)

        pass_count = sum(1 for r in results if r["status"] == "pass")
        fail_count = sum(1 for r in results if r["status"] == "fail")
        unclear_count = sum(1 for r in results if r["status"] == "unclear")

        check.results_json = json.dumps(results)
        check.pass_count = pass_count
        check.fail_count = fail_count
        check.unclear_count = unclear_count
        check.status = "complete"
        db.commit()

        # If this was a public submission, email the landlord
        if notify_owner_id:
            owner = db.execute(select(User).where(User.id == notify_owner_id)).scalar_one_or_none()
            if owner and owner.email:
                from .email import send_coi_submission_email, log_email_send
                review_url = f"{settings.app_url}/policies/{policy_id}#lease" if policy_id else f"{settings.app_url}/lease-compliance"
                submitter_name = tenant_name or tenant_email or "A tenant"
                import asyncio
                # Run the async email function from sync context
                loop = asyncio.new_event_loop()
                try:
                    loop.run_until_complete(send_coi_submission_email(
                        to_email=owner.email,
                        tenant_name=submitter_name,
                        property_address=property_address,
                        pass_count=pass_count,
                        fail_count=fail_count,
                        unclear_count=unclear_count,
                        review_url=review_url,
                        notes=tenant_notes,
                    ))
                finally:
                    loop.close()
                log_email_send(db, owner.email, "coi_submission", f"COI submitted by {submitter_name}", "sent")
                db.commit()

    except Exception as e:
        logger.exception("Background COI processing failed for check %s", check_id)
        try:
            check = db.execute(
                select(ComplianceCheck).where(ComplianceCheck.id == check_id)
            ).scalar_one_or_none()
            if check:
                check.status = "error"
                check.error_message = str(e)[:2000]
                db.commit()
        except Exception:
            logger.exception("Failed to update check status to error")
    finally:
        db.close()


@router.get("/checks/{check_id}/status")
def get_check_status(
    check_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Poll for async compliance check status."""
    check = db.execute(
        select(ComplianceCheck).where(ComplianceCheck.id == check_id)
    ).scalar_one_or_none()
    if not check:
        raise HTTPException(status_code=404, detail="Check not found")
    # Allow access if user owns the check or the parent requirement
    if check.user_id != user.id:
        req = db.execute(
            select(LeaseRequirement).where(
                LeaseRequirement.id == check.lease_requirement_id,
                LeaseRequirement.user_id == user.id,
            )
        ).scalar_one_or_none()
        if not req:
            raise HTTPException(status_code=404, detail="Check not found")

    result: dict = {
        "id": check.id,
        "status": check.status,
    }
    if check.status == "complete":
        results = json.loads(check.results_json) if check.results_json else []
        result.update({
            "ok": True,
            "results": results,
            "pass_count": check.pass_count,
            "fail_count": check.fail_count,
            "unclear_count": check.unclear_count,
            "checked_against": check.checked_against,
            "has_document": bool(check.coi_file_key),
        })
    elif check.status == "error":
        result["error"] = check.error_message or "Processing failed"
    return result


@router.post("/requirements/{req_id}/check-document")
async def check_document(
    req_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Tenant uploads a COI/dec page PDF — returns immediately, processes in background."""
    check_feature(user, "lease_compliance")
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.id == req_id,
            LeaseRequirement.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Lease requirement not found")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    # Save PDF to disk + DB
    upload_dir = Path(__file__).resolve().parent.parent / "uploads"
    coi_file_key = f"coi/{req.id}/{uuid.uuid4()}-{file.filename or 'certificate.pdf'}"
    coi_dest = upload_dir / coi_file_key
    coi_dest.parent.mkdir(parents=True, exist_ok=True)
    coi_dest.write_bytes(content)

    # Create a "pending" check immediately
    check = ComplianceCheck(
        user_id=user.id,
        lease_requirement_id=req.id,
        checked_against="document",
        results_json="[]",
        pass_count=0,
        fail_count=0,
        unclear_count=0,
        coi_file_key=coi_file_key,
        coi_file_data=content,
        status="pending",
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(check)
    db.commit()
    db.refresh(check)

    # Process in background (PDF→images→AI→compare→update)
    background_tasks.add_task(
        _process_coi_check,
        check.id,
        req.requirements_json,
        content,
    )

    return {
        "id": check.id,
        "ok": True,
        "status": "pending",
    }


@router.get("/requirements/{req_id}/checks")
def list_compliance_checks(
    req_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_feature(user, "lease_compliance")
    # Allow access if user owns the check OR the parent requirement
    req = db.execute(
        select(LeaseRequirement).where(LeaseRequirement.id == req_id)
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Requirement not found")
    if req.user_id != user.id:
        # Check if user has any checks on this requirement (tenant)
        has_own = db.execute(
            select(ComplianceCheck.id).where(
                ComplianceCheck.lease_requirement_id == req_id,
                ComplianceCheck.user_id == user.id,
            ).limit(1)
        ).scalar_one_or_none()
        if not has_own:
            raise HTTPException(status_code=404, detail="Requirement not found")
    checks = db.execute(
        select(ComplianceCheck).where(
            ComplianceCheck.lease_requirement_id == req_id,
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
            "tenant_name": c.tenant_name,
            "tenant_email": c.tenant_email,
            "has_document": bool(c.coi_file_key),
            "status": getattr(c, 'status', 'complete'),
            "submitted_at": c.submitted_at.isoformat() if c.submitted_at else None,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in checks
    ]


# ── COI Document Download ──────────────────────────

@router.get("/checks/{check_id}/document")
def download_coi_document(
    check_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download the tenant's uploaded COI document."""
    # Allow both the check owner AND the lease requirement owner to download
    check = db.execute(
        select(ComplianceCheck).where(ComplianceCheck.id == check_id)
    ).scalar_one_or_none()
    if not check:
        raise HTTPException(status_code=404, detail="Check not found")
    # Verify the current user owns either the check or the parent requirement
    if check.user_id != user.id:
        req = db.execute(
            select(LeaseRequirement).where(
                LeaseRequirement.id == check.lease_requirement_id,
                LeaseRequirement.user_id == user.id,
            )
        ).scalar_one_or_none()
        if not req:
            raise HTTPException(status_code=404, detail="Check not found")
    if not check.coi_file_key:
        raise HTTPException(status_code=404, detail="No document attached to this check")

    # Serve from database blob (survives Railway redeploys)
    if check.coi_file_data:
        from fastapi.responses import Response
        filename = Path(check.coi_file_key).name if check.coi_file_key else "certificate.pdf"
        return Response(
            content=check.coi_file_data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    # Fallback: serve from local disk
    upload_dir = Path(__file__).resolve().parent.parent / "uploads"
    file_path = upload_dir / check.coi_file_key
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Document file not found on server")

    from fastapi.responses import FileResponse
    return FileResponse(
        path=str(file_path),
        media_type="application/pdf",
        filename=file_path.name,
    )


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
    ).scalars().first()

    results = json.loads(latest_check.results_json) if latest_check else []

    # Try to get broker info — first from policy contacts, then profile
    broker_name = None
    broker_email = None

    # Check policy contacts if this requirement is linked to a policy
    if req.policy_id:
        policy_broker = db.execute(
            select(Contact).where(
                Contact.policy_id == req.policy_id,
                Contact.role == "broker",
            )
        ).scalars().first()
        if policy_broker:
            broker_name = policy_broker.name
            broker_email = policy_broker.email

    # Fall back to profile broker contact
    if not broker_name:
        from .models_profile import ProfileContact
        profile_broker = db.execute(
            select(ProfileContact).where(
                ProfileContact.user_id == user.id,
                ProfileContact.contact_type == "broker",
            )
        ).scalars().first()
        if profile_broker:
            broker_name = profile_broker.name
            broker_email = profile_broker.email

    email_data = generate_broker_email(
        requirements=requirements,
        results=results,
        property_address=req.property_address,
        landlord_name=req.counterparty_name if req.role == "tenant" else None,
        broker_name=broker_name,
    )

    return {
        "subject": email_data["subject"],
        "body": email_data["body"],
        "broker_name": broker_name,
        "broker_email": broker_email,
    }


# ── Sharing ─────────────────────────────────────────

class SendToTenantRequest(BaseModel):
    tenant_email: str
    tenant_name: Optional[str] = None
    notes: Optional[str] = None
    from_name: Optional[str] = None


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

    # Only set counterparty if not already set (don't overwrite for multi-tenant)
    if not req.counterparty_email and payload.tenant_email:
        req.counterparty_email = payload.tenant_email
    if not req.counterparty_name and payload.tenant_name:
        req.counterparty_name = payload.tenant_name
    db.commit()

    # Send email
    public_url = f"{settings.app_url}/lease-compliance/{req.access_code}"
    from .email import send_lease_requirements_email

    # Get sender name: use custom from_name if provided, else fall back to profile
    if payload.from_name and payload.from_name.strip():
        from_name = payload.from_name.strip()
    else:
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
        notes=payload.notes,
    )

    from .email import log_email_send
    log_email_send(db, payload.tenant_email, "lease_requirements", f"Lease requirements shared", "sent")
    db.commit()

    return {"ok": True, "public_url": public_url}


class SendToLandlordRequest(BaseModel):
    landlord_email: str
    landlord_name: Optional[str] = None
    notes: Optional[str] = None
    from_name: Optional[str] = None


@router.post("/requirements/{req_id}/send-to-landlord")
async def send_to_landlord(
    req_id: int,
    payload: SendToLandlordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Tenant sends compliance results to their landlord."""
    check_feature(user, "lease_compliance")
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.id == req_id,
            LeaseRequirement.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Lease requirement not found")

    # Get latest check results
    latest_check = db.execute(
        select(ComplianceCheck).where(
            ComplianceCheck.lease_requirement_id == req_id,
            ComplianceCheck.user_id == user.id,
        ).order_by(ComplianceCheck.created_at.desc())
    ).scalars().first()

    pass_count = latest_check.pass_count if latest_check else 0
    fail_count = latest_check.fail_count if latest_check else 0
    unclear_count = latest_check.unclear_count if latest_check else 0

    # Get sender name
    if payload.from_name and payload.from_name.strip():
        from_name = payload.from_name.strip()
    else:
        from .models_profile import UserProfile
        profile = db.execute(
            select(UserProfile).where(UserProfile.user_id == user.id)
        ).scalar_one_or_none()
        from_name = profile.full_name if profile and profile.full_name else user.email

    from .email import send_landlord_compliance_email
    await send_landlord_compliance_email(
        to_email=payload.landlord_email,
        landlord_name=payload.landlord_name or "Landlord",
        tenant_name=from_name,
        property_address=req.property_address,
        pass_count=pass_count,
        fail_count=fail_count,
        unclear_count=unclear_count,
        notes=payload.notes,
    )

    from .email import log_email_send
    log_email_send(db, payload.landlord_email, "landlord_compliance", "Compliance results sent to landlord", "sent")
    db.commit()

    return {"ok": True}


class SendDeficiencyRequest(BaseModel):
    tenant_email: str
    tenant_name: Optional[str] = None
    notes: Optional[str] = None
    from_name: Optional[str] = None


@router.post("/requirements/{req_id}/send-deficiency")
async def send_deficiency_notice(
    req_id: int,
    payload: SendDeficiencyRequest,
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

    # Find latest compliance check with failures
    latest_check = db.execute(
        select(ComplianceCheck).where(
            ComplianceCheck.lease_requirement_id == req_id,
        ).order_by(ComplianceCheck.id.desc())
    ).scalar_one_or_none()

    failed_items = []
    if latest_check and latest_check.results_json:
        results = json.loads(latest_check.results_json)
        failed_items = [
            {"label": r.get("requirement_label", ""), "note": r.get("note", "")}
            for r in results if r.get("status") == "fail"
        ]

    resubmit_url = f"{settings.app_url}/lease-compliance/{req.access_code}"

    # Get sender name: use custom from_name if provided, else fall back to profile
    if payload.from_name and payload.from_name.strip():
        landlord_name = payload.from_name.strip()
    else:
        from .models_profile import UserProfile
        profile = db.execute(
            select(UserProfile).where(UserProfile.user_id == user.id)
        ).scalar_one_or_none()
        landlord_name = profile.full_name if profile and profile.full_name else user.email

    from .email import send_deficiency_notice_email
    await send_deficiency_notice_email(
        to_email=payload.tenant_email,
        tenant_name=payload.tenant_name or "Tenant",
        landlord_name=landlord_name,
        property_address=req.property_address,
        failed_items=failed_items,
        notes=payload.notes,
        resubmit_url=resubmit_url,
    )

    from .email import log_email_send
    log_email_send(db, payload.tenant_email, "deficiency_notice", "Deficiency notice sent", "sent")
    db.commit()

    return {"ok": True}


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
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    tenant_name: str = Form(""),
    tenant_email: str = Form(""),
    tenant_notes: str = Form(""),
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

    # Save the COI PDF
    upload_dir = Path(__file__).resolve().parent.parent / "uploads"
    coi_file_key = f"coi/{req.id}/{uuid.uuid4()}-{file.filename or 'certificate.pdf'}"
    coi_dest = upload_dir / coi_file_key
    coi_dest.parent.mkdir(parents=True, exist_ok=True)
    coi_dest.write_bytes(content)

    # Create a "pending" check immediately
    check = ComplianceCheck(
        user_id=req.user_id,
        lease_requirement_id=req.id,
        checked_against="certificate",
        results_json="[]",
        pass_count=0,
        fail_count=0,
        unclear_count=0,
        tenant_name=tenant_name or None,
        tenant_email=tenant_email or None,
        coi_file_key=coi_file_key,
        coi_file_data=content,
        status="pending",
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(check)
    db.commit()
    db.refresh(check)

    # Process in background — also email the landlord on completion
    background_tasks.add_task(
        _process_coi_check,
        check.id,
        req.requirements_json,
        content,
        tenant_name=tenant_name or None,
        tenant_email=tenant_email or None,
        notify_owner_id=req.user_id,
        property_address=req.property_address,
        policy_id=req.policy_id,
        tenant_notes=tenant_notes or None,
    )

    return {
        "ok": True,
        "id": check.id,
        "status": "pending",
    }


@router.get("/public/checks/{check_id}/status")
def get_public_check_status(
    check_id: int,
    db: Session = Depends(get_db),
):
    """Poll for public COI submission check status (no auth required)."""
    check = db.execute(
        select(ComplianceCheck).where(ComplianceCheck.id == check_id)
    ).scalar_one_or_none()
    if not check:
        raise HTTPException(status_code=404, detail="Check not found")

    result: dict = {
        "id": check.id,
        "status": check.status,
    }
    if check.status == "complete":
        results = json.loads(check.results_json) if check.results_json else []
        result.update({
            "ok": True,
            "results": results,
            "pass_count": check.pass_count,
            "fail_count": check.fail_count,
            "unclear_count": check.unclear_count,
        })
    elif check.status == "error":
        result["error"] = check.error_message or "Processing failed"
    return result


# ── Printable ───────────────────────────────────────

@router.get("/requirements/{req_id}/printable")
def get_printable_requirement(
    req_id: int,
    access_code: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return requirement data formatted for printing/PDF generation."""
    req = db.execute(
        select(LeaseRequirement).where(
            LeaseRequirement.id == req_id,
            LeaseRequirement.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Lease requirement not found")

    requirements = json.loads(req.requirements_json)

    # Get latest check results
    latest_check = db.execute(
        select(ComplianceCheck).where(
            ComplianceCheck.lease_requirement_id == req.id,
            ComplianceCheck.user_id == user.id,
        ).order_by(ComplianceCheck.created_at.desc())
    ).scalars().first()

    results = json.loads(latest_check.results_json) if latest_check else []

    return {
        "label": req.label,
        "property_address": req.property_address,
        "counterparty_name": req.counterparty_name,
        "role": req.role,
        "requirements": requirements,
        "results": results,
        "pass_count": latest_check.pass_count if latest_check else 0,
        "fail_count": latest_check.fail_count if latest_check else 0,
        "unclear_count": latest_check.unclear_count if latest_check else 0,
        "created_at": req.created_at.isoformat() if req.created_at else None,
    }


# ── Helpers ─────────────────────────────────────────

def _requirement_to_dict(req: LeaseRequirement, db: Session) -> dict:
    """Convert a LeaseRequirement to a response dict with latest check info."""
    latest_check = db.execute(
        select(ComplianceCheck).where(
            ComplianceCheck.lease_requirement_id == req.id,
            ComplianceCheck.user_id == req.user_id,
        ).order_by(ComplianceCheck.created_at.desc())
    ).scalars().first()

    result = {
        "id": req.id,
        "user_id": req.user_id,
        "policy_id": req.policy_id,
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
            "tenant_name": latest_check.tenant_name,
            "created_at": latest_check.created_at.isoformat() if latest_check.created_at else None,
        }

    # Build per-tenant summary from all checks with submitted_at
    all_checks = db.execute(
        select(ComplianceCheck).where(
            ComplianceCheck.lease_requirement_id == req.id,
        ).order_by(ComplianceCheck.created_at.desc())
    ).scalars().all()

    tenants_map: dict[str, dict] = {}
    for c in all_checks:
        key = c.tenant_email or c.tenant_name
        if not key:
            continue
        if key not in tenants_map:
            tenants_map[key] = {
                "tenant_name": c.tenant_name,
                "tenant_email": c.tenant_email,
                "pass_count": c.pass_count,
                "fail_count": c.fail_count,
                "unclear_count": c.unclear_count,
                "submitted_at": c.submitted_at.isoformat() if c.submitted_at else None,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "check_id": c.id,
                "has_document": bool(c.coi_file_key),
            }
    result["tenants"] = list(tenants_map.values())

    return result
