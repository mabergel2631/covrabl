"""Lightweight event tracking for behavioral analytics."""

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .auth import get_current_user_optional
from .db import get_db
from .models import User
from .models_features import UserEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])


class EventCreate(BaseModel):
    event_name: str
    event_category: Optional[str] = None
    properties: Optional[dict] = None
    page_path: Optional[str] = None
    session_id: Optional[str] = None


class EventBatch(BaseModel):
    events: list[EventCreate]


@router.post("/track")
def track_events(
    payload: EventBatch,
    request: Request,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Batch event ingestion. Auth is optional to support pre-login tracking."""
    for ev in payload.events[:50]:  # cap at 50 per batch
        entry = UserEvent(
            user_id=user.id if user else None,
            session_id=(ev.session_id or "")[:50],
            event_name=ev.event_name[:80],
            event_category=(ev.event_category or "")[:40] or None,
            properties=json.dumps(ev.properties) if ev.properties else None,
            page_path=(ev.page_path or "")[:255] or None,
        )
        db.add(entry)
    db.commit()
    return {"ok": True, "count": min(len(payload.events), 50)}
