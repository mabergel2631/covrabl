import io
import json
import logging
from datetime import datetime
from pathlib import Path

import openai
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .auth import get_current_user
from .config import settings
from .coverage_taxonomy import analyze_coverage_gaps, get_coverage_summary
from .db import get_db
from .models import User, Policy, Contact, PolicyDetail, CoverageItem, Exposure
from .models_chat import Conversation, ChatMessage
from .models_documents import Document
from .models_features import (
    Claim, Certificate, Premium, PremiumHistory,
    PolicyDelta, DeltaExplanation, CoverageScore, PolicyShare,
)
from .models_profile import UserProfile, ProfileContact

router = APIRouter(prefix="/chat", tags=["chat"])

logger = logging.getLogger(__name__)

MAX_HISTORY_MESSAGES = 20
MAX_DOC_CHARS = 15_000
MAX_DOCS = 5


# ── Helpers ──────────────────────────────────────────


def _policy_to_dict(p: Policy) -> dict:
    return {
        "id": p.id,
        "scope": p.scope,
        "policy_type": p.policy_type,
        "carrier": p.carrier,
        "policy_number": p.policy_number,
        "nickname": p.nickname,
        "business_name": p.business_name,
        "coverage_amount": p.coverage_amount,
        "deductible": p.deductible,
        "premium_amount": p.premium_amount,
        "renewal_date": str(p.renewal_date) if p.renewal_date else None,
        "created_at": str(p.created_at) if p.created_at else None,
        "exposure_id": p.exposure_id,
        "status": p.status or "active",
        "contacts": [
            {"role": c.role, "name": c.name, "company": c.company, "phone": c.phone, "email": c.email}
            for c in (p.contacts or [])
        ],
        "details": [
            {"field_name": d.field_name, "field_value": d.field_value}
            for d in (p.details or [])
        ],
        "coverage_items": [
            {"item_type": ci.item_type, "description": ci.description, "limit": ci.limit}
            for ci in (p.coverage_items or [])
        ],
    }


def _format_money(cents: int | None) -> str:
    if cents is None:
        return "N/A"
    return f"${cents:,.0f}"


def _format_policy_block(d: dict) -> str:
    lines = []
    name = d.get("nickname") or f"{d['carrier']} {d['policy_type']}"
    lines.append(f"### {name}")
    lines.append(f"- Carrier: {d['carrier']}")
    lines.append(f"- Type: {d['policy_type']} ({d.get('scope', 'personal')})")
    lines.append(f"- Policy #: {d['policy_number']}")
    lines.append(f"- Status: {d.get('status', 'active')}")
    lines.append(f"- Coverage Limit: {_format_money(d.get('coverage_amount'))}")
    lines.append(f"- Deductible: {_format_money(d.get('deductible'))}")
    lines.append(f"- Premium: {_format_money(d.get('premium_amount'))}")
    if d.get("renewal_date"):
        lines.append(f"- Renewal Date: {d['renewal_date']}")
    if d.get("business_name"):
        lines.append(f"- Business: {d['business_name']}")

    # Contacts
    contacts = d.get("contacts") or []
    if contacts:
        lines.append("- Contacts:")
        for c in contacts:
            parts = [f"  - {c['role']}"]
            if c.get("name"):
                parts.append(f": {c['name']}")
            if c.get("company"):
                parts.append(f" ({c['company']})")
            if c.get("phone"):
                parts.append(f" | Phone: {c['phone']}")
            if c.get("email"):
                parts.append(f" | Email: {c['email']}")
            lines.append("".join(parts))

    # Details
    details = d.get("details") or []
    if details:
        lines.append("- Additional Details:")
        for dd in details:
            lines.append(f"  - {dd['field_name']}: {dd['field_value']}")

    # Coverage items (inclusions/exclusions)
    items = d.get("coverage_items") or []
    inclusions = [i for i in items if i["item_type"] == "inclusion"]
    exclusions = [i for i in items if i["item_type"] == "exclusion"]
    if inclusions:
        lines.append("- Inclusions:")
        for i in inclusions:
            limit_str = f" (Limit: {i['limit']})" if i.get("limit") else ""
            lines.append(f"  - {i['description']}{limit_str}")
    if exclusions:
        lines.append("- Exclusions:")
        for e in exclusions:
            lines.append(f"  - {e['description']}")

    return "\n".join(lines)


