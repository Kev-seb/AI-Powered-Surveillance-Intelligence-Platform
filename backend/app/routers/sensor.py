"""Sensor ingestion router — accepts external sensor events."""
from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.core.websocket_manager import ws_manager
from app.schemas.schemas import SensorEvent, SensorIngestResponse

router = APIRouter()


@router.post("/ingest", response_model=SensorIngestResponse)
async def ingest_sensor_events(
    events: list[SensorEvent],
    _=Depends(get_current_user),
):
    """Ingest external sensor events (motion, door, thermal) and broadcast."""
    event_ids = []
    for ev in events:
        import uuid
        event_id = str(uuid.uuid4())
        event_ids.append(event_id)
        # Broadcast to WebSocket clients
        await ws_manager.broadcast_all({
            "type": "sensor_event",
            "event_id": event_id,
            "sensor_id": ev.sensor_id,
            "sensor_type": ev.sensor_type,
            "timestamp": ev.timestamp.isoformat(),
            "value": ev.value,
        })

    return SensorIngestResponse(accepted=len(events), events=event_ids)
