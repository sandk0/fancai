
import asyncio
import httpx

async def test_api():
    base_url = "http://localhost:8000/api/v1"
    
    # Login
    async with httpx.AsyncClient() as client:
        print("Authenticating...")
        login_resp = await client.post(
            f"{base_url}/auth/login",
            data={"username": "sandk008@gmail.com", "password": "Grh08hert12233fssa!"}
        )
        print(f"Login status: {login_resp.status_code}")
        if login_resp.status_code != 200:
            print(f"Login failed: {login_resp.text}")
            return
        
        token = login_resp.json().get("access_token")
        print(f"Token obtained: {token[:20]}...")
        
        # Get parsing status
        book_id = "97a0c89f-cadf-4915-a9f4-749edc18505f"
        headers = {"Authorization": f"Bearer {token}"}
        
        print(f"\nFetching parsing-status for {book_id}...")
        status_resp = await client.get(
            f"{base_url}/books/{book_id}/parsing-status",
            headers=headers
        )
        print(f"Status code: {status_resp.status_code}")
        print(f"Response: {status_resp.text}")
        
        # Also get book list to check is_processing
        print(f"\nFetching book list...")
        list_resp = await client.get(
            f"{base_url}/books/?skip=0&limit=5",
            headers=headers
        )
        print(f"List status: {list_resp.status_code}")
        books = list_resp.json().get("books", [])
        for b in books:
            if b.get("id") == book_id:
                print(f"FOUND BOOK: is_processing={b.get('is_processing')}, is_parsed={b.get('is_parsed')}, parsing_progress={b.get('parsing_progress')}")

if __name__ == "__main__":
    asyncio.run(test_api())
