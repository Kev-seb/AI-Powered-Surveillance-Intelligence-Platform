"""
AI Surveillance Platform — FastAPI Application Entry Point
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import structlog

from app.core.config import settings
from app.core.database import init_db, close_db
from app.core.logging import configure_logging
from app.middleware.logging_middleware import LoggingMiddleware
from app.middleware.rate_limit_middleware import setup_rate_limiter
from app.routers import (
    auth, videos, events, persons, faces,
    alerts, reports, analytics, health, sensor, detect
)
from app.routers import audit, zones, system_health

configure_logging()
logger = structlog.get_logger(__name__)


import asyncio
import json
import redis.asyncio as aioredis
from app.services.genai_service import prewarm_llm
from app.core.websocket_manager import ws_manager


async def redis_pubsub_listener():
    """Listen to Redis pub/sub and broadcast to WebSockets."""
    logger.info("Starting Redis pub/sub listener...")
    while True:
        try:
            r = aioredis.from_url(settings.REDIS_URL)
            pubsub = r.pubsub()
            await pubsub.subscribe("asip:events")
            logger.info("Subscribed to Redis channel: asip:events")
            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        logger.info("Broadcasting message from Redis", msg_type=data.get("type"))
                        await ws_manager.broadcast_all(data)
                    except Exception as e:
                        logger.error(f"Error broadcasting message: {e}")
        except asyncio.CancelledError:
            logger.info("Redis pub/sub listener task cancelled")
            break
        except Exception as e:
            logger.error(f"Redis pub/sub listener error: {e}. Retrying in 5 seconds...")
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("startup", service="asip-backend", version="1.0.0", env=settings.ENVIRONMENT)
    await init_db()
    logger.info("databases_connected")
    # Pre-warm the LLM model in the background so it is ready for the first request
    asyncio.create_task(prewarm_llm())
    # Start Redis Pub/Sub listener
    listener_task = asyncio.create_task(redis_pubsub_listener())
    yield
    # Cancel Redis listener
    listener_task.cancel()
    try:
        await listener_task
    except asyncio.CancelledError:
        pass
    await close_db()
    logger.info("shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title="AI Surveillance Intelligence Platform",
        description="Enterprise-grade AI-powered surveillance analytics and threat detection platform.",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # ── Middleware ────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(LoggingMiddleware)
    setup_rate_limiter(app)

    # ── Static Files ──────────────────────────────────────────────
    import os
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    os.makedirs(settings.REPORTS_DIR, exist_ok=True)

    # ── Routers ───────────────────────────────────────────────────
    prefix = "/api/v1"
    app.include_router(health.router, prefix=prefix, tags=["Health"])
    app.include_router(auth.router, prefix=f"{prefix}/auth", tags=["Authentication"])
    app.include_router(videos.router, prefix=f"{prefix}/videos", tags=["Videos"])
    app.include_router(events.router, prefix=f"{prefix}/events", tags=["Events"])
    app.include_router(persons.router, prefix=f"{prefix}/persons", tags=["Persons"])
    app.include_router(faces.router, prefix=f"{prefix}/faces", tags=["Face Recognition"])
    app.include_router(alerts.router, prefix=f"{prefix}/alerts", tags=["Alerts & WebSocket"])
    app.include_router(reports.router, prefix=f"{prefix}/reports", tags=["Reports"])
    app.include_router(analytics.router, prefix=f"{prefix}/analytics", tags=["Analytics"])
    app.include_router(sensor.router, prefix=f"{prefix}/sensor", tags=["Sensor Ingestion"])
    app.include_router(audit.router, prefix=f"{prefix}/audit", tags=["Audit Logs"])
    app.include_router(zones.router, prefix=f"{prefix}/zones", tags=["Zones"])
    app.include_router(system_health.router, prefix=f"{prefix}/system", tags=["System Health"])
    app.include_router(detect.router, prefix=f"{prefix}/detect", tags=["Live Detection"])

    return app


app = create_app()
