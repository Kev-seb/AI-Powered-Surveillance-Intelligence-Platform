import asyncio
import json
import requests
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings

VIDEO_ID = "b62b2c6f-1402-45cb-908e-5e627ac11eaf"

async def reset_db():
    engine = create_async_engine(settings.DATABASE_URL)
    print("Resetting database events, alerts, and reports for video...")
    async with engine.begin() as conn:
        # Delete alerts referencing events of this video
        await conn.execute(text("""
            DELETE FROM alerts WHERE event_id IN (
                SELECT id FROM events WHERE video_id = :video_id
            )
        """), {"video_id": VIDEO_ID})
        
        # Delete reports
        await conn.execute(text("DELETE FROM incident_reports WHERE video_id = :video_id"), {"video_id": VIDEO_ID})
        
        # Delete events
        await conn.execute(text("DELETE FROM events WHERE video_id = :video_id"), {"video_id": VIDEO_ID})
        
        # Reset video status
        await conn.execute(text("UPDATE videos SET status = 'pending', progress = 0.0 WHERE id = :video_id"), {"video_id": VIDEO_ID})
        
    print("Database reset complete.")
    await engine.dispose()

def trigger_processing():
    base_url = "http://localhost:8000/api/v1"
    
    # 1. Login
    print("Logging in...")
    login_res = requests.post(f"{base_url}/auth/login", json={
        "username": "admin",
        "password": "Admin@1234"
    })
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. Trigger processing
    print("Triggering processing...")
    res = requests.post(f"{base_url}/videos/{VIDEO_ID}/process", json={
        "yolo_confidence": 0.25,
        "enable_face_recognition": True,
        "enable_behavior_analysis": True
    }, headers=headers)
    print(f"Trigger response: {res.status_code} - {res.text}")

if __name__ == "__main__":
    asyncio.run(reset_db())
    trigger_processing()
