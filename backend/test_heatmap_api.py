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
    
    # 2. Query heatmap
    print("Querying heatmap...")
    headers = {"Authorization": f"Bearer {token}"}
    heatmap_res = requests.get(f"{base_url}/analytics/heatmap", headers=headers)
    if heatmap_res.status_code != 200:
        print(f"Heatmap query failed: {heatmap_res.status_code} - {heatmap_res.text}")
        return
        
    data = heatmap_res.json()
    points = data.get("points", [])
    print(f"Success! Found {len(points)} points.")
    
    # Print sample points
    print("Sample points:")
    for pt in points[:10]:
        print(f"  x: {pt['x']:.4f}, y: {pt['y']:.4f}, weight: {pt['weight']:.4f}")

if __name__ == "__main__":
    test_api()
