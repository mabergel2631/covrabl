"""Deterministic "Items to Discuss" rule engine for Coverage Reviews.

Takes the renewing policy + prior policy + computed deltas, returns a list of
short, observational items the agent should review with the client.

Strict tone discipline (locked in memory: project_renewal_review_framing.md):
- Pure observation + invitation to review
- Never names a specific product as a remedy ("add umbrella", etc.)
- Never asserts industry standards with numbers
- Never makes adequacy verdicts ("underinsured", "modest", etc.)
- Never makes comparative judgment ("better/worse")
- Never makes confidence claims ("likely", "may indicate")

The BANNED_TOKENS list enforces this in tests.
"""

from __future__ import annotations

# Tokens that must NOT appear in any rule output. Tests fail-loud if a rule
# regresses into prescriptive territory.
BANNED_TOKENS = [
    # Naming specific products as remedies
    "add umbrella", "consider umbrella", "umbrella to ", "umbrella policy",
    "rideshare endorsement", "guaranteed replacement",
    "consider higher", "consider lower",
    # Industry-standard assertions
    "industry guidance", "industry typical", "industry standard",
    "commonly $", "100-125%", "100–125%", "75-125",
    # Adequacy verdicts
    "underinsured", "inadequate", "insufficient",
    " modest ", " low for ",
    # Comparative judgment
    "better than", "worse than", "stronger coverage", "weaker term",
    "superior", "inferior",
    # Cost-saving framings
    "save by", "save money", "reduce premium by",
    # Confidence/predictive claims
    "likely ", "appears to", "may indicate", "probably",
]


def _to_int(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(float(str(v)))
    except (ValueError, TypeError):
        return None


def _delta_for(deltas: list[dict], field: str) -> dict | None:
    for d in deltas:
        if d.get("field_key") == field:
            return d
    return None


def _pct_change(old, new) -> float | None:
    a = _to_int(old)
    b = _to_int(new)
    if a is None or b is None or a == 0:
        return None
    return (b - a) / a * 100.0


def compute_discussion_items(
    policy: dict,
    previous_policy: dict | None,
    deltas: list[dict],
) -> list[str]:
    """Produce a list of observational discussion items based on the deltas.

    `policy` and `previous_policy` are dicts with at least:
        carrier, policy_type, coverage_amount, deductible, premium_amount,
        policy_number, renewal_date.

    `deltas` is a list of dicts with field_key, old_value, new_value, delta_type.

    Returns a list of strings — empty if no rules fire.
    """
    if not deltas:
        return []

    items: list[str] = []
    policy_type_lower = (policy.get("policy_type") or "").lower()

    is_auto = "auto" in policy_type_lower
    is_home = "home" in policy_type_lower or "renter" in policy_type_lower or "dwell" in policy_type_lower
    is_health = "health" in policy_type_lower or "medical" in policy_type_lower

    coverage_delta = _delta_for(deltas, "coverage_amount")
    deductible_delta = _delta_for(deltas, "deductible")
    premium_delta = _delta_for(deltas, "premium_amount")
    carrier_delta = _delta_for(deltas, "carrier")
    policy_number_delta = _delta_for(deltas, "policy_number")

    # ── Auto rules ─────────────────────────────────────
    if is_auto:
        if coverage_delta and coverage_delta.get("delta_type") == "decreased":
            items.append(
                "Liability limit decreased from prior term. Review how current limits "
                "align with the client's coverage objectives."
            )
        elif coverage_delta and coverage_delta.get("delta_type") == "increased":
            pct = _pct_change(coverage_delta.get("old_value"), coverage_delta.get("new_value"))
            if pct is not None and pct >= 25.0:
                items.append(
                    "Liability limit increased from prior term. Review whether this affects "
                    "underlying-limit requirements on related coverage."
                )

        if deductible_delta and deductible_delta.get("delta_type") == "increased":
            items.append(
                "Deductible increased from prior term. Review the trade-off between premium "
                "and out-of-pocket exposure with the client."
            )

    # ── Homeowners / dwelling rules ────────────────────
    if is_home:
        if coverage_delta and coverage_delta.get("delta_type") == "decreased":
            items.append(
                "Dwelling coverage decreased from prior term. Review current rebuild "
                "assumptions and replacement-cost methodology with carrier and client."
            )
        elif coverage_delta and coverage_delta.get("delta_type") == "increased":
            pct = _pct_change(coverage_delta.get("old_value"), coverage_delta.get("new_value"))
            if pct is not None and pct >= 15.0:
                items.append(
                    "Dwelling coverage increased from prior term. Review the underlying "
                    "rebuild estimate."
                )

        if deductible_delta:
            items.append(
                "Deductible changed from prior term. Review the out-of-pocket impact on a "
                "typical loss with the client."
            )

    # ── Health rules ───────────────────────────────────
    if is_health:
        if deductible_delta and deductible_delta.get("delta_type") == "increased":
            items.append(
                "Deductible increased from prior term. Review year-of-care exposure with "
                "the client."
            )

    # ── Premium movement (any policy) ──────────────────
    if premium_delta and not coverage_delta and not deductible_delta:
        pct = _pct_change(premium_delta.get("old_value"), premium_delta.get("new_value"))
        if pct is not None:
            if pct >= 10.0:
                items.append(
                    "Premium increased without tracked coverage changes. Review carrier "
                    "rate explanation and any non-tracked policy changes."
                )
            elif pct <= -5.0:
                items.append(
                    "Premium decreased without tracked coverage changes. Review whether "
                    "endorsements or sub-limits changed in ways not captured here."
                )

    # ── Universal: carrier change ──────────────────────
    if carrier_delta:
        items.append(
            "Carrier changed from prior term. Review endorsements, exclusions, waiting "
            "periods, and any prior-acts coverage for continuity."
        )

    # ── Universal: policy_number changed but no other tracked deltas ──
    if policy_number_delta and len(deltas) == 1:
        items.append(
            "Policy number changed without other tracked-field deltas. Review form "
            "and endorsement continuity outside the structured fields."
        )

    # ── Universal: many simultaneous changes ───────────
    if len(deltas) >= 4:
        items.append(
            "Multiple changes this term across tracked fields. A full coverage review "
            "with the client may be warranted."
        )

    return items


def assert_no_banned_tokens(text: str) -> None:
    """Raise AssertionError if `text` contains any banned phrase. Used in tests."""
    lower = text.lower()
    for token in BANNED_TOKENS:
        if token in lower:
            raise AssertionError(
                f"Rule output contains banned token {token!r}: {text!r}"
            )
