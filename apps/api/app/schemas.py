from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List, Literal
from datetime import date, datetime


# ── Auth ──────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    role: Optional[Literal["individual", "broker"]] = "individual"


class UserOut(BaseModel):
    id: int
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Policies ──────────────────────────────────────────

VALID_POLICY_TYPES = [
    "auto", "motorcycle", "boat", "rv", "home", "health", "dental", "vision",
    "renters", "life", "disability", "pet", "flood", "earthquake",
    "liability", "umbrella", "general_liability", "professional_liability",
    "commercial_property", "commercial_auto", "cyber", "bop", "workers_comp",
    "directors_officers", "epli", "inland_marine", "other",
]


class PolicyBase(BaseModel):
    scope: Literal["personal", "business"]
    policy_type: str
    carrier: str
    policy_number: str
    nickname: Optional[str] = None
    business_name: Optional[str] = None
    coverage_amount: Optional[int] = None
    deductible: Optional[int] = None
    premium_amount: Optional[int] = None
    renewal_date: Optional[date] = None
    exposure_id: Optional[int] = None
    status: Optional[Literal["active", "expired", "archived"]] = "active"
    replaces_policy_id: Optional[int] = None
    # Health-specific fields
    plan_subtype: Optional[str] = None  # HMO, PPO, EPO, HDHP, POS
    out_of_pocket_max: Optional[int] = None
    family_deductible: Optional[int] = None
    family_oop_max: Optional[int] = None
    # Deductible tracking
    deductible_type: Optional[Literal["annual", "per_incident"]] = None
    deductible_period_start: Optional[date] = None
    deductible_applied: Optional[int] = None  # cents applied to deductible

    @field_validator("policy_type")
    @classmethod
    def validate_policy_type(cls, v: str) -> str:
        if v.lower() not in VALID_POLICY_TYPES:
            raise ValueError(f"Invalid policy_type: {v}")
        return v.lower()


class PolicyCreate(PolicyBase):
    pass


class PolicyUpdate(BaseModel):
    scope: Optional[Literal["personal", "business"]] = None
    policy_type: Optional[str] = None
    carrier: Optional[str] = None
    policy_number: Optional[str] = None
    nickname: Optional[str] = None
    business_name: Optional[str] = None
    coverage_amount: Optional[int] = None
    deductible: Optional[int] = None
    premium_amount: Optional[int] = None
    renewal_date: Optional[date] = None
    exposure_id: Optional[int] = None
    status: Optional[Literal["active", "expired", "archived"]] = None
    # Health-specific fields
    plan_subtype: Optional[str] = None
    out_of_pocket_max: Optional[int] = None
    family_deductible: Optional[int] = None
    family_oop_max: Optional[int] = None
    # Deductible tracking
    deductible_type: Optional[Literal["annual", "per_incident"]] = None
    deductible_period_start: Optional[date] = None
    deductible_applied: Optional[int] = None
    # Quote flag — marks a policy row as a quote (not yet bound)
    is_quote: Optional[bool] = None

    @field_validator("policy_type")
    @classmethod
    def validate_policy_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v.lower() not in VALID_POLICY_TYPES:
            raise ValueError(f"Invalid policy_type: {v}")
        return v.lower() if v else v


class PolicyOut(PolicyBase):
    id: int
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class BusinessGroupRename(BaseModel):
    old_name: str  # empty string = ungrouped
    new_name: str


class BusinessGroupDelete(BaseModel):
    name: str


# ── Contacts ──────────────────────────────────────────

class ContactBase(BaseModel):
    role: Literal["agent", "broker", "claims", "customer_service", "underwriter", "named_insured", "account_manager", "adjuster", "auditor", "other"]
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


class ContactCreate(ContactBase):
    pass


class ContactUpdate(BaseModel):
    role: Optional[Literal["agent", "broker", "claims", "customer_service", "underwriter", "named_insured", "account_manager", "adjuster", "auditor", "other"]] = None
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


class ContactOut(ContactBase):
    id: int
    policy_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Coverage Items (Inclusions/Exclusions) ────────────

class CoverageItemBase(BaseModel):
    item_type: Literal["inclusion", "exclusion"]
    description: str
    limit: Optional[str] = None


class CoverageItemCreate(CoverageItemBase):
    pass


class CoverageItemUpdate(BaseModel):
    item_type: Optional[Literal["inclusion", "exclusion"]] = None
    description: Optional[str] = None
    limit: Optional[str] = None


