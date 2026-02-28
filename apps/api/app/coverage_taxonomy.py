"""
Coverage taxonomy for gap analysis.
Defines coverage categories, what policies provide them, and rules for identifying gaps.
"""

from dataclasses import dataclass
from typing import Optional
import re


# Common policy exclusions to scan for and warn users about
EXCLUSION_KEYWORDS = {
    "flood": {
        "keywords": ["flood", "flooding", "flood damage", "surface water", "rising water"],
        "name": "Flood Exclusion",
        "description": "Flood damage is typically excluded from standard home insurance.",
        "recommendation": "Consider separate flood insurance through NFIP or private insurers, especially if you're in a flood-prone area.",
        "applies_to": ["home", "renters"],
    },
    "earthquake": {
        "keywords": ["earthquake", "earth movement", "seismic", "tremor"],
        "name": "Earthquake Exclusion",
        "description": "Earthquake damage is typically excluded from standard home insurance.",
        "recommendation": "Consider earthquake insurance if you live in a seismically active region.",
        "applies_to": ["home", "renters"],
    },
    "sewer_backup": {
        "keywords": ["sewer backup", "sewer", "drain backup", "sump pump", "water backup"],
        "name": "Sewer/Water Backup Exclusion",
        "description": "Sewer and drain backup damage may not be covered by your policy.",
        "recommendation": "Ask your agent about adding water backup coverage - it's usually inexpensive and covers a common claim type.",
        "applies_to": ["home", "renters"],
    },
    "mold": {
        "keywords": ["mold", "mildew", "fungus", "fungi", "spores"],
        "name": "Mold Exclusion",
        "description": "Mold damage and remediation may be excluded or have low limits.",
        "recommendation": "Review your mold coverage limits. Mold remediation can be very expensive.",
        "applies_to": ["home", "renters"],
    },
    "wear_and_tear": {
        "keywords": ["wear and tear", "gradual deterioration", "maintenance", "neglect", "lack of maintenance"],
        "name": "Maintenance/Wear Exclusion",
        "description": "Damage from lack of maintenance or normal wear is excluded.",
        "recommendation": "Regular home maintenance prevents claims from being denied. Document your upkeep.",
        "applies_to": ["home"],
    },
    "business_use": {
        "keywords": ["business use", "commercial use", "livery", "rideshare", "uber", "lyft", "delivery"],
        "name": "Business/Commercial Use Exclusion",
        "description": "Using your vehicle for business purposes may void coverage.",
        "recommendation": "If you do rideshare or delivery, you need commercial or rideshare coverage.",
        "applies_to": ["auto"],
    },
    "intentional_acts": {
        "keywords": ["intentional", "criminal act", "illegal act", "fraud"],
        "name": "Intentional Acts Exclusion",
        "description": "Intentional damage or illegal acts are not covered.",
        "recommendation": "This is standard. Just be aware coverage requires accidental loss.",
        "applies_to": ["auto", "home", "renters"],
    },
}


@dataclass
class CoverageCategory:
    """A category of protection (e.g., liability, property damage)."""
    id: str
    name: str
    description: str
    importance: str  # "critical", "important", "recommended"
    typical_sources: list[str]  # policy types that typically provide this


@dataclass
class GapRule:
    """A rule for detecting coverage gaps."""
    id: str
    name: str
    description: str
    severity: str  # "high", "medium", "low"
    condition: str  # description of when this gap exists
    recommendation: str


