"""System health router — detailed service diagnostics."""
import time
import asyncio
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, engine
from app.core.security import get_current_user

router = APIRouter()


async def _check_postgres(db: AsyncSession) -> Dict[str, Any]:
    start = time.monotonic()
    try:
        result = await db.execute(text("SELECT version(), pg_database_size(current_database())"))
        row = result.fetchone()
        latency = int((time.monotonic() - start) * 1000)
        return {
            "status": "healthy",
            "latency_ms": latency,
            "version": row[0].split(" ")[1] if row else "unknown",
            "db_size_mb": round(row[1] / 1024 / 1024, 1) if row else 0,
        }
    except Exception as e:
        return {"status": "error", "error": str(e), "latency_ms": -1}


async def _check_redis() -> Dict[str, Any]:
    import redis.asyncio as redis_async
    from app.core.config import settings
    start = time.monotonic()
    try:
        r = redis_async.from_url(settings.REDIS_URL)
        info = await r.info("server")
        await r.aclose()
        latency = int((time.monotonic() - start) * 1000)
        return {
            "status": "healthy",
            "latency_ms": latency,
            "version": info.get("redis_version", "unknown"),
            "connected_clients": info.get("connected_clients", 0),
            "used_memory_mb": round(info.get("used_memory", 0) / 1024 / 1024, 1),
        }
    except Exception as e:
        return {"status": "error", "error": str(e), "latency_ms": -1}


async def _check_mongodb() -> Dict[str, Any]:
    from motor.motor_asyncio import AsyncIOMotorClient
    from app.core.config import settings
    start = time.monotonic()
    try:
        client = AsyncIOMotorClient(settings.MONGO_URL, serverSelectionTimeoutMS=2000)
        info = await client.admin.command("serverStatus")
        client.close()
        latency = int((time.monotonic() - start) * 1000)
        return {
            "status": "healthy",
            "latency_ms": latency,
            "version": info.get("version", "unknown"),
            "connections": info.get("connections", {}).get("current", 0),
        }
    except Exception as e:
        return {"status": "error", "error": str(e), "latency_ms": -1}


async def _check_celery() -> Dict[str, Any]:
    start = time.monotonic()
    try:
        from app.tasks.celery_app import celery_app
        inspect = celery_app.control.inspect(timeout=2.0)
        # run in thread to avoid blocking
        loop = asyncio.get_event_loop()
        active = await loop.run_in_executor(None, inspect.active)
        latency = int((time.monotonic() - start) * 1000)
        if active is None:
            return {"status": "warning", "latency_ms": latency, "message": "No workers responding"}
        worker_count = len(active)
        task_count = sum(len(tasks) for tasks in active.values())
        return {
            "status": "healthy",
            "latency_ms": latency,
            "workers": worker_count,
            "active_tasks": task_count,
        }
    except Exception as e:
        return {"status": "error", "error": str(e), "latency_ms": -1}


async def _check_ollama() -> Dict[str, Any]:
    import httpx
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get("http://ollama:11434/api/tags")
        latency = int((time.monotonic() - start) * 1000)
        models = [m["name"] for m in r.json().get("models", [])]
        return {
            "status": "healthy",
            "latency_ms": latency,
            "models": models,
            "model_count": len(models),
        }
    except Exception as e:
        return {"status": "error", "error": str(e), "latency_ms": -1}


@router.get("/system")
async def get_system_health(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Full system health diagnostics."""
    results = await asyncio.gather(
        _check_postgres(db),
        _check_redis(),
        _check_mongodb(),
        _check_celery(),
        _check_ollama(),
        return_exceptions=True,
    )

    def safe(r):
        if isinstance(r, Exception):
            return {"status": "error", "error": str(r)}
        return r

    services = {
        "postgresql": safe(results[0]),
        "redis": safe(results[1]),
        "mongodb": safe(results[2]),
        "celery": safe(results[3]),
        "ollama": safe(results[4]),
    }

    all_statuses = [v.get("status") for v in services.values()]
    if all(s == "healthy" for s in all_statuses):
        overall = "healthy"
    elif any(s == "error" for s in all_statuses):
        overall = "degraded"
    else:
        overall = "warning"

    return {
        "overall": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": services,
    }
