"""
Swappable LLM extraction service for insurance policy PDFs.
Supports Anthropic (Claude) and OpenAI. Controlled by LLM_PROVIDER env var.
"""

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

from .config import settings

SYSTEM_PROMPT = """You are an expert insurance policy document parser. Your job is to extract EVERY piece of useful data from insurance policy documents. Be thorough and aggressive — extract as much as possible.

Return ONLY valid JSON with this exact schema (use null for missing fields):
{
  "carrier": "string or null - the full, correct insurance company name (e.g. 'State Farm Mutual Automobile Insurance Company', 'Allstate Insurance Company')",
  "policy_number": "string or null - the policy number, certificate number, or policy ID",
  "policy_type": "string or null - one of: auto, motorcycle, boat, rv, home, health, dental, vision, renters, life, disability, pet, flood, earthquake, liability, umbrella, general_liability, professional_liability, commercial_property, commercial_auto, cyber, bop, workers_comp, directors_officers, epli, inland_marine, other",
  "scope": "string or null - personal or business",
  "coverage_amount": "integer or null - the COVERAGE LIMIT (max payout), NOT the premium. For auto this is the liability limit. For home this is the dwelling coverage. Example: 300000 for $300k coverage",
  "deductible": "integer or null - primary deductible in dollars",
  "renewal_date": "string or null - YYYY-MM-DD format (policy expiration or renewal date)",
  "effective_date": "string or null - YYYY-MM-DD format (policy start/effective date)",
  "named_insured": "string or null - primary named insured on the policy",
  "payment_schedule": "string or null - e.g. monthly, quarterly, semi-annual, annual",
  "premium_amount": "integer or null - the PREMIUM (what the customer PAYS). For health/dental/vision plans with individual and family tiers, use the INDIVIDUAL premium. Extract family premium as a detail field (premium_family). Example: 1200 for $1,200/year premium",
  "contacts": [
    {
      "role": "string - one of: broker, agent, claims, underwriter, customer_service, other",
      "name": "string or null",
      "company": "string or null",
      "phone": "string or null - include area code, format as (XXX) XXX-XXXX",
      "email": "string or null"
    }
  ],
  "inclusions": [
    {
      "description": "string - what is covered",
      "limit": "string or null - coverage limit for this item (include dollar amounts)"
    }
  ],
  "exclusions": [
    {
      "description": "string - what is excluded"
    }
  ],
  "details": [
    {
      "field_name": "string",
      "field_value": "string"
    }
  ]
}

CRITICAL INSTRUCTIONS:
1. CONTACTS: Extract EVERY phone number and email in the document. Look for:
   - Claims phone numbers (often toll-free 1-800/1-888 numbers)
   - Agent name, phone, email, and agency name
   - Broker information
   - Customer service numbers
   - Roadside assistance numbers
   - Any "call us at" or "contact" phone numbers
   - Even if the same number appears in different contexts, extract it with the appropriate role
   If you find a phone number but aren't sure of the role, use "customer_service" or "other"

2. CARRIER NAME: Use the FULL legal company name as printed on the declarations page, not abbreviations

3. COVERAGE: Extract EVERY coverage line item as inclusions with their limits (e.g., "Bodily Injury Liability - $100,000/$300,000", "Comprehensive - $500 deductible")

4. DETAILS: Extract ALL of these type-specific fields when present:
   - auto: For EACH vehicle on the policy, use numbered fields: vehicle_1_description, vehicle_1_VIN, vehicle_2_description, vehicle_2_VIN, etc. Format vehicle descriptions as "YEAR MAKE MODEL" (e.g. "2022 Toyota Camry"). Also extract: listed_drivers (comma-separated list of ALL drivers on the policy, e.g. "John Smith, Jane Smith, Alex Smith"), garaging_address, usage_type, liability_limit, collision_deductible, comprehensive_deductible, uninsured_motorist, medical_payments, roadside_assistance
   - home: year_built, square_footage, construction_type, roof_type, roof_age, stories, alarm_system, property_address, dwelling_coverage, personal_property_coverage, liability_coverage, medical_payments, replacement_cost, actual_cash_value
   - life: insured_name, beneficiary, contingent_beneficiary, face_value, term_length, cash_value, policy_owner, policy_subtype (e.g. "Term Life", "Whole Life", "Universal Life")
   - liability/umbrella: underlying_policies, aggregate_limit, per_occurrence_limit, employer_liability_limit
   - workers_comp: business_name, classification_code, payroll_amount, experience_modifier, state, employer_liability_limit
   - renters: personal_property_limit, liability_limit, loss_of_use, medical_payments, rental_address, landlord_name, lease_end_date, replacement_cost_or_actual_cash_value, identity_theft_coverage
   - flood: flood_zone, building_coverage, contents_coverage, waiting_period, nfip_or_private
   - earthquake: dwelling_coverage, deductible_percent, foundation_type
   - disability: benefit_amount, benefit_period, elimination_period, own_occupation, definition_of_disability
   - health: plan_type (e.g. "PPO", "HMO", "EPO", "POS", "HDHP"), plan_tier (e.g. "Individual", "Family", "Individual + Spouse", "Individual + Children"), group_number, group_name, premium_individual, premium_family, deductible_individual_in_network, deductible_family_in_network, deductible_individual_out_of_network, deductible_family_out_of_network, oop_max_individual_in_network, oop_max_family_in_network, oop_max_individual_out_of_network, oop_max_family_out_of_network, office_visit_copay, specialist_copay, urgent_care_copay, er_copay, prescription_copay_generic, prescription_copay_preferred, prescription_copay_specialty, preventive_care, mental_health_copay, covered_members (comma-separated names of all insured members), network_name (e.g. "Blue Cross PPO Network"), coinsurance_in_network, coinsurance_out_of_network, prior_authorization_required, referral_required
   - dental: plan_type (e.g. "DPPO", "DHMO", "Indemnity"), group_number, group_name, premium_individual, premium_family, deductible_individual, deductible_family, annual_maximum, preventive_coverage (e.g. "100%"), basic_coverage (e.g. "80%"), major_coverage (e.g. "50%"), orthodontia_coverage, orthodontia_lifetime_max, waiting_period_basic, waiting_period_major, covered_members, network_name
   - vision: plan_type, group_number, group_name, premium_individual, premium_family, exam_copay, frames_allowance, contact_lens_allowance, lens_copay, exam_frequency (e.g. "every 12 months"), frames_frequency, contact_lens_frequency, covered_members, network_name
   - general_liability: aggregate_limit, per_occurrence_limit, products_completed_ops, medical_payments, fire_damage_limit
   - professional_liability: aggregate_limit, per_claim_limit, retroactive_date, profession, claims_made_vs_occurrence
   - commercial_property: building_value, business_personal_property, business_income_limit, extra_expense, coinsurance_pct
   - commercial_auto: liability_limit, fleet_size, hired_non_owned, cargo_coverage, scheduled_autos
   - cyber: first_party_limit, third_party_limit, ransomware_coverage, social_engineering_limit, regulatory_defense, breach_notification_costs
   - bop: property_limit, liability_limit, business_income_limit, industry_class
   - directors_officers: aggregate_limit, per_claim_limit, entity_coverage, side_a_b_c
   - epli: aggregate_limit, per_claim_limit, third_party_coverage, wage_hour
   - inland_marine: scheduled_equipment, blanket_limit, transit_coverage
   Also extract: additional_insured, mortgage_company, lienholder, loss_payee — any entity with a financial interest

5. Be extremely thorough. It is better to extract too much than too little.

6. CRITICAL — premium vs coverage: Do NOT confuse these two fields:
   - coverage_amount = the COVERAGE LIMIT (maximum the insurer will pay on a claim). This is usually a large number like $100,000 or $300,000.
   - premium_amount = the PREMIUM COST (what the policyholder pays for the insurance). This is the price/cost and is usually much smaller, like $800 or $2,400.
   If you only see one dollar amount and it looks like a price/cost the customer pays, put it in premium_amount. If it looks like a coverage limit, put it in coverage_amount.

Return ONLY the JSON object, no markdown fences or explanation."""


