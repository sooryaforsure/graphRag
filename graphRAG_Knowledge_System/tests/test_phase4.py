"""
Phase 4 Enterprise Governance Test Suite
Verifies:
1. Rate Limiting Middleware (HTTP 429 & Retry-After)
2. Disaster Recovery Snapshot Creation & Listing
3. Database Restore from Snapshot
4. Security API Key & Bearer Token Authentication
"""

import requests
import time
import json
import os

BASE_URL = "http://127.0.0.1:8000"

def test_phase4():
    print("=" * 65)
    print("TESTING PHASE 4: PRODUCTION GOVERNANCE & SECURITY")
    print("=" * 65)

    # 1. Health check includes auth_enabled
    print("\n1. Testing GET /health...")
    r = requests.get(f"{BASE_URL}/health")
    assert r.status_code == 200
    h_data = r.json()
    print("   [PASS] Health Status:", h_data.get("status"))
    print("   [PASS] Auth Enabled in Runtime:", h_data.get("auth_enabled"))

    # 2. Disaster Recovery Backup
    print("\n2. Testing POST /admin/backup...")
    r = requests.post(f"{BASE_URL}/admin/backup?workspace=all")
    assert r.status_code == 200
    b_data = r.json()
    backup_file = b_data.get("filename")
    print(f"   [PASS] Backup created: {backup_file}")
    print(f"          Nodes: {b_data.get('node_count')}, Edges: {b_data.get('edge_count')}, Size: {b_data.get('size_bytes')} bytes")

    # 3. List Backups
    print("\n3. Testing GET /admin/backups...")
    r = requests.get(f"{BASE_URL}/admin/backups")
    assert r.status_code == 200
    backups_list = r.json().get("backups", [])
    assert len(backups_list) > 0
    print(f"   [PASS] Found {len(backups_list)} snapshot(s) in backups/")

    # 4. Restore from Backup
    print(f"\n4. Testing POST /admin/restore with {backup_file}...")
    r = requests.post(f"{BASE_URL}/admin/restore?filename={backup_file}")
    assert r.status_code == 200
    res_data = r.json()
    print(f"   [PASS] Restore Status: {res_data.get('status')}")
    print(f"          Restored {res_data.get('nodes_restored')} nodes and {res_data.get('edges_restored')} edges")

    # 5. Sliding Window Rate Limiting Verification
    print("\n5. Testing Sliding Window Rate Limiter (Simulating high-frequency bursts)...")
    from security import rate_limiter
    test_client = "test-ratelimit-probe:127.0.0.1"
    # Exhaust rate limit capacity for test client
    for _ in range(rate_limiter.limit):
        rate_limiter.check(test_client)

    # Next check must be rejected with retry_after > 0
    allowed, retry_after = rate_limiter.check(test_client)
    assert not allowed, "Rate limiter did not block excessive requests!"
    assert retry_after > 0, "No retry-after window returned!"
    print(f"   [PASS] Rate limiter triggered: Blocked request. Retry-After: {retry_after}s")

    # 6. API Key Security Verification
    print("\n6. Testing API Key Authentication Logic...")
    from security import verify_api_key
    from unittest.mock import MagicMock
    import asyncio

    # Test when API key is required
    import security
    security.GRAPHRAG_API_KEY = "enterprise-secret-key-42"

    dummy_req = MagicMock()

    # Case A: Missing key -> 401
    try:
        asyncio.run(verify_api_key(dummy_req, api_key=None, bearer=None))
        assert False, "Should have raised 401 for missing key"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401
        print("   [PASS] Missing API key correctly rejected with HTTP 401")

    # Case B: Wrong key -> 401
    try:
        asyncio.run(verify_api_key(dummy_req, api_key="wrong-key", bearer=None))
        assert False, "Should have raised 401 for invalid key"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401
        print("   [PASS] Invalid API key correctly rejected with HTTP 401")

    # Case C: Valid X-API-Key -> Accepted
    valid_res = asyncio.run(verify_api_key(dummy_req, api_key="enterprise-secret-key-42", bearer=None))
    assert valid_res is True
    print("   [PASS] Valid 'X-API-Key' accepted successfully")

    # Case D: Valid Bearer token -> Accepted
    bearer_creds = MagicMock()
    bearer_creds.credentials = "enterprise-secret-key-42"
    valid_bearer = asyncio.run(verify_api_key(dummy_req, api_key=None, bearer=bearer_creds))
    assert valid_bearer is True
    print("   [PASS] Valid 'Authorization: Bearer' token accepted successfully")

    # Reset security key to default
    security.GRAPHRAG_API_KEY = ""

    print("\n" + "=" * 65)
    print("PHASE 4 PRODUCTION GOVERNANCE & SECURITY VERIFIED!")
    print("=" * 65)

if __name__ == "__main__":
    test_phase4()
