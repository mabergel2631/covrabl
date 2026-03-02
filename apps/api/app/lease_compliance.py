"""
Lease compliance comparison engine — pure logic, no DB access.
Compares extracted lease requirements against coverage evidence.
"""

from typing import Optional


def build_evidence_from_certificate(cert) -> list[dict]:
    """Map a Certificate record to coverage evidence entries."""
    evidence = []
    coverage_types = (cert.coverage_types or "").split(",")
    coverage_types = [ct.strip().lower() for ct in coverage_types if ct.strip()]

    # Map coverage type strings to category keys
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

    for ct in coverage_types:
        category = type_map.get(ct, "other")
        entry: dict = {
            "category": category,
            "carrier": cert.carrier,
            "policy_number": cert.policy_number,
        }
        if cert.coverage_amount is not None:
            entry["coverage_amount"] = cert.coverage_amount
        evidence.append(entry)

    # Add endorsement flags
    if cert.additional_insured:
        for ct in coverage_types:
            category = type_map.get(ct, "other")
            evidence.append({
                "category": category,
                "endorsement": "additional_insured",
                "value": True,
            })

    if cert.waiver_of_subrogation:
        for ct in coverage_types:
            category = type_map.get(ct, "other")
            evidence.append({
                "category": category,
                "endorsement": "waiver_of_subrogation",
                "value": True,
            })

    return evidence


def build_evidence_from_policies(policies) -> list[dict]:
    """Map a list of Policy records to coverage evidence entries."""
    evidence = []

    # Map policy_type to lease requirement categories
    type_map = {
        "general_liability": "general_liability",
        "commercial_auto": "commercial_auto",
        "auto": "commercial_auto",
        "umbrella": "umbrella",
        "workers_comp": "workers_comp",
        "property": "property",
        "commercial_property": "property",
        "professional_liability": "professional_liability",
        "cyber": "cyber",
    }

    for policy in policies:
        category = type_map.get(policy.policy_type, "other")
        entry: dict = {
            "category": category,
            "carrier": policy.carrier,
            "policy_number": policy.policy_number,
            "policy_type": policy.policy_type,
        }
        if policy.coverage_amount is not None:
            entry["coverage_amount"] = policy.coverage_amount
        evidence.append(entry)

    return evidence


def compare_requirements(requirements: list[dict], evidence: list[dict]) -> list[dict]:
    """
    Compare structured requirements against coverage evidence.
    Returns a list of result objects with status: pass, fail, or unclear.
    """
    results = []

    for req in requirements:
        category = req.get("category", "other")
        req_type = req.get("requirement_type", "other")
        required_value = req.get("required_value")
        label = req.get("label", "")

        # Find matching evidence by category
        matching = [e for e in evidence if e.get("category") == category]

        result = {
            "requirement_label": label,
            "category": category,
            "requirement_type": req_type,
            "required_value": required_value,
            "actual_value": None,
            "status": "fail",
            "note": "",
        }

        if req_type in ("coverage_limit_each_occurrence", "coverage_limit_aggregate", "coverage_limit_combined_single"):
            result = _check_coverage_limit(req, matching)
        elif req_type == "additional_insured":
            result = _check_endorsement(req, matching, "additional_insured")
        elif req_type == "waiver_of_subrogation":
            result = _check_endorsement(req, matching, "waiver_of_subrogation")
        elif req_type == "primary_noncontributory":
            result = _check_primary_noncontributory(req, matching)
        elif req_type == "insurer_rating":
            result = _check_insurer_rating(req, matching)
        elif req_type == "notice_of_cancellation":
            result = _check_notice_of_cancellation(req, matching)
        elif req_type == "certificate_holder":
            result = _check_certificate_holder(req, matching)
        else:
            result = _check_generic(req, matching)

        results.append(result)

    return results


