"""Analytics router — dashboard metrics, occupancy, heatmaps."""
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.event import Event
from app.models.video import Video
from app.schemas.schemas import DashboardMetrics

router = APIRouter()


@router.get("/dashboard", response_model=DashboardMetrics)
async def get_dashboard_metrics(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Aggregate metrics for the main dashboard."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Total events today
    total_today = await db.scalar(
        select(func.count(Event.id)).where(Event.timestamp >= today_start)
    )

    # Active threats (high/critical, not acknowledged)
    active_threats = await db.scalar(
        select(func.count(Event.id)).where(
            Event.severity.in_(["high", "critical"]),
            Event.acknowledged == False,
            Event.timestamp >= today_start,
        )
    )

    # Persons detected today (unique track IDs)
    persons_result = await db.execute(
        select(func.count(func.distinct(Event.track_id))).where(
            Event.timestamp >= today_start
        )
    )
    persons_detected = persons_result.scalar_one() or 0

    # Videos processed today
    videos_processed = await db.scalar(
        select(func.count(Video.id)).where(
            Video.status == "completed",
            Video.processed_at >= today_start,
        )
    )

    # Average threat score today
    avg_score = await db.scalar(
        select(func.avg(Event.threat_score)).where(Event.timestamp >= today_start)
    )

    # Severity breakdown
    sev_result = await db.execute(
        select(Event.severity, func.count(Event.id))
        .where(Event.timestamp >= today_start)
        .group_by(Event.severity)
    )
    severity_breakdown = {row[0]: row[1] for row in sev_result.fetchall()}

    # Event type breakdown
    type_result = await db.execute(
        select(Event.event_type, func.count(Event.id))
        .where(Event.timestamp >= today_start)
        .group_by(Event.event_type)
        .order_by(func.count(Event.id).desc())
        .limit(10)
    )
    event_type_breakdown = {row[0]: row[1] for row in type_result.fetchall()}

    # Hourly event counts (last 24 hours)
    hourly_result = await db.execute(
        text("""
            SELECT
                date_trunc('hour', timestamp) AS hour,
                COUNT(*) AS count,
                AVG(threat_score) AS avg_threat
            FROM events
            WHERE timestamp >= NOW() - INTERVAL '24 hours'
            GROUP BY hour
            ORDER BY hour
        """)
    )
    hourly_events = [
        {"hour": row[0].isoformat(), "count": row[1], "avg_threat": float(row[2] or 0)}
        for row in hourly_result.fetchall()
    ]

    # Top zones
    zone_result = await db.execute(
        select(Event.zone_name, func.count(Event.id).label("count"))
        .where(
            Event.timestamp >= today_start,
            Event.zone_name != None,
        )
        .group_by(Event.zone_name)
        .order_by(func.count(Event.id).desc())
        .limit(5)
    )
    top_zones = [{"zone": row[0], "count": row[1]} for row in zone_result.fetchall()]

    return DashboardMetrics(
        total_events_today=total_today or 0,
        active_threats=active_threats or 0,
        persons_detected=persons_detected,
        videos_processed=videos_processed or 0,
        avg_threat_score=float(avg_score or 0.0),
        severity_breakdown=severity_breakdown,
        event_type_breakdown=event_type_breakdown,
        hourly_events=hourly_events,
        top_zones=top_zones,
    )


@router.get("/heatmap")
async def get_heatmap_data(
    video_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Return aggregated position data for heatmap visualization."""
    query = select(Event.bbox, Event.threat_score, Video.resolution).outerjoin(Video, Event.video_id == Video.id).where(Event.bbox != None)
    if video_id:
        from uuid import UUID
        query = query.where(Event.video_id == UUID(video_id))

    result = await db.execute(query.limit(2000))
    points = []
    for bbox, score, resolution in result.fetchall():
        if bbox and "x" in bbox and "y" in bbox:
            cx = bbox["x"] + bbox.get("w", 0) / 2
            cy = bbox["y"] + bbox.get("h", 0) / 2

            width, height = 1280, 720
            if resolution and "x" in resolution:
                try:
                    w_str, h_str = resolution.split("x")
                    width = int(w_str)
                    height = int(h_str)
                except Exception:
                    pass

            is_normalized = not (
                bbox["x"] > 1.0 or
                bbox["y"] > 1.0 or
                bbox.get("w", 0) > 1.0 or
                bbox.get("h", 0) > 1.0
            )

            if not is_normalized:
                cx = cx / width
                cy = cy / height

            cx = max(0.0, min(1.0, cx))
            cy = max(0.0, min(1.0, cy))

            points.append({"x": cx, "y": cy, "weight": score})
    return {"points": points}


@router.get("/timeline")
async def get_timeline(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Event timeline for a specific video."""
    from uuid import UUID
    result = await db.execute(
        select(Event)
        .where(Event.video_id == UUID(video_id))
        .order_by(Event.timestamp_secs)
    )
    events = result.scalars().all()
    return [
        {
            "frame": ev.frame_number,
            "time_secs": ev.timestamp_secs,
            "track_id": ev.track_id,
            "event_type": ev.event_type,
            "severity": ev.severity,
            "threat_score": ev.threat_score,
        }
        for ev in events
    ]


@router.get("/trends")
async def get_trends(
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Daily event trends for the past N days."""
    result = await db.execute(text(f"""
        SELECT
            date_trunc('day', timestamp) AS day,
            COUNT(*) AS count,
            COUNT(*) FILTER (WHERE severity IN ('high','critical')) AS threats,
            AVG(threat_score) AS avg_threat
        FROM events
        WHERE timestamp >= NOW() - INTERVAL '{days} days'
        GROUP BY day
        ORDER BY day
    """))
    rows = result.fetchall()
    return [
        {
            "day": row[0].strftime("%b %d"),
            "events": row[1],
            "threats": row[2],
            "avg_threat": float(row[3] or 0),
        }
        for row in rows
    ]


@router.get("/person-activity")
async def get_person_activity(
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Top person/track activity summary."""
    result = await db.execute(text(f"""
        SELECT
            track_id,
            COUNT(*) AS event_count,
            MAX(threat_score) AS max_threat,
            COUNT(DISTINCT date_trunc('day', timestamp)) AS active_days
        FROM events
        WHERE timestamp >= NOW() - INTERVAL '{days} days'
          AND track_id IS NOT NULL
        GROUP BY track_id
        ORDER BY event_count DESC
        LIMIT 20
    """))
    return [
        {"track_id": r[0], "event_count": r[1], "max_threat": float(r[2] or 0), "active_days": r[3]}
        for r in result.fetchall()
    ]

