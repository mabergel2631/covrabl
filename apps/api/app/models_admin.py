from sqlalchemy import String, Integer, Boolean, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


class EmailLog(Base):
    __tablename__ = "email_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    recipient: Mapped[str] = mapped_column(String(255), index=True)
    email_type: Mapped[str] = mapped_column(String(50), index=True)  # password_reset, share_notification, renewal_reminder
    subject: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="sent")  # sent, failed
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(20), default="info")  # info, warning, maintenance
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    starts_at: Mapped[DateTime | None] = mapped_column(DateTime, nullable=True)
    ends_at: Mapped[DateTime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
