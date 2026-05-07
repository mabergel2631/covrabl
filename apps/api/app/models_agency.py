from sqlalchemy import String, Integer, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


class Agency(Base):
    __tablename__ = "agencies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    brand_logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    brand_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class AgencyMember(Base):
    __tablename__ = "agency_members"
    __table_args__ = (
        UniqueConstraint("agency_id", "user_id", name="uq_agency_member_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_id: Mapped[int] = mapped_column(Integer, ForeignKey("agencies.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(20))  # owner, producer, csr, viewer
    status: Mapped[str] = mapped_column(String(20), default="active")  # active, invited, removed
    invited_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invite_token: Mapped[str | None] = mapped_column(String(100), nullable=True, unique=True, index=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    removed_at: Mapped[DateTime | None] = mapped_column(DateTime, nullable=True)
