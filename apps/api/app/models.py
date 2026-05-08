from sqlalchemy import String, Integer, Boolean, Date, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="individual")  # "individual" or "agent"
    plan: Mapped[str] = mapped_column(String(20), default="free")  # free, pro, business (legacy: trial, basic)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    trial_ends_at: Mapped[DateTime | None] = mapped_column(DateTime, nullable=True)
    # MFA / 2FA (TOTP). Nullable until enrolled.
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mfa_recovery_codes: Mapped[str | None] = mapped_column(String(2000), nullable=True)  # JSON list of bcrypt hashes
    mfa_enrolled_at: Mapped[DateTime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class Exposure(Base):
    __tablename__ = "exposures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    exposure_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # dwelling, vehicle, business_entity, personal, other
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class Policy(Base):
    __tablename__ = "policies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    exposure_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("exposures.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active, expired, archived
    replaces_policy_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("policies.id", ondelete="SET NULL"), nullable=True, index=True
    )

    scope: Mapped[str] = mapped_column(String(20), index=True)
    policy_type: Mapped[str] = mapped_column(String(50), index=True)
    carrier: Mapped[str] = mapped_column(String(120))
    policy_number: Mapped[str] = mapped_column(String(80), index=True)
    nickname: Mapped[str | None] = mapped_column(String(200), nullable=True)
    business_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    coverage_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deductible: Mapped[int | None] = mapped_column(Integer, nullable=True)
    premium_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Health-specific fields
    plan_subtype: Mapped[str | None] = mapped_column(String(30), nullable=True)  # HMO, PPO, EPO, HDHP, POS
    out_of_pocket_max: Mapped[int | None] = mapped_column(Integer, nullable=True)  # cents
    family_deductible: Mapped[int | None] = mapped_column(Integer, nullable=True)  # cents
    family_oop_max: Mapped[int | None] = mapped_column(Integer, nullable=True)  # cents

    # Deductible tracking
    deductible_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # annual, per_incident
    deductible_period_start: Mapped[Date | None] = mapped_column(Date, nullable=True)
    deductible_applied: Mapped[int | None] = mapped_column(Integer, nullable=True)  # cents applied to deductible

    renewal_date: Mapped[Date | None] = mapped_column(Date, nullable=True)

    # When True, this policy row represents a quote (not a bound policy) — it's
    # eligible to be the right-hand side of a QuoteComparison and is hidden
    # from the active-policy lists. Defaults to False (a normal active policy).
    is_quote: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())

    # Version chain relationships
    replaced_by: Mapped[list["Policy"]] = relationship(
        "Policy", back_populates="replaces", foreign_keys="Policy.replaces_policy_id",
        lazy="select"
    )
    replaces: Mapped["Policy | None"] = relationship(
        "Policy", back_populates="replaced_by", remote_side="Policy.id",
        foreign_keys="Policy.replaces_policy_id", lazy="select"
    )

    # Relationships for eager loading
    contacts: Mapped[list["Contact"]] = relationship("Contact", lazy="select", cascade="all, delete-orphan")
    details: Mapped[list["PolicyDetail"]] = relationship("PolicyDetail", lazy="select", cascade="all, delete-orphan")
    coverage_items: Mapped[list["CoverageItem"]] = relationship("CoverageItem", lazy="select", cascade="all, delete-orphan")
    exposure: Mapped["Exposure | None"] = relationship("Exposure", lazy="select", foreign_keys=[exposure_id])


class PolicyDetail(Base):
    __tablename__ = "policy_details"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), index=True)
    field_name: Mapped[str] = mapped_column(String(100))
    field_value: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), index=True)

    role: Mapped[str] = mapped_column(String(50))  # "broker", "agent", "claims", "underwriter"
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    company: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    token: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    expires_at: Mapped[DateTime] = mapped_column(DateTime)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class CoverageItem(Base):
    __tablename__ = "coverage_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), index=True)

    item_type: Mapped[str] = mapped_column(String(20))  # "inclusion" or "exclusion"
    description: Mapped[str] = mapped_column(String(1000))
    limit: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
