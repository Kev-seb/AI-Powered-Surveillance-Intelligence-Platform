"""Routers package init."""
from app.routers import (
    auth, videos, events, persons, faces,
    alerts, reports, analytics, health, sensor,
)

__all__ = [
    "auth", "videos", "events", "persons", "faces",
    "alerts", "reports", "analytics", "health", "sensor",
]
