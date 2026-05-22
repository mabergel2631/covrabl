"""Renewal-workflow stage classification.

Renewals are a process, not a date — agents need visibility 120 days out
so they can run the workflow (review → discuss → shop → bind). This module
holds the stage definitions, default windows per policy type, and the
classifier the outreach feed uses.

Per locked positioning:
- Renewal workflow is a *feature inside* the engagement platform — not a
  new category. Stage labels are observational nouns, not imperatives.
- Defaults differ by policy type: commercial lines truly need 120 days;
  personal auto/renters/home move faster.
"""

from __future__ import annotations

from typing import TypedDict

from sqlalchemy.orm import Session


class Thresholds(TypedDict):
    upcoming_days: int   # entry into Upcoming Review (largest window)
    discussion_days: int # Client Discussion begins here
    market_days: int     # Market Active begins here
    finalization_days: int  # Finalization begins here


# Stage slugs are the canonical key — labels/colors are derived from them.
STAGE_UPCOMING = "upcoming_review"
STAGE_DISCUSSION = "client_discussion"
STAGE_MARKET = "market_active"
STAGE_FINALIZATION = "finalization"

STAGE_LABELS: dict[str, str] = {
    STAGE_UPCOMING: "Upcoming Review",
    STAGE_DISCUSSION: "Client Discussion",
    STAGE_MARKET: "Market Active",
    STAGE_FINALIZATION: "Finalization",
}

# Muted color gradient — soft red only at the very end, to avoid alert
# fatigue. These hexes mirror apps/web/src/app/renewal_constants.ts; if
# you change one, change both.
STAGE_COLORS: dict[str, str] = {
    STAGE_UPCOMING: "#a7c4a0",      # muted green
    STAGE_DISCUSSION: "#e8b86d",    # amber
    STAGE_MARKET: "#e08d52",        # orange
    STAGE_FINALIZATION: "#d97366",  # soft red (intentionally not pure red)
}

# Severity mapping for downstream consumers (search/sort already keys off
# severity ladder). Finalization is the only "high" — earlier stages are
# planning windows, not emergencies.
STAGE_SEVERITY: dict[str, str] = {
    STAGE_UPCOMING: "low",
    STAGE_DISCUSSION: "low",
    STAGE_MARKET: "medium",
    STAGE_FINALIZATION: "high",
}

# Reason copy keyed by stage. Strictly observational — no urgency theatre.
STAGE_REASON_TEMPLATES: dict[str, str] = {
    STAGE_UPCOMING: "{carrier} {policy_type} renews in {days} days — time to review",
    STAGE_DISCUSSION: "{carrier} {policy_type} renews in {days} days — open the conversation",
    STAGE_MARKET: "{carrier} {policy_type} renews in {days} days — quote / remarket window",
    STAGE_FINALIZATION: "{carrier} {policy_type} renews in {days} days — finalize and bind",
}

STAGE_SUGGESTED_ACTIONS: dict[str, str] = {
    STAGE_UPCOMING: "Review with client",
    STAGE_DISCUSSION: "Schedule renewal call",
    STAGE_MARKET: "Send quotes / discuss options",
    STAGE_FINALIZATION: "Bind renewal",
}


# Default thresholds per policy type. Commercial lines run on the wider
# 120/90/60/30 cadence; personal auto/renters/home are tighter because
# the carrier remarketing window is shorter and underwriting moves faster.
_COMMERCIAL_DEFAULT: Thresholds = {
    "upcoming_days": 120,
    "discussion_days": 90,
    "market_days": 60,
    "finalization_days": 30,
}

_PERSONAL_FAST: Thresholds = {
    "upcoming_days": 60,
    "discussion_days": 45,
    "market_days": 30,
    "finalization_days": 14,
}

_LONG_HORIZON: Thresholds = {
    # Life / umbrella — annual review with plenty of lead time.
    "upcoming_days": 120,
    "discussion_days": 90,
    "market_days": 60,
    "finalization_days": 30,
}

