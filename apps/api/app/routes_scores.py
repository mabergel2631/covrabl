"""
Coverage Health Score API routes.
Scores user protection across 4 categories with profile-adjusted dynamic weights.
"""

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .models import Policy, PolicyDetail, User
from .models_documents import Document
from .models_features import CoverageScore, DismissedRecommendation
from .models_profile import UserProfile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/coverage-scores", tags=["scores"])

# Bump when scoring logic changes to trigger recalculation
SCORE_VERSION = 2


# ═══════════════════════════════════════════════════════════════
# Profile & Weight Calculation
# ═══════════════════════════════════════════════════════════════

def _load_user_profile(db: Session, user_id: int) -> dict:
    """Load user profile flags. Returns defaults if no profile exists."""
    profile = db.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    ).scalar_one_or_none()

    if not profile:
        return {
            "is_homeowner": False, "is_renter": False,
            "has_dependents": False, "has_vehicle": False,
            "owns_business": False, "high_net_worth": False,
        }

    return {
        "is_homeowner": profile.is_homeowner or False,
        "is_renter": profile.is_renter or False,
        "has_dependents": profile.has_dependents or False,
        "has_vehicle": profile.has_vehicle or False,
        "owns_business": profile.owns_business or False,
        "high_net_worth": profile.high_net_worth or False,
    }


def _infer_exposure_band(profile: dict) -> str:
    """Infer exposure level from profile flags."""
    flags_set = sum(1 for v in profile.values() if v)

    if profile.get("high_net_worth") and profile.get("owns_business"):
        return "high"
    if profile.get("high_net_worth") or (
        profile.get("is_homeowner") and profile.get("owns_business")
    ):
        return "moderate_high"
    if flags_set >= 3:
        return "moderate"
    if flags_set >= 1:
        return "low_moderate"
    return "unknown"


def _calculate_dynamic_weights(profile: dict) -> dict:
    """Calculate category weights adjusted for user profile. Always sums to 100."""
    weights = {"liability": 30, "property": 25, "income": 20, "catastrophic": 25}

    if profile.get("owns_business"):
        weights["liability"] += 10

    if not profile.get("is_homeowner") and not profile.get("is_renter"):
        weights["property"] = 5

    if not profile.get("has_dependents"):
        weights["income"] = 5

    if profile.get("high_net_worth"):
        weights["catastrophic"] += 10

    # Normalize to sum = 100
    total = sum(weights.values())
    if total != 100:
        factor = 100 / total
        weights = {k: round(v * factor) for k, v in weights.items()}
        diff = 100 - sum(weights.values())
        if diff != 0:
            largest = max(weights, key=weights.get)
            weights[largest] += diff

    return weights


def _expected_policy_types(profile: dict) -> list[str]:
    """Determine which policy types we'd expect based on profile."""
    expected = []
    if profile.get("has_vehicle"):
        expected.append("auto")
    if profile.get("is_homeowner"):
        expected.append("home")
    elif profile.get("is_renter"):
        expected.append("renters")
    if profile.get("has_dependents"):
        expected.append("life")
    if profile.get("high_net_worth") or profile.get("is_homeowner"):
        expected.append("umbrella")
    if profile.get("owns_business"):
        expected.append("general_liability")
    return expected


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════

def _by_types(policies: list[dict], types: list[str]) -> list[dict]:
    """Filter policies matching any of the given types."""
    return [p for p in policies if p.get("policy_type", "") in types]


def _fmt(amount: int) -> str:
    """Format a dollar amount for display."""
    if amount >= 1_000_000:
        m = amount / 1_000_000
        return f"${m:.1f}M" if m != int(m) else f"${int(m)}M"
    if amount >= 1_000:
        return f"${amount // 1_000}K"
    return f"${amount:,}"


# ═══════════════════════════════════════════════════════════════
# Category Scorers
# ═══════════════════════════════════════════════════════════════

