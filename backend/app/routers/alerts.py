"""Alerts router — REST + WebSocket streaming."""
import uuid

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.websocket_manager import ws_manager
from app.models.alert import Alert
from app.schemas.schemas import AlertResponse

router = APIRouter()


@router.get("/", response_model=list[AlertResponse])
async def list_alerts(
    unread_only: bool = False,
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """List recent alerts."""
    query = select(Alert).order_by(Alert.created_at.desc()).limit(limit)
    if unread_only:
        query = query.where(Alert.is_read == False)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/{alert_id}/read", response_model=AlertResponse)
async def mark_read(
    alert_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if alert:
        alert.is_read = True
        await db.flush()
    return alert


@router.get("/live")
async def alerts_websocket_info():
    """WebSocket endpoint info."""
    return {"ws_url": "/ws/alerts", "channels": ["global"]}


@router.websocket("/ws")
async def websocket_alerts(websocket: WebSocket, channel: str = "global"):
    """
    Real-time alert streaming via WebSocket.
    Connect to: ws://localhost:8000/api/v1/alerts/ws?channel=global
    """
    await ws_manager.connect(websocket, channel)
    try:
        # Send connection confirmation
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "channel": channel,
            "message": "Real-time alert stream active",
        })
        # Keep connection alive — server pushes messages
        while True:
            data = await websocket.receive_text()
            # Handle ping/pong
            if data == "ping":
                await ws_manager.send_personal(websocket, {"type": "pong"})
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket, channel)
