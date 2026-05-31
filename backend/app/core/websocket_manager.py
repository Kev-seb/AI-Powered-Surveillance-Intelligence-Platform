"""WebSocket connection manager for real-time alert broadcasting."""
import asyncio
import json
from typing import Dict, List, Set
from uuid import UUID

import structlog
from fastapi import WebSocket

logger = structlog.get_logger(__name__)


class ConnectionManager:
    """Manages WebSocket connections with room/channel support."""

    def __init__(self):
        # channel -> set of websockets
        self._channels: Dict[str, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, channel: str = "global"):
        await websocket.accept()
        async with self._lock:
            if channel not in self._channels:
                self._channels[channel] = set()
            self._channels[channel].add(websocket)
        logger.info("websocket_connected", channel=channel, total=self._count())

    async def disconnect(self, websocket: WebSocket, channel: str = "global"):
        async with self._lock:
            ch = self._channels.get(channel, set())
            ch.discard(websocket)
            if not ch and channel in self._channels:
                del self._channels[channel]
        logger.info("websocket_disconnected", channel=channel, total=self._count())

    async def broadcast(self, message: dict, channel: str = "global"):
        """Broadcast JSON message to all connections in a channel."""
        payload = json.dumps(message, default=str)
        dead: List[WebSocket] = []

        connections = list(self._channels.get(channel, set()))
        for ws in connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)

        # Cleanup dead connections
        if dead:
            async with self._lock:
                for ws in dead:
                    self._channels.get(channel, set()).discard(ws)

    async def broadcast_all(self, message: dict):
        """Broadcast to ALL channels."""
        for channel in list(self._channels.keys()):
            await self.broadcast(message, channel)

    async def send_personal(self, websocket: WebSocket, message: dict):
        payload = json.dumps(message, default=str)
        try:
            await websocket.send_text(payload)
        except Exception:
            pass

    def _count(self) -> int:
        return sum(len(ws_set) for ws_set in self._channels.values())

    @property
    def connection_count(self) -> int:
        return self._count()


# Global singleton
ws_manager = ConnectionManager()
