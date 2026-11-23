"""User management (admin only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..security import hash_password, require_admin
from ..services.predictions import log_activity
from ..validation import EMAIL_RE, ROLES, validate_password
from .auth import user_dict

router = APIRouter(prefix="/users", tags=["users"])


class UserCreate(BaseModel):
    email: str = Field(max_length=255)
    name: str = Field(min_length=2, max_length=120)
    role: str
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Enter a valid e-mail address")
        return v

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        if v not in ROLES:
            raise ValueError("Role must be 'admin' or 'viewer'")
        return v

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return validate_password(v)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return v.strip()


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)

    @field_validator("role")
    @classmethod
    def _role(cls, v):
        if v is not None and v not in ROLES:
            raise ValueError("Role must be 'admin' or 'viewer'")
        return v

    @field_validator("password")
    @classmethod
    def _pw(cls, v):
        return None if v is None else validate_password(v)


def _admin_count(db: Session) -> int:
    return db.scalar(select(func.count(User.id)).where(User.role == "admin", User.is_active.is_(True))) or 0


@router.get("")
def list_users(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    return [user_dict(u) for u in db.scalars(select(User).order_by(User.id))]


@router.post("", status_code=201)
def create_user(body: UserCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if db.scalar(select(User).where(func.lower(User.email) == body.email)):
        raise HTTPException(409, f"A user with e-mail {body.email} already exists.")
    u = User(email=body.email, name=body.name, role=body.role, password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    log_activity(db, admin.email, "user_create", "user", u.id, f"Created {body.role} {body.email}")
    db.commit()
    return user_dict(u)


@router.put("/{user_id}")
def update_user(user_id: int, body: UserUpdate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User not found.")
    demoting = (body.role == "viewer" and u.role == "admin") or (body.is_active is False and u.role == "admin")
    if demoting and _admin_count(db) <= 1:
        raise HTTPException(400, "At least one active admin is required.")
    if u.id == admin.id and (body.is_active is False or body.role == "viewer"):
        raise HTTPException(400, "You cannot deactivate or demote your own account.")
    changes = []
    for field in ("name", "role", "is_active"):
        val = getattr(body, field)
        if val is not None and val != getattr(u, field):
            setattr(u, field, val.strip() if isinstance(val, str) else val)
            changes.append(field)
    if body.password:
        u.password_hash = hash_password(body.password)
        changes.append("password")
    log_activity(db, admin.email, "user_update", "user", u.id, f"Updated {u.email}: {', '.join(changes) or 'no changes'}")
    db.commit()
    return user_dict(u)


@router.delete("/{user_id}")
def delete_user(user_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User not found.")
    if u.id == admin.id:
        raise HTTPException(400, "You cannot delete your own account.")
    if u.role == "admin" and _admin_count(db) <= 1:
        raise HTTPException(400, "At least one active admin is required.")
    db.delete(u)
    log_activity(db, admin.email, "user_delete", "user", user_id, f"Deleted {u.email}")
    db.commit()
    return {"ok": True}
