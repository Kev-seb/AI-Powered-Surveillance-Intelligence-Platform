"""Zones router — manage detection zones and get zone analytics."""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, get_mongo_db
from app.core.security import get_current_user
from app.models.event import Event

router = APIRouter()


class ZoneCreate(BaseModel):
    name: str
    color: str = "#00d4ff"
    polygon: List[Dict[str, float]]  # [{x, y}, ...] normalized 0-1
    alert_threshold: float = 0.7
    max_capacity: Optional[int] = None
    camera_id: Optional[str] = None


class ZoneResponse(BaseModel):
    id: str
    name: str
    color: str
    polygon: List[Dict[str, float]]
    alert_threshold: float
    max_capacity: Optional[int]
    camera_id: Optional[str]
    created_at: str


@router.get("/")
async def list_zones(mongo=Depends(get_mongo_db), _=Depends(get_current_user)):
    """List all configured detection zones."""
    cursor = mongo.zones.find()
    zones = []
    async for doc in cursor:
        doc["id"] = str(doc.get("id") or doc["_id"])
        if "_id" in doc:
            del doc["_id"]
        if isinstance(doc.get("created_at"), datetime):
            doc["created_at"] = doc["created_at"].isoformat()
        zones.append(doc)
    return zones


@router.post("/")
async def create_zone(
    zone: ZoneCreate,
    mongo=Depends(get_mongo_db),
    _=Depends(get_current_user),
):
    """Create a new detection zone."""
    import uuid
    zone_id = str(uuid.uuid4())
    data = {
        "id": zone_id,
        "name": zone.name,
        "color": zone.color,
        "polygon": zone.polygon,
        "alert_threshold": zone.alert_threshold,
        "max_capacity": zone.max_capacity,
        "camera_id": zone.camera_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await mongo.zones.insert_one(data)
    data.pop("_id", None)
    return data


@router.put("/{zone_id}")
async def update_zone(
    zone_id: str,
    zone: ZoneCreate,
    mongo=Depends(get_mongo_db),
    _=Depends(get_current_user),
):
    """Update an existing zone."""
    existing = await mongo.zones.find_one({"id": zone_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Zone not found")
    
    update_data = {
        "name": zone.name,
        "color": zone.color,
        "polygon": zone.polygon,
        "alert_threshold": zone.alert_threshold,
        "max_capacity": zone.max_capacity,
        "camera_id": zone.camera_id,
    }
    await mongo.zones.update_one({"id": zone_id}, {"$set": update_data})
    
    updated = await mongo.zones.find_one({"id": zone_id})
    updated.pop("_id", None)
    if isinstance(updated.get("created_at"), datetime):
        updated["created_at"] = updated["created_at"].isoformat()
    return updated


@router.delete("/{zone_id}")
async def delete_zone(
    zone_id: str,
    mongo=Depends(get_mongo_db),
    _=Depends(get_current_user),
):
    """Delete a zone."""
    result = await mongo.zones.delete_one({"id": zone_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Zone not found")
    return {"deleted": True}


@router.get("/analytics")
async def get_zone_analytics(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return analytics per zone from event data."""
    result = await db.execute(
        select(
            Event.zone_name,
            func.count(Event.id).label("event_count"),
            func.avg(Event.threat_score).label("avg_threat"),
            func.max(Event.threat_score).label("max_threat"),
            func.count(func.distinct(Event.track_id)).label("unique_persons"),
        )
        .where(
            Event.zone_name != None,
            Event.timestamp >= datetime.now(timezone.utc) - timedelta(hours=24),
        )
        .group_by(Event.zone_name)
        .order_by(func.count(Event.id).desc())
    )
    rows = result.fetchall()
    return [
        {
            "zone_name": r[0],
            "event_count": r[1],
            "avg_threat": float(r[2] or 0),
            "max_threat": float(r[3] or 0),
            "unique_persons": r[4],
        }
        for r in rows
    ]