@dataclass
class ExtractedContact:
    role: str
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


@dataclass
class ExtractedCoverageItem:
    item_type: str  # "inclusion" or "exclusion"
    description: str
    limit: Optional[str] = None


@dataclass
class ExtractedDetail:
    field_name: str
    field_value: str


@dataclass
class ExtractionResult:
    carrier: Optional[str] = None
    policy_number: Optional[str] = None
    policy_type: Optional[str] = None
    scope: Optional[str] = None
    coverage_amount: Optional[int] = None
    deductible: Optional[int] = None
    renewal_date: Optional[str] = None
    premium_amount: Optional[int] = None
    contacts: list[ExtractedContact] = field(default_factory=list)
    coverage_items: list[ExtractedCoverageItem] = field(default_factory=list)
    details: list[ExtractedDetail] = field(default_factory=list)
    raw_response: str = ""


class BaseExtractor(ABC):
    @abstractmethod
    def extract(self, text: str) -> ExtractionResult:
        ...


class AnthropicExtractor(BaseExtractor):
    def extract(self, text: str) -> ExtractionResult:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Extract data from this insurance policy document:\n\n{text[:50000]}"}],
        )
        raw = message.content[0].text
        return _parse_response(raw)

    def extract_images(self, images: list[bytes]) -> ExtractionResult:
        import anthropic, base64
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        content: list[dict] = [{"type": "text", "text": "Extract data from this insurance policy document (scanned pages):"}]
        for img in images[:20]:  # cap at 20 pages
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(img).decode()}})
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
        raw = message.content[0].text
        return _parse_response(raw)

    def extract_coi(self, text: str) -> "COIExtractionResult":
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=COI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Extract data from this Certificate of Insurance:\n\n{text[:50000]}"}],
        )
        return _parse_coi_response(message.content[0].text)

    def extract_coi_images(self, images: list[bytes]) -> "COIExtractionResult":
        import anthropic, base64
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        content: list[dict] = [{"type": "text", "text": "Extract data from this Certificate of Insurance (scanned pages):"}]
        for img in images[:20]:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(img).decode()}})
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=COI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
        return _parse_coi_response(message.content[0].text)

    def extract_claim(self, text: str) -> "ClaimExtractionResult":
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=CLAIM_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Extract claim data from this insurance document:\n\n{text[:50000]}"}],
        )
        return _parse_claim_response(message.content[0].text)

    def extract_claim_images(self, images: list[bytes]) -> "ClaimExtractionResult":
        import anthropic, base64
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        content: list[dict] = [{"type": "text", "text": "Extract claim data from this insurance document (scanned pages):"}]
        for img in images[:20]:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(img).decode()}})
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=CLAIM_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
        return _parse_claim_response(message.content[0].text)

    def extract_lease(self, text: str) -> "LeaseExtractionResult":
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=LEASE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Extract insurance requirements from this lease clause:\n\n{text[:50000]}"}],
        )
        return _parse_lease_response(message.content[0].text)

    def extract_lease_images(self, images: list[bytes]) -> "LeaseExtractionResult":
        import anthropic, base64
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        content: list[dict] = [{"type": "text", "text": "Extract ALL insurance requirements from this lease document. Look through every page carefully for insurance-related sections, coverage requirements, endorsements, and certificate requirements:"}]
        for img in images:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(img).decode()}})
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=LEASE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
        return _parse_lease_response(message.content[0].text)