class CoverageItemOut(CoverageItemBase):
    id: int
    policy_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Policy Details (key-value extended fields) ────

class PolicyDetailBase(BaseModel):
    field_name: str
    field_value: str


class PolicyDetailCreate(PolicyDetailBase):
    pass


class PolicyDetailUpdate(BaseModel):
    field_name: Optional[str] = None
    field_value: Optional[str] = None


class PolicyDetailOut(PolicyDetailBase):
    id: int
    policy_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Premiums ─────────────────────────────────────────

class PremiumBase(BaseModel):
    amount: int  # cents
    frequency: Literal["monthly", "quarterly", "semi_annual", "annual"]
    due_date: date
    paid_date: Optional[date] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None


class PremiumCreate(PremiumBase):
    pass


class PremiumUpdate(BaseModel):
    amount: Optional[int] = None
    frequency: Optional[Literal["monthly", "quarterly", "semi_annual", "annual"]] = None
    due_date: Optional[date] = None
    paid_date: Optional[date] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None


class PremiumOut(PremiumBase):
    id: int
    policy_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Claims ───────────────────────────────────────────

class ClaimBase(BaseModel):
    claim_number: str
    status: Literal["open", "in_progress", "closed", "denied"]
    date_filed: date
    date_resolved: Optional[date] = None
    amount_claimed: Optional[int] = None  # cents
    amount_paid: Optional[int] = None  # cents
    description: str
    notes: Optional[str] = None


class ClaimCreate(ClaimBase):
    pass


class ClaimUpdate(BaseModel):
    claim_number: Optional[str] = None
    status: Optional[Literal["open", "in_progress", "closed", "denied"]] = None
    date_filed: Optional[date] = None
    date_resolved: Optional[date] = None
    amount_claimed: Optional[int] = None
    amount_paid: Optional[int] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class ClaimOut(ClaimBase):
    id: int
    policy_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Renewal Reminders ────────────────────────────────

class ReminderOut(BaseModel):
    id: int
    policy_id: int
    remind_at: date
    dismissed: bool
    created_at: datetime
    carrier: Optional[str] = None
    policy_type: Optional[str] = None
    nickname: Optional[str] = None

    class Config:
        from_attributes = True


# ── Audit Log ────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: int
    user_id: int
    action: str
    entity_type: str
    entity_id: int
    details: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AuditLogPage(BaseModel):
    items: List[AuditLogOut]
    total: int
    page: int
    limit: int


# ── Policy Sharing ───────────────────────────────────

class ShareCreate(BaseModel):
    shared_with_email: EmailStr
    permission: Literal["view", "edit"] = "view"
    role_label: Optional[str] = None  # spouse, child, cpa, attorney, caregiver, broker, other
    expires_at: Optional[date] = None


class ShareOut(BaseModel):
    id: int
    policy_id: int
    owner_id: int
    shared_with_email: str
    permission: str
    role_label: Optional[str] = None
    expires_at: Optional[date] = None
    accepted: bool
    created_at: datetime

    class Config:
        from_attributes = True


class BulkShareCreate(BaseModel):
    policy_ids: List[int]
    shared_with_email: EmailStr
    permission: Literal["view", "edit"] = "view"
    role_label: Optional[str] = None
    expires_at: Optional[date] = None


class BulkShareResult(BaseModel):
    created: int
    skipped: int
    total: int


# ── Exposures ───────────────────────────────────────

class ExposureCreate(BaseModel):
    name: str
    exposure_type: Optional[str] = None  # dwelling, vehicle, business_entity, personal, other
    description: Optional[str] = None


class ExposureUpdate(BaseModel):
    name: Optional[str] = None
    exposure_type: Optional[str] = None
    description: Optional[str] = None


class ExposureOut(BaseModel):
    id: int
    user_id: int
    name: str
    exposure_type: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Certificates ──────────────────────────────────

class CertificateCreate(BaseModel):
    direction: Literal["issued", "received"]
    policy_id: Optional[int] = None
    counterparty_name: str
    counterparty_type: str
    counterparty_email: Optional[EmailStr] = None
    carrier: Optional[str] = None
    policy_number: Optional[str] = None
    coverage_types: Optional[str] = None
    coverage_amount: Optional[int] = None
    additional_insured: bool = False
    waiver_of_subrogation: bool = False
    minimum_coverage: Optional[int] = None
    effective_date: Optional[date] = None
    expiration_date: Optional[date] = None
    status: Optional[Literal["active", "expiring", "expired", "pending"]] = "active"
    notes: Optional[str] = None
    file_token: Optional[str] = None


