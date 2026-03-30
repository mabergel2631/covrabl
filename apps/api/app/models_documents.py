from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id"), index=True)

    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120))
    object_key: Mapped[str] = mapped_column(String(512), unique=True, index=True)

    doc_type: Mapped[str] = mapped_column(String(50), server_default="policy")  # policy, insurance_card, endorsement, other
    extraction_status: Mapped[str] = mapped_column(String(20), server_default="none")  # none, pending, done, failed
    cached_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    uploaded_by_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