class OpenAIExtractor(BaseExtractor):
    def extract(self, text: str) -> ExtractionResult:
        import openai
        client = openai.OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Extract data from this insurance policy document:\n\n{text[:50000]}"},
            ],
        )
        raw = response.choices[0].message.content or ""
        return _parse_response(raw)

    def extract_images(self, images: list[bytes]) -> ExtractionResult:
        import openai, base64
        client = openai.OpenAI(api_key=settings.openai_api_key)
        content: list[dict] = [{"type": "text", "text": "Extract data from this insurance policy document (scanned pages):"}]
        for img in images[:20]:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64.b64encode(img).decode()}"}})
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
        )
        raw = response.choices[0].message.content or ""
        return _parse_response(raw)

    def extract_coi(self, text: str) -> "COIExtractionResult":
        import openai
        client = openai.OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": COI_SYSTEM_PROMPT},
                {"role": "user", "content": f"Extract data from this Certificate of Insurance:\n\n{text[:50000]}"},
            ],
        )
        return _parse_coi_response(response.choices[0].message.content or "")

    def extract_coi_images(self, images: list[bytes]) -> "COIExtractionResult":
        import openai, base64
        client = openai.OpenAI(api_key=settings.openai_api_key)
        content: list[dict] = [{"type": "text", "text": "Extract data from this Certificate of Insurance (scanned pages):"}]
        for img in images[:20]:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64.b64encode(img).decode()}"}})
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": COI_SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
        )
        return _parse_coi_response(response.choices[0].message.content or "")

    def extract_claim(self, text: str) -> "ClaimExtractionResult":
        import openai
        client = openai.OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=2048,
            messages=[
                {"role": "system", "content": CLAIM_SYSTEM_PROMPT},
                {"role": "user", "content": f"Extract claim data from this insurance document:\n\n{text[:50000]}"},
            ],
        )
        return _parse_claim_response(response.choices[0].message.content or "")

    def extract_claim_images(self, images: list[bytes]) -> "ClaimExtractionResult":
        import openai, base64
        client = openai.OpenAI(api_key=settings.openai_api_key)
        content: list[dict] = [{"type": "text", "text": "Extract claim data from this insurance document (scanned pages):"}]
        for img in images[:20]:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64.b64encode(img).decode()}"}})
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=2048,
            messages=[
                {"role": "system", "content": CLAIM_SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
        )
        return _parse_claim_response(response.choices[0].message.content or "")

    def extract_lease(self, text: str) -> "LeaseExtractionResult":
        import openai
        client = openai.OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": LEASE_SYSTEM_PROMPT},
                {"role": "user", "content": f"Extract insurance requirements from this lease clause:\n\n{text[:50000]}"},
            ],
        )
        return _parse_lease_response(response.choices[0].message.content or "")

    def extract_lease_images(self, images: list[bytes]) -> "LeaseExtractionResult":
        import openai, base64
        client = openai.OpenAI(api_key=settings.openai_api_key)
        content: list[dict] = [{"type": "text", "text": "Extract ALL insurance requirements from this lease document. Look through every page carefully for insurance-related sections, coverage requirements, endorsements, and certificate requirements:"}]
        for img in images:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64.b64encode(img).decode()}"}})
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": LEASE_SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
        )
        return _parse_lease_response(response.choices[0].message.content or "")


