"""
Security & Governance Module (Phase 4 Enterprise)
- API Key & Bearer Token Authentication
- In-memory Sliding Window Rate Limiting (DDoS protection)
"""

import os
import time
from collections import defaultdict
from typing import Optional
from fastapi import Request, HTTPException, Security
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

load_dotenv()

GRAPHRAG_API_KEY = os.getenv("GRAPHRAG_API_KEY", "").strip()
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "180"))

# Fast header extractors
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_auth = HTTPBearer(auto_error=False)

def is_auth_enabled() -> bool:
    """Returns True if an API key has been configured in the environment."""
    return bool(GRAPHRAG_API_KEY)

async def verify_api_key(
    request: Request,
    api_key: Optional[str] = Security(api_key_header),
    bearer: Optional[HTTPAuthorizationCredentials] = Security(bearer_auth)
) -> bool:
    """
    FastAPI security dependency.
    Validates either 'X-API-Key' header or 'Authorization: Bearer <key>'.
    Bypasses validation if GRAPHRAG_API_KEY is not configured in .env.
    """
    if not is_auth_enabled():
        return True

    candidate_key = None
    if api_key:
        candidate_key = api_key.strip()
    elif bearer and bearer.credentials:
        candidate_key = bearer.credentials.strip()

    if not candidate_key or candidate_key != GRAPHRAG_API_KEY:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key. Provide a valid 'X-API-Key' or 'Authorization: Bearer' token.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    return True

# ==============================================================================
# SLIDING WINDOW RATE LIMITER (Zero external Redis dependency)
# ==============================================================================

class SlidingWindowRateLimiter:
    def __init__(self, limit: int = 180, window_seconds: int = 60):
        self.limit = limit
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)

    def check(self, client_id: str) -> tuple[bool, int]:
        """Returns (is_allowed, retry_after_seconds)."""
        now = time.time()
        timestamps = self.requests[client_id]

        cutoff = now - self.window_seconds
        while timestamps and timestamps[0] <= cutoff:
            timestamps.pop(0)

        if len(timestamps) >= self.limit:
            oldest = timestamps[0]
            retry_after = max(1, int(self.window_seconds - (now - oldest)))
            return False, retry_after

        timestamps.append(now)
        return True, 0

rate_limiter = SlidingWindowRateLimiter(limit=RATE_LIMIT_PER_MINUTE, window_seconds=60)

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if path in ["/health", "/stats", "/docs", "/openapi.json", "/redoc", "/favicon.ico"] or path.startswith("/upload/status"):
            return await call_next(request)

        client_ip = request.client.host if request.client else "127.0.0.1"
        auth_hdr = request.headers.get("X-API-Key", "") or request.headers.get("Authorization", "")
        client_key = f"{client_ip}:{auth_hdr[:16]}"

        allowed, retry_after = rate_limiter.check(client_key)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please slow down requests.", "retry_after": retry_after},
                headers={"Retry-After": str(retry_after)}
            )

        return await call_next(request)