def _score_liability(policies: list[dict], profile: dict, details: dict) -> dict:
    """Score liability protection (0-100)."""
    comps = []
    recs = []

    auto = _by_types(policies, ["auto"])
    home = _by_types(policies, ["home", "renters"])
    umbrella = _by_types(policies, ["umbrella", "liability"])
    biz = _by_types(policies, ["general_liability", "bop"])
    has_biz = profile.get("owns_business")

    # ── Auto liability (25 pts) ──────────────────
    auto_pts = 0
    if auto:
        mx = max((p.get("coverage_amount") or 0) for p in auto)
        if mx >= 100_000:
            auto_pts = 25
            comps.append({"name": "Auto liability", "score": 25, "max": 25,
                          "detail": f"Coverage of {_fmt(mx)} meets recommended minimum"})
        elif mx > 0:
            auto_pts = max(5, int(25 * min(1.0, mx / 100_000)))
            comps.append({"name": "Auto liability", "score": auto_pts, "max": 25,
                          "detail": f"Coverage of {_fmt(mx)} found — recommended minimum is $100K"})
            recs.append({"priority": "medium",
                         "text": "Consider asking your agent about increasing auto liability limits",
                         "detail": "Coverage of $100K or more per person is generally recommended to protect against serious accident costs."})
        else:
            auto_pts = 15
            comps.append({"name": "Auto liability", "score": 15, "max": 25,
                          "detail": "Auto policy found — coverage limit not recorded"})
    elif profile.get("has_vehicle"):
        comps.append({"name": "Auto liability", "score": 0, "max": 25,
                      "detail": "No auto policy visible — profile indicates vehicle ownership"})
        recs.append({"priority": "high",
                     "text": "Upload your auto policy to include liability coverage in your score",
                     "detail": "Auto liability is legally required in most states and protects against significant financial exposure."})

    # ── Home/renters liability (20 pts) ──────────
    home_pts = 0
    if home:
        home_pts = 20
        ptype = (home[0].get("policy_type") or "home").title()
        comps.append({"name": f"{ptype} liability", "score": 20, "max": 20,
                      "detail": f"{ptype} policy appears to include liability protection"})
    elif profile.get("is_homeowner") or profile.get("is_renter"):
        label = "homeowners" if profile.get("is_homeowner") else "renters"
        comps.append({"name": "Property liability", "score": 0, "max": 20,
                      "detail": "No home or renters policy visible"})
        recs.append({"priority": "high",
                     "text": f"Upload your {label} policy to include property liability in your score",
                     "detail": f"{label.title()} policies typically include liability coverage that protects against claims from visitors."})

    # ── Umbrella (15 pts) ────────────────────────
    umb_pts = 0
    if umbrella:
        mx = max((p.get("coverage_amount") or 0) for p in umbrella)
        if mx >= 1_000_000:
            umb_pts = 15
            comps.append({"name": "Umbrella coverage", "score": 15, "max": 15,
                          "detail": f"Umbrella policy of {_fmt(mx)} provides extended liability protection"})
        elif mx > 0:
            umb_pts = max(5, int(15 * min(1.0, mx / 1_000_000)))
            comps.append({"name": "Umbrella coverage", "score": umb_pts, "max": 15,
                          "detail": f"Umbrella policy of {_fmt(mx)} found — $1M or more is commonly recommended"})
        else:
            umb_pts = 10
            comps.append({"name": "Umbrella coverage", "score": 10, "max": 15,
                          "detail": "Umbrella policy found — coverage limit not recorded"})
    else:
        comps.append({"name": "Umbrella coverage", "score": 0, "max": 15,
                      "detail": "No umbrella or excess liability policy visible"})
        if profile.get("high_net_worth") or (auto and home):
            recs.append({"priority": "medium",
                         "text": "Consider asking your agent about umbrella liability coverage",
                         "detail": "An umbrella policy extends liability protection beyond auto and home limits, typically starting at $1M."})

    # ── Business GL (15 pts, only if owns_business) ──
    biz_pts = 0
    if has_biz:
        if biz:
            mx = max((p.get("coverage_amount") or 0) for p in biz)
            if mx >= 1_000_000:
                biz_pts = 15
                comps.append({"name": "Business general liability", "score": 15, "max": 15,
                              "detail": f"GL coverage of {_fmt(mx)} found"})
            elif mx > 0:
                biz_pts = max(5, int(15 * min(1.0, mx / 1_000_000)))
                comps.append({"name": "Business general liability", "score": biz_pts, "max": 15,
                              "detail": f"GL coverage of {_fmt(mx)} found — $1M per occurrence is commonly recommended"})
            else:
                biz_pts = 10
                comps.append({"name": "Business general liability", "score": 10, "max": 15,
                              "detail": "Business liability policy found — coverage limit not recorded"})
        else:
            comps.append({"name": "Business general liability", "score": 0, "max": 15,
                          "detail": "No general liability policy visible — profile indicates business ownership"})
            recs.append({"priority": "high",
                         "text": "Upload your business liability policy",
                         "detail": "General liability insurance is foundational for business protection against third-party claims."})

    # ── Total ────────────────────────────────────
    max_pts = 60 + (15 if has_biz else 0)
    earned = auto_pts + home_pts + umb_pts + biz_pts
    score = round((earned / max_pts) * 100) if max_pts > 0 else 0

    return {"score": min(100, max(0, score)), "components": comps, "recommendations": recs}