# Coverage categories - what types of protection exist
COVERAGE_CATEGORIES = {
    # Liability Protection
    "auto_liability": CoverageCategory(
        id="auto_liability",
        name="Auto Liability",
        description="Covers damage/injury you cause to others while driving",
        importance="critical",
        typical_sources=["auto"]
    ),
    "home_liability": CoverageCategory(
        id="home_liability",
        name="Home Liability",
        description="Covers injury to others on your property or damage you cause",
        importance="critical",
        typical_sources=["home", "renters"]
    ),
    "umbrella_liability": CoverageCategory(
        id="umbrella_liability",
        name="Umbrella/Excess Liability",
        description="Additional liability coverage above auto/home limits",
        importance="important",
        typical_sources=["umbrella", "liability"]
    ),

    # Property Protection
    "dwelling_coverage": CoverageCategory(
        id="dwelling_coverage",
        name="Dwelling Coverage",
        description="Covers repair/rebuild of your home structure",
        importance="critical",
        typical_sources=["home"]
    ),
    "personal_property": CoverageCategory(
        id="personal_property",
        name="Personal Property",
        description="Covers your belongings (furniture, electronics, clothes)",
        importance="important",
        typical_sources=["home", "renters"]
    ),
    "auto_collision": CoverageCategory(
        id="auto_collision",
        name="Auto Collision",
        description="Covers damage to your car from accidents",
        importance="important",
        typical_sources=["auto"]
    ),
    "auto_comprehensive": CoverageCategory(
        id="auto_comprehensive",
        name="Auto Comprehensive",
        description="Covers non-collision damage (theft, weather, animals)",
        importance="important",
        typical_sources=["auto"]
    ),

    # Life & Income Protection
    "life_insurance": CoverageCategory(
        id="life_insurance",
        name="Life Insurance",
        description="Provides financial support to dependents if you pass away",
        importance="critical",
        typical_sources=["life"]
    ),
    "disability_income": CoverageCategory(
        id="disability_income",
        name="Disability Income",
        description="Replaces income if you can't work due to illness/injury",
        importance="important",
        typical_sources=["disability"]
    ),

    # Medical
    "medical_payments": CoverageCategory(
        id="medical_payments",
        name="Medical Payments",
        description="Covers medical bills regardless of fault",
        importance="recommended",
        typical_sources=["auto", "home", "renters"]
    ),
    "loss_of_use": CoverageCategory(
        id="loss_of_use",
        name="Loss of Use / Additional Living Expenses",
        description="Covers temporary housing and living costs if your home becomes uninhabitable",
        importance="important",
        typical_sources=["home", "renters"]
    ),
    "uninsured_motorist": CoverageCategory(
        id="uninsured_motorist",
        name="Uninsured/Underinsured Motorist",
        description="Covers you if hit by uninsured driver",
        importance="important",
        typical_sources=["auto"]
    ),

    # Health & Wellness
    "health_insurance": CoverageCategory(
        id="health_insurance",
        name="Health Insurance",
        description="Covers medical expenses, doctor visits, and hospital stays",
        importance="critical",
        typical_sources=["health"]
    ),
    "dental_insurance": CoverageCategory(
        id="dental_insurance",
        name="Dental Insurance",
        description="Covers preventive, basic, and major dental care",
        importance="recommended",
        typical_sources=["dental"]
    ),
    "vision_insurance": CoverageCategory(
        id="vision_insurance",
        name="Vision Insurance",
        description="Covers eye exams, glasses, and contact lenses",
        importance="recommended",
        typical_sources=["vision"]
    ),
    "pet_insurance": CoverageCategory(
        id="pet_insurance",
        name="Pet Insurance",
        description="Covers veterinary expenses for illness and injury",
        importance="recommended",
        typical_sources=["pet"]
    ),

    # Watercraft
    "watercraft_liability": CoverageCategory(
        id="watercraft_liability",
        name="Watercraft Liability",
        description="Covers damage or injury caused by your boat or watercraft",
        importance="critical",
        typical_sources=["boat"]
    ),
    "hull_coverage": CoverageCategory(
        id="hull_coverage",
        name="Hull / Physical Damage",
        description="Covers physical damage to your boat or watercraft",
        importance="important",
        typical_sources=["boat"]
    ),

    # Business Coverage
    "general_liability": CoverageCategory(
        id="general_liability",
        name="General Liability",
        description="Covers third-party bodily injury and property damage claims against your business",
        importance="critical",
        typical_sources=["general_liability", "bop"]
    ),
    "professional_liability": CoverageCategory(
        id="professional_liability",
        name="Professional Liability (E&O)",
        description="Covers claims of professional negligence, errors, or omissions",
        importance="critical",
        typical_sources=["professional_liability"]
    ),
    "commercial_property": CoverageCategory(
        id="commercial_property",
        name="Commercial Property",
        description="Covers business property, equipment, and inventory",
        importance="critical",
        typical_sources=["commercial_property", "bop"]
    ),
    "commercial_auto_liability": CoverageCategory(
        id="commercial_auto_liability",
        name="Commercial Auto",
        description="Covers business vehicles and commercial driving liability",
        importance="important",
        typical_sources=["commercial_auto"]
    ),
    "cyber_liability": CoverageCategory(
        id="cyber_liability",
        name="Cyber Liability",
        description="Covers data breaches, ransomware, and cyber incidents",
        importance="important",
        typical_sources=["cyber"]
    ),
    "directors_officers": CoverageCategory(
        id="directors_officers",
        name="Directors & Officers",
        description="Protects company leadership from personal liability in management decisions",
        importance="important",
        typical_sources=["directors_officers"]
    ),
    "employment_practices": CoverageCategory(
        id="employment_practices",
        name="Employment Practices Liability",
        description="Covers claims of wrongful termination, discrimination, and harassment",
        importance="important",
        typical_sources=["epli"]
    ),
}


