import requests

def test_api():
    base_url = "http://localhost:8000/api/v1"
    
    # 1. Login to get token
    print("Logging in...")
    login_res = requests.post(f"{base_url}/auth/login", json={
        "username": "admin",
        "password": "Admin@1234"
    })
    if login_res.status_code != 200:
        print(f"Login failed: {login_res.status_code} - {login_res.text}")
        return
        
    token = login_res.json()["access_token"]
    print("Login successful! Got token.")
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. Get videos
    print("Querying videos...")
    videos_res = requests.get(f"{base_url}/videos/", headers=headers)
    if videos_res.status_code != 200:
        print(f"Videos query failed: {videos_res.status_code} - {videos_res.text}")
        return
    videos = videos_res.json()
    print(f"Found {len(videos)} videos:")
    for v in videos:
        print(f"  ID: {v['id']}, Name: {v['original_name']}, Status: {v['status']}")
        
        # Query events for this video
        events_res = requests.get(f"{base_url}/events/", params={"video_id": v['id'], "per_page": 500}, headers=headers)
        if events_res.status_code != 200:
            print(f"    Events query failed: {events_res.status_code} - {events_res.text}")
        else:
            ev_data = events_res.json()
            print(f"    Total events in DB: {ev_data.get('total')}, length of items: {len(ev_data.get('items', []))}")
            if ev_data.get('items'):
                print(f"    Sample event: {ev_data['items'][0]}")

if __name__ == "__main__":
    test_api()