def _cache_document_text(doc: Document, db: Session) -> str | None:
    """Extract and cache PDF text for a document. Returns cached_text."""
    if doc.cached_text is not None:
        return doc.cached_text

    try:
        upload_dir = Path(__file__).resolve().parent.parent / "uploads"
        file_path = upload_dir / doc.object_key
        if not file_path.exists():
            return None

        import pdfplumber
        pdf_bytes = file_path.read_bytes()
        text = ""
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"

        if text.strip():
            doc.cached_text = text.strip()
            db.commit()
            return doc.cached_text
    except Exception as e:
        logger.warning("Failed to cache document text for doc %d: %s", doc.id, e)

    return None


def _build_chat_context(
    user: User,
    db: Session,
    *,
    policy_id: int | None = None,
    compare_policy_ids: list[int] | None = None,
) -> str:
    """Assemble full context block from user's data for the system prompt.

    When policy_id is provided, scope context to just that single policy.
    When compare_policy_ids is provided, scope to those policies with comparison framing.
    """
    sections = []

    if compare_policy_ids:
        sections.append("## CONTEXT: POLICY COMPARISON")
        sections.append("The user is comparing the following policies. Focus your answers on differences between these policies.\n")
    elif policy_id:
        sections.append("## CONTEXT: SINGLE POLICY FOCUS")
        sections.append("The user is asking about a specific policy. Focus your answers on this policy's details.\n")

    # 1. User profile
    profile = db.execute(
        select(UserProfile).where(UserProfile.user_id == user.id)
    ).scalar_one_or_none()

    sections.append("## USER PROFILE")
    sections.append(f"- Email: {user.email}")
    if profile:
        if profile.full_name:
            sections.append(f"- Name: {profile.full_name}")
        if profile.address_city or profile.address_state:
            loc_parts = [p for p in [profile.address_city, profile.address_state, profile.address_zip] if p]
            sections.append(f"- Location: {', '.join(loc_parts)}")
        flags = []
        if profile.is_homeowner:
            flags.append("homeowner")
        if profile.is_renter:
            flags.append("renter")
        if profile.has_dependents:
            flags.append("has dependents")
        if profile.has_vehicle:
            flags.append("has vehicle")
        if profile.owns_business:
            flags.append("business owner")
        if profile.high_net_worth:
            flags.append("high net worth")
        if flags:
            sections.append(f"- Profile flags: {', '.join(flags)}")

    # 2. Policies with eager-loaded relationships (scoped if policy_id or compare_policy_ids provided)
    policy_query = select(Policy).where(Policy.user_id == user.id).options(
        selectinload(Policy.contacts),
        selectinload(Policy.details),
        selectinload(Policy.coverage_items),
        selectinload(Policy.exposure),
    )
    if compare_policy_ids:
        policy_query = policy_query.where(Policy.id.in_(compare_policy_ids))
    elif policy_id:
        policy_query = policy_query.where(Policy.id == policy_id)
    policies = db.execute(policy_query).scalars().all()

    policy_dicts = [_policy_to_dict(p) for p in policies]

    sections.append("\n## INSURANCE POLICIES")
    if policy_dicts:
        for d in policy_dicts:
            sections.append(_format_policy_block(d))
            sections.append("")
    else:
        sections.append("No policies on file.")

    # 3. Coverage summary (skip when scoped to single policy or comparison)
    if policy_dicts and not policy_id and not compare_policy_ids:
        summary = get_coverage_summary(policy_dicts)
        sections.append("## COVERAGE SUMMARY")
        sections.append(f"- Total policies: {summary.get('total_policies', 0)}")
        sections.append(f"- Policy types: {', '.join(summary.get('policy_types', []))}")
        sections.append(f"- Total coverage: {_format_money(summary.get('total_coverage'))}")
        sections.append(f"- Total annual premium: {_format_money(summary.get('total_annual_premium'))}")
        covered = summary.get("covered_categories", [])
        missing = summary.get("missing_categories", [])
        if covered:
            sections.append(f"- Covered categories: {', '.join(covered)}")
        if missing:
            sections.append(f"- Missing categories: {', '.join(missing)}")

    # 4. Gap analysis (skip when scoped to single policy or comparison)
    if policy_dicts and not policy_id and not compare_policy_ids:
        user_context = None
        if profile:
            user_context = {
                "is_homeowner": profile.is_homeowner,
                "is_renter": profile.is_renter,
                "has_dependents": profile.has_dependents,
                "has_vehicle": profile.has_vehicle,
                "owns_business": profile.owns_business,
                "high_net_worth": profile.high_net_worth,
            }
        gaps = analyze_coverage_gaps(policy_dicts, user_context)
        if gaps:
            sections.append("\n## COVERAGE GAPS")
            for g in gaps:
                if g.get("severity") in ("high", "medium"):
                    sections.append(f"- [{g['severity'].upper()}] {g['name']}: {g['description']}")
                    if g.get("recommendation"):
                        sections.append(f"  Recommendation: {g['recommendation']}")

    # 5. Claims history
    claims = db.execute(
        select(Claim).where(
            Claim.policy_id.in_([p.id for p in policies])
        )
    ).scalars().all() if policies else []

    if claims:
        sections.append("\n## CLAIMS HISTORY")
        for c in claims:
            policy = next((p for p in policies if p.id == c.policy_id), None)
            carrier = policy.carrier if policy else "Unknown"
            sections.append(f"- Claim #{c.claim_number} ({carrier})")
            sections.append(f"  Status: {c.status} | Filed: {c.date_filed}")
            if c.amount_claimed:
                sections.append(f"  Amount claimed: {_format_money(c.amount_claimed)}")
            if c.amount_paid:
                sections.append(f"  Amount paid: {_format_money(c.amount_paid)}")
            sections.append(f"  Description: {c.description}")

    # 6. Certificates of Insurance
    certs = db.execute(
        select(Certificate).where(Certificate.user_id == user.id)
    ).scalars().all()

    if certs:
        sections.append("\n## CERTIFICATES OF INSURANCE")
        for cert in certs:
            direction_label = "Shared to" if cert.direction == "issued" else "Received from"
            linked_policy = next((p for p in policies if p.id == cert.policy_id), None) if cert.policy_id else None
            lines = [f"- {direction_label}: {cert.counterparty_name} ({cert.counterparty_type})"]
            lines.append(f"  Status: {cert.status}")
            if linked_policy:
                lines.append(f"  Linked policy: {linked_policy.carrier} ({linked_policy.policy_type})")
            if cert.carrier:
                lines.append(f"  Carrier: {cert.carrier}")
            if cert.policy_number:
                lines.append(f"  Policy #: {cert.policy_number}")
            if cert.coverage_types:
                lines.append(f"  Coverage types: {cert.coverage_types}")
            if cert.coverage_amount:
                lines.append(f"  Coverage amount: {_format_money(cert.coverage_amount)}")
            if cert.effective_date:
                lines.append(f"  Effective: {cert.effective_date}")
            if cert.expiration_date:
                lines.append(f"  Expires: {cert.expiration_date}")
            if cert.additional_insured:
                lines.append("  Additional insured: Yes")
            if cert.waiver_of_subrogation:
                lines.append("  Waiver of subrogation: Yes")
            if cert.minimum_coverage:
                lines.append(f"  Minimum required: {_format_money(cert.minimum_coverage)}")
            if cert.notes:
                lines.append(f"  Notes: {cert.notes}")
            sections.append("\n".join(lines))

    # 7. Premium payment schedule
    if policies:
        premiums = db.execute(
            select(Premium)
            .where(Premium.policy_id.in_([p.id for p in policies]))
            .order_by(Premium.due_date.desc())
        ).scalars().all()

        if premiums:
            sections.append("\n## PREMIUM PAYMENTS")
            for pm in premiums:
                policy = next((p for p in policies if p.id == pm.policy_id), None)
                carrier = policy.carrier if policy else "Unknown"
                paid_str = f"Paid {pm.paid_date}" if pm.paid_date else "Unpaid"
                sections.append(f"- {carrier}: {_format_money(pm.amount)} ({pm.frequency}) — Due: {pm.due_date} — {paid_str}")
                if pm.payment_method:
                    sections.append(f"  Payment method: {pm.payment_method}")

    # 8. Premium history (rate changes over time)
    if policies:
        history = db.execute(
            select(PremiumHistory)
            .where(PremiumHistory.policy_id.in_([p.id for p in policies]))
            .order_by(PremiumHistory.effective_date.desc())
            .limit(20)
        ).scalars().all()

        if history:
            sections.append("\n## PREMIUM HISTORY")
            for h in history:
                policy = next((p for p in policies if p.id == h.policy_id), None)
                carrier = policy.carrier if policy else "Unknown"
                sections.append(f"- {carrier}: {_format_money(h.amount)} effective {h.effective_date} (source: {h.source})")
                if h.notes:
                    sections.append(f"  Note: {h.notes}")

    # 9. Policy changes (deltas)
    if policies:
        deltas = db.execute(
            select(PolicyDelta)
            .where(PolicyDelta.policy_id.in_([p.id for p in policies]))
            .order_by(PolicyDelta.created_at.desc())
            .limit(20)
        ).scalars().all()

        if deltas:
            sections.append("\n## POLICY CHANGES DETECTED")
            delta_ids = [d.id for d in deltas]
            explanations = db.execute(
                select(DeltaExplanation)
                .where(DeltaExplanation.delta_id.in_(delta_ids))
            ).scalars().all()
            expl_map = {e.delta_id: e for e in explanations}

            for d in deltas:
                policy = next((p for p in policies if p.id == d.policy_id), None)
                carrier = policy.carrier if policy else "Unknown"
                old_val = d.old_value or "none"
                new_val = d.new_value or "none"
                sections.append(f"- [{d.severity.upper()}] {carrier} — {d.field_key}: {old_val} → {new_val} ({d.delta_type})")
                expl = expl_map.get(d.id)
                if expl:
                    sections.append(f"  Explanation: {expl.explanation}")

    # 10. Coverage scores
    scores = db.execute(
        select(CoverageScore)
        .where(CoverageScore.user_id == user.id)
        .order_by(CoverageScore.last_calculated.desc())
    ).scalars().all()

    if scores:
        sections.append("\n## COVERAGE SCORES")
        for s in scores:
            sections.append(f"- {s.category}: {s.score_total}/100")
            if s.insights:
                try:
                    import json as _json
                    insights_list = _json.loads(s.insights)
                    for insight in insights_list[:3]:
                        sections.append(f"  - {insight}")
                except Exception:
                    pass

    # 11. Profile contacts (emergency, broker)
    profile_contacts = db.execute(
        select(ProfileContact).where(ProfileContact.user_id == user.id)
    ).scalars().all()

    if profile_contacts:
        sections.append("\n## YOUR CONTACTS")
        for pc in profile_contacts:
            parts = [f"- {pc.contact_type.title()}: {pc.name}"]
            if pc.relationship:
                parts.append(f" ({pc.relationship})")
            if pc.company:
                parts.append(f" — {pc.company}")
            sections.append("".join(parts))
            if pc.phone:
                sections.append(f"  Phone: {pc.phone}")
            if pc.email:
                sections.append(f"  Email: {pc.email}")

    # 12. Policy sharing
    if policies:
        shares = db.execute(
            select(PolicyShare)
            .where(PolicyShare.policy_id.in_([p.id for p in policies]))
        ).scalars().all()

        if shares:
            sections.append("\n## POLICY SHARING")
            for sh in shares:
                policy = next((p for p in policies if p.id == sh.policy_id), None)
                carrier = policy.carrier if policy else "Unknown"
                status = "accepted" if sh.accepted else "pending"
                role = f" ({sh.role_label})" if sh.role_label else ""
                sections.append(f"- {carrier} shared with {sh.shared_with_email}{role} — {sh.permission} access — {status}")
                if sh.expires_at:
                    sections.append(f"  Expires: {sh.expires_at}")

    # 13. Document text (cached, lazy-extracted)
    if policies:
        docs = db.execute(
            select(Document)
            .where(Document.policy_id.in_([p.id for p in policies]))
            .order_by(Document.created_at.desc())
            .limit(MAX_DOCS)
        ).scalars().all()

        doc_texts = []
        for doc in docs:
            text = _cache_document_text(doc, db)
            if text:
                truncated = text[:MAX_DOC_CHARS]
                policy = next((p for p in policies if p.id == doc.policy_id), None)
                carrier = policy.carrier if policy else "Unknown"
                doc_texts.append(f"### Document: {doc.filename} (Policy: {carrier})\n{truncated}")

        if doc_texts:
            sections.append("\n## POLICY DOCUMENT TEXT")
            sections.extend(doc_texts)

    return "\n".join(sections)


