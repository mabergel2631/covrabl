"""
Email Ingestion API routes.
Handles inbound email addresses and policy drafts from email attachments.
"""

import secrets
import json
import hashlib
import hmac
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_db
from .models import Policy, User
from .models_features import InboundAddress, InboundEmail, PolicyDraft
from .config import settings

router = APIRouter(tags=["inbound"])


# ═══════════════════════════════════════════════════════════════
# Helper functions
# ═══════════════════════════════════════════════════════════════

def generate_alias(user_id: int) -> str:
    """Generate a unique email alias for a user."""
    random_part = secrets.token_hex(4)
    return f"u_{user_id}_{random_part}"


def get_inbound_domain() -> str:
    """Get the inbound email domain from settings."""
    return getattr(settings, 'INBOUND_EMAIL_DOMAIN', 'inbound.policyvault.com')


def verify_webhook_signature(payload: bytes, signature: str, secret: str) -> bool:
    """Verify webhook signature from email service (SendGrid/Mailgun)."""
    if not secret:
        return True  # Skip verification if no secret configured

    expected = hmac.HMAC(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(signature, expected)


# ═══════════════════════════════════════════════════════════════
# Request/Response schemas
# ═══════════════════════════════════════════════════════════════

class InboundAddressResponse(BaseModel):
    id: int
    email: str
    alias: str
    is_active: bool
    created_at: str


class DraftResponse(BaseModel):
    id: int
    carrier: Optional[str]
    policy_number: Optional[str]
    policy_type: Optional[str]
    matched_policy_id: Optional[int]
    original_filename: Optional[str]
    extraction_data: Optional[dict]
    status: str
    created_at: str


class ApproveDraftRequest(BaseModel):
    policy_type: Optional[str] = None
    scope: str = "personal"


# ═══════════════════════════════════════════════════════════════
# Inbound Address Management
# ═══════════════════════════════════════════════════════════════

@router.post("/inbound/address")
def create_inbound_address(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Create or get the user's inbound email address."""
    # Check if user already has an address
    existing = db.execute(
        select(InboundAddress).where(InboundAddress.user_id == user.id)
    ).scalar_one_or_none()

    if existing:
        domain = existing.domain or get_inbound_domain()
        return {
            "id": existing.id,
            "email": f"{existing.alias}@{domain}",
            "alias": existing.alias,
            "is_active": existing.is_active,
            "created_at": str(existing.created_at),
        }

    # Create new address
    alias = generate_alias(user.id)
    domain = get_inbound_domain()

    address = InboundAddress(
        user_id=user.id,
        alias=alias,
        domain=domain,
    )
    db.add(address)
    db.commit()
    db.refresh(address)

    return {
        "id": address.id,
        "email": f"{alias}@{domain}",
        "alias": alias,
        "is_active": address.is_active,
        "created_at": str(address.created_at),
    }


@router.get("/inbound/address")
def get_inbound_address(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get the user's inbound email address."""
    address = db.execute(
        select(InboundAddress).where(InboundAddress.user_id == user.id)
    ).scalar_one_or_none()

    if not address:
        return {"address": None}

    domain = address.domain or get_inbound_domain()
    return {
        "address": {
            "id": address.id,
            "email": f"{address.alias}@{domain}",
            "alias": address.alias,
            "is_active": address.is_active,
            "created_at": str(address.created_at),
        }
    }


@router.put("/inbound/address")
def update_inbound_address(
    is_active: bool,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Enable or disable the inbound address."""
    address = db.execute(
        select(InboundAddress).where(InboundAddress.user_id == user.id)
    ).scalar_one_or_none()

    if not address:
        raise HTTPException(status_code=404, detail="No inbound address found")

    address.is_active = is_active
    db.commit()

    return {"ok": True}


@router.delete("/inbound/address")
def delete_inbound_address(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Delete the user's inbound address."""
    address = db.execute(
        select(InboundAddress).where(InboundAddress.user_id == user.id)
    ).scalar_one_or_none()

    if not address:
        raise HTTPException(status_code=404, detail="No inbound address found")

    db.delete(address)
    db.commit()

    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
# Email Webhook (called by SendGrid/Mailgun)
# ═══════════════════════════════════════════════════════════════

async def process_email_async(email_id: int, db_session_maker):
    """Background task to process an inbound email."""
    from sqlalchemy.orm import Session
    db = db_session_maker()

    try:
        email = db.get(InboundEmail, email_id)
        if not email:
            return

        email.status = "processing"
        db.commit()

        # Parse payload
        try:
            payload = json.loads(email.raw_payload) if email.raw_payload else {}
        except:
            email.status = "failed"
            email.error_message = "Invalid payload format"
            db.commit()
            return

        # Extract attachments (format depends on email service)
        attachments = payload.get("attachments", [])
        pdf_attachments = [a for a in attachments if a.get("content_type", "").lower() == "application/pdf"]

        if not pdf_attachments:
            email.status = "completed"
            email.error_message = "No PDF attachments found"
            db.commit()
            return

        # Process each PDF attachment
        for attachment in pdf_attachments:
            try:
                # Save attachment to uploads
                content = attachment.get("content")  # Base64 encoded
                filename = attachment.get("filename", "document.pdf")

                if content:
                    import base64
                    pdf_bytes = base64.b64decode(content)

                    # Save to uploads directory
                    upload_dir = Path(__file__).resolve().parent.parent / "uploads"
                    upload_dir.mkdir(exist_ok=True)

                    object_key = f"inbound_{email.id}_{secrets.token_hex(8)}.pdf"
                    file_path = upload_dir / object_key
                    file_path.write_bytes(pdf_bytes)

                    # Try to extract policy info
                    from .extraction import get_extractor
                    import pdfplumber
                    import io

                    text = ""
                    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                        for page in pdf.pages:
                            page_text = page.extract_text()
                            if page_text:
                                text += page_text + "\n"

                    extraction_data = {}
                    if text.strip():
                        extractor = get_extractor()
                        result = extractor.extract(text)
                        extraction_data = {
                            "carrier": result.carrier,
                            "policy_number": result.policy_number,
                            "policy_type": result.policy_type,
                            "coverage_amount": result.coverage_amount,
                            "deductible": result.deductible,
                            "premium_amount": result.premium_amount,
                        }

                    # Try to match to existing policy
                    matched_policy_id = None
                    if extraction_data.get("policy_number"):
                        existing_policy = db.execute(
                            select(Policy).where(
                                Policy.user_id == email.user_id,
                                Policy.policy_number == extraction_data["policy_number"]
                            )
                        ).scalar_one_or_none()
                        if existing_policy:
                            matched_policy_id = existing_policy.id

                    # Create draft
                    draft = PolicyDraft(
                        user_id=email.user_id,
                        inbound_email_id=email.id,
                        matched_policy_id=matched_policy_id,
                        carrier=extraction_data.get("carrier"),
                        policy_number=extraction_data.get("policy_number"),
                        policy_type=extraction_data.get("policy_type"),
                        extraction_data=json.dumps(extraction_data),
                        original_filename=filename,
                        object_key=object_key,
                    )
                    db.add(draft)

            except Exception as e:
                email.error_message = str(e)

        email.status = "completed"
        db.commit()

    except Exception as e:
        if email:
            email.status = "failed"
            email.error_message = str(e)
            db.commit()
    finally:
        db.close()


@router.post("/webhooks/inbound-email")
async def receive_inbound_email(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Webhook endpoint for receiving inbound emails from email service.
    No authentication required - validates via webhook signature.
    """
    # Get raw body for signature verification
    body = await request.body()

    # Verify webhook signature (if configured)
    webhook_secret = getattr(settings, 'INBOUND_WEBHOOK_SECRET', None)
    signature = request.headers.get('X-Webhook-Signature', '')

    if webhook_secret and not verify_webhook_signature(body, signature, webhook_secret):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # Parse payload
    try:
        payload = json.loads(body)
    except:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Extract recipient address
    # Format depends on email service (SendGrid vs Mailgun)
    recipient = payload.get("to") or payload.get("recipient") or payload.get("envelope", {}).get("to", [""])[0]
    if isinstance(recipient, list):
        recipient = recipient[0] if recipient else ""

    # Extract alias from recipient
    alias = recipient.split("@")[0] if "@" in recipient else recipient

    # Find matching inbound address
    address = db.execute(
        select(InboundAddress).where(InboundAddress.alias == alias)
    ).scalar_one_or_none()

    if not address:
        raise HTTPException(status_code=404, detail="Unknown recipient address")

    if not address.is_active:
        raise HTTPException(status_code=403, detail="Inbound address is disabled")

    # Create email record
    from_email = payload.get("from") or payload.get("sender") or "unknown"
    subject = payload.get("subject") or ""

    email = InboundEmail(
        user_id=address.user_id,
        inbound_address_id=address.id,
        from_email=from_email,
        subject=subject,
        raw_payload=json.dumps(payload),
    )
    db.add(email)
    db.commit()
    db.refresh(email)

    # Process email in background
    from .db import SessionLocal
    background_tasks.add_task(process_email_async, email.id, SessionLocal)

    return {"ok": True, "email_id": email.id}


# ═══════════════════════════════════════════════════════════════
# Policy Drafts Management
# ═══════════════════════════════════════════════════════════════

@router.get("/inbound/drafts")
def list_drafts(
    status: Optional[str] = "pending",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """List policy drafts for the current user."""
    query = select(PolicyDraft).where(PolicyDraft.user_id == user.id)

    if status:
        query = query.where(PolicyDraft.status == status)

    query = query.order_by(PolicyDraft.created_at.desc())
    drafts = db.execute(query).scalars().all()

    items = []
    for d in drafts:
        extraction = json.loads(d.extraction_data) if d.extraction_data else {}
        items.append({
            "id": d.id,
            "carrier": d.carrier,
            "policy_number": d.policy_number,
            "policy_type": d.policy_type,
            "matched_policy_id": d.matched_policy_id,
            "original_filename": d.original_filename,
            "extraction_data": extraction,
            "status": d.status,
            "created_at": str(d.created_at),
        })

    return {"items": items, "total": len(items)}


@router.get("/inbound/drafts/{draft_id}")
def get_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get a specific draft."""
    draft = db.get(PolicyDraft, draft_id)
    if not draft or draft.user_id != user.id:
        raise HTTPException(status_code=404, detail="Draft not found")

    extraction = json.loads(draft.extraction_data) if draft.extraction_data else {}

    return {
        "id": draft.id,
        "carrier": draft.carrier,
        "policy_number": draft.policy_number,
        "policy_type": draft.policy_type,
        "matched_policy_id": draft.matched_policy_id,
        "original_filename": draft.original_filename,
        "object_key": draft.object_key,
        "extraction_data": extraction,
        "status": draft.status,
        "created_at": str(draft.created_at),
    }


@router.post("/inbound/drafts/{draft_id}/approve")
def approve_draft(
    draft_id: int,
    payload: ApproveDraftRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Approve a draft and create/update the policy."""
    draft = db.get(PolicyDraft, draft_id)
    if not draft or draft.user_id != user.id:
        raise HTTPException(status_code=404, detail="Draft not found")

    if draft.status != "pending":
        raise HTTPException(status_code=400, detail="Draft already processed")

    extraction = json.loads(draft.extraction_data) if draft.extraction_data else {}

    # If matched to existing policy, update it
    if draft.matched_policy_id:
        policy = db.get(Policy, draft.matched_policy_id)
        if policy and policy.user_id == user.id:
            # Update policy fields from extraction
            if extraction.get("carrier"):
                policy.carrier = extraction["carrier"]
            if extraction.get("coverage_amount"):
                policy.coverage_amount = extraction["coverage_amount"]
            if extraction.get("deductible"):
                policy.deductible = extraction["deductible"]
            if extraction.get("premium_amount"):
                policy.premium_amount = extraction["premium_amount"]

            draft.status = "approved"
            db.commit()

            return {"ok": True, "policy_id": policy.id, "action": "updated"}

    # Create new policy
    policy = Policy(
        user_id=user.id,
        scope=payload.scope,
        policy_type=payload.policy_type or draft.policy_type or "other",
        carrier=draft.carrier or extraction.get("carrier") or "Unknown",
        policy_number=draft.policy_number or extraction.get("policy_number") or "TBD",
        coverage_amount=extraction.get("coverage_amount"),
        deductible=extraction.get("deductible"),
        premium_amount=extraction.get("premium_amount"),
    )
    db.add(policy)
    db.flush()

    # Link the uploaded document to the policy
    if draft.object_key:
        from .models_documents import Document
        doc = Document(
            policy_id=policy.id,
            filename=draft.original_filename or "document.pdf",
            content_type="application/pdf",
            object_key=draft.object_key,
            doc_type="policy",
            extraction_status="done",
        )
        db.add(doc)

    draft.status = "approved"
    draft.matched_policy_id = policy.id
    db.commit()

    return {"ok": True, "policy_id": policy.id, "action": "created"}


@router.post("/inbound/drafts/{draft_id}/reject")
def reject_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Reject and discard a draft."""
    draft = db.get(PolicyDraft, draft_id)
    if not draft or draft.user_id != user.id:
        raise HTTPException(status_code=404, detail="Draft not found")

    if draft.status != "pending":
        raise HTTPException(status_code=400, detail="Draft already processed")

    draft.status = "rejected"
    db.commit()

    return {"ok": True}


@router.get("/inbound/drafts/count")
def count_pending_drafts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get count of pending drafts for dashboard notification."""
    count = len(db.execute(
        select(PolicyDraft).where(
            PolicyDraft.user_id == user.id,
            PolicyDraft.status == "pending"
        )
    ).scalars().all())

    return {"count": count}
