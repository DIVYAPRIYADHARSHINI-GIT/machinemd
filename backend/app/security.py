"""Password hashing (bcrypt), JWT issuing/verification, role guards, login rate limiting."""

from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import config
from .db import get_db
from .models import RevokedToken, User

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("ascii")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:
        return False


def create_token(user: User) -> tuple[str, datetime]:
    exp = datetime.now(timezone.utc) + timedelta(minutes=config.JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user.id), "email": user.email, "role": user.role, "exp": exp, "iat": datetime.now(timezone.utc), "jti": uuid.uuid4().hex}
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM), exp


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid authentication token.")


def get_token_payload(creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)) -> dict:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated.")
    payload = decode_token(creds.credentials)
    if db.get(RevokedToken, payload.get("jti", "")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This session was signed out. Please sign in again.")
    return payload


def get_current_user(payload: dict = Depends(get_token_payload), db: Session = Depends(get_db)) -> User:
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User account is not active.")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required. Viewers have read-only access.")
    return user


class LoginRateLimiter:
    """Sliding-window limiter keyed by client IP and by e-mail (per instance)."""

    def __init__(self, max_attempts: int, window: int) -> None:
        self.max_attempts = max_attempts
        self.window = window
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque:
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def check(self, *keys: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in keys:
                q = self._prune(key, now)
                if len(q) >= self.max_attempts:
                    retry = int(self.window - (now - q[0])) + 1
                    raise HTTPException(
                        status.HTTP_429_TOO_MANY_REQUESTS,
                        f"Too many failed sign-in attempts. Try again in {retry} seconds.",
                        headers={"Retry-After": str(retry)},
                    )

    def fail(self, *keys: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in keys:
                self._hits[key].append(now)

    def reset(self, *keys: str) -> None:
        with self._lock:
            for key in keys:
                self._hits.pop(key, None)


login_limiter = LoginRateLimiter(config.LOGIN_MAX_ATTEMPTS, config.LOGIN_WINDOW_SECONDS)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