# Gap detection rules - specific scenarios that indicate coverage gaps
GAP_RULES: list[GapRule] = [
    # High severity gaps
    GapRule(
        id="no_auto_with_vehicle",
        name="No Auto Insurance",
        description="You appear to have a vehicle but no auto insurance policy",
        severity="high",
        condition="has_vehicle AND NOT has_auto_policy",
        recommendation="Auto liability insurance is legally required in most states. Add an auto policy immediately."
    ),
    GapRule(
        id="no_home_as_owner",
        name="No Homeowners Insurance",
        description="You own a home but don't have homeowners insurance",
        severity="high",
        condition="is_homeowner AND NOT has_home_policy",
        recommendation="Your home is likely your largest asset. Homeowners insurance protects against fire, theft, liability, and more."
    ),
    GapRule(
        id="no_renters_as_renter",
        name="No Renters Insurance",
        description="You rent your home but don't have renters insurance",
        severity="medium",
        condition="is_renter AND NOT has_renters_policy",
        recommendation="Renters insurance is inexpensive and covers your belongings plus liability. Highly recommended."
    ),
    GapRule(
        id="no_life_with_dependents",
        name="No Life Insurance with Dependents",
        description="You have dependents but no life insurance",
        severity="high",
        condition="has_dependents AND NOT has_life_policy",
        recommendation="Life insurance ensures your family is financially protected. Consider term life for affordable coverage."
    ),

    # Medium severity gaps
    GapRule(
        id="no_umbrella_high_assets",
        name="No Umbrella Coverage",
        description="Your assets exceed your liability coverage limits",
        severity="medium",
        condition="high_net_worth AND NOT has_umbrella_policy",
        recommendation="An umbrella policy provides extra liability protection above your auto/home limits. Protects your savings and future earnings from lawsuits."
    ),
    GapRule(
        id="low_liability_limits",
        name="Low Liability Limits",
        description="Your liability coverage may be insufficient for your assets",
        severity="medium",
        condition="auto_liability_under_100k OR home_liability_under_300k",
        recommendation="Consider increasing liability limits. A serious accident could exceed your coverage and put your assets at risk."
    ),
    GapRule(
        id="no_uninsured_motorist",
        name="No Uninsured Motorist Coverage",
        description="You're not protected if hit by an uninsured driver",
        severity="medium",
        condition="has_auto_policy AND NOT has_uninsured_motorist",
        recommendation="About 13% of drivers are uninsured. UM/UIM coverage protects you and is usually inexpensive."
    ),

    # Low severity / recommendations
    GapRule(
        id="no_roadside",
        name="No Roadside Assistance",
        description="You don't have roadside assistance coverage",
        severity="low",
        condition="has_auto_policy AND NOT has_roadside",
        recommendation="Roadside assistance covers towing, flat tires, lockouts. Often just a few dollars per month."
    ),
    GapRule(
        id="high_deductible_low_savings",
        name="High Deductible Risk",
        description="Your deductible may be higher than your emergency fund",
        severity="low",
        condition="deductible_exceeds_emergency_fund",
        recommendation="Ensure you can cover your deductible in an emergency. Consider lowering it if needed."
    ),
    GapRule(
        id="renewal_approaching",
        name="Policy Renewal Approaching",
        description="A policy is expiring soon - time to review coverage",
        severity="low",
        condition="renewal_within_30_days",
        recommendation="Review your coverage before renewal. Shop around or ask your agent about discounts."
    ),
]