def get_extractor() -> BaseExtractor:
    provider = settings.llm_provider.lower()
    if provider == "openai":
        return OpenAIExtractor()
    return AnthropicExtractor()


def _parse_response(raw: str) -> ExtractionResult:
    raw = raw.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        first_line_end = raw.find("\n")
        raw = raw[first_line_end + 1:] if first_line_end != -1 else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            data = json.loads(raw[start:end + 1])
        else:
            raise

    _VALID_ROLES = {"agent", "broker", "claims", "customer_service", "underwriter", "named_insured", "account_manager", "adjuster", "auditor", "other"}
    contacts = []
    for c in data.get("contacts") or []:
        raw_role = (c.get("role") or "other").lower().strip().replace(" ", "_")
        contacts.append(ExtractedContact(
            role=raw_role if raw_role in _VALID_ROLES else "other",
            name=c.get("name"),
            company=c.get("company"),
            phone=c.get("phone"),
            email=c.get("email"),
        ))

    coverage_items = []
    for inc in data.get("inclusions") or []:
        coverage_items.append(ExtractedCoverageItem(
            item_type="inclusion",
            description=inc.get("description", ""),
            limit=inc.get("limit"),
        ))
    for exc in data.get("exclusions") or []:
        coverage_items.append(ExtractedCoverageItem(
            item_type="exclusion",
            description=exc.get("description", ""),
        ))

    premium_amount = int(data["premium_amount"]) if data.get("premium_amount") else None

    details = []
    # Add top-level enriched fields as details
    for extra_field in ["effective_date", "named_insured", "payment_schedule"]:
        val = data.get(extra_field)
        if val:
            details.append(ExtractedDetail(field_name=extra_field, field_value=str(val)))

    # Post-process details: group duplicate vehicle fields into numbered vehicles,
    # consolidate driver_name entries into listed_drivers
    raw_details = data.get("details") or []
    vehicle_fields = {"year", "make", "model", "VIN", "vehicle_description", "mileage",
                      "usage_type", "collision_deductible", "comprehensive_deductible", "garaging_address"}
    # Collect vehicles by scanning for repeated vehicle_description or year/make/model groups
    vehicles: list[dict] = []
    current_vehicle: dict = {}
    drivers: list[str] = []
    other_details: list[dict] = []

    for d in raw_details:
        fn = d.get("field_name", "")
        fv = d.get("field_value", "")
        if not fn or not fv:
            continue
        # Already numbered (vehicle_1_description etc.) — pass through
        if fn.startswith("vehicle_") and "_" in fn[8:]:
            other_details.append(d)
        elif fn == "listed_drivers":
            drivers.extend([x.strip() for x in fv.split(",") if x.strip()])
        elif fn == "driver_name":
            drivers.append(fv)
        elif fn in vehicle_fields:
            # If we see a field that's already in current_vehicle, start a new vehicle
            if fn in current_vehicle:
                vehicles.append(current_vehicle)
                current_vehicle = {}
            current_vehicle[fn] = fv
        else:
            other_details.append(d)

    if current_vehicle:
        vehicles.append(current_vehicle)

    # Emit numbered vehicle fields
    for i, veh in enumerate(vehicles, 1):
        desc = veh.get("vehicle_description") or " ".join(
            filter(None, [veh.get("year"), veh.get("make"), veh.get("model")])
        )
        if desc:
            details.append(ExtractedDetail(field_name=f"vehicle_{i}_description", field_value=desc))
        if veh.get("VIN"):
            details.append(ExtractedDetail(field_name=f"vehicle_{i}_VIN", field_value=veh["VIN"]))

    # Emit listed_drivers
    if drivers:
        details.append(ExtractedDetail(field_name="listed_drivers", field_value=", ".join(drivers)))

    # Emit remaining details
    for d in other_details:
        details.append(ExtractedDetail(field_name=d["field_name"], field_value=d["field_value"]))

    # Normalize policy_type — AI sometimes returns synonyms
    _TYPE_ALIASES = {
        "medical": "health", "health_insurance": "health", "medical_insurance": "health",
        "homeowners": "home", "homeowner": "home", "condo": "home",
        "automobile": "auto", "car": "auto", "vehicle": "auto",
        "term_life": "life", "whole_life": "life", "life_insurance": "life",
        "renters_insurance": "renters", "renter": "renters",
        "dental_insurance": "dental", "vision_insurance": "vision",
        "pet_insurance": "pet", "disability_insurance": "disability",
        "flood_insurance": "flood", "earthquake_insurance": "earthquake",
        "umbrella_insurance": "umbrella", "personal_umbrella": "umbrella",
        "gl": "general_liability", "commercial_general_liability": "general_liability",
        "e_and_o": "professional_liability", "errors_and_omissions": "professional_liability",
        "d_and_o": "directors_officers", "d&o": "directors_officers",
        "workers_compensation": "workers_comp", "work_comp": "workers_comp",
        "cyber_insurance": "cyber", "cyber_liability": "cyber",
        "commercial_vehicle": "commercial_auto",
    }
    raw_type = (data.get("policy_type") or "").lower().strip()
    policy_type = _TYPE_ALIASES.get(raw_type, raw_type) or None

    return ExtractionResult(
        carrier=data.get("carrier"),
        policy_number=data.get("policy_number"),
        policy_type=policy_type,
        scope=data.get("scope"),
        coverage_amount=int(data["coverage_amount"]) if data.get("coverage_amount") else None,
        deductible=int(data["deductible"]) if data.get("deductible") else None,
        renewal_date=data.get("renewal_date"),
        premium_amount=premium_amount,
        contacts=contacts,
        coverage_items=coverage_items,
        details=details,
        raw_response=raw,
    )