def _score_property(policies: list[dict], profile: dict, details: dict) -> dict:
    """Score property protection (0-100)."""
    comps = []
    recs = []

    home = _by_types(policies, ["home"])
    renters = _by_types(policies, ["renters"])
    auto = _by_types(policies, ["auto"])
    prop = home or renters

    # ── Home/renters policy (30 pts) ─────────────
    prop_pts = 0
    if home:
        prop_pts = 30
        comps.append({"name": "Homeowners policy", "score": 30, "max": 30,
                      "detail": "Homeowners policy provides dwelling and personal property protection"})
    elif renters:
        prop_pts = 30
        comps.append({"name": "Renters policy", "score": 30, "max": 30,
                      "detail": "Renters policy provides personal property and liability protection"})
    elif profile.get("is_homeowner"):
        comps.append({"name": "Homeowners policy", "score": 0, "max": 30,
                      "detail": "No homeowners policy visible — profile indicates home ownership"})
        recs.append({"priority": "high", "text": "Upload your homeowners policy",
                     "detail": "Your home is likely your largest asset. Homeowners insurance protects against fire, theft, liability, and more."})
    elif profile.get("is_renter"):
        comps.append({"name": "Renters policy", "score": 0, "max": 30,
                      "detail": "No renters policy visible — profile indicates renting"})
        recs.append({"priority": "medium", "text": "Consider asking your agent about renters insurance",
                     "detail": "Renters insurance protects personal belongings and provides liability coverage, typically at low cost."})

    # ── Dwelling / personal property adequacy (25 pts) ──
    dwell_pts = 0
    if home:
        mx = max((p.get("coverage_amount") or 0) for p in home)
        if mx >= 250_000:
            dwell_pts = 25
            comps.append({"name": "Dwelling coverage", "score": 25, "max": 25,
                          "detail": f"Dwelling coverage of {_fmt(mx)} found"})
        elif mx > 0:
            dwell_pts = max(8, int(25 * min(1.0, mx / 250_000)))
            comps.append({"name": "Dwelling coverage", "score": dwell_pts, "max": 25,
                          "detail": f"Dwelling coverage of {_fmt(mx)} found — may warrant review against current rebuild costs"})
            recs.append({"priority": "medium", "text": "Consider reviewing dwelling coverage with your agent",
                         "detail": "Construction costs have risen significantly. Coverage should approximate your home's rebuild cost."})
        else:
            dwell_pts = 12
            comps.append({"name": "Dwelling coverage", "score": 12, "max": 25,
                          "detail": "Homeowners policy found — dwelling coverage amount not recorded"})
    elif renters:
        dwell_pts = 20
        comps.append({"name": "Personal property coverage", "score": 20, "max": 25,
                      "detail": "Renters policy appears to include personal property protection"})

    # ── Auto physical damage (25 pts) ────────────
    auto_pts = 0
    if auto:
        has_comp = has_coll = False
        for p in auto:
            dtxt = " ".join(str(v) for v in details.get(p["id"], {}).values()).lower()
            if "comprehensive" in dtxt:
                has_comp = True
            if "collision" in dtxt:
                has_coll = True

        if has_comp and has_coll:
            auto_pts = 25
            comps.append({"name": "Auto physical damage", "score": 25, "max": 25,
                          "detail": "Comprehensive and collision coverage found"})
        elif has_comp or has_coll:
            auto_pts = 15
            found = "Comprehensive" if has_comp else "Collision"
            missing = "collision" if has_comp else "comprehensive"
            comps.append({"name": "Auto physical damage", "score": 15, "max": 25,
                          "detail": f"{found} coverage found — {missing} not detected in policy details"})
        else:
            auto_pts = 12
            comps.append({"name": "Auto physical damage", "score": 12, "max": 25,
                          "detail": "Auto policy found — comprehensive and collision not confirmed from available details"})
    elif profile.get("has_vehicle"):
        comps.append({"name": "Auto physical damage", "score": 0, "max": 25,
                      "detail": "No auto policy visible"})

    # ── Deductible reasonableness (20 pts) ───────
    ded_pts = 0
    deductibles = [p.get("deductible") or 0 for p in prop + auto if (p.get("deductible") or 0) > 0]
    if deductibles:
        avg = sum(deductibles) / len(deductibles)
        if avg <= 2_500:
            ded_pts = 20
            comps.append({"name": "Deductible levels", "score": 20, "max": 20,
                          "detail": f"Average deductible of {_fmt(int(avg))} appears manageable"})
        elif avg <= 5_000:
            ded_pts = 15
            comps.append({"name": "Deductible levels", "score": 15, "max": 20,
                          "detail": f"Average deductible of {_fmt(int(avg))} — higher deductibles mean more out-of-pocket in a claim"})
        else:
            ded_pts = 8
            comps.append({"name": "Deductible levels", "score": 8, "max": 20,
                          "detail": f"Average deductible of {_fmt(int(avg))} is relatively high"})
    elif prop or auto:
        ded_pts = 10
        comps.append({"name": "Deductible levels", "score": 10, "max": 20,
                      "detail": "Deductible amounts not recorded in policy details"})

    score = min(100, max(0, prop_pts + dwell_pts + auto_pts + ded_pts))
    return {"score": score, "components": comps, "recommendations": recs}


def _score_income(policies: list[dict], profile: dict, details: dict) -> dict:
    """Score income protection (0-100)."""
    comps = []
    recs = []

    life = _by_types(policies, ["life"])
    disability = _by_types(policies, ["disability"])

    # ── Life insurance (40 pts) ──────────────────
    life_pts = 0
    if life:
        mx = max((p.get("coverage_amount") or 0) for p in life)
        if mx >= 500_000:
            life_pts = 40
            comps.append({"name": "Life insurance", "score": 40, "max": 40,
                          "detail": f"Life coverage of {_fmt(mx)} found"})
        elif mx >= 250_000:
            life_pts = 28
            comps.append({"name": "Life insurance", "score": 28, "max": 40,
                          "detail": f"Life coverage of {_fmt(mx)} found — $500K or more is commonly recommended for families"})
        elif mx > 0:
            life_pts = 16
            comps.append({"name": "Life insurance", "score": 16, "max": 40,
                          "detail": f"Life coverage of {_fmt(mx)} found — may warrant review against income needs"})
            if profile.get("has_dependents"):
                recs.append({"priority": "medium",
                             "text": "Consider reviewing life coverage amount with your agent",
                             "detail": "A common guideline suggests coverage of 10-12x annual income for families with dependents."})
        else:
            life_pts = 20
            comps.append({"name": "Life insurance", "score": 20, "max": 40,
                          "detail": "Life insurance policy found — coverage amount not recorded"})
    elif profile.get("has_dependents"):
        comps.append({"name": "Life insurance", "score": 0, "max": 40,
                      "detail": "No life insurance policy visible — profile indicates dependents"})
        recs.append({"priority": "high",
                     "text": "Consider asking your agent about life insurance options",
                     "detail": "Life insurance provides financial security for dependents. Term life offers affordable coverage."})

    # ── Disability (30 pts) ──────────────────────
    dis_pts = 0
    if disability:
        dis_pts = 30
        comps.append({"name": "Disability insurance", "score": 30, "max": 30,
                      "detail": "Disability income policy found — protects income if unable to work"})
    else:
        comps.append({"name": "Disability insurance", "score": 0, "max": 30,
                      "detail": "No disability insurance policy visible"})
        if profile.get("has_dependents"):
            recs.append({"priority": "medium",
                         "text": "Consider asking about disability income protection",
                         "detail": "Disability insurance replaces a portion of income during illness or injury — often overlooked but critical for earners with dependents."})

    # ── Policy status / term (30 pts) ────────────
    term_pts = 0
    if life:
        active = [p for p in life if p.get("status", "active") == "active"]
        if active:
            term_pts = 30
            comps.append({"name": "Policy status", "score": 30, "max": 30,
                          "detail": "Active life insurance policy in place"})
        else:
            term_pts = 10
            comps.append({"name": "Policy status", "score": 10, "max": 30,
                          "detail": "Life insurance policy may not be in active status"})
    elif disability:
        term_pts = 15
        comps.append({"name": "Income protection status", "score": 15, "max": 30,
                      "detail": "Disability coverage is active, though no life policy visible"})

    score = min(100, max(0, life_pts + dis_pts + term_pts))
    return {"score": score, "components": comps, "recommendations": recs}


