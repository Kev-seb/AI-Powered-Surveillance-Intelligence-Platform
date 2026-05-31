import requests

def test_dashboard():
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
    
    # 2. Query dashboard metrics
    print("Querying dashboard...")
    headers = {"Authorization": f"Bearer {token}"}
    dashboard_res = requests.get(f"{base_url}/analytics/dashboard", headers=headers)
    print(f"Response code: {dashboard_res.status_code}")
    if dashboard_res.status_code != 200:
        print(f"Failed: {dashboard_res.text}")
        return
        
    data = dashboard_res.json()
    print("Dashboard Response Payload:")
    import json
    print(json.dumps(data, indent=2))

if __name__ == "__main__":
    test_dashboard()
