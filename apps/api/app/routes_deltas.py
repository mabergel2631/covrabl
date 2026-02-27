"""
Delta Alerts API routes.
Tracks and displays changes between policy versions.
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from .auth import get_current_user
from .db import get_db
from .models import Policy, User
from .models_features import PolicyDelta, DeltaExplanation
from .config import settings
from .routes_billing import check_feature

router = APIRouter(tags=["deltas"])


# ═══════════════════════════════════════════════════════════════
# Severity calculation rules
# ═══════════════════════════════════════════════════════════════

def calculate_severity(field_key: str, old_value: str | None, new_value: str | None, delta_type: str) -> str:
    """Calculate severity based on field and change type."""
    try:
        old_num = float(old_value) if old_value else 0
        new_num = float(new_value) if new_value else 0
    except (ValueError, TypeError):
        old_num = new_num = 0

    # Premium changes
    if field_key == "premium_amount":
        if old_num > 0 and new_num > old_num:
            pct_change = ((new_num - old_num) / old_num) * 100
            if pct_change > 20:
                return "critical"
            elif pct_change > 10:
                return "warning"
        return "info"

    # Coverage changes
    if field_key == "coverage_amount":
        if delta_type == "decreased" or (old_num > 0 and new_num < old_num):
            return "critical"
        return "info"

    # Deductible changes
    if field_key == "deductible":
        if delta_type == "increased" or (new_num > old_num):
            return "warning"
        return "info"

    # Carrier change
    if field_key == "carrier":
        return "warning"

    # Renewal date change
    if field_key == "renewal_date":
        return "info"

    return "info"


def determine_delta_type(field_key: str, old_value: str | None, new_value: str | None) -> str:
    """Determine the type of change."""
    if old_value is None and new_value is not None:
        return "added"
    if old_value is not None and new_value is None:
        return "removed"

    # For numeric fields, determine increase/decrease
    try:
        old_num = float(old_value) if old_value else 0
        new_num = float(new_value) if new_value else 0
        if new_num > old_num:
            return "increased"
        elif new_num < old_num:
            return "decreased"
    except (ValueError, TypeError):
        pass

    return "changed"


# ═══════════════════════════════════════════════════════════════
# Delta detection helper
# ═══════════════════════════════════════════════════════════════

TRACKED_FIELDS = [
    "carrier", "policy_number", "policy_type", "scope",
    "coverage_amount", "deductible", "premium_amount", "renewal_date"
]


def detect_deltas(
    db: Session,
    policy: Policy,
    new_data: dict,
    document_id: int | None = None
) -> list[PolicyDelta]:
    """
    Compare new extraction data against current policy values.
    Creates PolicyDelta records for any changes found.
    """
    deltas = []

    for field in TRACKED_FIELDS:
        old_value = getattr(policy, field, None)
        new_value = new_data.get(field)

        # Skip if both are None or empty
        if not old_value and not new_value:
            continue

        # Convert to string for comparison
        old_str = str(old_value) if old_value is not None else None
        new_str = str(new_value) if new_value is not None else None

        # Skip "Pending extraction..." placeholder
        if old_str == "Pending extraction..." or old_str == "TBD":
            continue

        # Skip if no actual change
        if old_str == new_str:
            continue

        delta_type = determine_delta_type(field, old_str, new_str)
        severity = calculate_severity(field, old_str, new_str, delta_type)

        delta = PolicyDelta(
            policy_id=policy.id,
            document_id=document_id,
            field_key=field,
            old_value=old_str,
            new_value=new_str,
            delta_type=delta_type,
            severity=severity,
        )
        db.add(delta)
        deltas.append(delta)

    return deltas


# ═══════════════════════════════════════════════════════════════
# Response schemas
# ═══════════════════════════════════════════════════════════════

class DeltaResponse(BaseModel):
    id: int
    policy_id: int
    document_id: Optional[int]
    field_key: str
    old_value: Optional[str]
    new_value: Optional[str]
    delta_type: str
    severity: str
    is_acknowledged: bool
    created_at: str
    policy_carrier: Optional[str] = None
    policy_type: Optional[str] = None
    explanation: Optional[str] = None


class DeltaListResponse(BaseModel):
    items: list[DeltaResponse]
    total: int
    unacknowledged_count: int


# ═══════════════════════════════════════════════════════════════
# API Routes
# ═══════════════════════════════════════════════════════════════

@router.get("/deltas")
def list_all_deltas(
    acknowledged: Optional[bool] = None,
    severity: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """List all deltas for the current user across all policies."""
    check_feature(user, "deltas")
    # Get user's policy IDs
    policy_ids = db.execute(
        select(Policy.id).where(Policy.user_id == user.id)
    ).scalars().all()

    if not policy_ids:
        return {"items": [], "total": 0, "unacknowledged_count": 0}

    # Build query
    query = select(PolicyDelta).where(PolicyDelta.policy_id.in_(policy_ids))

    if acknowledged is not None:
        query = query.where(PolicyDelta.is_acknowledged == acknowledged)
    if severity:
        query = query.where(PolicyDelta.severity == severity)

    query = query.order_by(PolicyDelta.created_at.desc())

    # Count total and unacknowledged
    total_query = select(PolicyDelta).where(PolicyDelta.policy_id.in_(policy_ids))
    total = len(db.execute(total_query).scalars().all())

    unack_query = select(PolicyDelta).where(
        PolicyDelta.policy_id.in_(policy_ids),
        PolicyDelta.is_acknowledged == False
    )
    unacknowledged_count = len(db.execute(unack_query).scalars().all())

    # Paginate
    offset = (page - 1) * limit
    deltas = db.execute(query.offset(offset).limit(limit)).scalars().all()

    # Build response with policy info
    items = []
    for d in deltas:
        policy = db.get(Policy, d.policy_id)
        explanation = db.execute(
            select(DeltaExplanation).where(DeltaExplanation.delta_id == d.id)
        ).scalar_one_or_none()

        items.append({
            "id": d.id,
            "policy_id": d.policy_id,
            "document_id": d.document_id,
            "field_key": d.field_key,
            "old_value": d.old_value,
            "new_value": d.new_value,
            "delta_type": d.delta_type,
            "severity": d.severity,
            "is_acknowledged": d.is_acknowledged,
            "created_at": str(d.created_at),
            "policy_carrier": policy.carrier if policy else None,
            "policy_type": policy.policy_type if policy else None,
            "explanation": explanation.explanation if explanation else None,
        })

    return {"items": items, "total": total, "unacknowledged_count": unacknowledged_count}


@router.get("/policies/{policy_id}/deltas")
def list_policy_deltas(
    policy_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """List all deltas for a specific policy."""
    check_feature(user, "deltas")
    policy = db.get(Policy, policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Policy not found")

    deltas = db.execute(
        select(PolicyDelta)
        .where(PolicyDelta.policy_id == policy_id)
        .order_by(PolicyDelta.created_at.desc())
    ).scalars().all()

    items = []
    for d in deltas:
        explanation = db.execute(
            select(DeltaExplanation).where(DeltaExplanation.delta_id == d.id)
        ).scalar_one_or_none()

        items.append({
            "id": d.id,
            "policy_id": d.policy_id,
            "document_id": d.document_id,
            "field_key": d.field_key,
            "old_value": d.old_value,
            "new_value": d.new_value,
            "delta_type": d.delta_type,
            "severity": d.severity,
            "is_acknowledged": d.is_acknowledged,
            "created_at": str(d.created_at),
            "explanation": explanation.explanation if explanation else None,
        })

    return {"items": items, "total": len(items)}


@router.put("/deltas/{delta_id}/acknowledge")
def acknowledge_delta(
    delta_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Mark a delta as acknowledged."""
    check_feature(user, "deltas")
    delta = db.get(PolicyDelta, delta_id)
    if not delta:
        raise HTTPException(status_code=404, detail="Delta not found")

    # Verify ownership
    policy = db.get(Policy, delta.policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Delta not found")

    delta.is_acknowledged = True
    db.commit()

    return {"ok": True}


@router.put("/deltas/acknowledge-all")
def acknowledge_all_deltas(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Mark all deltas as acknowledged for the current user."""
    check_feature(user, "deltas")
    policy_ids = db.execute(
        select(Policy.id).where(Policy.user_id == user.id)
    ).scalars().all()

    if policy_ids:
        deltas = db.execute(
            select(PolicyDelta).where(
                PolicyDelta.policy_id.in_(policy_ids),
                PolicyDelta.is_acknowledged == False
            )
        ).scalars().all()

        for delta in deltas:
            delta.is_acknowledged = True

        db.commit()

    return {"ok": True}


@router.post("/deltas/{delta_id}/explain")
def explain_delta(
    delta_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Generate an AI explanation for a delta."""
    check_feature(user, "deltas")
    delta = db.get(PolicyDelta, delta_id)
    if not delta:
        raise HTTPException(status_code=404, detail="Delta not found")

    # Verify ownership
    policy = db.get(Policy, delta.policy_id)
    if not policy or policy.user_id != user.id:
        raise HTTPException(status_code=404, detail="Delta not found")

    # Check if explanation already exists
    existing = db.execute(
        select(DeltaExplanation).where(DeltaExplanation.delta_id == delta_id)
    ).scalar_one_or_none()

    if existing:
        return {
            "explanation": existing.explanation,
            "possible_reasons": json.loads(existing.possible_reasons) if existing.possible_reasons else [],
        }

    # Generate explanation using LLM
    from .extraction import get_extractor
    extractor = get_extractor()

    field_labels = {
        "premium_amount": "premium",
        "coverage_amount": "coverage limit",
        "deductible": "deductible",
        "carrier": "insurance carrier",
        "renewal_date": "renewal date",
        "policy_type": "policy type",
        "policy_number": "policy number",
    }

    field_label = field_labels.get(delta.field_key, delta.field_key)

    prompt = f"""A user's insurance policy has changed. Explain this change in simple, helpful terms.

Policy type: {policy.policy_type}
Carrier: {policy.carrier}
Change: The {field_label} changed from {delta.old_value or 'not set'} to {delta.new_value or 'removed'}.
Change type: {delta.delta_type}
Severity: {delta.severity}

Please provide:
1. A brief explanation of what this change means for the policyholder (2-3 sentences)
2. Three possible reasons why this change might have occurred

Format your response as JSON:
{{"explanation": "...", "possible_reasons": ["reason 1", "reason 2", "reason 3"]}}
"""

    try:
        response = extractor.llm.generate(prompt)
        # Parse JSON from response
        import re
        json_match = re.search(r'\{[^}]+\}', response, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
            explanation_text = result.get("explanation", "Unable to generate explanation.")
            reasons = result.get("possible_reasons", [])
        else:
            explanation_text = response.strip()
            reasons = []
    except Exception as e:
        explanation_text = f"Your {field_label} has {delta.delta_type}. This may affect your coverage or costs."
        reasons = [
            "Policy renewal with updated rates",
            "Changes in coverage or risk factors",
            "Market conditions or regulatory changes"
        ]

    # Save explanation
    explanation = DeltaExplanation(
        delta_id=delta_id,
        explanation=explanation_text,
        possible_reasons=json.dumps(reasons) if reasons else None,
    )
    db.add(explanation)
    db.commit()

    return {
        "explanation": explanation_text,
        "possible_reasons": reasons,
    }
