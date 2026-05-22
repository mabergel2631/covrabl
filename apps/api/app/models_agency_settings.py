"""Agency-level configuration. Currently houses renewal-workflow
thresholds; future agency-wide settings should live here too."""

from __future__ import annotations

from sqlalchemy import Integer, String, ForeignKey, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class AgencyRenewalThreshold(Base):
    """Per-agency, per-policy-type override of the default renewal-stage
    windows defined in renewal_config.DEFAULT_THRESHOLDS.

    If a row exists for (agency_id, policy_type) it wins; otherwise the
    code default wins. policy_type stores the normalized slug from
    renewal_config._normalize_policy_type (e.g. "auto", "general_liability").
    """

    __tablename__ = "agency_renewal_thresholds"
    __table_args__ = (
        UniqueConstraint("agency_id", "policy_type", name="uq_agency_policy_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_id: Mapped[int] = mapped_column(Integer, ForeignKey("agencies.id", ondelete="CASCADE"), index=True)
    policy_type: Mapped[str] = mapped_column(String(60))

    upcoming_days: Mapped[int] = mapped_column(Integer)
    discussion_days: Mapped[int] = mapped_column(Integer)
    market_days: Mapped[int] = mapped_column(Integer)
    finalization_days: Mapped[int] = mapped_column(Integer)

    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