def _score_catastrophic(policies: list[dict], profile: dict, details: dict) -> dict:
    """Score catastrophic protection (0-100)."""
    comps = []
    recs = []

    umbrella = _by_types(policies, ["umbrella", "liability"])
    flood = _by_types(policies, ["flood"])
    earthquake = _by_types(policies, ["earthquake"])

    # ── Umbrella (40 pts) ────────────────────────
    umb_pts = 0
    if umbrella:
        mx = max((p.get("coverage_amount") or 0) for p in umbrella)
        if mx >= 1_000_000:
            umb_pts = 40
            comps.append({"name": "Umbrella / excess liability", "score": 40, "max": 40,
                          "detail": f"Umbrella coverage of {_fmt(mx)} provides catastrophic liability protection"})
        elif mx > 0:
            umb_pts = max(10, int(40 * min(1.0, mx / 1_000_000)))
            comps.append({"name": "Umbrella / excess liability", "score": umb_pts, "max": 40,
                          "detail": f"Umbrella coverage of {_fmt(mx)} found — $1M or more is commonly recommended"})
        else:
            umb_pts = 20
            comps.append({"name": "Umbrella / excess liability", "score": 20, "max": 40,
                          "detail": "Umbrella policy found — coverage limit not recorded"})
    else:
        comps.append({"name": "Umbrella / excess liability", "score": 0, "max": 40,
                      "detail": "No umbrella or excess liability policy visible"})
        if profile.get("high_net_worth") or profile.get("is_homeowner"):
            recs.append({"priority": "high",
                         "text": "Consider asking your agent about umbrella coverage",
                         "detail": "Umbrella policies provide an additional layer of liability protection above auto and home limits, typically starting at $1M."})

    # ── Flood coverage (30 pts) ──────────────────
    flood_pts = 0
    if flood:
        flood_pts = 30
        comps.append({"name": "Flood coverage", "score": 30, "max": 30,
                      "detail": "Separate flood insurance policy found — standard policies exclude flood damage"})
    elif profile.get("is_homeowner") or profile.get("is_renter"):
        comps.append({"name": "Flood coverage", "score": 0, "max": 30,
                      "detail": "No flood insurance policy visible — standard home policies exclude flood damage"})
        recs.append({"priority": "medium",
                     "text": "Consider reviewing flood risk with your agent",
                     "detail": "Flood damage is excluded from standard homeowners and renters policies. NFIP and private options are available."})

    # ── Earthquake / other catastrophic (30 pts) ─
    cat_pts = 0
    if earthquake:
        cat_pts = 30
        comps.append({"name": "Additional catastrophic coverage", "score": 30, "max": 30,
                      "detail": "Earthquake insurance policy found"})
    elif profile.get("is_homeowner"):
        cat_pts = 10
        comps.append({"name": "Additional catastrophic coverage", "score": 10, "max": 30,
                      "detail": "No earthquake or additional catastrophic policy visible — relevance depends on location"})
    else:
        cat_pts = 15
        comps.append({"name": "Additional catastrophic coverage", "score": 15, "max": 30,
                      "detail": "Catastrophic coverage is less critical for non-property owners"})

    score = min(100, max(0, umb_pts + flood_pts + cat_pts))
    return {"score": score, "components": comps, "recommendations": recs}


# ═══════════════════════════════════════════════════════════════
# Business Category Scorers
# ═══════════════════════════════════════════════════════════════

def _score_biz_core_liability(policies: list[dict], details: dict) -> dict:
    """Score business core liability protection (0-100)."""
    comps = []
    recs = []

    gl = _by_types(policies, ["general_liability", "bop"])
    prof = _by_types(policies, ["professional_liability"])

    # ── GL / BOP presence (40 pts) ────────────────
    gl_pts = 0
    if gl:
        gl_pts = 40
        comps.append({"name": "General Liability / BOP", "score": 40, "max": 40,
                      "detail": "General liability or business owner's policy found"})
    else:
        comps.append({"name": "General Liability / BOP", "score": 0, "max": 40,
                      "detail": "No general liability or business owner's policy visible"})
        recs.append({"priority": "high",
                     "text": "Upload your general liability policy",
                     "detail": "General liability insurance is foundational for business protection against third-party claims."})

    # ── Professional Liability / E&O (30 pts) ─────
    prof_pts = 0
    if prof:
        prof_pts = 30
        comps.append({"name": "Professional Liability (E&O)", "score": 30, "max": 30,
                      "detail": "Professional liability / errors & omissions policy found"})
    else:
        comps.append({"name": "Professional Liability (E&O)", "score": 0, "max": 30,
                      "detail": "No professional liability policy visible"})
        recs.append({"priority": "medium",
                     "text": "Consider professional liability (E&O) coverage",
                     "detail": "E&O insurance protects against claims arising from professional services, advice, or errors."})

    # ── GL coverage adequacy (30 pts) ─────────────
    adeq_pts = 0
    if gl:
        mx = max((p.get("coverage_amount") or 0) for p in gl)
        if mx >= 1_000_000:
            adeq_pts = 30
            comps.append({"name": "GL coverage adequacy", "score": 30, "max": 30,
                          "detail": f"GL coverage of {_fmt(mx)} meets $1M recommended minimum"})
        elif mx > 0:
            adeq_pts = max(5, int(30 * min(1.0, mx / 1_000_000)))
            comps.append({"name": "GL coverage adequacy", "score": adeq_pts, "max": 30,
                          "detail": f"GL coverage of {_fmt(mx)} — $1M per occurrence is commonly recommended"})
        else:
            adeq_pts = 15
            comps.append({"name": "GL coverage adequacy", "score": 15, "max": 30,
                          "detail": "GL policy found — coverage limit not recorded"})

    score = min(100, max(0, gl_pts + prof_pts + adeq_pts))
    return {"score": score, "components": comps, "recommendations": recs}