# ── COI (Certificate of Insurance) Extraction ──────────

COI_SYSTEM_PROMPT = """You are an expert insurance document parser specializing in Certificates of Insurance (COI), including ACORD 25 and ACORD 28 forms.

Return ONLY valid JSON with this exact schema (use null for missing fields):
{
  "certificate_holder_name": "string or null - the entity who requested / received the COI (usually at bottom-left of ACORD 25)",
  "certificate_holder_type": "string or null - one of: landlord, lender, client, vendor, contractor, tenant, property_manager, other",
  "certificate_holder_email": "string or null",
  "insured_name": "string or null - the named insured shown on the certificate",
  "carrier": "string or null - the insurance company / insurer name",
  "policy_number": "string or null - primary policy number on the certificate",
  "coverage_types": "list of strings - coverage types present, from: General Liability, Auto, Workers Comp, Umbrella, Professional Liability, Property",
  "primary_coverage_amount": "integer or null - the highest general aggregate or combined coverage limit in DOLLARS (e.g. 2000000 for $2M)",
  "additional_insured": "boolean - true if certificate holder is listed as additional insured",
  "waiver_of_subrogation": "boolean - true if waiver of subrogation applies",
  "effective_date": "string or null - YYYY-MM-DD, earliest policy effective date on the certificate",
  "expiration_date": "string or null - YYYY-MM-DD, latest policy expiration date on the certificate",
  "description_of_operations": "string or null - the Description of Operations / Locations / Vehicles section",
  "producer_name": "string or null - insurance agent or broker name",
  "producer_phone": "string or null",
  "producer_email": "string or null"
}

CRITICAL INSTRUCTIONS:
1. COVERAGE TYPES: List ALL coverage types present on the certificate (GL, auto, umbrella, workers comp, professional liability, property).
2. AMOUNTS: Return dollar values as integers (e.g. 1000000 for $1,000,000). Look for General Aggregate, Each Occurrence, Combined Single Limit.
3. ADDITIONAL INSURED / WAIVER: Check the Description of Operations section AND any checkboxes.
4. CERTIFICATE HOLDER: Typically at the bottom-left of an ACORD 25 form.
5. DATES: If multiple policies have different dates, use the earliest effective and latest expiration.
6. primary_coverage_amount: Use the largest general aggregate or combined limit found.

Return ONLY the JSON object, no markdown fences or explanation."""