def get_policy_coverages(policy_type: str) -> list[str]:
    """Get the coverage categories typically provided by a policy type."""
    policy_type = (policy_type or "").lower()

    coverage_map = {
        # Personal — vehicles
        "auto": ["auto_liability", "auto_collision", "auto_comprehensive", "medical_payments", "uninsured_motorist"],
        "motorcycle": ["auto_liability", "auto_collision", "auto_comprehensive"],
        "boat": ["watercraft_liability", "hull_coverage"],
        "rv": ["auto_liability", "auto_collision", "auto_comprehensive"],
        # Personal — property
        "home": ["dwelling_coverage", "personal_property", "home_liability", "medical_payments", "loss_of_use"],
        "renters": ["personal_property", "home_liability", "medical_payments", "loss_of_use"],
        "flood": [],
        "earthquake": [],
        # Personal — health & life
        "health": ["health_insurance"],
        "dental": ["dental_insurance"],
        "vision": ["vision_insurance"],
        "life": ["life_insurance"],
        "disability": ["disability_income"],
        "pet": ["pet_insurance"],
        # Both
        "umbrella": ["umbrella_liability"],
        "liability": ["umbrella_liability"],
        # Business
        "workers_comp": [],
        "general_liability": ["general_liability"],
        "professional_liability": ["professional_liability"],
        "commercial_property": ["commercial_property"],
        "commercial_auto": ["commercial_auto_liability"],
        "cyber": ["cyber_liability"],
        "bop": ["general_liability", "commercial_property"],
        "directors_officers": ["directors_officers"],
        "epli": ["employment_practices"],
        "inland_marine": [],
    }

    return coverage_map.get(policy_type, [])


