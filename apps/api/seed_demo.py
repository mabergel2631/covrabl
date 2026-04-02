"""Seed realistic demo data for agent dashboard demos.

Run: python -m seed_demo
From: apps/api/

Creates 5 demo clients with varied coverage statuses so the agent
dashboard shows a compelling mix of Good / Review / Gaps Detected.
"""

import sys
import os

# Ensure app package is importable
sys.path.insert(0, os.path.dirname(__file__))

from datetime import date, datetime, timedelta
from app.db import SessionLocal, engine
from app.models import User, Policy, Exposure
from app.models_profile import UserProfile
from app.models_features import CoverageScore, ComplianceCheck, LeaseRequirement
from app.models_agent import AgentClient
from app.auth import hash_password

DEMO_PASSWORD = hash_password("demo1234")

# ── Demo clients ──────────────────────────────────────────

DEMO_CLIENTS = [
    {
        "email": "sarah.westlake@demo.covrabl.com",
        "full_name": "Sarah Westlake",
        "profile": {"is_homeowner": True, "has_vehicle": True, "has_dependents": True,
                     "address_city": "Austin", "address_state": "TX"},
        "exposures": [
            {"name": "123 Oak Lane, Austin TX", "exposure_type": "dwelling"},
        ],
        "policies": [
            {"carrier": "Chubb", "policy_type": "homeowners", "scope": "personal",
             "policy_number": "CHB-2024-88431", "coverage_amount": 650000,
             "deductible": 2500, "premium_amount": 3200,
             "renewal_date": date.today() + timedelta(days=180), "status": "active"},
            {"carrier": "State Farm", "policy_type": "auto", "scope": "personal",
             "policy_number": "SF-AUTO-55219", "coverage_amount": 300000,
             "deductible": 1000, "premium_amount": 1800,
             "renewal_date": date.today() + timedelta(days=90), "status": "active"},
            {"carrier": "Northwestern Mutual", "policy_type": "life", "scope": "personal",
             "policy_number": "NWM-LIFE-10022", "coverage_amount": 1000000,
             "deductible": 0, "premium_amount": 2400,
             "renewal_date": date.today() + timedelta(days=365), "status": "active"},
        ],
        # No umbrella → gap. Score: moderate
        "score": 62,
    },
    {
        "email": "mike.johnson@demo.covrabl.com",
        "full_name": "Mike Johnson",
        "profile": {"is_homeowner": True, "has_vehicle": True,
                     "address_city": "Denver", "address_state": "CO"},
        "exposures": [
            {"name": "456 Pine St, Denver CO", "exposure_type": "dwelling"},
        ],
        "policies": [
            {"carrier": "Travelers", "policy_type": "homeowners", "scope": "personal",
             "policy_number": "TRV-HO-77234", "coverage_amount": 420000,
             "deductible": 5000, "premium_amount": 2100,
             "renewal_date": date.today() + timedelta(days=12), "status": "active"},
            {"carrier": "GEICO", "policy_type": "auto", "scope": "personal",
             "policy_number": "GEI-9923481", "coverage_amount": 250000,
             "deductible": 500, "premium_amount": 1400,
             "renewal_date": date.today() + timedelta(days=200), "status": "active"},
        ],
        # Renewal in 12 days → review. No umbrella → gap.
        "score": 48,
    },
    {
        "email": "canyon.retail@demo.covrabl.com",
        "full_name": "Canyon Retail LLC",
        "profile": {"owns_business": True,
                     "address_city": "Phoenix", "address_state": "AZ"},
        "exposures": [
            {"name": "Canyon Retail LLC", "exposure_type": "business_entity"},
        ],
        "policies": [
            {"carrier": "Hartford", "policy_type": "general_liability", "scope": "business",
             "policy_number": "HFD-GL-443210", "coverage_amount": 1000000,
             "deductible": 2500, "premium_amount": 4500,
             "renewal_date": date.today() + timedelta(days=120), "status": "active",
             "business_name": "Canyon Retail LLC"},
            {"carrier": "Hartford", "policy_type": "property", "scope": "business",
             "policy_number": "HFD-PROP-443211", "coverage_amount": 500000,
             "deductible": 5000, "premium_amount": 3200,
             "renewal_date": date.today() + timedelta(days=120), "status": "active",
             "business_name": "Canyon Retail LLC"},
            {"carrier": "Hiscox", "policy_type": "professional_liability", "scope": "business",
             "policy_number": "HIS-PL-90123", "coverage_amount": 1000000,
             "deductible": 2500, "premium_amount": 2800,
             "renewal_date": date.today() + timedelta(days=250), "status": "active",
             "business_name": "Canyon Retail LLC"},
            {"carrier": "Travelers", "policy_type": "umbrella", "scope": "business",
             "policy_number": "TRV-UMB-55001", "coverage_amount": 2000000,
             "deductible": 0, "premium_amount": 1200,
             "renewal_date": date.today() + timedelta(days=300), "status": "active",
             "business_name": "Canyon Retail LLC"},
            {"carrier": "Hartford", "policy_type": "workers_comp", "scope": "business",
             "policy_number": "HFD-WC-443212", "coverage_amount": 500000,
             "deductible": 0, "premium_amount": 6800,
             "renewal_date": date.today() + timedelta(days=120), "status": "active",
             "business_name": "Canyon Retail LLC"},
        ],
        # Well-covered business → good
        "score": 88,
    },
    {
        "email": "lisa.chen@demo.covrabl.com",
        "full_name": "Lisa Chen",
        "profile": {"is_homeowner": True, "has_vehicle": True, "has_dependents": True,
                     "address_city": "Seattle", "address_state": "WA"},
        "exposures": [
            {"name": "789 Maple Ave, Seattle WA", "exposure_type": "dwelling"},
        ],
        "policies": [
            {"carrier": "Allstate", "policy_type": "homeowners", "scope": "personal",
             "policy_number": "ALL-HO-33201", "coverage_amount": 580000,
             "deductible": 2000, "premium_amount": 2900,
             "renewal_date": date.today() - timedelta(days=15), "status": "expired"},
            {"carrier": "Progressive", "policy_type": "auto", "scope": "personal",
             "policy_number": "PRG-AUTO-67821", "coverage_amount": 300000,
             "deductible": 1000, "premium_amount": 1600,
             "renewal_date": date.today() + timedelta(days=45), "status": "active"},
        ],
        # Expired homeowners → gaps detected (high priority)
        "score": 31,
        "compliance_fail": True,
    },
    {
        "email": "david.park@demo.covrabl.com",
        "full_name": "David Park",
        "profile": {"is_homeowner": False, "is_renter": True, "has_vehicle": True,
                     "address_city": "Portland", "address_state": "OR"},
        "exposures": [],
        "policies": [
            {"carrier": "USAA", "policy_type": "renters", "scope": "personal",
             "policy_number": "USAA-RNT-44210", "coverage_amount": 50000,
             "deductible": 500, "premium_amount": 420,
             "renewal_date": date.today() + timedelta(days=150), "status": "active"},
            {"carrier": "USAA", "policy_type": "auto", "scope": "personal",
             "policy_number": "USAA-AUTO-44211", "coverage_amount": 300000,
             "deductible": 500, "premium_amount": 1100,
             "renewal_date": date.today() + timedelta(days=150), "status": "active"},
        ],
        # Simple, covered renter → good
        "score": 78,
    },
]


