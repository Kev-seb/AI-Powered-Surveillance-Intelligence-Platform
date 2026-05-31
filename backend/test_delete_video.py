import requests

def delete_test_video():
    base_url = "http://localhost:8000/api/v1"
    video_id = "8a209660-ff30-40ec-90f8-5e2b361a56a5"
    
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
    
    # 2. Delete video
    print(f"Deleting video {video_id}...")
    headers = {"Authorization": f"Bearer {token}"}
    delete_res = requests.delete(f"{base_url}/videos/{video_id}", headers=headers)
    print(f"Response code: {delete_res.status_code}")
    print(f"Response: {delete_res.text}")

if __name__ == "__main__":
    delete_test_video()
