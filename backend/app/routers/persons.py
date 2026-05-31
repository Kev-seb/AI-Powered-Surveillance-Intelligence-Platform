"""Persons registry router."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, get_mongo_db
from app.core.security import get_current_user, require_role
from app.models.event import Event
from app.models.person import Person
from app.schemas.schemas import PersonCard, PersonCreate, PersonResponse

router = APIRouter()


@router.get("/", response_model=list[PersonResponse])
async def list_persons(
    risk_level: Optional[str] = None,
    registered_only: bool = False,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    query = select(Person).order_by(Person.created_at.desc()).offset(skip).limit(limit)
    if risk_level:
        query = query.where(Person.risk_level == risk_level)
    if registered_only:
        query = query.where(Person.is_registered == True)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=PersonResponse, status_code=201)
async def create_person(
    payload: PersonCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("analyst")),
):
    person = Person(**payload.dict(), registered_by=current_user.id)
    db.add(person)
    await db.flush()
    return person


@router.get("/{person_id}", response_model=PersonResponse)
async def get_person(
    person_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Person).where(Person.id == person_id))
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(404, "Person not found")
    return person


@router.get("/{person_id}/card", response_model=PersonCard)
async def get_person_card(
    person_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Full intelligence card for a person — events, stats, timeline."""
    result = await db.execute(select(Person).where(Person.id == person_id))
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(404, "Person not found")

    # Aggregate stats
    events_result = await db.execute(
        select(Event)
        .where(Event.person_id == person_id)
        .order_by(Event.timestamp.desc())
    )
    events = events_result.scalars().all()

    behavior_summary: dict[str, int] = {}
    threat_scores = []
    for ev in events:
        for flag in (ev.behavior_flags or []):
            behavior_summary[flag] = behavior_summary.get(flag, 0) + 1
        threat_scores.append(ev.threat_score)

    return PersonCard(
        person=person,
        total_events=len(events),
        first_seen=events[-1].timestamp if events else None,
        last_seen=events[0].timestamp if events else None,
        visit_count=len({ev.video_id for ev in events}),
        avg_threat_score=sum(threat_scores) / len(threat_scores) if threat_scores else 0.0,
        behavior_summary=behavior_summary,
        recent_events=events[:10],
    )


@router.delete("/{person_id}")
async def delete_person(
    person_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    mongo=Depends(get_mongo_db),
    _=Depends(require_role("analyst")),
):
    """Delete a person profile entirely, including face embeddings and photos."""
    result = await db.execute(select(Person).where(Person.id == person_id))
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(404, "Person not found")

    # Delete embedding from MongoDB
    await mongo.face_embeddings.delete_one({"person_id": str(person_id)})

    # Delete photo file from disk if exists
    if person.photo_path:
        from pathlib import Path
        photo_path = Path(person.photo_path)
        if photo_path.exists():
            photo_path.unlink()

    # Delete person from SQL DB
    await db.delete(person)
    await db.flush()

    return {
        "message": "Person profile and associated face registry deleted successfully",
        "person_id": str(person_id),
    }