def _check_coverage_limit(req: dict, matching: list[dict]) -> dict:
    """Check if coverage limit meets the required minimum."""
    category = req.get("category", "other")
    label = req.get("label", "")
    required_value = req.get("required_value")
    required_int = _parse_int(required_value)

    # Find coverage evidence (non-endorsement entries)
    coverage_entries = [e for e in matching if "endorsement" not in e]

    if not coverage_entries:
        return {
            "requirement_label": label,
            "category": category,
            "requirement_type": req.get("requirement_type", "other"),
            "required_value": required_value,
            "actual_value": None,
            "status": "fail",
            "note": f"No {_category_label(category)} coverage found in provided documentation",
        }

    # Find the highest coverage amount
    best_amount: Optional[int] = None
    best_carrier: Optional[str] = None
    for entry in coverage_entries:
        amount = entry.get("coverage_amount")
        if amount is not None:
            if best_amount is None or amount > best_amount:
                best_amount = amount
                best_carrier = entry.get("carrier")

    if best_amount is None:
        return {
            "requirement_label": label,
            "category": category,
            "requirement_type": req.get("requirement_type", "other"),
            "required_value": required_value,
            "actual_value": None,
            "status": "unclear",
            "note": f"{_category_label(category)} coverage found but limit could not be verified",
        }

    if required_int is not None and best_amount >= required_int:
        return {
            "requirement_label": label,
            "category": category,
            "requirement_type": req.get("requirement_type", "other"),
            "required_value": required_value,
            "actual_value": str(best_amount),
            "status": "pass",
            "note": f"Coverage of ${best_amount:,} found{f' ({best_carrier})' if best_carrier else ''} — appears to meet the ${required_int:,} minimum requirement",
        }
    elif required_int is not None:
        return {
            "requirement_label": label,
            "category": category,
            "requirement_type": req.get("requirement_type", "other"),
            "required_value": required_value,
            "actual_value": str(best_amount),
            "status": "fail",
            "note": f"Coverage of ${best_amount:,} found — may not satisfy the ${required_int:,} requirement",
        }
    else:
        return {
            "requirement_label": label,
            "category": category,
            "requirement_type": req.get("requirement_type", "other"),
            "required_value": required_value,
            "actual_value": str(best_amount),
            "status": "unclear",
            "note": f"Coverage of ${best_amount:,} found — should be verified against requirement",
        }


def _check_endorsement(req: dict, matching: list[dict], endorsement_key: str) -> dict:
    """Check if an endorsement (AI, waiver) is present."""
    category = req.get("category", "other")
    label = req.get("label", "")
    required_value = req.get("required_value")
    endorsement_label = endorsement_key.replace("_", " ").title()

    endorsement_entries = [e for e in matching if e.get("endorsement") == endorsement_key and e.get("value")]

    if endorsement_entries:
        return {
            "requirement_label": label,
            "category": category,
            "requirement_type": req.get("requirement_type", "other"),
            "required_value": required_value,
            "actual_value": "true",
            "status": "pass",
            "note": f"{endorsement_label} appears to be confirmed for {_category_label(category)}",
        }

    # Check if we have any coverage at all for this category
    coverage_entries = [e for e in matching if "endorsement" not in e]
    if coverage_entries:
        return {
            "requirement_label": label,
            "category": category,
            "requirement_type": req.get("requirement_type", "other"),
            "required_value": required_value,
            "actual_value": None,
            "status": "unclear",
            "note": f"{_category_label(category)} coverage found but {endorsement_label} not confirmed — may require endorsement verification",
        }

    return {
        "requirement_label": label,
        "category": category,
        "requirement_type": req.get("requirement_type", "other"),
        "required_value": required_value,
        "actual_value": None,
        "status": "fail",
        "note": f"No {_category_label(category)} coverage found — {endorsement_label} cannot be verified",
    }


def _check_primary_noncontributory(req: dict, matching: list[dict]) -> dict:
    """Primary & non-contributory always requires endorsement verification."""
    category = req.get("category", "other")
    label = req.get("label", "")
    coverage_entries = [e for e in matching if "endorsement" not in e]

    if coverage_entries:
        return {
            "requirement_label": label,
            "category": category,
            "requirement_type": "primary_noncontributory",
            "required_value": req.get("required_value"),
            "actual_value": None,
            "status": "unclear",
            "note": f"{_category_label(category)} coverage found — Primary & Non-Contributory status should be verified on the actual policy endorsement",
        }

    return {
        "requirement_label": label,
        "category": category,
        "requirement_type": "primary_noncontributory",
        "required_value": req.get("required_value"),
        "actual_value": None,
        "status": "fail",
        "note": f"No {_category_label(category)} coverage found — Primary & Non-Contributory cannot be verified",
    }


