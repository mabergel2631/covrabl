from sqlalchemy import String, Integer, DateTime, Text, Boolean, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


class AgentClient(Base):
    __tablename__ = "agent_clients"
    __table_args__ = (
        UniqueConstraint("agent_id", "client_id", name="uq_agent_client"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agent_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    client_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="invited")  # invited, pending, active, removed
    invited_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invite_token: Mapped[str | None] = mapped_column(String(100), nullable=True, unique=True, index=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class AgentPolicyAccess(Base):
    """Controls which policies an agent can see for a given client."""
    __tablename__ = "agent_policy_access"
    __table_args__ = (
        UniqueConstraint("agent_id", "policy_id", name="uq_agent_policy"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agent_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    client_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    policy_id: Mapped[int] = mapped_column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), index=True)
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class AgentNote(Base):
    __tablename__ = "agent_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agent_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    client_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
