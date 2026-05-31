import sys
sys.path.append("/app")
import requests
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.security import create_access_token

# Get user
sync_url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
engine = create_engine(sync_url)
with Session(engine) as db:
    res = db.execute(text("SELECT id, username FROM users LIMIT 1")).fetchone()
    user_id, username = res

token = create_access_token({"sub": str(user_id), "username": username})
headers = {"Authorization": f"Bearer {token}"}

# 1. List zones
print("--- 1. List zones ---")
r = requests.get("http://localhost:8000/api/v1/zones/", headers=headers)
print("Status:", r.status_code)
print("Data:", r.json())

# 2. Create zone
print("\n--- 2. Create zone ---")
zone_data = {
    "name": "Test Zone",
    "color": "#ef4444",
    "polygon": [{"x": 0.1, "y": 0.1}, {"x": 0.5, "y": 0.1}, {"x": 0.5, "y": 0.5}, {"x": 0.1, "y": 0.5}],
    "alert_threshold": 0.8,
    "max_capacity": 5
}
r = requests.post("http://localhost:8000/api/v1/zones/", json=zone_data, headers=headers)
print("Status:", r.status_code)
zone = r.json()
print("Created:", zone)

# 3. List zones again
print("\n--- 3. List zones again ---")
r = requests.get("http://localhost:8000/api/v1/zones/", headers=headers)
print("Status:", r.status_code)
print("Data:", r.json())

# 4. Get zone analytics
print("\n--- 4. Get zone analytics ---")
r = requests.get("http://localhost:8000/api/v1/zones/analytics", headers=headers)
print("Status:", r.status_code)
print("Data:", r.json())
