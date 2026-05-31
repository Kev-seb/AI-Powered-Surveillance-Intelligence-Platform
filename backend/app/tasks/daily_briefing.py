"""Daily intelligence briefing Celery task."""
import logging
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.daily_briefing.generate_daily_briefing")
def generate_daily_briefing():
    """Generate and store daily AI intelligence briefing."""
    logger.info("Generating daily intelligence briefing...")
    try:
        from sqlalchemy import create_engine, func, select
        from sqlalchemy.orm import Session
        from app.core.config import settings
        from app.models.event import Event
        from datetime import datetime, timezone, timedelta

        sync_url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
        engine = create_engine(sync_url)

        with Session(engine) as db:
            today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            stats = {
                "total_events": db.query(func.count(Event.id)).filter(Event.timestamp >= today).scalar() or 0,
                "critical_threats": db.query(func.count(Event.id)).filter(
                    Event.timestamp >= today, Event.severity == "critical"
                ).scalar() or 0,
                "persons_detected": db.query(func.count(func.distinct(Event.track_id))).filter(
                    Event.timestamp >= today
                ).scalar() or 0,
                "top_zones": "See dashboard for zone breakdown",
                "behavior_summary": "Automated analysis complete",
                "date": today.strftime("%Y-%m-%d"),
            }

        # Run async LLM call in sync context using asyncio
        import asyncio
        from app.services.genai_service import get_llm_provider
        provider = get_llm_provider()
        briefing_text = asyncio.run(provider.generate_daily_briefing(stats))

        # Store in MongoDB
        from pymongo import MongoClient
        client = MongoClient(settings.MONGO_URL)
        db_mongo = client.get_default_database()
        db_mongo.intelligence_briefings.replace_one(
            {"date": stats["date"]},
            {"date": stats["date"], "briefing": briefing_text, "stats": stats,
             "generated_at": datetime.utcnow()},
            upsert=True,
        )
        client.close()
        logger.info(f"Daily briefing generated for {stats['date']}")
    except Exception as e:
        logger.error(f"Daily briefing failed: {e}")