def _score_biz_property_fleet(policies: list[dict], details: dict) -> dict:
    """Score business property & fleet protection (0-100)."""
    comps = []
    recs = []

    comm_prop = _by_types(policies, ["commercial_property"])
    comm_auto = _by_types(policies, ["commercial_auto"])
    inland = _by_types(policies, ["inland_marine"])

    # ── Commercial Property (40 pts) ──────────────
    prop_pts = 0
    if comm_prop:
        prop_pts = 40
        comps.append({"name": "Commercial Property", "score": 40, "max": 40,
                      "detail": "Commercial property insurance found"})
    else:
        comps.append({"name": "Commercial Property", "score": 0, "max": 40,
                      "detail": "No commercial property policy visible"})
        recs.append({"priority": "medium",
                     "text": "Consider commercial property insurance",
                     "detail": "Commercial property insurance protects business premises, equipment, and inventory."})

    # ── Commercial Auto (30 pts) ──────────────────
    auto_pts = 0
    if comm_auto:
        auto_pts = 30
        comps.append({"name": "Commercial Auto", "score": 30, "max": 30,
                      "detail": "Commercial auto policy found"})
    else:
        comps.append({"name": "Commercial Auto", "score": 0, "max": 30,
                      "detail": "No commercial auto policy visible"})

    # ── Inland Marine / Equipment (30 pts) ────────
    inland_pts = 0
    if inland:
        inland_pts = 30
        comps.append({"name": "Inland Marine / Equipment", "score": 30, "max": 30,
                      "detail": "Inland marine or equipment coverage found"})
    else:
        comps.append({"name": "Inland Marine / Equipment", "score": 0, "max": 30,
                      "detail": "No inland marine or equipment coverage visible"})

    score = min(100, max(0, prop_pts + auto_pts + inland_pts))
    return {"score": score, "components": comps, "recommendations": recs}


def _score_biz_workforce(policies: list[dict], details: dict) -> dict:
    """Score business workforce protection (0-100)."""
    comps = []
    recs = []

    wc = _by_types(policies, ["workers_comp"])
    epli = _by_types(policies, ["epli"])
    do_policies = _by_types(policies, ["directors_officers"])

    # ── Workers' Comp (50 pts) ────────────────────
    wc_pts = 0
    if wc:
        wc_pts = 50
        comps.append({"name": "Workers' Compensation", "score": 50, "max": 50,
                      "detail": "Workers' compensation policy found"})
    else:
        comps.append({"name": "Workers' Compensation", "score": 0, "max": 50,
                      "detail": "No workers' compensation policy visible"})
        recs.append({"priority": "high",
                     "text": "Upload your workers' compensation policy",
                     "detail": "Workers' comp is legally required in most states for businesses with employees."})

    # ── EPLI (25 pts) ─────────────────────────────
    epli_pts = 0
    if epli:
        epli_pts = 25
        comps.append({"name": "Employment Practices (EPLI)", "score": 25, "max": 25,
                      "detail": "Employment practices liability policy found"})
    else:
        comps.append({"name": "Employment Practices (EPLI)", "score": 0, "max": 25,
                      "detail": "No EPLI policy visible"})

    # ── D&O (25 pts) ──────────────────────────────
    do_pts = 0
    if do_policies:
        do_pts = 25
        comps.append({"name": "Directors & Officers", "score": 25, "max": 25,
                      "detail": "Directors & officers liability policy found"})
    else:
        comps.append({"name": "Directors & Officers", "score": 0, "max": 25,
                      "detail": "No D&O policy visible"})

    score = min(100, max(0, wc_pts + epli_pts + do_pts))
    return {"score": score, "components": comps, "recommendations": recs}


def _score_biz_specialty(policies: list[dict], details: dict) -> dict:
    """Score business specialty protection (0-100)."""
    comps = []
    recs = []

    cyber = _by_types(policies, ["cyber"])
    umbrella = _by_types(policies, ["umbrella"])
    # Any business types beyond the main scored categories
    scored_types = {"general_liability", "professional_liability", "commercial_property",
                    "commercial_auto", "inland_marine", "workers_comp", "epli",
                    "directors_officers", "cyber", "umbrella", "bop"}
    other = [p for p in policies if p.get("policy_type", "") not in scored_types]

    # ── Cyber Insurance (40 pts) ──────────────────
    cyber_pts = 0
    if cyber:
        cyber_pts = 40
        comps.append({"name": "Cyber Liability", "score": 40, "max": 40,
                      "detail": "Cyber liability insurance found"})
    else:
        comps.append({"name": "Cyber Liability", "score": 0, "max": 40,
                      "detail": "No cyber liability policy visible"})
        recs.append({"priority": "medium",
                     "text": "Consider cyber liability insurance",
                     "detail": "Cyber insurance protects against data breaches, ransomware, and other digital threats."})

    # ── Umbrella / Excess Liability (30 pts) ──────
    umb_pts = 0
    if umbrella:
        mx = max((p.get("coverage_amount") or 0) for p in umbrella)
        if mx >= 1_000_000:
            umb_pts = 30
            comps.append({"name": "Umbrella / Excess", "score": 30, "max": 30,
                          "detail": f"Umbrella coverage of {_fmt(mx)} provides extended protection"})
        elif mx > 0:
            umb_pts = max(8, int(30 * min(1.0, mx / 1_000_000)))
            comps.append({"name": "Umbrella / Excess", "score": umb_pts, "max": 30,
                          "detail": f"Umbrella coverage of {_fmt(mx)} found"})
        else:
            umb_pts = 15
            comps.append({"name": "Umbrella / Excess", "score": 15, "max": 30,
                          "detail": "Umbrella policy found — coverage limit not recorded"})
    else:
        comps.append({"name": "Umbrella / Excess", "score": 0, "max": 30,
                      "detail": "No umbrella or excess liability policy visible"})

    # ── Additional coverage (30 pts) ──────────────
    add_pts = 0
    if other:
        add_pts = 30
        comps.append({"name": "Additional coverage", "score": 30, "max": 30,
                      "detail": f"{len(other)} additional business coverage(s) found"})
    else:
        comps.append({"name": "Additional coverage", "score": 0, "max": 30,
                      "detail": "No additional business coverages detected"})

    score = min(100, max(0, cyber_pts + umb_pts + add_pts))
    return {"score": score, "components": comps, "recommendations": recs}