def analyze_coverage_gaps(
    policies: list[dict],
    user_context: Optional[dict] = None
) -> list[dict]:
    """
    Analyze a user's policies and identify coverage gaps.

    Args:
        policies: List of policy dicts with type, coverage_amount, details, etc.
        user_context: Optional dict with user info (has_dependents, is_homeowner, etc.)

    Returns:
        List of identified gaps with severity, description, and recommendations
    """
    user_context = user_context or {}
    gaps = []

    # Build a set of what coverage the user has
    policy_types = set()
    has_coverages = set()
    total_liability = 0

    for policy in policies:
        ptype = (policy.get("policy_type") or "").lower()
        policy_types.add(ptype)
        has_coverages.update(get_policy_coverages(ptype))

        # Track liability limits
        if ptype == "auto":
            total_liability += policy.get("coverage_amount") or 0

        # Check for specific coverages in details
        details = {d.get("field_name", "").lower(): d.get("field_value", "")
                   for d in policy.get("details", [])}

        if details.get("uninsured_motorist"):
            has_coverages.add("uninsured_motorist")
        if details.get("roadside_assistance"):
            has_coverages.add("roadside")

    # Check each gap rule
    # No auto insurance
    if "auto" not in policy_types:
        severity = "high" if user_context.get("has_vehicle") else "info"
        gaps.append({
            "id": "consider_auto",
            "name": "Auto Insurance",
            "severity": severity,
            "description": "No auto policy on file. If you own or lease a vehicle, you need auto insurance.",
            "recommendation": "Add your auto policy to track coverage and renewals.",
            "category": "auto_liability"
        })

    # No home/renters
    if "home" not in policy_types and "renters" not in policy_types:
        if user_context.get("is_homeowner"):
            severity = "high"
        elif user_context.get("is_renter"):
            severity = "medium"
        else:
            severity = "info"
        gaps.append({
            "id": "consider_property",
            "name": "Property Insurance",
            "severity": severity,
            "description": "No home or renters policy on file.",
            "recommendation": "Homeowners need dwelling coverage. Renters should have renters insurance to protect belongings.",
            "category": "personal_property"
        })

    # No life insurance - especially important with dependents
    if "life" not in policy_types:
        severity = "high" if user_context.get("has_dependents") else "info"
        gaps.append({
            "id": "no_life",
            "name": "Life Insurance",
            "severity": severity,
            "description": "No life insurance policy on file.",
            "recommendation": "Life insurance provides financial security for your loved ones. Term life is an affordable option.",
            "category": "life_insurance"
        })

    # No umbrella - important for asset protection
    if "umbrella" not in policy_types and "liability" not in policy_types:
        if user_context.get("high_net_worth") or len(policy_types) >= 2:
            severity = "high" if user_context.get("high_net_worth") else "medium"
            gaps.append({
                "id": "no_umbrella",
                "name": "Umbrella Coverage",
                "severity": severity,
                "description": "No umbrella/excess liability policy.",
                "recommendation": "An umbrella policy provides additional liability coverage above your auto and home limits. Protects your assets from lawsuits.",
                "category": "umbrella_liability"
            })

    # No health insurance
    if "health" not in policy_types:
        severity = "high" if user_context.get("has_dependents") else "medium"
        gaps.append({
            "id": "no_health",
            "name": "Health Insurance",
            "severity": severity,
            "description": "No health insurance policy on file.",
            "recommendation": "Health insurance is essential. If employer-sponsored, add it here to track deductibles and out-of-pocket costs.",
            "category": "health_insurance"
        })

    # No dental
    if "dental" not in policy_types:
        gaps.append({
            "id": "no_dental",
            "name": "Dental Insurance",
            "severity": "info",
            "description": "No dental insurance policy on file.",
            "recommendation": "Dental coverage helps manage preventive and restorative care costs.",
            "category": "dental_insurance"
        })

    # No vision
    if "vision" not in policy_types:
        gaps.append({
            "id": "no_vision",
            "name": "Vision Insurance",
            "severity": "info",
            "description": "No vision insurance policy on file.",
            "recommendation": "Vision plans cover eye exams, glasses, and contacts at reduced cost.",
            "category": "vision_insurance"
        })

    # No disability — critical for income earners
    if "disability" not in policy_types:
        severity = "medium" if user_context.get("has_dependents") else "info"
        gaps.append({
            "id": "no_disability",
            "name": "Disability Insurance",
            "severity": severity,
            "description": "No disability insurance on file.",
            "recommendation": "Disability insurance replaces income if you can't work due to illness or injury. Often overlooked but critical.",
            "category": "disability_income"
        })

    # Business gap analysis
    business_types = {"general_liability", "professional_liability", "commercial_property",
                      "commercial_auto", "cyber", "bop", "directors_officers", "epli",
                      "inland_marine", "workers_comp"}
    has_business_policies = bool(policy_types & business_types)
    owns_business = user_context.get("owns_business", False)

    if has_business_policies or owns_business:
        if "general_liability" not in policy_types and "bop" not in policy_types:
            gaps.append({
                "id": "no_gl",
                "name": "No General Liability",
                "severity": "high",
                "description": "No general liability or BOP policy on file. GL is the foundation of business insurance.",
                "recommendation": "General liability covers third-party injury and property damage claims. Required by most contracts and leases.",
                "category": "general_liability"
            })
        if "cyber" not in policy_types:
            severity = "high" if owns_business else "medium"
            gaps.append({
                "id": "no_cyber",
                "name": "No Cyber Coverage",
                "severity": severity,
                "description": "No cyber liability policy on file.",
                "recommendation": "Cyber insurance covers data breaches, ransomware, and response costs. A growing risk for all businesses.",
                "category": "cyber_liability"
            })
        if "epli" not in policy_types and ("workers_comp" in policy_types or owns_business):
            severity = "high" if owns_business else "medium"
            gaps.append({
                "id": "no_epli",
                "name": "No Employment Practices Liability",
                "severity": severity,
                "description": "No EPLI coverage on file.",
                "recommendation": "EPLI covers wrongful termination, discrimination, and harassment claims — risks not covered by workers' comp.",
                "category": "employment_practices"
            })
        if "professional_liability" not in policy_types:
            gaps.append({
                "id": "no_professional_liability",
                "name": "Professional Liability (E&O)",
                "severity": "info",
                "description": "No professional liability policy on file.",
                "recommendation": "If your business provides professional services or advice, E&O insurance protects against negligence claims.",
                "category": "professional_liability"
            })

    # Low auto liability
    if "auto" in policy_types:
        auto_policies = [p for p in policies if (p.get("policy_type") or "").lower() == "auto"]
        for ap in auto_policies:
            coverage = ap.get("coverage_amount") or 0
            if coverage > 0 and coverage < 100000:
                gaps.append({
                    "id": "low_auto_liability",
                    "name": "Low Auto Liability Limit",
                    "severity": "medium",
                    "description": f"Your auto liability limit (${coverage:,}) may be insufficient.",
                    "recommendation": "Consider increasing to at least $100,000/$300,000. Medical costs and lawsuits can easily exceed low limits.",
                    "category": "auto_liability"
                })
                break

    # Check for policies expiring soon
    from datetime import datetime, timedelta
    now = datetime.now().date()
    for policy in policies:
        renewal = policy.get("renewal_date")
        if renewal:
            try:
                if isinstance(renewal, str):
                    renewal_date = datetime.strptime(renewal, "%Y-%m-%d").date()
                else:
                    renewal_date = renewal

                days_until = (renewal_date - now).days

                if days_until < 0:
                    gaps.append({
                        "id": f"expired_{policy.get('id')}",
                        "name": "Policy Expired",
                        "severity": "high",
                        "description": f"Your {policy.get('carrier', 'policy')} {policy.get('policy_type', '')} policy has expired.",
                        "recommendation": "Renew immediately to avoid coverage lapses.",
                        "category": "renewal",
                        "policy_id": policy.get("id")
                    })
                elif days_until <= 14:
                    gaps.append({
                        "id": f"expiring_soon_{policy.get('id')}",
                        "name": "Renewal Urgent",
                        "severity": "medium",
                        "description": f"Your {policy.get('carrier', 'policy')} {policy.get('policy_type', '')} policy expires in {days_until} days.",
                        "recommendation": "Review coverage and renew before expiration.",
                        "category": "renewal",
                        "policy_id": policy.get("id")
                    })
                elif days_until <= 30:
                    gaps.append({
                        "id": f"expiring_{policy.get('id')}",
                        "name": "Renewal Approaching",
                        "severity": "low",
                        "description": f"Your {policy.get('carrier', 'policy')} {policy.get('policy_type', '')} policy expires in {days_until} days.",
                        "recommendation": "Good time to review coverage and shop around.",
                        "category": "renewal",
                        "policy_id": policy.get("id")
                    })
            except (ValueError, TypeError):
                pass

    # Check for stale home coverage (not updated in 3+ years - construction costs rise ~5-10% annually)
    for policy in policies:
        ptype = (policy.get("policy_type") or "").lower()
        if ptype == "home":
            created = policy.get("created_at")
            renewal = policy.get("renewal_date")

            # Check if dwelling coverage might be outdated
            coverage = policy.get("coverage_amount") or 0
            if coverage > 0:
                # Simple heuristic: if home policy was created 3+ years ago, coverage may need review
                # In real world, would compare to local rebuild cost indices
                try:
                    if created:
                        created_date = datetime.strptime(str(created)[:10], "%Y-%m-%d").date()
                        years_old = (now - created_date).days / 365
                        if years_old >= 3:
                            estimated_increase = int(years_old * 7)  # ~7% annual construction cost increase
                            gaps.append({
                                "id": f"stale_home_coverage_{policy.get('id')}",
                                "name": "Home Coverage Review Needed",
                                "severity": "medium",
                                "description": f"Your home coverage (${coverage:,}) hasn't been reviewed in {int(years_old)} years. Construction costs have risen ~{estimated_increase}% since then.",
                                "recommendation": "Contact your agent to review dwelling coverage. You may be underinsured if rebuild costs have increased.",
                                "category": "dwelling_coverage",
                                "policy_id": policy.get("id")
                            })
                except (ValueError, TypeError):
                    pass

    # Check for missing claims contact (preparedness warning)
    for policy in policies:
        contacts = policy.get("contacts", [])
        has_claims_contact = any(
            c.get("role") in ("claims", "customer_service") and c.get("phone")
            for c in contacts
        )
        if not has_claims_contact and policy.get("carrier") != "Pending extraction...":
            gaps.append({
                "id": f"no_claims_contact_{policy.get('id')}",
                "name": "Missing Claims Contact",
                "severity": "low",
                "description": f"Your {policy.get('carrier', 'policy')} policy has no claims phone number on file.",
                "recommendation": "Add the claims phone number so you're ready if you need to file a claim.",
                "category": "preparedness",
                "policy_id": policy.get("id")
            })

    # Check for policies with no coverage amount specified
    for policy in policies:
        if not policy.get("coverage_amount") and policy.get("carrier") != "Pending extraction...":
            ptype = policy.get("policy_type", "")
            if ptype in ("auto", "home", "renters", "umbrella", "liability", "general_liability", "professional_liability", "commercial_property", "cyber"):
                gaps.append({
                    "id": f"unknown_coverage_{policy.get('id')}",
                    "name": "Unknown Coverage Limit",
                    "severity": "low",
                    "description": f"Your {policy.get('carrier', 'policy')} {ptype} policy has no coverage limit recorded.",
                    "recommendation": "Add your coverage limit to better understand your protection level.",
                    "category": "incomplete_data",
                    "policy_id": policy.get("id")
                })

    # Scan for exclusion keywords in policy details
    exclusions_found = set()  # Track unique exclusions to avoid duplicates
    for policy in policies:
        ptype = (policy.get("policy_type") or "").lower()
        details = policy.get("details", [])

        # Combine all detail text for scanning
        detail_text = " ".join([
            f"{d.get('field_name', '')} {d.get('field_value', '')}"
            for d in details
        ]).lower()

        # Also scan carrier name and any notes
        detail_text += f" {policy.get('carrier', '')} {policy.get('notes', '')}".lower()

        for excl_id, excl_info in EXCLUSION_KEYWORDS.items():
            # Skip if this exclusion doesn't apply to this policy type
            if ptype not in excl_info.get("applies_to", []):
                continue

            # Check if any keywords match
            for keyword in excl_info["keywords"]:
                if keyword.lower() in detail_text:
                    exclusion_key = f"{excl_id}_{policy.get('id')}"
                    if exclusion_key not in exclusions_found:
                        exclusions_found.add(exclusion_key)
                        gaps.append({
                            "id": f"exclusion_{excl_id}_{policy.get('id')}",
                            "name": excl_info["name"],
                            "severity": "info",
                            "description": excl_info["description"],
                            "recommendation": excl_info["recommendation"],
                            "category": "exclusion_warning",
                            "policy_id": policy.get("id")
                        })
                    break  # Only add once per exclusion type per policy

    # For home policies, proactively warn about common exclusions even if not found in text
    # These are almost universal exclusions that users should be aware of
    home_policies = [p for p in policies if (p.get("policy_type") or "").lower() in ("home", "renters")]
    for hp in home_policies:
        policy_id = hp.get("id")
        # Check if we already warned about flood for this policy
        if f"flood_{policy_id}" not in exclusions_found:
            gaps.append({
                "id": f"exclusion_flood_reminder_{policy_id}",
                "name": "Flood Coverage Reminder",
                "severity": "info",
                "description": "Standard home/renters policies do NOT cover flood damage.",
                "recommendation": "If you're in a flood-prone area, consider NFIP or private flood insurance.",
                "category": "exclusion_warning",
                "policy_id": policy_id
            })

    # Sort by severity
    severity_order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    gaps.sort(key=lambda g: severity_order.get(g["severity"], 4))

    return gaps


