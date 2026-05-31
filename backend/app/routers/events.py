"""Events router — list, detail, acknowledge."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.event import Event
from app.schemas.schemas import AcknowledgeRequest, EventListResponse, EventResponse

router = APIRouter()


@router.get("/", response_model=EventListResponse)
async def list_events(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=1000),
    severity: Optional[str] = None,
    event_type: Optional[str] = None,
    video_id: Optional[uuid.UUID] = None,
    acknowledged: Optional[bool] = None,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """List detection events with rich filtering."""
    from sqlalchemy.orm import selectinload
    query = select(Event).options(selectinload(Event.person)).order_by(Event.timestamp.desc())

    if severity:
        query = query.where(Event.severity == severity)
    if event_type:
        query = query.where(Event.event_type == event_type)
    if video_id:
        query = query.where(Event.video_id == video_id)
    if acknowledged is not None:
        query = query.where(Event.acknowledged == acknowledged)
    if from_dt:
        query = query.where(Event.timestamp >= from_dt)
    if to_dt:
        query = query.where(Event.timestamp <= to_dt)

    # Total count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Paginate
    offset = (page - 1) * per_page
    result = await db.execute(query.offset(offset).limit(per_page))
    events = result.scalars().all()

    return EventListResponse(items=events, total=total, page=page, per_page=per_page)


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Get a single event by ID."""
    from sqlalchemy.orm import selectinload
    result = await db.execute(select(Event).options(selectinload(Event.person)).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(404, "Event not found")
    return event


@router.post("/{event_id}/acknowledge", response_model=EventResponse)
async def acknowledge_event(
    event_id: uuid.UUID,
    payload: AcknowledgeRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Mark an event as acknowledged."""
    from sqlalchemy.orm import selectinload
    result = await db.execute(select(Event).options(selectinload(Event.person)).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(404, "Event not found")

    event.acknowledged = True
    event.acknowledged_by = current_user.id
    event.acknowledged_at = datetime.now(timezone.utc)
    if payload.note:
        event.metadata_["acknowledge_note"] = payload.note
    await db.flush()
    return event
