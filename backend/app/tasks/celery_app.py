"""Celery application configuration."""
from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "asip",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.tasks.video_processor",
        "app.tasks.report_generator",
        "app.tasks.daily_briefing",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_routes={
        "app.tasks.video_processor.*": {"queue": "video_processing"},
        "app.tasks.report_generator.*": {"queue": "report_generation"},
        "app.tasks.daily_briefing.*": {"queue": "default"},
    },
    beat_schedule={
        "daily-intelligence-briefing": {
            "task": "app.tasks.daily_briefing.generate_daily_briefing",
            "schedule": 86400,  # every 24 hours
        },
    },
)
