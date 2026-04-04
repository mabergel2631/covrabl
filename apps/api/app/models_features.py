from sqlalchemy import String, Integer, Date, DateTime, Boolean, ForeignKey, func, Text, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


class Premium(Base):
    __tablename__ = "premiums"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(Integer)  # cents
    frequency: Mapped[str] = mapped_column(String(20))  # monthly, quarterly, semi_annual, annual
    due_date: Mapped[Date] = mapped_column(Date)
    paid_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class Claim(Base):
    __tablename__ = "claims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), index=True)
    claim_number: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20))  # open, in_progress, closed, denied
    date_filed: Mapped[Date] = mapped_column(Date)
    date_resolved: Mapped[Date | None] = mapped_column(Date, nullable=True)
    amount_claimed: Mapped[int | None] = mapped_column(Integer, nullable=True)  # cents
    amount_paid: Mapped[int | None] = mapped_column(Integer, nullable=True)  # cents
    description: Mapped[str] = mapped_column(String(2000))
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class RenewalReminder(Base):
    __tablename__ = "renewal_reminders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), index=True)
    remind_at: Mapped[Date] = mapped_column(Date)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(50))  # created, updated, deleted, uploaded, confirmed, filed
    entity_type: Mapped[str] = mapped_column(String(50))  # policy, document, claim, premium, etc.
    entity_id: Mapped[int] = mapped_column(Integer)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON string
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class PolicyShare(Base):
    __tablename__ = "policy_shares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    shared_with_email: Mapped[str] = mapped_column(String(255))
    permission: Mapped[str] = mapped_column(String(10))  # view, edit
    role_label: Mapped[str | None] = mapped_column(String(30), nullable=True)  # spouse, child, cpa, attorney, caregiver, broker, other
    expires_at: Mapped[Date | None] = mapped_column(Date, nullable=True)
    accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class EmergencyCard(Base):
    """ICE (In Case of Emergency) shareable card with policy essentials."""
    __tablename__ = "emergency_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    access_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # URL-safe random code
    pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Optional PIN protection
    holder_name: Mapped[str] = mapped_column(String(200))  # Name displayed on card
    emergency_contact_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    include_coverage_amounts: Mapped[bool] = mapped_column(Boolean, default=True)
    include_deductibles: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[Date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class PremiumHistory(Base):
    """Track premium changes over time for price trend analysis."""
    __tablename__ = "premium_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(Integer)  # dollars (annual premium)
    effective_date: Mapped[Date] = mapped_column(Date)  # When this premium took effect
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual, extraction, renewal
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class PolicyDelta(Base):
    """Track changes between policy versions detected during extraction."""
    __tablename__ = "policy_deltas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    field_key: Mapped[str] = mapped_column(String(100))  # "premium_amount", "coverage_amount", etc.
    old_value: Mapped[str | None] = mapped_column(String(500), nullable=True)
    new_value: Mapped[str | None] = mapped_column(String(500), nullable=True)
    delta_type: Mapped[str] = mapped_column(String(20))  # "increased", "decreased", "added", "removed", "changed"
    severity: Mapped[str] = mapped_column(String(20))  # "critical", "warning", "info"
    is_acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class DeltaExplanation(Base):
    """AI-generated explanation for a policy change."""
    __tablename__ = "delta_explanations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    delta_id: Mapped[int] = mapped_column(Integer, ForeignKey("policy_deltas.id", ondelete="CASCADE"), index=True)
    explanation: Mapped[str] = mapped_column(Text)
    possible_reasons: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of reasons
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class CoverageScore(Base):
    """User coverage score by category."""
    __tablename__ = "coverage_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    category: Mapped[str] = mapped_column(String(50))  # "auto", "home", "life", "umbrella", "overall"
    score_total: Mapped[int] = mapped_column(Integer)  # 0-100
    score_breakdown: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    insights: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array
    last_calculated: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class InboundAddress(Base):
    """User's unique email address for receiving policy documents."""
    __tablename__ = "inbound_addresses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), unique=True, index=True)
    alias: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # "u_5_a8f2k3"
    domain: Mapped[str] = mapped_column(String(100), default="inbound.policyvault.com")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class InboundEmail(Base):
    """Record of received inbound emails."""
    __tablename__ = "inbound_emails"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    inbound_address_id: Mapped[int] = mapped_column(Integer, ForeignKey("inbound_addresses.id"), index=True)
    from_email: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    raw_payload: Mapped[str | None] = mapped_column(Text, nullable=True)  # Full JSON
    status: Mapped[str] = mapped_column(String(20), default="pending")  # "pending", "processing", "completed", "failed"
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class PolicyDraft(Base):
    """Policy draft created from email ingestion awaiting user approval."""
    __tablename__ = "policy_drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    inbound_email_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("inbound_emails.id"), nullable=True)
    matched_policy_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("policies.id", ondelete="SET NULL"), nullable=True)
    carrier: Mapped[str | None] = mapped_column(String(200), nullable=True)
    policy_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    policy_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    extraction_data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # "pending", "approved", "rejected"
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class Certificate(Base):
    """Certificate of Insurance (COI) tracking - issued and received."""
    __tablename__ = "certificates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    direction: Mapped[str] = mapped_column(String(10))  # "issued" or "received"
    policy_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("policies.id", ondelete="SET NULL"), nullable=True, index=True)
    counterparty_name: Mapped[str] = mapped_column(String(200))
    counterparty_type: Mapped[str] = mapped_column(String(50))  # landlord, lender, client, vendor, contractor, tenant, property_manager, other
    counterparty_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    carrier: Mapped[str | None] = mapped_column(String(200), nullable=True)
    policy_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    coverage_types: Mapped[str | None] = mapped_column(String(500), nullable=True)  # comma-separated
    coverage_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    additional_insured: Mapped[bool] = mapped_column(Boolean, default=False)
    waiver_of_subrogation: Mapped[bool] = mapped_column(Boolean, default=False)
    minimum_coverage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    effective_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    expiration_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active, expiring, expired, pending
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    coi_file_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    coi_file_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class CertificateReminder(Base):
    """Expiration reminders for certificates."""
    __tablename__ = "certificate_reminders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    certificate_id: Mapped[int] = mapped_column(Integer, ForeignKey("certificates.id", ondelete="CASCADE"), index=True)
    remind_at: Mapped[Date] = mapped_column(Date)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class LeaseRequirement(Base):
    """Extracted insurance requirements from a lease clause."""
    __tablename__ = "lease_requirements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    policy_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("policies.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    label: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(10))  # tenant, landlord
    counterparty_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    counterparty_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    property_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    lease_clause_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    requirements_json: Mapped[str] = mapped_column(Text)  # JSON array of requirement objects
    access_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active, archived
    source_doc_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_doc_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class ComplianceCheck(Base):
    """Result of comparing lease requirements against actual coverage."""
    __tablename__ = "compliance_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    lease_requirement_id: Mapped[int] = mapped_column(Integer, ForeignKey("lease_requirements.id", ondelete="CASCADE"), index=True)
    certificate_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("certificates.id", ondelete="SET NULL"), nullable=True)
    checked_against: Mapped[str] = mapped_column(String(20))  # policies, certificate, manual
    results_json: Mapped[str] = mapped_column(Text)  # JSON array of result objects
    pass_count: Mapped[int] = mapped_column(Integer, default=0)
    fail_count: Mapped[int] = mapped_column(Integer, default=0)
    unclear_count: Mapped[int] = mapped_column(Integer, default=0)
    tenant_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    tenant_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    coi_file_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    coi_file_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="complete")  # pending, processing, complete, error
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # Narrative compliance report (markdown)
    submitted_at: Mapped[DateTime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class DismissedRecommendation(Base):
    """Tracks recommendations a user has dismissed from Coverage Overview."""
    __tablename__ = "dismissed_recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    rec_key: Mapped[str] = mapped_column(String(200))  # unique key for the recommendation
    scope: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "personal" or "business" — for renewal reset
    dismissed_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class UserEvent(Base):
    """Behavioral event tracking for analytics (page views, clicks, feature usage)."""
    __tablename__ = "user_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    session_id: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    event_name: Mapped[str] = mapped_column(String(80), index=True)
    event_category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    properties: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    page_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), index=True)
