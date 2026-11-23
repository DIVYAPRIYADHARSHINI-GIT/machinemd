"""Alerts generated from risk level: list/filter, acknowledge."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Alert, Machine, User, utcnow
from ..security import get_current_user, require_admin
from ..services.predictions import log_activity

router = APIRouter(prefix="/alerts", tags=["alerts"])


def alert_dict(a: Alert, m: Machine | None) -> dict:
    return {"id": a.id, "machine_id": a.machine_id, "machine_code": m.code if m else None, "machine_name": m.name if m else None,
            "machine_type": m.type if m else None, "location": m.location if m else None,
            "risk_level": a.risk_level, "failure_probability": a.failure_probability, "message": a.message, "status": a.status,
            "created_at": a.created_at.isoformat(), "acknowledged_by": a.acknowledged_by,
            "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
            "handled_at": a.handled_at.isoformat() if a.handled_at else None, "maintenance_id": a.maintenance_id}


@router.get("")
def list_alerts(
    status: str | None = Query(default=None, pattern="^(Open|Acknowledged|Handled|active)$"),
    risk: str | None = Query(default=None, pattern="^(Low|Medium|High)$"),
    machine_id: int | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Alert, Machine).join(Machine, Machine.id == Alert.machine_id)
    if status == "active":
        q = q.where(Alert.status.in_(("Open", "Acknowledged")))
    elif status:
        q = q.where(Alert.status == status)
    if risk:
        q = q.where(Alert.risk_level == risk)
    if machine_id is not None:
        q = q.where(Alert.machine_id == machine_id)
    rows = db.execute(q.order_by(Alert.created_at.desc(), Alert.id.desc()).limit(limit)).all()
    return [alert_dict(a, m) for a, m in rows]


@router.post("/{alert_id}/acknowledge")
def acknowledge(alert_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.get(Alert, alert_id)
    if a is None:
        raise HTTPException(404, "Alert not found.")
    if a.status != "Open":
        raise HTTPException(409, f"Alert is already {a.status.lower()}.")
    a.status = "Acknowledged"
    a.acknowledged_by = admin.email
    a.acknowledged_at = utcnow()
    m = db.get(Machine, a.machine_id)
    log_activity(db, admin.email, "alert_acknowledge", "alert", a.id, f"Acknowledged {a.risk_level} alert for {m.code if m else a.machine_id}")
    db.commit()
    return alert_dict(a, m)
