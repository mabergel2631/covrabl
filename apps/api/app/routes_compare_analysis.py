import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .auth import get_current_user
from .config import settings
from .db import get_db
from .models import User, Policy
from .models_documents import Document
from .routes_chat import _policy_to_dict, _format_policy_block, _cache_document_text

router = APIRouter(prefix="/policies/compare", tags=["compare-analysis"])

logger = logging.getLogger(__name__)

MAX_DOC_CHARS_PER_POLICY = 15_000
MAX_DOC_CHARS_MULTI = 8_000  # per policy when comparing 3+


# ── Request / Response Models ──────────────────────────


class CompareAnalyzeRequest(BaseModel):
    policy_ids: list[int]


class DataSufficiencyInfo(BaseModel):
    policy_id: int
    carrier: str
    has_documents: bool
    has_coverage_items: bool
    has_details: bool
    document_char_count: int
    coverage_item_count: int
    detail_count: int
    sufficiency: str  # "full", "partial", "minimal"
    warning: str | None


class ComparisonFinding(BaseModel):
    category: str  # coverage_gap, sublimit_difference, exclusion_difference, deductible, premium, condition, endorsement, general
    severity: str  # critical, important, informational
    title: str
    description: str
    policies_affected: list[int]
    recommendation: str | None


class CompareAnalysisResponse(BaseModel):
    summary: str
    data_sufficiency: list[DataSufficiencyInfo]
    findings: list[ComparisonFinding]
    limitations: list[str]


# ── Helpers ────────────────────────────────────────────


def _assess_sufficiency(
    policy: Policy,
    coverage_items: list,
    details: list,
    documents: list[Document],
    db: Session,
) -> DataSufficiencyInfo:
    doc_text_chars = 0
    for d in documents:
        text = _cache_document_text(d, db)
        if text:
            doc_text_chars += len(text)

    ci_count = len(coverage_items)
    detail_count = len(details)
    carrier = policy.carrier or "Unknown"
    policy_type = policy.policy_type or "Unknown"

    if doc_text_chars > 5000 and ci_count >= 3 and detail_count >= 3:
        sufficiency = "full"
        warning = None
    elif ci_count >= 1 or detail_count >= 1 or doc_text_chars > 1000:
        sufficiency = "partial"
        warning = (
            f"Limited data available for {carrier} ({policy_type}). "
            "Only a declaration page or summary may have been uploaded. "
            "Contact your agent for full policy details before relying on this analysis."
        )
    else:
        sufficiency = "minimal"
        warning = (
            f"Insufficient details for {carrier} ({policy_type}) — "
            "only basic fields were entered. Upload the full policy document "
            "or contact your agent for complete coverage information."
        )

    return DataSufficiencyInfo(
        policy_id=policy.id,
        carrier=carrier,
        has_documents=len(documents) > 0,
        has_coverage_items=ci_count > 0,
        has_details=detail_count > 0,
        document_char_count=doc_text_chars,
        coverage_item_count=ci_count,
        detail_count=detail_count,
        sufficiency=sufficiency,
        warning=warning,
    )


def _strip_markdown_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    return raw


COMPARE_SYSTEM_PROMPT = """You are an expert insurance analyst performing a detailed comparison of insurance policies.

You will be given data for 2-4 insurance policies including their coverage items, details, exclusions, deductibles, premiums, and (when available) full policy document text.

Your job is to produce a structured JSON comparison analysis. Follow these rules:

1. Find COVERAGE GAPS — items covered by one policy but absent from the other
2. Find SUBLIMIT DIFFERENCES — same coverage category, different per-item or aggregate limits
3. Find EXCLUSION DIFFERENCES — exclusions in one but not the other, or materially different language
4. Explain DEDUCTIBLE & PREMIUM differences in plain English with dollar impact
5. Flag CONDITION & ENDORSEMENT differences
6. Catch NUANCED DIFFERENCES a trained insurance professional would flag
7. NEVER FABRICATE — only cite data provided in the context. If something is not stated, do not assume it.
8. FLAG DATA LIMITATIONS — if only declaration pages or minimal data are available, note this prominently in limitations.

Return ONLY valid JSON matching this exact schema (no markdown fences, no extra text):

{
  "summary": "2-3 sentence executive summary of the most important differences",
  "findings": [
    {
      "category": "coverage_gap|sublimit_difference|exclusion_difference|deductible|premium|condition|endorsement|general",
      "severity": "critical|important|informational",
      "title": "Short finding title",
      "description": "Detailed explanation of the difference",
      "policies_affected": [1, 2],
      "recommendation": "What the policyholder should consider (or null)"
    }
  ],
  "limitations": ["List of caveats about the analysis, e.g. limited document data"]
}

SEVERITY GUIDE:
- critical: Coverage gaps that leave the policyholder exposed to significant financial risk
- important: Meaningful differences in limits, deductibles, or exclusions that affect coverage quality
- informational: Minor differences, cosmetic differences, or observations

For policies_affected, use the policy IDs provided in the data.

Be thorough but concise. Focus on actionable differences, not restating identical coverage."""