def _check_insurer_rating(req: dict, matching: list[dict]) -> dict:
    """Insurer rating always requires independent verification."""
    category = req.get("category", "other")
    label = req.get("label", "")
    coverage_entries = [e for e in matching if "endorsement" not in e]
    carriers = [e.get("carrier") for e in coverage_entries if e.get("carrier")]

    if carriers:
        return {
            "requirement_label": label,
            "category": category,
            "requirement_type": "insurer_rating",
            "required_value": req.get("required_value"),
            "actual_value": ", ".join(set(carriers)),
            "status": "unclear",
            "note": f"Carrier identified ({', '.join(set(carriers))}) — AM Best rating should be verified independently",
        }

    return {
        "requirement_label": label,
        "category": category,
        "requirement_type": "insurer_rating",
        "required_value": req.get("required_value"),
        "actual_value": None,
        "status": "unclear",
        "note": "Carrier not identified — AM Best rating should be verified independently",
    }


def _check_notice_of_cancellation(req: dict, matching: list[dict]) -> dict:
    """Notice of cancellation should be verified on the actual policy."""
    return {
        "requirement_label": req.get("label", ""),
        "category": req.get("category", "other"),
        "requirement_type": "notice_of_cancellation",
        "required_value": req.get("required_value"),
        "actual_value": None,
        "status": "unclear",
        "note": "Notice of cancellation terms should be verified on the actual policy",
    }


def _check_certificate_holder(req: dict, matching: list[dict]) -> dict:
    """Certificate holder formatting should be verified against the lease."""
    return {
        "requirement_label": req.get("label", ""),
        "category": req.get("category", "other"),
        "requirement_type": "certificate_holder",
        "required_value": req.get("required_value"),
        "actual_value": None,
        "status": "unclear",
        "note": "Certificate holder formatting should be verified to match lease requirements exactly",
    }


def _check_generic(req: dict, matching: list[dict]) -> dict:
    """Generic check for unrecognized requirement types."""
    category = req.get("category", "other")
    label = req.get("label", "")
    coverage_entries = [e for e in matching if "endorsement" not in e]

    if coverage_entries:
        return {
            "requirement_label": label,
            "category": category,
            "requirement_type": req.get("requirement_type", "other"),
            "required_value": req.get("required_value"),
            "actual_value": None,
            "status": "unclear",
            "note": f"Related coverage found — this requirement should be verified manually",
        }

    return {
        "requirement_label": label,
        "category": category,
        "requirement_type": req.get("requirement_type", "other"),
        "required_value": req.get("required_value"),
        "actual_value": None,
        "status": "fail",
        "note": "No matching coverage found for this requirement",
    }


def _parse_int(value) -> Optional[int]:
    """Try to parse a value as an integer."""
    if value is None:
        return None
    try:
        return int(str(value).replace(",", "").replace("$", "").strip())
    except (ValueError, TypeError):
        return None


def _category_label(category: str) -> str:
    """Human-readable category label."""
    labels = {
        "general_liability": "General Liability",
        "commercial_auto": "Commercial Auto",
        "umbrella": "Umbrella/Excess",
        "workers_comp": "Workers' Compensation",
        "property": "Property",
        "professional_liability": "Professional Liability",
        "cyber": "Cyber Liability",
        "other": "Other",
    }
    return labels.get(category, category.replace("_", " ").title())


def generate_broker_email(
    requirements: list[dict],
    results: list[dict],
    property_address: str | None = None,
    landlord_name: str | None = None,
    broker_name: str | None = None,
) -> dict:
    """Generate a pre-filled email body for sending to broker about missing coverage."""
    failing = [r for r in results if r.get("status") in ("fail", "unclear")]

    subject = "Insurance Requirements"
    if property_address:
        subject += f" — {property_address}"

    lines = []
    if broker_name:
        lines.append(f"Hi {broker_name},")
    else:
        lines.append("Hi,")

    lines.append("")
    intro = "I need to update my insurance to meet lease requirements"
    if property_address:
        intro += f" for {property_address}"
    if landlord_name:
        intro += f" (landlord: {landlord_name})"
    intro += ". Here's what I need:"
    lines.append(intro)
    lines.append("")

    for item in failing:
        status_label = "MISSING" if item.get("status") == "fail" else "NEEDS VERIFICATION"
        lines.append(f"  [{status_label}] {item.get('requirement_label', 'Unknown')}")
        if item.get("note"):
            lines.append(f"    Note: {item['note']}")

    lines.append("")
    lines.append("Can you help me get these endorsements/coverage updates? Please let me know the next steps and any additional cost.")
    lines.append("")
    lines.append("Thank you!")

    return {
        "subject": subject,
        "body": "\n".join(lines),
    }