SYSTEM_PROMPT_TEMPLATE = """You are Covrabl's Policy Insights assistant. You help users understand their insurance coverage based on the documents they've uploaded.

IDENTITY:
- You are a structured extraction and analysis tool, not a general-purpose AI chatbot
- Your knowledge comes ONLY from the user's uploaded policy documents and extracted data shown below
- You do NOT browse the internet, access external databases, or have knowledge of policies not uploaded to Covrabl

TONE:
- Warm, conversational, and brief — like texting with a knowledgeable friend
- Use casual language: "You've got...", "Looks like...", "Here's the quick rundown..."
- Keep responses SHORT: 2-4 sentences or a few quick bullets. No walls of text
- One key insight per response is better than listing everything

SOURCE-BOUND RULES (CRITICAL — follow these strictly):
- ONLY reference data that appears in the context below. Never invent, estimate, or assume policy details
- When citing a specific number (coverage amount, deductible, premium), state it comes from the user's uploaded data: e.g. "Based on your uploaded State Farm policy, your deductible is **$500**"
- If information is NOT in the data below, say clearly: "I don't see that in your uploaded policies. You may not have added it yet, or it might be in a document that hasn't been uploaded."
- NEVER guess at coverage amounts, limits, or terms that aren't explicitly in the data
- NEVER fabricate policy numbers, carrier names, phone numbers, or dates
- If a field shows "N/A" or is missing, say it wasn't found in the uploaded documents — don't fill in a plausible value
- For "Am I covered for X?" questions where the answer isn't clear from the data: say what IS in the data, note what's unclear, and suggest checking the original document or calling the carrier (include phone if available)

RESPONSE RULES:
- For overview questions ("What do I have?"): give a quick 1-line-per-policy summary, then ask what they want to dig into
- For specific questions ("What's my deductible?"): answer directly in 1-2 sentences with the exact number from the data
- Format dollar amounts: $1,200 not 1200. Amounts in the data are in dollars
- Bold the key numbers so they pop out
- Never dump all policy details. Keep it scannable
- You're NOT a licensed agent — for changes, point them to their agent/broker
- For general insurance questions (not about the user's specific policies), you can answer with general knowledge but clearly label it as general guidance, not specific to their coverage
- When answering about specific coverage, add a brief natural reminder like "(confirm against your policy document for anything important)" — keep it short, not a disclaimer block
- Today's date: {today}

{context}"""


