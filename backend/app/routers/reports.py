"""Reports router — DOCX incident reports and CSV event exports."""
import csv
import io
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.event import Event
from app.models.incident import IncidentReport
from app.schemas.schemas import IncidentReportResponse
from app.services.report_service import ReportService
from app.services.genai_service import get_llm_provider

router = APIRouter()


@router.get("/incident/{event_id}", response_model=IncidentReportResponse)
async def generate_incident_report(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Generate an AI-narrated incident report for an event."""
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(404, "Event not found")

    # Check for existing report
    existing = await db.execute(
        select(IncidentReport)
        .where(IncidentReport.event_id == event_id)
        .order_by(IncidentReport.generated_at.desc())
        .limit(1)
    )
    report = existing.scalars().first()
    if report:
        return report

    # Generate via LLM
    provider = get_llm_provider()
    narrative = await provider.generate_incident_summary({
        "event_id": str(event_id),
        "event_type": event.event_type,
        "severity": event.severity,
        "threat_score": event.threat_score,
        "behavior_flags": event.behavior_flags,
        "timestamp": event.timestamp.isoformat(),
        "zone_name": event.zone_name,
        "confidence": event.confidence,
    })

    # Generate DOCX
    report_service = ReportService()
    docx_path = await report_service.generate_docx(event, narrative)

    # Save report
    incident = IncidentReport(
        event_id=event_id,
        video_id=event.video_id,
        title=narrative.get("title", f"Incident Report — {event.event_type}"),
        summary=narrative.get("summary"),
        classification=narrative.get("classification"),
        recommended_actions=narrative.get("recommended_actions", []),
        confidence_notes=narrative.get("confidence_notes"),
        llm_provider=provider.provider_name,
        llm_model=provider.model_name,
        generated_by=current_user.id,
        docx_path=docx_path,
    )
    db.add(incident)
    await db.flush()
    return incident


@router.get("/incident/{report_id}/download")
async def download_incident_docx(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Download the DOCX incident report file."""
    result = await db.execute(select(IncidentReport).where(IncidentReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report or not report.docx_path:
        raise HTTPException(404, "Report file not found")

    path = Path(report.docx_path)
    if not path.exists():
        raise HTTPException(404, "Report file missing from disk")

    return FileResponse(
        path=str(path),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=path.name,
    )


@router.get("/events/export")
async def export_events_csv(
    video_id: uuid.UUID | None = None,
    severity: str | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Export detection events as a CSV file."""
    query = select(Event).order_by(Event.timestamp.desc())
    if video_id:
        query = query.where(Event.video_id == video_id)
    if severity:
        query = query.where(Event.severity == severity)
    if from_dt:
        query = query.where(Event.timestamp >= from_dt)
    if to_dt:
        query = query.where(Event.timestamp <= to_dt)

    result = await db.execute(query)
    events = result.scalars().all()

    # Build CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "timestamp", "event_type", "severity", "threat_score",
        "confidence", "track_id", "zone_name", "behavior_flags",
        "acknowledged", "video_id",
    ])
    for ev in events:
        writer.writerow([
            str(ev.id), ev.timestamp.isoformat(), ev.event_type, ev.severity,
            round(ev.threat_score, 4), round(ev.confidence, 4), ev.track_id,
            ev.zone_name, "|".join(ev.behavior_flags or []),
            ev.acknowledged, str(ev.video_id),
        ])

    output.seek(0)
    filename = f"events_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/snapshot/{video_id}")
async def capture_evidence_snapshot(
    video_id: uuid.UUID,
    timestamp_secs: float = 0.0,
    event_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Capture a JPEG frame snapshot from a video at a given timestamp for evidence."""
    import asyncio
    from app.models.video import Video

    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(404, "Video not found")

    video_path = Path(video.file_path)
    if not video_path.exists():
        raise HTTPException(404, "Video file not found on disk")

    def extract_frame(path: str, secs: float) -> bytes:
        import cv2
        cap = cv2.VideoCapture(path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        frame_idx = int(secs * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        cap.release()
        if not ret:
            raise ValueError(f"Could not extract frame at {secs}s")
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
        return buf.tobytes()

    loop = asyncio.get_event_loop()
    try:
        jpeg_bytes = await loop.run_in_executor(None, extract_frame, str(video_path), timestamp_secs)
    except Exception as e:
        raise HTTPException(500, f"Frame extraction failed: {str(e)}")

    # Save to snapshots dir
    snap_dir = Path(settings.REPORTS_DIR) / "snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)
    snap_name = f"snapshot_{video_id}_{int(timestamp_secs * 1000)}ms_{uuid.uuid4().hex[:8]}.jpg"
    snap_path = snap_dir / snap_name
    snap_path.write_bytes(jpeg_bytes)

    return {
        "snapshot_id": snap_name,
        "video_id": str(video_id),
        "event_id": str(event_id) if event_id else None,
        "timestamp_secs": timestamp_secs,
        "filename": snap_name,
        "size_bytes": len(jpeg_bytes),
        "captured_at": datetime.utcnow().isoformat(),
        "download_url": f"/api/v1/reports/snapshot/download/{snap_name}",
    }


@router.get("/snapshot/download/{snap_name}")
async def download_snapshot(
    snap_name: str,
    _=Depends(get_current_user),
):
    """Download a captured evidence snapshot."""
    snap_path = Path(settings.REPORTS_DIR) / "snapshots" / snap_name
    if not snap_path.exists():
        raise HTTPException(404, "Snapshot not found")
    return FileResponse(
        path=str(snap_path),
        media_type="image/jpeg",
        filename=snap_name,
    )


@router.delete("/snapshot/{snap_name}")
async def delete_snapshot(
    snap_name: str,
    _=Depends(get_current_user),
):
    """Delete a captured evidence snapshot."""
    snap_path = Path(settings.REPORTS_DIR) / "snapshots" / snap_name
    if not snap_path.exists():
        raise HTTPException(404, "Snapshot not found")
    try:
        snap_path.unlink()
        return {"deleted": True, "filename": snap_name}
    except Exception as e:
        raise HTTPException(500, f"Failed to delete snapshot: {str(e)}")



@router.get("/snapshots")
async def list_snapshots(
    video_id: uuid.UUID | None = None,
    _=Depends(get_current_user),
):
    """List all captured evidence snapshots."""
    snap_dir = Path(settings.REPORTS_DIR) / "snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)
    snaps = []
    for f in sorted(snap_dir.glob("*.jpg"), key=lambda x: x.stat().st_mtime, reverse=True):
        parts = f.stem.split("_")
        vid_id = parts[1] if len(parts) > 1 else None
        if video_id and vid_id != str(video_id).replace("-", ""):
            continue
        snaps.append({
            "filename": f.name,
            "size_bytes": f.stat().st_size,
            "captured_at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
            "download_url": f"/api/v1/reports/snapshot/download/{f.name}",
        })
    return snaps
