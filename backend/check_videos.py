import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings

async def inspect():
    engine = create_async_engine(settings.DATABASE_URL)
    
    print("--- Videos in Postgres ---")
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT id, filename, original_name, status, error_message FROM videos ORDER BY uploaded_at DESC"))
        for row in res:
            print(f"ID: {row[0]}, File: {row[1]}, Name: {row[2]}, Status: {row[3]}, Error: {row[4]}")
            
    print("\n--- Event Counts per Video ---")
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT video_id, count(*), array_agg(distinct event_type) FROM events GROUP BY video_id"))
        for row in res:
            print(f"Video ID: {row[0]}, Count: {row[1]}, Types: {row[2]}")

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(inspect())