class CertificateUpdate(BaseModel):
    direction: Optional[Literal["issued", "received"]] = None
    policy_id: Optional[int] = None
    counterparty_name: Optional[str] = None
    counterparty_type: Optional[str] = None
    counterparty_email: Optional[EmailStr] = None
    carrier: Optional[str] = None
    policy_number: Optional[str] = None
    coverage_types: Optional[str] = None
    coverage_amount: Optional[int] = None
    additional_insured: Optional[bool] = None
    waiver_of_subrogation: Optional[bool] = None
    minimum_coverage: Optional[int] = None
    effective_date: Optional[date] = None
    expiration_date: Optional[date] = None
    status: Optional[Literal["active", "expiring", "expired", "pending"]] = None
    notes: Optional[str] = None


class CertificateOut(BaseModel):
    id: int
    user_id: int
    direction: str
    policy_id: Optional[int] = None
    counterparty_name: str
    counterparty_type: str
    counterparty_email: Optional[str] = None
    carrier: Optional[str] = None
    policy_number: Optional[str] = None
    coverage_types: Optional[str] = None
    coverage_amount: Optional[int] = None
    additional_insured: bool
    waiver_of_subrogation: bool
    minimum_coverage: Optional[int] = None
    effective_date: Optional[date] = None
    expiration_date: Optional[date] = None
    status: str
    notes: Optional[str] = None
    has_document: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


# ── User Profile ──────────────────────────────────────

class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    address_street: Optional[str] = None
    address_city: Optional[str] = None
    address_state: Optional[str] = None
    address_zip: Optional[str] = None
    is_homeowner: Optional[bool] = None
    is_renter: Optional[bool] = None
    has_dependents: Optional[bool] = None
    has_vehicle: Optional[bool] = None
    owns_business: Optional[bool] = None
    high_net_worth: Optional[bool] = None


class UserProfileOut(BaseModel):
    id: int
    user_id: int
    full_name: Optional[str] = None
    phone: Optional[str] = None
    address_street: Optional[str] = None
    address_city: Optional[str] = None
    address_state: Optional[str] = None
    address_zip: Optional[str] = None
    is_homeowner: bool
    is_renter: bool
    has_dependents: bool
    has_vehicle: bool
    owns_business: bool
    high_net_worth: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Lease Compliance ────────────────────────────────

class LeaseRequirementCreate(BaseModel):
    label: str
    role: Literal["tenant", "landlord", "requester"]
    policy_id: Optional[int] = None
    counterparty_name: Optional[str] = None
    counterparty_email: Optional[str] = None
    property_address: Optional[str] = None
    lease_clause_text: Optional[str] = None
    requirements_json: str  # JSON string


class LeaseRequirementUpdate(BaseModel):
    label: Optional[str] = None
    role: Optional[Literal["tenant", "landlord", "requester"]] = None
    counterparty_name: Optional[str] = None
    counterparty_email: Optional[str] = None
    property_address: Optional[str] = None
    lease_clause_text: Optional[str] = None
    requirements_json: Optional[str] = None
    status: Optional[Literal["active", "archived"]] = None


class LeaseRequirementOut(BaseModel):
    id: int
    user_id: int
    policy_id: Optional[int] = None
    label: str
    role: str
    counterparty_name: Optional[str] = None
    counterparty_email: Optional[str] = None
    property_address: Optional[str] = None
    lease_clause_text: Optional[str] = None
    requirements_json: str
    access_code: str
    status: str
    source_doc_name: Optional[str] = None
    has_source_doc: bool = False
    created_at: datetime
    updated_at: datetime
    latest_check: Optional[dict] = None

    class Config:
        from_attributes = True


class ComplianceCheckOut(BaseModel):
    id: int
    user_id: int
    lease_requirement_id: int
    certificate_id: Optional[int] = None
    checked_against: str
    results_json: str
    pass_count: int
    fail_count: int
    unclear_count: int
    tenant_name: Optional[str] = None
    tenant_email: Optional[str] = None
    submitted_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ProfileContactCreate(BaseModel):
    contact_type: Literal["emergency", "broker"]
    name: str
    relationship: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


class ProfileContactUpdate(BaseModel):
    name: Optional[str] = None
    relationship: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


class ProfileContactOut(BaseModel):
    id: int
    user_id: int
    contact_type: str
    name: str
    relationship: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
