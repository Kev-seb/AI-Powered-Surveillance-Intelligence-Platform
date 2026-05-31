import asyncio
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings

async def inspect():
    engine = create_async_engine(settings.DATABASE_URL)
    
    print("--- Sample Events with BBox ---")
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT id, video_id, bbox, threat_score FROM events WHERE bbox IS NOT NULL LIMIT 10"))
        rows = res.fetchall()
        if not rows:
            print("No events with bounding box found.")
        for row in rows:
            print(f"Event ID: {row[0]}, Video ID: {row[1]}, BBox: {json.dumps(row[2])}, Threat: {row[3]}")
            
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(inspect())
