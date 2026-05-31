"""Audit log router — query and search platform audit trail."""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.audit import AuditLog

router = APIRouter()


@router.get("/")
async def list_audit_logs(
    action: Optional[str] = None,
    username: Optional[str] = None,
    resource_type: Optional[str] = None,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Query audit logs with optional filters."""
    query = select(AuditLog).order_by(AuditLog.timestamp.desc())

    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    if username:
        query = query.where(AuditLog.username.ilike(f"%{username}%"))
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)
    if from_dt:
        query = query.where(AuditLog.timestamp >= from_dt)
    if to_dt:
        query = query.where(AuditLog.timestamp <= to_dt)

    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    results = await db.execute(query.offset((page - 1) * per_page).limit(per_page))
    logs = results.scalars().all()

    return {
        "items": [
            {
                "id": str(log.id),
                "timestamp": log.timestamp.isoformat(),
                "username": log.username,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "ip_address": log.ip_address,
                "status_code": log.status_code,
                "duration_ms": log.duration_ms,
                "trace_id": log.trace_id,
            }
            for log in logs
        ],
        "total": total or 0,
        "page": page,
        "per_page": per_page,
    }


@router.get("/summary")
async def get_audit_summary(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Summary statistics for audit logs."""
    from sqlalchemy import text
    result = await db.execute(text("""
        SELECT
            action,
            COUNT(*) AS count,
            COUNT(DISTINCT username) AS unique_users,
            AVG(duration_ms) AS avg_duration_ms
        FROM audit_logs
        WHERE timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY action
        ORDER BY count DESC
        LIMIT 20
    """))
    rows = result.fetchall()

    user_result = await db.execute(text("""
        SELECT username, COUNT(*) AS count
        FROM audit_logs
        WHERE timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY username
        ORDER BY count DESC
        LIMIT 10
    """))
    user_rows = user_result.fetchall()

    total_24h = await db.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.timestamp >= datetime.now(timezone.utc).replace(hour=0, minute=0, second=0)
        )
    )

    return {
        "total_24h": total_24h or 0,
        "top_actions": [{"action": r[0], "count": r[1], "unique_users": r[2], "avg_ms": float(r[3] or 0)} for r in rows],
        "top_users": [{"username": r[0], "count": r[1]} for r in user_rows],
    }


@router.get("/export")
async def export_audit_logs_csv(
    action: Optional[str] = None,
    username: Optional[str] = None,
    resource_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Export audit logs as a CSV file."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    query = select(AuditLog).order_by(AuditLog.timestamp.desc())

    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    if username:
        query = query.where(AuditLog.username.ilike(f"%{username}%"))
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)

    result = await db.execute(query)
    logs = result.scalars().all()

    # Build CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "timestamp", "username", "action", "resource_type",
        "resource_id", "ip_address", "status_code", "duration_ms",
        "trace_id",
    ])
    for log in logs:
        writer.writerow([
            str(log.id), log.timestamp.isoformat() if log.timestamp else "",
            log.username or "", log.action, log.resource_type or "",
            log.resource_id or "", log.ip_address or "", log.status_code or "",
            log.duration_ms or "", log.trace_id or "",
        ])

    output.seek(0)
    filename = f"audit_log_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