@dataclass
class COIExtractionResult:
    certificate_holder_name: Optional[str] = None
    certificate_holder_type: Optional[str] = None
    certificate_holder_email: Optional[str] = None
    insured_name: Optional[str] = None
    carrier: Optional[str] = None
    policy_number: Optional[str] = None
    coverage_types: list[str] = field(default_factory=list)
    primary_coverage_amount: Optional[int] = None
    additional_insured: bool = False
    waiver_of_subrogation: bool = False
    effective_date: Optional[str] = None
    expiration_date: Optional[str] = None
    description_of_operations: Optional[str] = None
    producer_name: Optional[str] = None
    producer_phone: Optional[str] = None
    producer_email: Optional[str] = None
    raw_response: str = ""


# ── Claim Document Extraction ──────────────────────────

CLAIM_SYSTEM_PROMPT = """You are an expert insurance claim document parser. Your job is to extract claim details from insurance claim documents, Explanation of Benefits (EOB) forms, claim acknowledgment letters, settlement letters, and similar documents.

Return ONLY valid JSON with this exact schema (use null for missing fields):
{
  "claim_number": "string or null - the claim number, reference number, or case ID",
  "status": "string or null - one of: open, in_progress, closed, denied. Infer from document context (e.g. settlement letter = closed, denial letter = denied, acknowledgment = open or in_progress)",
  "date_filed": "string or null - YYYY-MM-DD format, the date the claim was filed or reported",
  "date_resolved": "string or null - YYYY-MM-DD format, the date the claim was settled, closed, or denied",
  "amount_claimed": "integer or null - the amount claimed in CENTS (e.g. 150000 for $1,500.00)",
  "amount_paid": "integer or null - the amount paid/settled in CENTS (e.g. 120000 for $1,200.00)",
  "description": "string or null - brief description of what the claim is for (e.g. 'Water damage to basement from pipe burst', 'Rear-end collision on Highway 101')",
  "notes": "string or null - any additional relevant details like adjuster name, repair shop, provider name, denial reason, deductible applied, etc."
}

CRITICAL INSTRUCTIONS:
1. CLAIM NUMBER: Look for claim #, reference #, case #, file #, or similar identifiers
2. AMOUNTS: Convert dollar amounts to cents (multiply by 100). $1,500.00 = 150000
3. STATUS: Infer from context — payment/settlement = closed, denial = denied, under review = in_progress, new filing = open
4. DATES: Use YYYY-MM-DD format. Look for date of loss, date filed, date of service, settlement date
5. DESCRIPTION: Summarize the nature of the claim concisely
6. NOTES: Include adjuster info, denial reasons, deductible amounts, provider/shop names, or any other useful context

Return ONLY the JSON object, no markdown fences or explanation."""