# ═══════════════════════════════════════════════════════════════
# Confidence & Policy Health
# ═══════════════════════════════════════════════════════════════

def _calculate_confidence(policies: list[dict], expected: list[str]) -> str:
    """Confidence based on how many expected policy types are uploaded."""
    if not expected:
        if len(policies) >= 3:
            return "moderate"
        return "low"

    uploaded = set(p.get("policy_type", "") for p in policies)
    found = sum(1 for t in expected if t in uploaded)
    ratio = found / len(expected)

    if ratio >= 0.75 and len(policies) >= 3:
        return "high"
    if ratio >= 0.5 or len(policies) >= 2:
        return "moderate"
    return "low"


def _build_policy_health(policies: list[dict], db: Session, user_id: int) -> dict:
    """Expiring policies, missing documents, recency."""
    now = datetime.now(timezone.utc).date()
    expiring = []

    for p in policies:
        renewal = p.get("renewal_date")
        if not renewal:
            continue
        try:
            rd = datetime.strptime(str(renewal), "%Y-%m-%d").date() if isinstance(renewal, str) else renewal
            days_left = (rd - now).days
            if 0 <= days_left <= 30:
                expiring.append({
                    "policy_id": p["id"], "type": p.get("policy_type", "unknown"),
                    "carrier": p.get("carrier", ""), "days_left": days_left,
                })
        except (ValueError, TypeError):
            pass

    expiring.sort(key=lambda x: x["days_left"])

    # Policies without uploaded documents
    missing_docs = []
    pids = [p["id"] for p in policies]
    if pids:
        has_doc = set(
            db.execute(select(Document.policy_id).where(Document.policy_id.in_(pids))).scalars().all()
        )
        for p in policies:
            if p["id"] not in has_doc:
                missing_docs.append({
                    "policy_id": p["id"], "type": p.get("policy_type", "unknown"),
                    "carrier": p.get("carrier", ""),
                })

    # Recently updated?
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    recently_updated = False
    for p in policies:
        ca = p.get("created_at")
        if not ca:
            continue
        try:
            if isinstance(ca, str):
                dt = datetime.fromisoformat(ca[:19]).replace(tzinfo=timezone.utc)
            else:
                dt = ca.replace(tzinfo=timezone.utc) if ca.tzinfo is None else ca
            if dt > cutoff:
                recently_updated = True
                break
        except (ValueError, TypeError, AttributeError):
            pass

    return {
        "expiring_soon": expiring[:5],
        "missing_documents": missing_docs[:5],
        "recently_updated": recently_updated,
    }


# ═══════════════════════════════════════════════════════════════
# Dismissed-recommendation score adjustment
# ═══════════════════════════════════════════════════════════════

# Maps recommendation text fragments to the component names they correspond to.
# When a rec is dismissed, we grant full points for the related component.
_REC_TO_COMPONENT: list[tuple[str, str]] = [
    # Liability
    ("upload your auto policy", "Auto liability"),
    ("upload your homeowners policy", "Property liability"),
    ("upload your renters policy", "Property liability"),
    ("umbrella liability coverage", "Umbrella coverage"),
    ("upload your business liability", "Business general liability"),
    # Property
    ("upload your homeowners", "Homeowners policy"),
    ("upload your renters", "Renters policy"),
    ("upload your auto policy to include physical", "Auto physical damage"),
    # Income
    ("disability income protection", "Disability insurance"),
    ("upload your life insurance", "Life insurance coverage"),
    # Catastrophic
    ("umbrella coverage", "Umbrella / excess liability"),
    ("flood risk", "Flood coverage"),
    # Business categories
    ("upload your general liability", "General Liability / BOP"),
    ("professional liability", "Professional Liability (E&O)"),
    ("commercial property insurance", "Commercial Property"),
    ("workers' compensation", "Workers' Compensation"),
    ("cyber liability", "Cyber Liability"),
]


def _adjust_score_for_dismissed(cat_data: dict, dismissed_keys: set[str]) -> None:
    """
    When a user dismisses a recommendation, grant full points for the
    related component so the category score reflects the acknowledgment.
    Mutates cat_data in place.
    """
    dismissed_recs = [r for r in cat_data.get("recommendations", []) if r.get("dismissed")]
    if not dismissed_recs:
        return

    # Build set of component names to boost
    boost_components: set[str] = set()
    for rec in dismissed_recs:
        text_lower = rec["text"].lower()
        for fragment, comp_name in _REC_TO_COMPONENT:
            if fragment in text_lower:
                boost_components.add(comp_name)
                break
        else:
            # No specific mapping — boost any zero-score component in this category
            for comp in cat_data.get("components", []):
                if comp["score"] == 0:
                    boost_components.add(comp["name"])
                    break

    if not boost_components:
        return

    # Grant full points for boosted components
    total_max = 0
    total_earned = 0
    for comp in cat_data.get("components", []):
        if comp["name"] in boost_components and comp["score"] < comp["max"]:
            comp["score"] = comp["max"]
            comp["detail"] = comp["detail"] + " (acknowledged)"
        total_max += comp["max"]
        total_earned += comp["score"]

    # Recalculate category score
    if total_max > 0:
        cat_data["score"] = min(100, max(0, round((total_earned / total_max) * 100)))


