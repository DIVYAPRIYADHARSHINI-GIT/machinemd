"""Authentication: login (rate limited), logout (token denylist), current user, change password."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import RevokedToken, User, utcnow
from ..security import HASH_PREFIX, client_ip, create_token, get_current_user, get_token_payload, is_replay, login_limiter, password_hash_for, verify_password
from ..services.predictions import log_activity
from ..validation import EMAIL_RE, validate_password

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Enter a valid e-mail address")
        return v


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _strong(cls, v: str) -> str:
        return v if v.startswith(HASH_PREFIX) else validate_password(v)


def user_dict(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    keys = (f"ip:{ip}", f"email:{body.email}")
    login_limiter.check(*keys)
    user = db.scalar(select(User).where(func.lower(User.email) == body.email))
    if user is None or not verify_password(body.password, user.password_hash):
        login_limiter.fail(*keys)
        log_activity(db, body.email, "login_failed", "user", detail=f"Failed sign-in from {ip}")
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect e-mail or password.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated. Contact an administrator.")
    login_limiter.reset(*keys)
    token, exp = create_token(user)
    user.last_login_at = utcnow()
    log_activity(db, user.email, "login", "user", user.id, "Signed in")
    db.commit()
    return {"access_token": token, "token_type": "bearer", "expires_at": exp.isoformat(), "user": user_dict(user)}


@router.post("/logout")
async def logout(request: Request, payload: dict = Depends(get_token_payload), db: Session = Depends(get_db)):
    jti, exp = payload["jti"], payload["exp"]
    if is_replay(request):
        # Replayed on another instance (BUG-08): revoke the ORIGINAL token carried in the signed op.
        try:
            original = json.loads(await request.body() or b"{}")
            jti, exp = str(original["jti"]), int(original["exp"])
        except (ValueError, KeyError, TypeError):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Malformed replayed logout.")
    db.execute(delete(RevokedToken).where(RevokedToken.expires_at < utcnow()))
    db.merge(RevokedToken(jti=jti, expires_at=datetime.fromtimestamp(exp, timezone.utc).replace(tzinfo=None)))
    log_activity(db, payload.get("email"), "logout", "user", payload.get("sub"), "Signed out")
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_dict(user)


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if is_replay(request):  # already verified on the instance that handled the original request
        user.password_hash = password_hash_for(body.new_password, True)
        db.commit()
        return {"ok": True, "message": "Password changed."}
    if body.new_password.startswith(HASH_PREFIX):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid password.")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect.")
    if body.current_password == body.new_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The new password must be different from the current one.")
    user.password_hash = password_hash_for(body.new_password, False)
    log_activity(db, user.email, "change_password", "user", user.id, "Changed own password")
    db.commit()
    return {"ok": True, "message": "Password changed."}
