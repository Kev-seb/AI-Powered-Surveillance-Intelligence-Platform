import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings

async def inspect():
    engine = create_async_engine(settings.DATABASE_URL)
    
    print("--- Alerts in Postgres ---")
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT count(*) FROM alerts"))
        count = res.scalar()
        print(f"Total Alerts: {count}")
        
        if count > 0:
            res = await conn.execute(text("SELECT id, alert_type, severity, title FROM alerts LIMIT 10"))
            for row in res:
                print(f"ID: {row[0]}, Type: {row[1]}, Severity: {row[2]}, Title: {row[3]}")
            
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(inspect())