def seed():
    db = SessionLocal()
    try:
        # Find the admin user to create agent-client relationships
        admin = db.query(User).filter(User.role == "admin").first()
        if not admin:
            print("ERROR: No admin user found. Please create one first.")
            return

        created = 0
        skipped = 0

        for client_data in DEMO_CLIENTS:
            # Check if demo user already exists
            existing = db.query(User).filter(User.email == client_data["email"]).first()
            if existing:
                print(f"  SKIP {client_data['full_name']} — already exists")
                skipped += 1
                continue

            # Create user
            user = User(
                email=client_data["email"],
                hashed_password=DEMO_PASSWORD,
                role="individual",
                plan="free",
            )
            db.add(user)
            db.flush()

            # Create profile
            prof_data = client_data["profile"]
            profile = UserProfile(
                user_id=user.id,
                full_name=client_data["full_name"],
                **prof_data,
            )
            db.add(profile)

            # Create exposures
            exposure_map = {}
            for exp_data in client_data.get("exposures", []):
                exp = Exposure(user_id=user.id, **exp_data)
                db.add(exp)
                db.flush()
                exposure_map[exp_data["name"]] = exp.id

            # Create policies
            first_exposure_id = list(exposure_map.values())[0] if exposure_map else None
            for pol_data in client_data["policies"]:
                pol = Policy(
                    user_id=user.id,
                    exposure_id=first_exposure_id,
                    **pol_data,
                )
                db.add(pol)

            # Create coverage score
            score = CoverageScore(
                user_id=user.id,
                category="overall",
                score_total=client_data["score"],
            )
            db.add(score)

            # Create compliance failure if flagged
            if client_data.get("compliance_fail"):
                import json
                lr = LeaseRequirement(
                    user_id=user.id,
                    label="Lease at 789 Maple Ave",
                    role="tenant",
                    counterparty_name="Maple Property Mgmt",
                    property_address="789 Maple Ave, Seattle WA",
                    requirements_json=json.dumps([
                        {"name": "General Liability", "required": True, "min_amount": 1000000},
                        {"name": "Additional Insured", "required": True},
                    ]),
                    access_code=f"demo-{user.id:04d}",
                    status="active",
                )
                db.add(lr)
                db.flush()

                cc = ComplianceCheck(
                    user_id=user.id,
                    lease_requirement_id=lr.id,
                    checked_against="policies",
                    results_json=json.dumps([
                        {"name": "General Liability", "status": "fail", "reason": "No matching policy found"},
                        {"name": "Additional Insured", "status": "fail", "reason": "Cannot verify"},
                    ]),
                    pass_count=0,
                    fail_count=2,
                    unclear_count=0,
                )
                db.add(cc)

            # Create agent-client relationship (admin as agent)
            rel = AgentClient(
                agent_id=admin.id,
                client_id=user.id,
                status="active",
                invited_email=client_data["email"],
            )
            db.add(rel)

            created += 1
            print(f"  CREATED {client_data['full_name']} (score: {client_data['score']})")

        db.commit()
        print(f"\nDone: {created} created, {skipped} skipped")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print("Seeding demo data for agent dashboard...\n")
    seed()
