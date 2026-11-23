"""Health check, settings (risk thresholds), activity log."""

from __future__ import annotations

import platform

import shutil

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .. import config
from ..db import get_db, session_factory
from ..models import ActivityLog, Machine, Reading, Setting, User
from ..security import get_current_user, require_admin
from ..services import bootstrap, registry
from ..services.predictions import get_thresholds, log_activity, reclassify_risk

router = APIRouter(tags=["system"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    row = registry.active_row(db)
    model_ok = False
    if row is not None:
        try:
            registry.load_bundle(row)
            model_ok = True
        except Exception:  # noqa: BLE001
            model_ok = False
    return {
        "status": "ok" if model_ok else "degraded",
        "version": config.APP_VERSION,
        "database": {"ok": True, "machines": db.scalar(select(func.count(Machine.id))), "readings": db.scalar(select(func.count(Reading.id))),
                     "startup": bootstrap.STATUS.get("db")},
        "model": {"ok": model_ok, "active_version": row.version if row else None, "serving": row.primary_model if row else None},
        "self_heal": bootstrap.STATUS.get("healed", []),
        "environment": "vercel" if config.IS_VERCEL else "local",
        "storage": {"runtime_dir": str(config.RUNTIME_DIR), "temporary": True, "note": config.STORAGE_NOTE},
        "jwt_secret_configured": config.JWT_SECRET_CONFIGURED,
        "python": platform.python_version(),
    }


class ThresholdsIn(BaseModel):
    medium: float = Field(gt=0, lt=1)
    high: float = Field(gt=0, lt=1)

    @model_validator(mode="after")
    def _order(self):
        if self.medium >= self.high:
            raise ValueError("The Medium threshold must be lower than the High threshold")
        return self


@router.get("/settings")
def get_settings(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"risk_thresholds": get_thresholds(db), "storage_note": config.STORAGE_NOTE, "jwt_expire_minutes": config.JWT_EXPIRE_MINUTES,
            "upload_max_rows": config.UPLOAD_MAX_ROWS, "batch_max_rows": config.BATCH_MAX_ROWS}


@router.put("/settings/thresholds")
def set_thresholds(body: ThresholdsIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    row = db.get(Setting, "risk_thresholds")
    val = {"medium": round(body.medium, 3), "high": round(body.high, 3)}
    if row is None:
        db.add(Setting(key="risk_thresholds", value=val))
    else:
        row.value = val
    db.flush()
    reclassify_risk(db)
    log_activity(db, admin.email, "settings_thresholds", "settings", None, f"Risk thresholds set to Medium >= {val['medium']:.0%}, High >= {val['high']:.0%}")
    db.commit()
    return {"risk_thresholds": val}


@router.get("/activity")
def activity(limit: int = Query(default=100, ge=1, le=500), action: str | None = Query(default=None, max_length=60),
             _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(ActivityLog)
    if action:
        q = q.where(ActivityLog.action == action)
    rows = db.scalars(q.order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc()).limit(limit))
    return [{"id": a.id, "created_at": a.created_at.isoformat(), "user": a.user_email, "action": a.action, "entity": a.entity, "entity_id": a.entity_id, "detail": a.detail} for a in rows]


@router.post("/admin/reset-demo")
def reset_demo(admin: User = Depends(require_admin)):
    """Discard all runtime changes and go back to the committed seed data and models."""
    email = admin.email
    bootstrap.reset_runtime()
    if config.RUNTIME_MODELS.exists():
        shutil.rmtree(config.RUNTIME_MODELS, ignore_errors=True)
    bootstrap.ensure_ready()
    with session_factory()() as db:
        log_activity(db, email, "demo_reset", "database", None, "Reset demo data to the committed seed")
        db.commit()
    return {"ok": True}

