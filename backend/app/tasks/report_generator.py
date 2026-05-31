"""Celery task: Background report generation."""
import logging
from uuid import UUID
from celery import Task
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="app.tasks.report_generator.generate_docx_report",
    max_retries=3,
    default_retry_delay=60,
)
def generate_docx_report(event_id: str, narrative_data: dict, user_id: str | None = None):
    """
    Background task to generate a DOCX report for an event.
    """
    logger.info(f"[TASK] Starting report generation for event: {event_id}")

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.core.config import settings
    from app.models.event import Event
    from app.models.incident import IncidentReport
    from app.services.report_service import ReportService
    import asyncio

    sync_url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    engine = create_engine(sync_url)

    with Session(engine) as db:
        event = db.query(Event).filter(Event.id == UUID(event_id)).first()
        if not event:
            logger.error(f"Event {event_id} not found for report generation.")
            return

        report_service = ReportService()
        
        try:
            # Since report_service.generate_docx is async, run in asyncio loop
            docx_path = asyncio.run(report_service.generate_docx(event, narrative_data))
            
            # Save or update report
            incident = db.query(IncidentReport).filter(IncidentReport.event_id == UUID(event_id)).first()
            if not incident:
                incident = IncidentReport(
                    event_id=UUID(event_id),
                    video_id=event.video_id,
                    title=narrative_data.get("title", f"Incident Report — {event.event_type}"),
                    summary=narrative_data.get("summary"),
                    classification=narrative_data.get("classification"),
                    recommended_actions=narrative_data.get("recommended_actions", []),
                    confidence_notes=narrative_data.get("confidence_notes"),
                    llm_provider=narrative_data.get("llm_provider", "Unknown"),
                    llm_model=narrative_data.get("llm_model", "Unknown"),
                    generated_by=UUID(user_id) if user_id else None,
                    docx_path=docx_path,
                )
                db.add(incident)
            else:
                incident.docx_path = docx_path
                incident.title = narrative_data.get("title", incident.title)
                incident.summary = narrative_data.get("summary", incident.summary)
                incident.classification = narrative_data.get("classification", incident.classification)
                incident.recommended_actions = narrative_data.get("recommended_actions", incident.recommended_actions)
                incident.confidence_notes = narrative_data.get("confidence_notes", incident.confidence_notes)
            
            db.commit()
            logger.info(f"[TASK] DOCX report generated and saved for event: {event_id}")
        except Exception as e:
            logger.error(f"[TASK] Failed to generate report: {e}")
            db.rollback()
            raise e