DEFAULT_THRESHOLDS: dict[str, Thresholds] = {
    "auto": _PERSONAL_FAST,
    "home": _PERSONAL_FAST,
    "renters": _PERSONAL_FAST,
    "condo": _PERSONAL_FAST,
    "motorcycle": _PERSONAL_FAST,
    "watercraft": _PERSONAL_FAST,
    "life": _LONG_HORIZON,
    "umbrella": _LONG_HORIZON,
    "health": _LONG_HORIZON,
    "dental": _LONG_HORIZON,
    "vision": _LONG_HORIZON,
    # Commercial / business lines all use the wider window.
    "general_liability": _COMMERCIAL_DEFAULT,
    "professional_liability": _COMMERCIAL_DEFAULT,
    "commercial_property": _COMMERCIAL_DEFAULT,
    "commercial_auto": _COMMERCIAL_DEFAULT,
    "workers_comp": _COMMERCIAL_DEFAULT,
    "cyber": _COMMERCIAL_DEFAULT,
    "directors_officers": _COMMERCIAL_DEFAULT,
    "employment_practices": _COMMERCIAL_DEFAULT,
    "business_owners": _COMMERCIAL_DEFAULT,
    "commercial_umbrella": _COMMERCIAL_DEFAULT,
}

# Anything not in DEFAULT_THRESHOLDS falls back to the commercial default
# — better to be slightly early than to miss a renewal.
FALLBACK_THRESHOLDS: Thresholds = _COMMERCIAL_DEFAULT


def _normalize_policy_type(policy_type: str | None) -> str:
    """Normalize the free-form policy_type string into the slug used as a
    threshold key. demo_seed.py uses 'Auto', 'Home', 'General Liability',
    'Commercial General Liability' — we map all of these to lowercase
    snake_case slugs.
    """
    if not policy_type:
        return ""
    s = policy_type.strip().lower()
    s = s.replace("/", " ").replace("-", " ")
    # Strip parenthetical suffixes like "Condo (HO6)" → "condo"
    if "(" in s:
        s = s.split("(", 1)[0].strip()
    # Common aliases
    aliases = {
        "commercial general liability": "general_liability",
        "general liability": "general_liability",
        "professional liability": "professional_liability",
        "errors and omissions": "professional_liability",
        "e&o": "professional_liability",
        "commercial property": "commercial_property",
        "commercial auto": "commercial_auto",
        "workers compensation": "workers_comp",
        "workers' compensation": "workers_comp",
        "workers comp": "workers_comp",
        "business owners": "business_owners",
        "bop": "business_owners",
        "directors and officers": "directors_officers",
        "d&o": "directors_officers",
        "employment practices liability": "employment_practices",
        "epl": "employment_practices",
        "commercial umbrella": "commercial_umbrella",
    }
    if s in aliases:
        return aliases[s]
    return s.replace(" ", "_")


def resolve_thresholds(
    db: Session | None,
    agency_id: int | None,
    policy_type: str | None,
) -> Thresholds:
    """Resolve effective thresholds for a (agency, policy_type) pair.

    Agency-level overrides (in agency_renewal_thresholds) win; otherwise
    fall back to the type default; otherwise the commercial fallback.

    `db` and `agency_id` may be None — in that case skip the DB lookup
    and return the type default directly. Callers in pure code paths
    (tests, batch jobs) can use this without a session.
    """
    slug = _normalize_policy_type(policy_type)
    default = DEFAULT_THRESHOLDS.get(slug, FALLBACK_THRESHOLDS)

    if db is None or agency_id is None:
        return default

    # Lazy import to avoid circular dependency at module load.
    from .models_agency_settings import AgencyRenewalThreshold
    from sqlalchemy import select

    row = db.execute(
        select(AgencyRenewalThreshold).where(
            AgencyRenewalThreshold.agency_id == agency_id,
            AgencyRenewalThreshold.policy_type == slug,
        )
    ).scalar_one_or_none()

    if row is None:
        return default

    return {
        "upcoming_days": row.upcoming_days,
        "discussion_days": row.discussion_days,
        "market_days": row.market_days,
        "finalization_days": row.finalization_days,
    }


def classify_stage(days_until: int, thresholds: Thresholds) -> str | None:
    """Map a renewal that's `days_until` days out to its stage slug.

    Returns None if the renewal is outside the watched window (more than
    `upcoming_days` away or already past).
    """
    if days_until < 0:
        return None  # already past — outreach feed handles this elsewhere
    if days_until <= thresholds["finalization_days"]:
        return STAGE_FINALIZATION
    if days_until <= thresholds["market_days"]:
        return STAGE_MARKET
    if days_until <= thresholds["discussion_days"]:
        return STAGE_DISCUSSION
    if days_until <= thresholds["upcoming_days"]:
        return STAGE_UPCOMING
    return None  # outside the window — not surfaced yet