def _call_llm(system_prompt: str, user_message: str) -> str:
    if settings.llm_provider == "anthropic" and settings.anthropic_api_key:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )
        return message.content[0].text
    elif settings.openai_api_key:
        import openai
        client = openai.OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
        )
        return resp.choices[0].message.content or ""
    else:
        raise HTTPException(status_code=503, detail="No LLM provider configured")


# ── Endpoint ──────────────────────────────────────────


@router.post("/analyze", response_model=CompareAnalysisResponse)
def compare_analyze(
    body: CompareAnalyzeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ids = body.policy_ids
    if len(ids) < 2 or len(ids) > 4:
        raise HTTPException(status_code=400, detail="Provide 2-4 policy IDs")

    # Load policies with relationships
    policies = db.execute(
        select(Policy)
        .where(Policy.id.in_(ids), Policy.user_id == user.id)
        .options(
            selectinload(Policy.contacts),
            selectinload(Policy.details),
            selectinload(Policy.coverage_items),
            selectinload(Policy.exposure),
        )
    ).scalars().all()

    if len(policies) != len(ids):
        raise HTTPException(status_code=404, detail="One or more policies not found")

    # Sort policies to match requested order
    policy_map = {p.id: p for p in policies}
    policies = [policy_map[pid] for pid in ids]

    # Load documents per policy
    all_docs = db.execute(
        select(Document).where(Document.policy_id.in_(ids))
    ).scalars().all()
    docs_by_policy: dict[int, list[Document]] = {}
    for doc in all_docs:
        docs_by_policy.setdefault(doc.policy_id, []).append(doc)

    # Compute data sufficiency for each policy
    sufficiency_list: list[DataSufficiencyInfo] = []
    for p in policies:
        p_docs = docs_by_policy.get(p.id, [])
        suf = _assess_sufficiency(
            p,
            list(p.coverage_items or []),
            list(p.details or []),
            p_docs,
            db,
        )
        sufficiency_list.append(suf)

    # Build user message with all policy data
    char_limit = MAX_DOC_CHARS_MULTI if len(policies) > 2 else MAX_DOC_CHARS_PER_POLICY

    user_parts = ["Compare the following insurance policies:\n"]
    for p in policies:
        d = _policy_to_dict(p)
        user_parts.append(f"---\n## Policy ID {p.id}\n")
        user_parts.append(_format_policy_block(d))

        # Include document text if available
        p_docs = docs_by_policy.get(p.id, [])
        for doc in p_docs:
            text = _cache_document_text(doc, db)
            if text:
                truncated = text[:char_limit]
                user_parts.append(f"\n#### Document: {doc.filename}\n{truncated}")

        user_parts.append("")

    user_message = "\n".join(user_parts)

    # Call LLM
    try:
        raw = _call_llm(COMPARE_SYSTEM_PROMPT, user_message)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Compare analysis LLM error: %s", e)
        raise HTTPException(status_code=502, detail="AI analysis temporarily unavailable")

    # Parse response
    try:
        cleaned = _strip_markdown_fences(raw)
        data = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError) as e:
        logger.error("Compare analysis JSON parse error: %s\nRaw: %s", e, raw[:500])
        raise HTTPException(status_code=502, detail="AI returned an unparseable response")

    # Build response
    findings = []
    for f in data.get("findings", []):
        findings.append(ComparisonFinding(
            category=f.get("category", "general"),
            severity=f.get("severity", "informational"),
            title=f.get("title", ""),
            description=f.get("description", ""),
            policies_affected=f.get("policies_affected", []),
            recommendation=f.get("recommendation"),
        ))

    limitations = data.get("limitations", [])
    # Append sufficiency-based limitations
    for suf in sufficiency_list:
        if suf.sufficiency == "minimal":
            limitations.append(
                f"Policy {suf.carrier} (ID {suf.policy_id}) has minimal data — "
                "analysis for this policy may be incomplete."
            )
        elif suf.sufficiency == "partial":
            limitations.append(
                f"Policy {suf.carrier} (ID {suf.policy_id}) has limited data — "
                "some differences may not be detected."
            )

    return CompareAnalysisResponse(
        summary=data.get("summary", ""),
        data_sufficiency=sufficiency_list,
        findings=findings,
        limitations=limitations,
    )