# ── Request/Response Models ──────────────────────────


class ChatSendRequest(BaseModel):
    message: str
    conversation_id: int | None = None
    policy_id: int | None = None
    compare_policy_ids: list[int] | None = None


# ── Endpoints ────────────────────────────────────────


@router.post("/send")
def chat_send(body: ChatSendRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="AI chat is not configured")

    # Get or create conversation
    conversation: Conversation
    if body.conversation_id:
        conversation = db.execute(
            select(Conversation).where(
                Conversation.id == body.conversation_id,
                Conversation.user_id == user.id,
            )
        ).scalar_one_or_none()
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        # Create new conversation, title = first message truncated
        title = body.message.strip()[:200]
        conversation = Conversation(user_id=user.id, title=title)
        db.add(conversation)
        db.flush()

    # Save user message
    user_msg = ChatMessage(conversation_id=conversation.id, role="user", content=body.message.strip())
    db.add(user_msg)
    db.commit()

    # Load conversation history (last N messages)
    history_rows = db.execute(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation.id)
        .order_by(ChatMessage.created_at.asc())
    ).scalars().all()

    # Keep last MAX_HISTORY_MESSAGES
    recent = history_rows[-MAX_HISTORY_MESSAGES:] if len(history_rows) > MAX_HISTORY_MESSAGES else history_rows

    messages = [{"role": m.role, "content": m.content} for m in recent]

    # Build system prompt with context
    context = _build_chat_context(user, db, policy_id=body.policy_id, compare_policy_ids=body.compare_policy_ids)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        today=datetime.now().strftime("%Y-%m-%d"),
        context=context,
    )

    conv_id = conversation.id

    def generate():
        # First event: send conversation_id
        yield f"data: {json.dumps({'type': 'conversation_id', 'id': conv_id})}\n\n"

        full_response = ""
        try:
            client = openai.OpenAI(api_key=settings.openai_api_key)
            oai_messages = [{"role": "system", "content": system_prompt}] + messages
            stream = client.chat.completions.create(
                model="gpt-4o",
                max_tokens=2048,
                messages=oai_messages,
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    full_response += delta.content
                    yield f"data: {json.dumps({'type': 'text', 'content': delta.content})}\n\n"
        except Exception as e:
            logger.error("Chat streaming error: %s", e)
            yield f"data: {json.dumps({'type': 'error', 'content': 'Sorry, something went wrong. Please try again.'})}\n\n"

        # Save assistant response
        if full_response:
            from .db import SessionLocal
            save_db = SessionLocal()
            try:
                assistant_msg = ChatMessage(
                    conversation_id=conv_id,
                    role="assistant",
                    content=full_response,
                )
                save_db.add(assistant_msg)
                save_db.commit()
            except Exception as e:
                logger.error("Failed to save assistant message: %s", e)
                save_db.rollback()
            finally:
                save_db.close()

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/conversations")
def list_conversations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Conversation)
        .where(Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc())
    ).scalars().all()

    return [
        {
            "id": c.id,
            "title": c.title,
            "created_at": str(c.created_at) if c.created_at else None,
            "updated_at": str(c.updated_at) if c.updated_at else None,
        }
        for c in rows
    ]


@router.get("/conversations/{conversation_id}/messages")
def get_conversation_messages(
    conversation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = db.execute(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.created_at.asc())
    ).scalars().all()

    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "created_at": str(m.created_at) if m.created_at else None,
        }
        for m in messages
    ]


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    db.delete(conversation)
    db.commit()
    return {"ok": True}