def get_coverage_summary(policies: list[dict]) -> dict:
    """
    Generate a summary of the user's overall coverage.

    Returns:
        Dict with coverage statistics and insights
    """
    policy_types = set()
    total_coverage = 0
    total_premium = 0
    coverage_by_type = {}

    for policy in policies:
        ptype = (policy.get("policy_type") or "other").lower()
        policy_types.add(ptype)

        coverage = policy.get("coverage_amount") or 0
        premium = policy.get("premium_amount") or 0

        total_coverage += coverage
        total_premium += premium

        if ptype not in coverage_by_type:
            coverage_by_type[ptype] = {"coverage": 0, "premium": 0, "count": 0}
        coverage_by_type[ptype]["coverage"] += coverage
        coverage_by_type[ptype]["premium"] += premium
        coverage_by_type[ptype]["count"] += 1

    # Determine what categories are covered
    covered_categories = set()
    for ptype in policy_types:
        covered_categories.update(get_policy_coverages(ptype))

    return {
        "total_policies": len(policies),
        "policy_types": list(policy_types),
        "total_coverage": total_coverage,
        "total_annual_premium": total_premium,
        "coverage_by_type": coverage_by_type,
        "covered_categories": list(covered_categories),
        "missing_categories": [
            cat_id for cat_id, cat in COVERAGE_CATEGORIES.items()
            if cat_id not in covered_categories and cat.importance in ("critical", "important")
        ]
    }