# ═══════════════════════════════════════════════════════════════
# Core computation
# ═══════════════════════════════════════════════════════════════

def _compute_scores(db: Session, user: User) -> dict:
    """Core scoring logic used by both GET and POST /recalculate."""
    profile = _load_user_profile(db, user.id)

    policies_orm = db.execute(
        select(Policy).where(Policy.user_id == user.id, Policy.status != "archived")
    ).scalars().all()

    policies = [
        {
            "id": p.id,
            "policy_type": (p.policy_type or "").lower(),
            "carrier": p.carrier,
            "coverage_amount": p.coverage_amount,
            "deductible": p.deductible,
            "premium_amount": p.premium_amount,
            "renewal_date": p.renewal_date,
            "status": p.status,
            "created_at": p.created_at,
        }
        for p in policies_orm
        if p.carrier != "Pending extraction..."
    ]

    all_details: dict[int, dict] = {}
    for p in policies_orm:
        rows = db.execute(
            select(PolicyDetail).where(PolicyDetail.policy_id == p.id)
        ).scalars().all()
        all_details[p.id] = {d.field_name.lower(): d.field_value for d in rows}

    weights = _calculate_dynamic_weights(profile)
    expected = _expected_policy_types(profile)
    exposure_band = _infer_exposure_band(profile)

    categories = {
        "liability": _score_liability(policies, profile, all_details),
        "property": _score_property(policies, profile, all_details),
        "income": _score_income(policies, profile, all_details),
        "catastrophic": _score_catastrophic(policies, profile, all_details),
    }

    # Load user's dismissed recommendations
    dismissed_rows = db.execute(
        select(DismissedRecommendation).where(DismissedRecommendation.user_id == user.id)
    ).scalars().all()
    dismissed_keys = {r.rec_key for r in dismissed_rows}

    for cat_name, cat_data in categories.items():
        cat_data["weight"] = weights[cat_name]
        # Add rec_key and dismissed flag to each recommendation
        for rec in cat_data.get("recommendations", []):
            rec["rec_key"] = _rec_key(cat_name, rec["text"])
            rec["dismissed"] = rec["rec_key"] in dismissed_keys
        # Adjust score: dismissed recs remove their scoring penalty
        _adjust_score_for_dismissed(cat_data, dismissed_keys)

    # Weighted overall score
    weighted_sum = sum(
        categories[c]["score"] * categories[c]["weight"] for c in categories
    )
    overall_score = round(weighted_sum / 100) if policies else 0

    confidence = _calculate_confidence(policies, expected)

    uploaded_types = set(p["policy_type"] for p in policies)
    not_visible = [t for t in expected if t not in uploaded_types]

    policy_health = _build_policy_health(policies, db, user.id)

    result = {
        "overall_score": overall_score,
        "confidence": confidence,
        "policies_analyzed": len(policies),
        "expected_policy_types": expected,
        "not_visible": not_visible,
        "exposure_band": exposure_band,
        "categories": categories,
        "policy_health": policy_health,
    }

    # ── Cache to DB ──────────────────────────────
    breakdown_json = json.dumps({
        "version": SCORE_VERSION,
        "weights": weights,
        "exposure_band": exposure_band,
        "categories": {
            c: {"score": d["score"], "weight": d["weight"]}
            for c, d in categories.items()
        },
    })
    insights_json = json.dumps({
        "confidence": confidence,
        "not_visible": not_visible,
        "expected": expected,
    })

    existing = db.execute(
        select(CoverageScore).where(
            CoverageScore.user_id == user.id,
            CoverageScore.category == "overall_v2",
        )
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if existing:
        existing.score_total = overall_score
        existing.score_breakdown = breakdown_json
        existing.insights = insights_json
        existing.last_calculated = now
    else:
        db.add(CoverageScore(
            user_id=user.id,
            category="overall_v2",
            score_total=overall_score,
            score_breakdown=breakdown_json,
            insights=insights_json,
        ))

    db.commit()
    return result


def _compute_scores_for_scope(db: Session, user: User, scope: str):
    """Compute scores for a specific scope (personal or business). Returns None if no policies."""
    profile = _load_user_profile(db, user.id)

    policies_orm = db.execute(
        select(Policy).where(
            Policy.user_id == user.id,
            Policy.status != "archived",
            Policy.scope == scope,
        )
    ).scalars().all()

    if not policies_orm:
        return None

    policies = [
        {
            "id": p.id,
            "policy_type": (p.policy_type or "").lower(),
            "carrier": p.carrier,
            "coverage_amount": p.coverage_amount,
            "deductible": p.deductible,
            "premium_amount": p.premium_amount,
            "renewal_date": p.renewal_date,
            "status": p.status,
            "created_at": p.created_at,
        }
        for p in policies_orm
        if p.carrier != "Pending extraction..."
    ]

    if not policies:
        return None

    all_details: dict[int, dict] = {}
    for p in policies_orm:
        rows = db.execute(
            select(PolicyDetail).where(PolicyDetail.policy_id == p.id)
        ).scalars().all()
        all_details[p.id] = {d.field_name.lower(): d.field_value for d in rows}

    # Load user's dismissed recommendations
    dismissed_rows = db.execute(
        select(DismissedRecommendation).where(DismissedRecommendation.user_id == user.id)
    ).scalars().all()
    dismissed_keys = {r.rec_key for r in dismissed_rows}

    if scope == "personal":
        weights = _calculate_dynamic_weights(profile)
        categories = {
            "liability": _score_liability(policies, profile, all_details),
            "property": _score_property(policies, profile, all_details),
            "income": _score_income(policies, profile, all_details),
            "catastrophic": _score_catastrophic(policies, profile, all_details),
        }
        for cat_name, cat_data in categories.items():
            cat_data["weight"] = weights[cat_name]
            for rec in cat_data.get("recommendations", []):
                rec["rec_key"] = _rec_key(cat_name, rec["text"])
                rec["dismissed"] = rec["rec_key"] in dismissed_keys
            _adjust_score_for_dismissed(cat_data, dismissed_keys)
        expected = [t for t in _expected_policy_types(profile)
                    if t not in ("general_liability",)]
    else:
        biz_weights = {"core_liability": 35, "property_fleet": 25, "workforce": 20, "specialty": 20}
        categories = {
            "core_liability": _score_biz_core_liability(policies, all_details),
            "property_fleet": _score_biz_property_fleet(policies, all_details),
            "workforce": _score_biz_workforce(policies, all_details),
            "specialty": _score_biz_specialty(policies, all_details),
        }
        for cat_name, cat_data in categories.items():
            cat_data["weight"] = biz_weights[cat_name]
            for rec in cat_data.get("recommendations", []):
                rec["rec_key"] = _rec_key(cat_name, rec["text"])
                rec["dismissed"] = rec["rec_key"] in dismissed_keys
            _adjust_score_for_dismissed(cat_data, dismissed_keys)
        expected = ["general_liability", "workers_comp", "commercial_property", "cyber"]

    weighted_sum = sum(
        categories[c]["score"] * categories[c]["weight"] for c in categories
    )
    overall_score = round(weighted_sum / 100)

    uploaded_types = set(p["policy_type"] for p in policies)
    not_visible = [t for t in expected if t not in uploaded_types]
    confidence = _calculate_confidence(policies, expected)

    # Cache to DB
    cache_category = f"{scope}_v1"
    breakdown_json = json.dumps({
        "version": SCORE_VERSION,
        "scope": scope,
        "categories": {
            c: {"score": d["score"], "weight": d["weight"]}
            for c, d in categories.items()
        },
    })

    existing = db.execute(
        select(CoverageScore).where(
            CoverageScore.user_id == user.id,
            CoverageScore.category == cache_category,
        )
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if existing:
        existing.score_total = overall_score
        existing.score_breakdown = breakdown_json
        existing.last_calculated = now
    else:
        db.add(CoverageScore(
            user_id=user.id,
            category=cache_category,
            score_total=overall_score,
            score_breakdown=breakdown_json,
        ))

    return {
        "overall_score": overall_score,
        "confidence": confidence,
        "policies_analyzed": len(policies),
        "not_visible": not_visible,
        "categories": categories,
    }


# ═══════════════════════════════════════════════════════════════
# API Routes
# ═══════════════════════════════════════════════════════════════

@router.get("")
def get_coverage_scores(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get coverage health score for the current user."""
    return _compute_scores(db, user)


@router.post("/recalculate")
def recalculate_scores(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Force recalculation of coverage scores."""
    from sqlalchemy import delete as sa_delete
    db.execute(sa_delete(CoverageScore).where(CoverageScore.user_id == user.id))
    db.commit()
    return _compute_scores(db, user)


@router.get("/by-scope")
def get_scores_by_scope(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get separate coverage scores for personal and business scopes."""
    personal = _compute_scores_for_scope(db, user, "personal")
    business = _compute_scores_for_scope(db, user, "business")
    db.commit()
    return {"personal": personal, "business": business}


@router.post("/recalculate/{scope}")
def recalculate_scope_scores(
    scope: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Force recalculation of coverage scores for a specific scope."""
    if scope not in ("personal", "business"):
        raise HTTPException(status_code=400, detail="scope must be 'personal' or 'business'")
    db.execute(sa_delete(CoverageScore).where(CoverageScore.user_id == user.id))
    db.commit()
    result = _compute_scores_for_scope(db, user, scope)
    db.commit()
    if result is None:
        return {
            "overall_score": 0, "confidence": "low", "policies_analyzed": 0,
            "not_visible": [], "categories": {},
        }
    return result


# ── Recommendation Dismiss/Restore ─────────────────────────────

def _rec_key(category: str, text: str) -> str:
    """Generate a stable key for a recommendation from its category + text."""
    raw = f"{category}:{text}".lower().strip()
    return hashlib.md5(raw.encode()).hexdigest()[:16]


class DismissRequest(BaseModel):
    rec_key: str


@router.get("/dismissed")
def list_dismissed(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all dismissed recommendation keys for the current user."""
    rows = db.execute(
        select(DismissedRecommendation).where(DismissedRecommendation.user_id == user.id)
    ).scalars().all()
    return [{"rec_key": r.rec_key, "dismissed_at": r.dismissed_at.isoformat() if r.dismissed_at else None} for r in rows]


@router.post("/dismiss")
def dismiss_recommendation(
    body: DismissRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Dismiss a recommendation so it no longer affects the score display."""
    existing = db.execute(
        select(DismissedRecommendation).where(
            DismissedRecommendation.user_id == user.id,
            DismissedRecommendation.rec_key == body.rec_key,
        )
    ).scalar_one_or_none()
    if existing:
        return {"ok": True, "already_dismissed": True}
    rec = DismissedRecommendation(user_id=user.id, rec_key=body.rec_key)
    db.add(rec)
    db.commit()
    return {"ok": True}


@router.post("/restore")
def restore_recommendation(
    body: DismissRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Restore a previously dismissed recommendation."""
    db.execute(
        sa_delete(DismissedRecommendation).where(
            DismissedRecommendation.user_id == user.id,
            DismissedRecommendation.rec_key == body.rec_key,
        )
    )
    db.commit()
    return {"ok": True}
