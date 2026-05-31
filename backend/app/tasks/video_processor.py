"""
Celery task: orchestrates the full video processing pipeline.
Runs inside the celery worker container (has GPU access).
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict
from uuid import UUID

from celery import Task

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


class VideoProcessorTask(Task):
    """Base task class with pipeline initialization."""
    _pipeline = None

    @property
    def pipeline(self):
        if self._pipeline is None:
            from ml.pipeline.video_processor import VideoPipeline
            self._pipeline = VideoPipeline()
        return self._pipeline


@celery_app.task(
    bind=True,
    base=VideoProcessorTask,
    name="app.tasks.video_processor.process_video_task",
    max_retries=2,
    default_retry_delay=30,
)
def process_video_task(self, video_id: str, options: Dict[str, Any]):
    """
    Main video processing Celery task.
    Runs the complete AI pipeline frame-by-frame.
    """
    logger.info(f"[TASK] Starting video processing: {video_id}")

    # Use sync DB access in Celery context
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.core.config import settings

    # Celery uses sync SQLAlchemy
    sync_url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    engine = create_engine(sync_url)

    with Session(engine) as db:
        from app.models.video import Video
        video = db.query(Video).filter(Video.id == UUID(video_id)).first()
        if not video:
            logger.error(f"Video {video_id} not found")
            return

        # Update status
        video.status = "processing"
        db.commit()

        try:
            mongo_client = None
            try:
                from pymongo import MongoClient
                from app.core.config import settings
                mongo_client = MongoClient(settings.MONGO_URL.replace("mongodb://", "mongodb://"))
                mongo_db = mongo_client.get_default_database()

                # Run pipeline
                results = self.pipeline.process(
                    video_path=video.file_path,
                    video_id=video_id,
                    options=options,
                    progress_callback=lambda p, n: _update_progress(db, video, p, n),
                    mongo_db=mongo_db,
                )
            finally:
                if mongo_client:
                    mongo_client.close()

            # Persist events
            from app.models.event import Event
            from app.models.alert import Alert

            events_created = 0
            for ev_data in results.get("events", []):
                raw_person_id = ev_data.get("person_id")
                parsed_person_id = UUID(raw_person_id) if raw_person_id else None

                event = Event(
                    video_id=UUID(video_id),
                    track_id=ev_data.get("track_id"),
                    person_id=parsed_person_id,
                    event_type=ev_data.get("event_type", "detection"),
                    severity=ev_data.get("severity", "low"),
                    threat_score=ev_data.get("threat_score", 0.0),
                    confidence=ev_data.get("confidence", 0.0),
                    frame_number=ev_data.get("frame_number"),
                    timestamp_secs=ev_data.get("timestamp_secs"),
                    bbox=ev_data.get("bbox"),
                    zone_id=ev_data.get("zone_id"),
                    zone_name=ev_data.get("zone_name"),
                    behavior_flags=ev_data.get("behavior_flags", []),
                    metadata_=ev_data.get("metadata", {}),
                )
                db.add(event)
                db.flush()
                events_created += 1

                # Create alert for medium, high, and critical severity
                if ev_data.get("severity") in ("medium", "high", "critical"):
                    alert = Alert(
                        event_id=event.id,
                        alert_type=ev_data.get("event_type"),
                        severity=ev_data.get("severity"),
                        title=f"⚠️ {ev_data.get('event_type', 'Threat').replace('_', ' ').title()} Detected",
                        description=f"Threat score: {ev_data.get('threat_score', 0):.1%} in {ev_data.get('zone_name', 'monitored zone')}",
                        threat_score=ev_data.get("threat_score"),
                    )
                    db.add(alert)
                    db.flush()

                    # Broadcast the alert to Redis pub/sub
                    alert_payload = {
                        "type": "alert",
                        "alert_id": str(alert.id),
                        "alert_type": alert.alert_type,
                        "severity": alert.severity,
                        "title": alert.title,
                        "description": alert.description,
                        "threat_score": alert.threat_score,
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    }
                    _broadcast_alert(alert_payload)

            # Save trajectories to MongoDB
            _save_trajectories(video_id, results.get("trajectories", {}))

            # Mark complete
            video.status = "completed"
            video.progress = 1.0
            video.frames_processed = results.get("frames_processed", 0)
            video.processed_at = datetime.now(timezone.utc)
            video.metadata_["events_count"] = events_created
            db.commit()

            logger.info(f"[TASK] Completed: {video_id} — {events_created} events created")

            # Broadcast completion via Redis pub/sub → WebSocket
            _broadcast_completion(video_id, events_created)

        except Exception as exc:
            video.status = "failed"
            video.error_message = str(exc)
            db.commit()
            logger.error(f"[TASK] Failed: {video_id} — {exc}")
            raise self.retry(exc=exc)


def _update_progress(db, video, progress: float, frames: int):
    video.progress = progress
    video.frames_processed = frames
    db.commit()


def _save_trajectories(video_id: str, trajectories: dict):
    """Save trajectory data to MongoDB."""
    try:
        import motor.motor_asyncio as _motor
        # Use synchronous pymongo for Celery context
        from pymongo import MongoClient
        from app.core.config import settings
        client = MongoClient(settings.MONGO_URL.replace("mongodb://", "mongodb://"))
        db = client.get_default_database()
        if trajectories:
            # MongoDB requires string keys — convert int track IDs to strings
            str_trajectories = {str(k): v for k, v in trajectories.items()}
            doc = {
                "video_id": video_id,
                "trajectories": str_trajectories,
                "created_at": datetime.utcnow(),
            }
            db.trajectories.replace_one(
                {"video_id": video_id}, doc, upsert=True
            )
        client.close()
    except Exception as e:
        logger.warning(f"Failed to save trajectories: {e}")


def _broadcast_completion(video_id: str, events_count: int):
    """Publish completion event to Redis for WebSocket broadcasting."""
    try:
        import redis
        from app.core.config import settings
        r = redis.from_url(settings.REDIS_URL)
        import json
        r.publish("asip:events", json.dumps({
            "type": "video_processed",
            "video_id": video_id,
            "events_count": events_count,
            "timestamp": datetime.utcnow().isoformat(),
        }))
        r.close()
    except Exception as e:
        logger.warning(f"Failed to broadcast completion: {e}")


def _broadcast_alert(alert_data: dict):
    """Publish alert event to Redis for WebSocket broadcasting."""
    try:
        import redis
        from app.core.config import settings
        r = redis.from_url(settings.REDIS_URL)
        import json
        r.publish("asip:events", json.dumps(alert_data))
        r.close()
    except Exception as e:
        logger.warning(f"Failed to broadcast alert: {e}")
