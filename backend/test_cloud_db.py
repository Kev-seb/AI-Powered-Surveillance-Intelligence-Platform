import asyncio
import sys
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from pymongo import MongoClient
import redis

# We load variables from .env
def test_connections():
    import os
    from dotenv import load_dotenv
    load_dotenv(dotenv_path="/app/.env", override=True)
    
    db_url = os.getenv("DATABASE_URL")
    mongo_url = os.getenv("MONGO_URL")
    redis_url = os.getenv("REDIS_URL")
    
    print("Loaded environment variables:")
    print(f"  Postgres URL: {db_url}")
    print(f"  Mongo URL: {mongo_url}")
    print(f"  Redis URL: {redis_url}")
    print("-" * 50)
    
    # 1. Test Redis Connection
    print("Testing Upstash Redis connection...")
    try:
        r = redis.from_url(redis_url)
        r.ping()
        print("✅ Redis connection successful!")
        r.close()
    except Exception as e:
        print(f"❌ Redis connection failed: {e}")
        
    # 2. Test MongoDB Atlas Connection
    print("\nTesting MongoDB Atlas connection...")
    try:
        client = MongoClient(mongo_url)
        db = client.get_default_database()
        print(f"✅ MongoDB Atlas connection successful! DB Name: {db.name}")
        client.close()
    except Exception as e:
        print(f"❌ MongoDB Atlas connection failed: {e}")

    # 3. Test Supabase Postgres Connection (Async)
    print("\nTesting Supabase Postgres connection...")
    async def test_postgres():
        try:
            engine = create_async_engine(db_url)
            async with engine.connect() as conn:
                res = await conn.execute(text("SELECT 1"))
                val = res.scalar()
                print(f"✅ Postgres connection successful! Result: {val}")
            await engine.dispose()
        except Exception as e:
            print(f"❌ Postgres connection failed: {e}")
            
    asyncio.run(test_postgres())

if __name__ == "__main__":
    test_connections()
