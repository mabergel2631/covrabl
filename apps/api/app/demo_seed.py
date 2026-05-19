"""One-shot demo seed for the public-facing demo account.

Creates `demo@covrabl.com` (password: Covrabl) as an agent user, populates the
agent's own personal/business policies, and seeds 10 client users + their
policies. For every policy, a realistic-looking PDF declaration page is
generated with reportlab and written directly to R2 (or local disk if R2 isn't
configured), then registered as a Document row.

The endpoint is idempotent: if the demo agent already exists, it returns
{status: "already_seeded"} and skips. To re-seed cleanly, delete the
demo@covrabl.com user from the admin panel and re-call.
"""
from __future__ import annotations

import io
import logging
import uuid
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import hash_password
from .db import get_db
from .models import User, Policy, Exposure, Contact
from .models_documents import Document
from .models_agent import AgentClient
from .models_agency import Agency, AgencyMember
from .storage import _get_r2, UPLOAD_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/seed-demo", tags=["admin-seed"])

DEMO_AGENT_EMAIL = "demo@covrabl.com"
DEMO_AGENT_PASSWORD = "Covrabl"


# ── PDF generation ─────────────────────────────────────


def _generate_policy_pdf(
    *,
    carrier: str,
    policy_type: str,
    policy_number: str,
    named_insured: str,
    address: str,
    effective: date,
    expiration: date,
    premium: int,
    coverages: list[tuple[str, str]],
    deductible: Optional[int] = None,
    notes: Optional[str] = None,
) -> bytes:
    """Render a declarations-style policy PDF. Returns the bytes."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.6 * inch, bottomMargin=0.6 * inch,
        title=f"{carrier} {policy_type} Declarations",
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Title"], fontSize=18, textColor=HexColor("#0f172a"), spaceAfter=2)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=11, textColor=HexColor("#475569"), spaceAfter=8)
    label = ParagraphStyle("Label", parent=styles["Normal"], fontSize=8, textColor=HexColor("#64748b"))
    value = ParagraphStyle("Value", parent=styles["Normal"], fontSize=10.5, textColor=HexColor("#0f172a"))
    small = ParagraphStyle("Small", parent=styles["Normal"], fontSize=8, textColor=HexColor("#64748b"))

    story: list = []

    # ── Carrier letterhead ─────────────────────────────
    story.append(Paragraph(f"<b>{carrier}</b>", h1))
    story.append(Paragraph(f"{policy_type.upper()} POLICY — DECLARATIONS PAGE", h2))
    story.append(Spacer(1, 6))

    # Horizontal rule
    story.append(Table(
        [[""]], colWidths=[6.9 * inch], rowHeights=[1],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), HexColor("#0f172a"))]),
    ))
    story.append(Spacer(1, 12))

    # ── Top header: insured + policy info ─────────────
    insured_block = [
        [Paragraph("NAMED INSURED", label)],
        [Paragraph(f"<b>{named_insured}</b>", value)],
        [Paragraph(address.replace("\n", "<br/>"), small)],
    ]
    policy_block = [
        [Paragraph("POLICY NUMBER", label)],
        [Paragraph(f"<b>{policy_number}</b>", value)],
        [Spacer(1, 4)],
        [Paragraph("POLICY PERIOD", label)],
        [Paragraph(
            f"{effective.strftime('%b %d, %Y')} &nbsp;to&nbsp; {expiration.strftime('%b %d, %Y')}",
            value,
        )],
        [Paragraph("12:01 AM standard time at the address shown", small)],
    ]
    header_table = Table(
        [[Table(insured_block), Table(policy_block)]],
        colWidths=[3.6 * inch, 3.3 * inch],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 18))

    # ── Coverages table ───────────────────────────────
    story.append(Paragraph("<b>COVERAGES AND LIMITS</b>", h2))
    rows = [["Coverage", "Limit / Amount"]]
    for lbl, amt in coverages:
        rows.append([lbl, amt])
    if deductible is not None:
        rows.append(["Deductible", f"${deductible:,}"])
    rows.append(["Total Annual Premium", f"${premium:,}"])

    cov_table = Table(rows, colWidths=[3.6 * inch, 3.3 * inch])
    cov_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#0f172a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("LINEBELOW", (0, 1), (-1, -2), 0.5, HexColor("#e2e8f0")),
        ("BACKGROUND", (0, -1), (-1, -1), HexColor("#f0f9ff")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("LINEABOVE", (0, -1), (-1, -1), 1, HexColor("#0f172a")),
    ]))
    story.append(cov_table)
    story.append(Spacer(1, 16))

    # ── Notes ─────────────────────────────────────────
    if notes:
        story.append(Paragraph("<b>ENDORSEMENTS / NOTES</b>", h2))
        story.append(Paragraph(notes, value))
        story.append(Spacer(1, 14))

    # ── Footer ────────────────────────────────────────
    story.append(Spacer(1, 24))
    story.append(Table(
        [[""]], colWidths=[6.9 * inch], rowHeights=[1],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), HexColor("#cbd5e1"))]),
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "This declarations page is part of your policy and replaces any prior declarations of "
        "the same number. Coverages are subject to all terms, conditions, exclusions, and "
        "endorsements of the policy. Please review carefully and contact your agent with any "
        "questions.",
        small,
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"<i>Demo declarations page generated for Covrabl &middot; {carrier} is a fictional "
        f"carrier used for demonstration only.</i>",
        small,
    ))

    doc.build(story)
    return buf.getvalue()


def _put_pdf(pdf_bytes: bytes, object_key: str) -> None:
    """Upload PDF bytes to R2 (or local disk fallback)."""
    r2 = _get_r2()
    if r2 is not None:
        client, bucket = r2
        client.put_object(
            Bucket=bucket, Key=object_key, Body=pdf_bytes,
            ContentType="application/pdf",
        )
        return
    # Local fallback
    target = UPLOAD_DIR / object_key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(pdf_bytes)


# ── Seed data ──────────────────────────────────────────


def _today_offset(days: int) -> date:
    return date.today() + timedelta(days=days)


# Per-policy demo contacts. Keyed by policy_number so the seed stays in sync
# with PERSONAL_POLICIES below without duplicating identifiers. Phones are
# kept obviously-fake (555 area code) to avoid any chance a demo user dials
# a real carrier line. The SOS card and ID Card both surface these in
# emergency-priority order (claims → broker → agent → customer_service).
DEMO_PERSONAL_CONTACTS: dict[str, list[dict]] = {
    "GEI-1029-A0042": [  # Auto / Geico
        dict(role="claims", phone="800-555-0142", name=None),
        dict(role="broker", phone="415-555-0101", name="Avery Chen"),
        dict(role="agent", phone="415-555-0188", name="Demo Agent (Covrabl)"),
    ],
    "SF-HO3-77821": [  # Home / State Farm
        dict(role="claims", phone="800-555-7828", name=None),
        dict(role="broker", phone="415-555-0101", name="Avery Chen"),
    ],
}


PERSONAL_POLICIES = [
    dict(
        policy_type="Auto",
        carrier="Geico",
        policy_number="GEI-1029-A0042",
        coverage_amount=300000,
        deductible=500,
        premium_amount=2150,
        offset_days=120,
        coverages=[
            ("Bodily Injury Liability — Per Person", "$300,000"),
            ("Bodily Injury Liability — Per Occurrence", "$500,000"),
            ("Property Damage Liability", "$100,000"),
            ("Uninsured Motorist — Per Person", "$300,000"),
            ("Medical Payments", "$5,000"),
            ("Comprehensive Deductible", "$500"),
            ("Collision Deductible", "$500"),
        ],
        notes="Roadside Assistance &middot; Rental Reimbursement &middot; Glass Coverage Waiver",
    ),
    dict(
        policy_type="Home",
        carrier="State Farm",
        policy_number="SF-HO3-77821",
        coverage_amount=850000,
        deductible=2500,
        premium_amount=3400,
        offset_days=210,
        coverages=[
            ("Dwelling (Coverage A)", "$850,000"),
            ("Other Structures (Coverage B)", "$85,000"),
            ("Personal Property (Coverage C)", "$425,000"),
            ("Loss of Use (Coverage D)", "$170,000"),
            ("Personal Liability (Coverage E)", "$500,000"),
            ("Medical Payments (Coverage F)", "$5,000"),
            ("Wind/Hail Deductible", "1%"),
        ],
        notes="Replacement Cost on Dwelling &middot; Scheduled Personal Property: Jewelry $25,000",
    ),
    dict(
        policy_type="Life",
        carrier="Northwestern Mutual",
        policy_number="NM-TERM-204881",
        coverage_amount=1000000,
        deductible=None,
        premium_amount=620,
        offset_days=320,
        coverages=[
            ("Death Benefit", "$1,000,000"),
            ("Policy Type", "20-Year Level Term"),
            ("Insured Age at Issue", "42"),
            ("Risk Class", "Preferred Plus Non-Tobacco"),
            ("Beneficiary", "Per beneficiary designation on file"),
        ],
        notes="Convertible to permanent insurance up to age 65 without evidence of insurability.",
    ),
    dict(
        policy_type="Umbrella",
        carrier="Chubb",
        policy_number="CHB-PUL-99102",
        coverage_amount=3000000,
        deductible=None,
        premium_amount=850,
        offset_days=210,
        coverages=[
            ("Personal Umbrella Limit", "$3,000,000"),
            ("Underlying Auto BI/PD Required", "$300,000 / $500,000 / $100,000"),
            ("Underlying Homeowners Liability Required", "$500,000"),
            ("Uninsured/Underinsured Motorist", "$1,000,000"),
            ("Self-Insured Retention", "$0"),
        ],
        notes="Worldwide coverage. Excludes business pursuits and intentional acts.",
    ),
    dict(
        policy_type="Renters",
        carrier="Lemonade",
        policy_number="LEM-RT-456001",
        coverage_amount=50000,
        deductible=500,
        premium_amount=180,
        offset_days=60,
        coverages=[
            ("Personal Property", "$50,000"),
            ("Personal Liability", "$300,000"),
            ("Loss of Use", "$15,000"),
            ("Medical Payments to Others", "$1,000"),
        ],
        notes="Secondary residence policy &middot; Replacement cost on personal property.",
    ),
]


BUSINESS_ENTITIES = [
    dict(
        name="Covrabl Demo Restaurants Inc.",
        address="241 Market Street\nSan Francisco, CA 94105",
        policies=[
            dict(
                policy_type="Commercial General Liability",
                carrier="The Hartford",
                policy_number="HART-CGL-552201",
                coverage_amount=2000000,
                deductible=2500,
                premium_amount=8800,
                offset_days=150,
                coverages=[
                    ("Each Occurrence", "$1,000,000"),
                    ("General Aggregate", "$2,000,000"),
                    ("Products/Completed Operations Aggregate", "$2,000,000"),
                    ("Personal & Advertising Injury", "$1,000,000"),
                    ("Damage to Rented Premises", "$300,000"),
                    ("Medical Expense (any one person)", "$10,000"),
                ],
                notes="Liquor Liability endorsement included &middot; Hired & Non-Owned Auto $1M",
            ),
            dict(
                policy_type="Workers Compensation",
                carrier="Travelers",
                policy_number="TRV-WC-810044",
                coverage_amount=1000000,
                deductible=None,
                premium_amount=14200,
                offset_days=150,
                coverages=[
                    ("Workers Compensation", "Statutory"),
                    ("Employers Liability — Bodily Injury by Accident, each accident", "$1,000,000"),
                    ("Employers Liability — Bodily Injury by Disease, policy limit", "$1,000,000"),
                    ("Employers Liability — Bodily Injury by Disease, each employee", "$1,000,000"),
                    ("Estimated Annual Payroll", "$985,000"),
                    ("Experience Modification Factor", "0.92"),
                ],
                notes="Class codes: 9082 Restaurant NOC &middot; 8810 Clerical",
            ),
            dict(
                policy_type="Commercial Auto",
                carrier="Progressive Commercial",
                policy_number="PGR-COMM-330771",
                coverage_amount=1000000,
                deductible=1000,
                premium_amount=4600,
                offset_days=150,
                coverages=[
                    ("Combined Single Limit Liability", "$1,000,000"),
                    ("Uninsured/Underinsured Motorist", "$1,000,000"),
                    ("Medical Payments", "$5,000"),
                    ("Comprehensive Deductible", "$1,000"),
                    ("Collision Deductible", "$1,000"),
                    ("Hired Auto / Non-Owned Auto", "$1,000,000"),
                ],
                notes="2 scheduled vehicles: 2022 Ford Transit, 2021 Toyota Sienna",
            ),
        ],
    ),
    dict(
        name="Covrabl Demo Properties LLC",
        address="1450 Embarcadero\nOakland, CA 94606",
        policies=[
            dict(
                policy_type="Commercial Property",
                carrier="Travelers",
                policy_number="TRV-CP-220801",
                coverage_amount=4500000,
                deductible=10000,
                premium_amount=18400,
                offset_days=280,
                coverages=[
                    ("Building (Coverage A)", "$4,500,000"),
                    ("Business Personal Property", "$450,000"),
                    ("Business Income (12 months)", "$650,000"),
                    ("Equipment Breakdown", "$1,000,000"),
                    ("Wind/Hail Deductible", "1%"),
                    ("All Other Perils Deductible", "$10,000"),
                ],
                notes="Replacement cost valuation &middot; Ordinance or Law coverage $500K",
            ),
            dict(
                policy_type="Commercial General Liability",
                carrier="Liberty Mutual",
                policy_number="LM-CGL-991204",
                coverage_amount=2000000,
                deductible=5000,
                premium_amount=6200,
                offset_days=280,
                coverages=[
                    ("Each Occurrence", "$1,000,000"),
                    ("General Aggregate", "$2,000,000"),
                    ("Products/Completed Operations Aggregate", "$2,000,000"),
                    ("Damage to Rented Premises", "$500,000"),
                ],
                notes="Additional insured endorsement: Tenants and mortgagees as scheduled",
            ),
        ],
    ),
    dict(
        name="Covrabl Demo Consulting LLC",
        address="500 Howard Street, Suite 400\nSan Francisco, CA 94105",
        policies=[
            dict(
                policy_type="Professional Liability",
                carrier="Hiscox",
                policy_number="HIS-E&O-447733",
                coverage_amount=2000000,
                deductible=5000,
                premium_amount=3800,
                offset_days=95,
                coverages=[
                    ("Each Claim Limit", "$2,000,000"),
                    ("Aggregate Limit", "$2,000,000"),
                    ("Retroactive Date", "01/01/2022"),
                    ("Defense Costs", "Inside the limit"),
                ],
                notes="Tail coverage available at policy expiration &middot; Worldwide territory",
            ),
            dict(
                policy_type="Cyber Liability",
                carrier="Beazley",
                policy_number="BZL-CYB-661199",
                coverage_amount=1000000,
                deductible=10000,
                premium_amount=2400,
                offset_days=95,
                coverages=[
                    ("Aggregate Limit", "$1,000,000"),
                    ("Breach Response Sublimit", "$1,000,000"),
                    ("Business Interruption Sublimit", "$500,000"),
                    ("Cyber Extortion Sublimit", "$500,000"),
                    ("Regulatory Defense & Penalties", "$500,000"),
                ],
                notes="24/7 breach hotline included &middot; Pre-approved forensics panel",
            ),
        ],
    ),
]


CLIENTS = [
    dict(
        first="Sarah", last="Westlake", email="sarah.westlake@demo.dev",
        address="32 Magnolia Drive\nMill Valley, CA 94941",
        policies=[
            ("Auto", "Allstate", "ALL-AU-220011", 250000, 1000, 1980, 145),
            ("Home", "Allstate", "ALL-HO-220012", 720000, 2500, 2900, 145),
            ("Umbrella", "Allstate", "ALL-PUL-220013", 2000000, None, 480, 145),
        ],
    ),
    dict(
        first="Michael", last="Chen", email="michael.chen@demo.dev",
        address="1845 Vine Street\nBerkeley, CA 94703",
        policies=[
            ("Auto", "Progressive", "PRG-AU-501122", 100000, 500, 1620, 60),
            ("Renters", "Progressive", "PRG-RT-501123", 35000, 500, 220, 60),
        ],
    ),
    dict(
        first="Elena", last="Rodriguez", email="elena.rodriguez@demo.dev",
        address="2210 Sutter Street\nSan Francisco, CA 94115",
        policies=[
            ("Auto", "USAA", "USAA-AU-310445", 500000, 250, 2400, 200),
            ("Home", "USAA", "USAA-HO-310446", 1250000, 5000, 5200, 200),
            ("Umbrella", "USAA", "USAA-PUL-310447", 5000000, None, 1100, 200),
            ("Life", "USAA Life", "USAA-LIFE-31044", 2000000, None, 1450, 365),
        ],
    ),
    dict(
        first="James", last="O'Brien", email="james.obrien@demo.dev",
        address="84 Buena Vista Drive\nSausalito, CA 94965",
        policies=[
            ("Auto", "Liberty Mutual", "LM-AU-998771", 300000, 1000, 2200, 35),
            ("Home", "Liberty Mutual", "LM-HO-998772", 1850000, 5000, 7400, 35),
        ],
    ),
    dict(
        first="Priya", last="Patel", email="priya.patel@demo.dev",
        address="1701 Filbert Street\nSan Francisco, CA 94123",
        policies=[
            ("Condo (HO6)", "Travelers", "TRV-HO6-225001", 180000, 1000, 720, 92),
            ("Auto", "Travelers", "TRV-AU-225002", 250000, 500, 1850, 92),
        ],
    ),
    dict(
        first="Robert", last="Thompson", email="robert.thompson@demo.dev",
        address="450 Spring Valley Road\nKentfield, CA 94904",
        policies=[
            ("Auto", "Chubb", "CHB-MAS-770201", 500000, 500, 3100, 175),
            ("Home", "Chubb", "CHB-MAS-770202", 2800000, 10000, 12400, 175),
            ("Umbrella", "Chubb", "CHB-MAS-770203", 10000000, None, 2900, 175),
            ("Watercraft", "Chubb", "CHB-WAT-770204", 250000, 1000, 1850, 175),
            # Second Auto so the Quote Comparison picker has a candidate.
            ("Auto", "Mercury", "MER-AU-770205", 500000, 500, 2950, 175),
        ],
    ),
    dict(
        first="Anna", last="Kowalski", email="anna.kowalski@demo.dev",
        address="2900 Pacific Avenue\nSan Francisco, CA 94115",
        policies=[
            ("Auto", "Geico", "GEI-AU-115501", 100000, 500, 1320, 50),
            ("Renters", "Lemonade", "LEM-RT-115502", 45000, 500, 195, 70),
            ("Life", "Haven Life", "HVN-TERM-115503", 750000, None, 380, 200),
        ],
    ),
    dict(
        first="David", last="Nakamura", email="david.nakamura@demo.dev",
        address="180 Locust Avenue\nBurlingame, CA 94010",
        policies=[
            ("Auto", "State Farm", "SF-AU-650088", 250000, 500, 1980, 110),
            ("Home", "State Farm", "SF-HO-650089", 1450000, 2500, 4900, 110),
            ("Motorcycle", "Progressive", "PRG-MC-650090", 50000, 500, 720, 60),
        ],
    ),
    dict(
        first="Linda", last="Goldberg", email="linda.goldberg@demo.dev",
        address="221 California Street, Unit 17B\nSan Francisco, CA 94111",
        policies=[
            ("Condo (HO6)", "AIG", "AIG-HO6-808811", 350000, 1000, 1450, 230),
            ("Auto", "AIG", "AIG-AU-808812", 250000, 1000, 1620, 230),
            ("Umbrella", "AIG", "AIG-PUL-808813", 3000000, None, 720, 230),
        ],
    ),
    dict(
        first="Marcus", last="Williams", email="marcus.williams@demo.dev",
        address="76 Marlin Cove\nRedwood Shores, CA 94065",
        policies=[
            ("Auto", "Nationwide", "NW-AU-440099", 300000, 500, 2150, 80),
            ("Home", "Nationwide", "NW-HO-440100", 1100000, 2500, 3800, 80),
            ("Life", "Northwestern Mutual", "NM-TERM-44010", 1500000, None, 920, 365),
        ],
    ),
]


# ── Endpoint ───────────────────────────────────────────


def _do_seed(db: Session) -> dict:
    # Idempotency: bail early if demo user exists
    existing = db.execute(
        select(User).where(User.email == DEMO_AGENT_EMAIL)
    ).scalar_one_or_none()
    if existing:
        return {
            "status": "already_seeded",
            "email": DEMO_AGENT_EMAIL,
            "user_id": existing.id,
            "note": "Demo account already exists. Delete the user via /admin to re-seed.",
        }

    # ── Demo agent user ───────────────────────────
    agent = User(
        email=DEMO_AGENT_EMAIL,
        hashed_password=hash_password(DEMO_AGENT_PASSWORD),
        role="agent",
        plan="business",
    )
    db.add(agent)
    db.flush()
    agent_id = agent.id

    # Agency-of-One for this demo agent (mirrors what main.py self-heal does on startup)
    agency = Agency(name="Covrabl Demo Agency", slug=f"demo-agency-{agent_id}")
    db.add(agency)
    db.flush()
    db.add(AgencyMember(
        agency_id=agency.id, user_id=agent_id,
        role="owner", status="active",
    ))
    db.flush()
    agency_id = agency.id

    agent_email_local = agent.email.split("@", 1)[0]
    agent_display = "Demo Agent (Covrabl)"

    counts = {"personal": 0, "business": 0, "clients": 0, "client_policies": 0, "pdfs": 0}

    # ── Personal policies on the demo agent ───────
    for pol in PERSONAL_POLICIES:
        eff = _today_offset(pol["offset_days"] - 365)
        exp = _today_offset(pol["offset_days"])
        p = Policy(
            user_id=agent_id,
            scope="personal",
            policy_type=pol["policy_type"],
            carrier=pol["carrier"],
            policy_number=pol["policy_number"],
            coverage_amount=pol["coverage_amount"],
            deductible=pol["deductible"],
            premium_amount=pol["premium_amount"],
            renewal_date=exp,
            status="active",
        )
        db.add(p)
        db.flush()
        pdf_bytes = _generate_policy_pdf(
            carrier=pol["carrier"], policy_type=pol["policy_type"],
            policy_number=pol["policy_number"],
            named_insured=agent_display,
            address="100 Demo Way\nSan Francisco, CA 94105",
            effective=eff, expiration=exp,
            premium=pol["premium_amount"],
            coverages=pol["coverages"],
            deductible=pol["deductible"],
            notes=pol.get("notes"),
        )
        filename = f"test_{pol['policy_type'].lower().replace(' ', '_')}_dec.pdf"
        object_key = f"policies/personal/{p.id}/{uuid.uuid4()}-{filename}"
        _put_pdf(pdf_bytes, object_key)
        db.add(Document(
            policy_id=p.id, filename=filename, content_type="application/pdf",
            object_key=object_key, doc_type="policy",
            uploaded_by_user_id=agent_id,
        ))

        # Demo contacts (broker / claims / agent) so the SOS card and ID
        # Card actually have something to render. Without these the new
        # "Who to contact" block stays hidden on the demo, defeating its
        # purpose as a showcase.
        for c in DEMO_PERSONAL_CONTACTS.get(pol["policy_number"], []):
            db.add(Contact(
                policy_id=p.id,
                role=c["role"],
                name=c.get("name"),
                phone=c.get("phone"),
            ))

        counts["personal"] += 1
        counts["pdfs"] += 1

    # ── Business entities + their policies on the demo agent ───────
    for biz in BUSINESS_ENTITIES:
        exp_row = Exposure(
            user_id=agent_id,
            name=biz["name"],
            exposure_type="business_entity",
            description=f"Demo business entity at {biz['address'].splitlines()[0]}",
        )
        db.add(exp_row)
        db.flush()
        for pol in biz["policies"]:
            eff = _today_offset(pol["offset_days"] - 365)
            exp_date = _today_offset(pol["offset_days"])
            p = Policy(
                user_id=agent_id,
                scope="business",
                policy_type=pol["policy_type"],
                carrier=pol["carrier"],
                policy_number=pol["policy_number"],
                business_name=biz["name"],
                exposure_id=exp_row.id,
                coverage_amount=pol["coverage_amount"],
                deductible=pol["deductible"],
                premium_amount=pol["premium_amount"],
                renewal_date=exp_date,
                status="active",
            )
            db.add(p)
            db.flush()
            pdf_bytes = _generate_policy_pdf(
                carrier=pol["carrier"], policy_type=pol["policy_type"],
                policy_number=pol["policy_number"],
                named_insured=biz["name"],
                address=biz["address"],
                effective=eff, expiration=exp_date,
                premium=pol["premium_amount"],
                coverages=pol["coverages"],
                deductible=pol["deductible"],
                notes=pol.get("notes"),
            )
            slug = pol["policy_type"].lower().replace(" ", "_").replace("/", "_")
            filename = f"test_{slug}_dec.pdf"
            object_key = f"policies/business/{p.id}/{uuid.uuid4()}-{filename}"
            _put_pdf(pdf_bytes, object_key)
            db.add(Document(
                policy_id=p.id, filename=filename, content_type="application/pdf",
                object_key=object_key, doc_type="policy",
                uploaded_by_user_id=agent_id,
            ))
            counts["business"] += 1
            counts["pdfs"] += 1

    # ── 10 client users + their policies ───────
    for c in CLIENTS:
        # Create or get the client user
        existing_client = db.execute(
            select(User).where(User.email == c["email"].lower())
        ).scalar_one_or_none()
        if existing_client:
            client_user = existing_client
        else:
            client_user = User(
                email=c["email"].lower(),
                hashed_password=hash_password("Covrabl"),  # easy demo password
                role="individual",
                plan="free",
            )
            db.add(client_user)
            db.flush()

        # Active agent-client relationship (Covrabl Demo Agency)
        existing_rel = db.execute(
            select(AgentClient).where(
                AgentClient.agency_id == agency_id,
                AgentClient.client_id == client_user.id,
            )
        ).scalar_one_or_none()
        if not existing_rel:
            db.add(AgentClient(
                agent_id=agent_id, client_id=client_user.id,
                agency_id=agency_id, status="active",
                invited_email=c["email"].lower(),
            ))

        # Save profile name so the agent dashboard shows the client's name
        from .models_profile import UserProfile
        existing_profile = db.execute(
            select(UserProfile).where(UserProfile.user_id == client_user.id)
        ).scalar_one_or_none()
        if not existing_profile:
            db.add(UserProfile(
                user_id=client_user.id,
                full_name=f"{c['first']} {c['last']}",
            ))

        # Create the client's policies + PDFs
        for (ptype, carrier, pnum, coverage, deductible, premium, offset_days) in c["policies"]:
            eff = _today_offset(offset_days - 365)
            exp_date = _today_offset(offset_days)
            p = Policy(
                user_id=client_user.id,
                scope="personal",
                policy_type=ptype,
                carrier=carrier,
                policy_number=pnum,
                coverage_amount=coverage,
                deductible=deductible,
                premium_amount=premium,
                renewal_date=exp_date,
                status="active",
            )
            db.add(p)
            db.flush()
            # Simple coverages list keyed off the policy type
            coverages = _simple_coverages_for(ptype, coverage, deductible)
            pdf_bytes = _generate_policy_pdf(
                carrier=carrier, policy_type=ptype,
                policy_number=pnum,
                named_insured=f"{c['first']} {c['last']}",
                address=c["address"],
                effective=eff, expiration=exp_date,
                premium=premium,
                coverages=coverages,
                deductible=deductible,
            )
            slug = ptype.lower().replace(" ", "_").replace("/", "_").replace("(", "").replace(")", "")
            filename = f"test_{slug}_dec.pdf"
            object_key = f"policies/personal/{p.id}/{uuid.uuid4()}-{filename}"
            _put_pdf(pdf_bytes, object_key)
            db.add(Document(
                policy_id=p.id, filename=filename, content_type="application/pdf",
                object_key=object_key, doc_type="policy",
                uploaded_by_user_id=agent_id,
            ))
            counts["client_policies"] += 1
            counts["pdfs"] += 1
        counts["clients"] += 1

    db.commit()

    return {
        "status": "seeded",
        "email": DEMO_AGENT_EMAIL,
        "password_hint": "Covrabl",
        "agent_id": agent_id,
        "agency_id": agency_id,
        "counts": counts,
    }


def _simple_coverages_for(policy_type: str, coverage: Optional[int], deductible: Optional[int]) -> list[tuple[str, str]]:
    """Reasonable default coverage rows for a client policy based on type."""
    cov = f"${coverage:,}" if coverage else "Per policy"
    pt = policy_type.lower()
    if "auto" in pt:
        return [
            ("Bodily Injury Liability — Per Person", cov),
            ("Bodily Injury Liability — Per Occurrence", f"${(coverage or 0) * 2:,}" if coverage else "—"),
            ("Property Damage Liability", "$100,000"),
            ("Uninsured Motorist", cov),
            ("Medical Payments", "$5,000"),
            ("Comprehensive Deductible", f"${deductible:,}") if deductible else ("Comprehensive Deductible", "—"),
            ("Collision Deductible", f"${deductible:,}") if deductible else ("Collision Deductible", "—"),
        ]
    if "home" in pt or "dwell" in pt:
        return [
            ("Dwelling (Coverage A)", cov),
            ("Other Structures (Coverage B)", f"${int((coverage or 0) * 0.1):,}"),
            ("Personal Property (Coverage C)", f"${int((coverage or 0) * 0.5):,}"),
            ("Loss of Use (Coverage D)", f"${int((coverage or 0) * 0.2):,}"),
            ("Personal Liability (Coverage E)", "$500,000"),
            ("Medical Payments (Coverage F)", "$5,000"),
        ]
    if "condo" in pt:
        return [
            ("Building Property (Coverage A)", cov),
            ("Personal Property (Coverage C)", f"${int((coverage or 0) * 0.4):,}"),
            ("Loss of Use (Coverage D)", f"${int((coverage or 0) * 0.2):,}"),
            ("Personal Liability", "$300,000"),
            ("Loss Assessment", "$50,000"),
        ]
    if "renter" in pt:
        return [
            ("Personal Property", cov),
            ("Personal Liability", "$300,000"),
            ("Loss of Use", f"${int((coverage or 0) * 0.3):,}"),
            ("Medical Payments to Others", "$1,000"),
        ]
    if "umbrella" in pt:
        return [
            ("Personal Umbrella Limit", cov),
            ("Underlying Auto BI/PD Required", "$300,000 / $500,000 / $100,000"),
            ("Underlying Homeowners Liability Required", "$500,000"),
            ("Self-Insured Retention", "$0"),
        ]
    if "life" in pt:
        return [
            ("Death Benefit", cov),
            ("Policy Type", "20-Year Level Term"),
            ("Beneficiary", "Per beneficiary designation on file"),
        ]
    if "motorcycle" in pt:
        return [
            ("Bodily Injury Liability", cov),
            ("Property Damage Liability", "$50,000"),
            ("Comprehensive Deductible", f"${deductible:,}" if deductible else "—"),
            ("Collision Deductible", f"${deductible:,}" if deductible else "—"),
        ]
    if "water" in pt or "boat" in pt:
        return [
            ("Hull Coverage", cov),
            ("Liability", "$500,000"),
            ("Medical Payments", "$5,000"),
            ("Uninsured Boater", "$300,000"),
        ]
    # Fallback
    return [
        ("Coverage Limit", cov),
        ("Deductible", f"${deductible:,}" if deductible else "—"),
    ]


def _wipe_demo(db: Session) -> int:
    """Remove every row tied to the demo account. Used by reset=true. Returns
    a deletion count. Order matters: child rows first, then parents.

    Touches ONLY the demo agent (demo@covrabl.com) and the seeded client users
    (emails ending in @demo.dev or @demo.test legacy). Real user data is not
    touched.
    """
    from sqlalchemy import or_, delete as sa_delete
    from .models_documents import Document
    from .models_features import (
        PolicyShare, PolicyDelta, RenewalReview, QuoteComparison,
        DismissedRecommendation, AuditLog, UserEvent, CoverageScore,
        ComplianceCheck, LeaseRequirement, EmergencyCard, PremiumHistory,
        DeltaExplanation, RenewalReminder, InboundAddress, InboundEmail,
        PolicyDraft, Certificate, CertificateReminder,
    )
    from .models_features import Premium, Claim
    from .models_agent import AgentNote, AgentPolicyAccess

    demo_agent = db.execute(
        select(User).where(User.email == DEMO_AGENT_EMAIL)
    ).scalar_one_or_none()
    if not demo_agent:
        return 0

    # Find all demo users (agent + clients)
    demo_users = db.execute(
        select(User).where(or_(
            User.email == DEMO_AGENT_EMAIL,
            User.email.like("%@demo.dev"),
            User.email.like("%@demo.test"),  # legacy from first seed
        ))
    ).scalars().all()
    demo_user_ids = [u.id for u in demo_users]

    # Find all policies owned by demo users
    demo_policies = db.execute(
        select(Policy).where(Policy.user_id.in_(demo_user_ids))
    ).scalars().all()
    demo_policy_ids = [p.id for p in demo_policies]

    deleted = 0

    if demo_policy_ids:
        # Child rows referencing policies — delete in dependency order
        for table_cls in [
            Premium, Claim, RenewalReminder, PolicyDelta, RenewalReview,
            QuoteComparison, Document, PolicyShare, PremiumHistory,
            AgentPolicyAccess,
        ]:
            try:
                col = (
                    table_cls.policy_id if hasattr(table_cls, "policy_id")
                    else getattr(table_cls, "incumbent_policy_id", None)
                )
                if col is not None:
                    n = db.execute(
                        sa_delete(table_cls).where(col.in_(demo_policy_ids))
                    ).rowcount or 0
                    deleted += n
            except Exception as e:
                logger.warning("wipe: could not delete from %s: %s", table_cls.__tablename__, e)

        # DeltaExplanation FK is on PolicyDelta.id which we just deleted — orphans cleaned
        # PolicyDraft.matched_policy_id is SET NULL on policy delete — no-op needed

        # Now delete the policies themselves
        db.execute(sa_delete(Policy).where(Policy.id.in_(demo_policy_ids)))
        deleted += len(demo_policy_ids)

    # Exposures owned by demo users
    db.execute(sa_delete(Exposure).where(Exposure.user_id.in_(demo_user_ids)))

    # User-scoped rows
    for table_cls in [
        AuditLog, UserEvent, CoverageScore, ComplianceCheck, LeaseRequirement,
        EmergencyCard, AgentNote, AgentClient, AgentPolicyAccess,
        InboundAddress, InboundEmail, PolicyDraft, Certificate, PolicyShare,
        DismissedRecommendation,
    ]:
        try:
            col = getattr(table_cls, "user_id", None) or getattr(table_cls, "owner_id", None) or getattr(table_cls, "agent_id", None) or getattr(table_cls, "client_id", None)
            if col is not None:
                db.execute(sa_delete(table_cls).where(col.in_(demo_user_ids)))
        except Exception as e:
            logger.warning("wipe: could not clear %s: %s", getattr(table_cls, "__tablename__", "?"), e)

    # Profiles
    from .models_profile import UserProfile
    db.execute(sa_delete(UserProfile).where(UserProfile.user_id.in_(demo_user_ids)))

    # Agency-of-One for the demo agent
    agency_members = db.execute(
        select(AgencyMember).where(AgencyMember.user_id.in_(demo_user_ids))
    ).scalars().all()
    agency_ids = list({m.agency_id for m in agency_members})
    db.execute(sa_delete(AgencyMember).where(AgencyMember.user_id.in_(demo_user_ids)))
    if agency_ids:
        # Also clear any agent_clients referencing this agency
        db.execute(sa_delete(AgentClient).where(AgentClient.agency_id.in_(agency_ids)))
        db.execute(sa_delete(Agency).where(Agency.id.in_(agency_ids)))

    # Finally, the users themselves
    db.execute(sa_delete(User).where(User.id.in_(demo_user_ids)))
    deleted += len(demo_user_ids)

    db.commit()
    return deleted


@router.post("")
def seed_demo(reset: bool = False, db: Session = Depends(get_db)):
    """One-shot seed for the public demo account.

    By default idempotent — second call returns `already_seeded` and does nothing.

    Pass `?reset=true` to wipe the existing demo account (agent + 10 clients +
    all their policies, PDFs, deltas, share links) and re-seed from scratch.
    Use this when the seed data shape changes; testers will lose any saved
    summaries / share links they generated on prior demo data.
    """
    try:
        if reset:
            deleted = _wipe_demo(db)
            logger.info("Demo wipe: removed %s rows", deleted)
        return _do_seed(db)
    except Exception as e:
        logger.exception("Seed-demo failed")
        raise HTTPException(status_code=500, detail=f"Seed failed: {e}")