@dataclass
class ClaimExtractionResult:
    claim_number: Optional[str] = None
    status: Optional[str] = None
    date_filed: Optional[str] = None
    date_resolved: Optional[str] = None
    amount_claimed: Optional[int] = None
    amount_paid: Optional[int] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    raw_response: str = ""


# ── Lease Clause Extraction ─────────────────────────

LEASE_SYSTEM_PROMPT = """You are an expert insurance requirements parser. Your job is to extract every insurance requirement from a document. The document may be a commercial or residential lease, loan agreement, contract, service agreement, or any other document containing insurance requirements.

Return ONLY valid JSON with this exact schema (use null for missing fields):
{
  "property_address": "string or null - the property address mentioned",
  "landlord_name": "string or null - the landlord / property owner name",
  "tenant_name": "string or null - the tenant name",
  "requirements": [
    {
      "category": "string - one of: general_liability, commercial_auto, umbrella, workers_comp, property, professional_liability, cyber, other",
      "requirement_type": "string - one of: coverage_limit_each_occurrence, coverage_limit_aggregate, coverage_limit_combined_single, additional_insured, waiver_of_subrogation, primary_noncontributory, notice_of_cancellation, insurer_rating, certificate_holder, other",
      "required_value": "string or null - for limits use integer string e.g. '1000000' for $1M. For booleans use 'true'. For text requirements use the text.",
      "label": "string - human-readable label e.g. 'General Liability - Each Occurrence: $1,000,000'",
      "notes": "string or null - any additional context from the lease"
    }
  ],
  "certificate_holder_text": "string or null - the exact certificate holder name and address formatting required",
  "notice_address": "string or null - address for cancellation notices",
  "deadline": "string or null - deadline for providing insurance if mentioned",
  "raw_summary": "string - a plain-English 2-3 sentence summary of all requirements"
}

CRITICAL INSTRUCTIONS:
1. REQUIREMENTS: Extract EVERY insurance requirement mentioned. Be thorough — include coverage types, limits, endorsements, additional insured, waiver of subrogation, primary & non-contributory, notice of cancellation, insurer ratings (AM Best), certificate holder formatting.
2. DOLLAR AMOUNTS: Normalize to integers. "$1,000,000" → "1000000". "$2M" → "2000000". "$500K" → "500000".
3. CATEGORIES: Map each requirement to the most specific category. IMPORTANT INDUSTRY STANDARD MAPPINGS:
   - Bodily Injury, Property Damage, Personal Injury, Personal & Advertising Injury, Products/Completed Operations, Premises Liability, and Contractual Liability are ALL covered under "general_liability" (Commercial General Liability / CGL). Use category "general_liability" for all of these.
   - Auto Liability, Hired Auto, Non-Owned Auto are covered under "commercial_auto".
   - Excess Liability is the same as "umbrella".
   If a requirement applies to multiple coverage types, create separate entries for each.
4. ADDITIONAL INSURED / WAIVER: Create separate requirement entries for each coverage type that requires these endorsements.
5. Be aggressive — it is better to extract too many requirements than to miss one.
6. If the text mentions "per occurrence", "each occurrence", or "per claim" use coverage_limit_each_occurrence. If it mentions "aggregate" or "general aggregate" use coverage_limit_aggregate. If it mentions "combined single limit" or "CSL" use coverage_limit_combined_single.

Return ONLY the JSON object, no markdown fences or explanation."""


@dataclass
class LeaseExtractionResult:
    property_address: Optional[str] = None
    landlord_name: Optional[str] = None
    tenant_name: Optional[str] = None
    requirements: list[dict] = field(default_factory=list)
    certificate_holder_text: Optional[str] = None
    notice_address: Optional[str] = None
    deadline: Optional[str] = None
    raw_summary: Optional[str] = None
    raw_response: str = ""


def _parse_lease_response(raw: str) -> LeaseExtractionResult:
    raw = raw.strip()
    if raw.startswith("```"):
        # Remove ```json or ``` prefix
        first_line_end = raw.find("\n")
        raw = raw[first_line_end + 1:] if first_line_end != -1 else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    # Try to find JSON object in response even if there's extra text
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Try to extract JSON from within the response
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(raw[start:end + 1])
            except json.JSONDecodeError:
                # Return empty result rather than crashing
                return LeaseExtractionResult(
                    raw_summary="Could not parse extraction response. The document may not contain standard lease insurance requirements.",
                    raw_response=raw,
                )
        else:
            return LeaseExtractionResult(
                raw_summary="Could not parse extraction response. The document may not contain standard lease insurance requirements.",
                raw_response=raw,
            )

    requirements = data.get("requirements") or []
    # Validate each requirement has required fields
    valid_categories = {"general_liability", "commercial_auto", "umbrella", "workers_comp", "property", "professional_liability", "cyber", "other"}
    valid_types = {"coverage_limit_each_occurrence", "coverage_limit_aggregate", "coverage_limit_combined_single", "additional_insured", "waiver_of_subrogation", "primary_noncontributory", "notice_of_cancellation", "insurer_rating", "certificate_holder", "other"}
    cleaned = []
    for req in requirements:
        cat = req.get("category", "other")
        if cat not in valid_categories:
            cat = "other"
        rtype = req.get("requirement_type", "other")
        if rtype not in valid_types:
            rtype = "other"
        cleaned.append({
            "category": cat,
            "requirement_type": rtype,
            "required_value": req.get("required_value"),
            "label": req.get("label", ""),
            "notes": req.get("notes"),
        })

    return LeaseExtractionResult(
        property_address=data.get("property_address"),
        landlord_name=data.get("landlord_name"),
        tenant_name=data.get("tenant_name"),
        requirements=cleaned,
        certificate_holder_text=data.get("certificate_holder_text"),
        notice_address=data.get("notice_address"),
        deadline=data.get("deadline"),
        raw_summary=data.get("raw_summary"),
        raw_response=raw,
    )


def _parse_claim_response(raw: str) -> ClaimExtractionResult:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    data = json.loads(raw)

    amount_claimed = data.get("amount_claimed")
    if amount_claimed is not None:
        amount_claimed = int(amount_claimed)

    amount_paid = data.get("amount_paid")
    if amount_paid is not None:
        amount_paid = int(amount_paid)

    status = data.get("status")
    if status and status not in ("open", "in_progress", "closed", "denied"):
        status = "open"

    return ClaimExtractionResult(
        claim_number=data.get("claim_number"),
        status=status,
        date_filed=data.get("date_filed"),
        date_resolved=data.get("date_resolved"),
        amount_claimed=amount_claimed,
        amount_paid=amount_paid,
        description=data.get("description"),
        notes=data.get("notes"),
        raw_response=raw,
    )


def _parse_coi_response(raw: str) -> COIExtractionResult:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    data = json.loads(raw)

    coverage_types = data.get("coverage_types") or []
    if isinstance(coverage_types, str):
        coverage_types = [t.strip() for t in coverage_types.split(",") if t.strip()]

    amount = data.get("primary_coverage_amount")
    if amount is not None:
        amount = int(amount)

    return COIExtractionResult(
        certificate_holder_name=data.get("certificate_holder_name"),
        certificate_holder_type=data.get("certificate_holder_type"),
        certificate_holder_email=data.get("certificate_holder_email"),
        insured_name=data.get("insured_name"),
        carrier=data.get("carrier"),
        policy_number=data.get("policy_number"),
        coverage_types=coverage_types,
        primary_coverage_amount=amount,
        additional_insured=bool(data.get("additional_insured", False)),
        waiver_of_subrogation=bool(data.get("waiver_of_subrogation", False)),
        effective_date=data.get("effective_date"),
        expiration_date=data.get("expiration_date"),
        description_of_operations=data.get("description_of_operations"),
        producer_name=data.get("producer_name"),
        producer_phone=data.get("producer_phone"),
        producer_email=data.get("producer_email"),
        raw_response=raw,
    )
