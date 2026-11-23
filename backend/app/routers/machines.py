"""Machines CRUD + machine detail (readings with anomaly flags, prediction, explanation)."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ml.config import SENSORS
from ml.serve import anomaly_flags

from ..db import get_db
from ..models import Alert, FailureEvent, Machine, MaintenanceLog, Prediction, Reading, User
from ..security import get_current_user, require_admin
from ..services import registry
from ..services.predictions import OPEN_STATUSES, action_for, latest_prediction_map, log_activity, prediction_dict
from ..validation import MACHINE_STATUSES, check_machine_type

router = APIRouter(prefix="/machines", tags=["machines"])


class MachineIn(BaseModel):
    code: str = Field(min_length=2, max_length=30, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    name: str = Field(min_length=2, max_length=120)
    type: str
    location: str = Field(min_length=2, max_length=120)
    install_date: date
    status: str = "Active"

    @field_validator("type")
    @classmethod
    def _type(cls, v: str) -> str:
        return check_machine_type(v)

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in MACHINE_STATUSES:
            raise ValueError(f"Status must be one of: {', '.join(MACHINE_STATUSES)}")
        return v

    @field_validator("install_date")
    @classmethod
    def _date(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("Install date cannot be in the future")
        if v.year < 1950:
            raise ValueError("Install date looks wrong (before 1950)")
        return v

    @field_validator("code", "name", "location")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


def machine_dict(m: Machine, pred: Prediction | None = None, open_alerts: int = 0, last_reading: datetime | None = None) -> dict:
    top = [c for c in ((pred.contributions if pred else None) or []) if c.get("risk_drop", 0) > 0.02][:3]
    return {
        "id": m.id, "code": m.code, "name": m.name, "type": m.type, "location": m.location,
        "install_date": m.install_date.isoformat(), "status": m.status,
        "prediction": prediction_dict(pred), "open_alerts": open_alerts,
        "top_sensors": [{"sensor": c["sensor"], "label": c["label"], "risk_drop": c["risk_drop"]} for c in top],
        "last_reading_at": last_reading.isoformat() if last_reading else None,
    }


@router.get("")
def list_machines(
    search: str | None = Query(default=None, max_length=100),
    type: str | None = None,
    risk: str | None = Query(default=None, pattern="^(Low|Medium|High)$"),
    location: str | None = Query(default=None, max_length=120),
    status: str | None = None,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preds = latest_prediction_map(db)
    alerts = dict(db.execute(select(Alert.machine_id, func.count(Alert.id)).where(Alert.status.in_(OPEN_STATUSES)).group_by(Alert.machine_id)).all())
    last = dict(db.execute(select(Reading.machine_id, func.max(Reading.timestamp)).group_by(Reading.machine_id)).all())
    out = []
    for m in db.scalars(select(Machine).order_by(Machine.code)):
        if search and search.lower() not in f"{m.code} {m.name} {m.location} {m.type}".lower():
            continue
        if type and m.type != type:
            continue
        if location and m.location != location:
            continue
        if status and m.status != status:
            continue
        p = preds.get(m.id)
        if risk and (p is None or p.risk_level != risk):
            continue
        out.append(machine_dict(m, p, alerts.get(m.id, 0), last.get(m.id)))
    return out


@router.get("/meta")
def machine_meta(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from ml.config import MACHINE_TYPES
    locations = sorted({loc for (loc,) in db.execute(select(Machine.location).distinct())})
    return {"types": MACHINE_TYPES, "statuses": MACHINE_STATUSES, "locations": locations}


def _get(db: Session, machine_id: int) -> Machine:
    m = db.get(Machine, machine_id)
    if m is None:
        raise HTTPException(404, f"Machine {machine_id} not found.")
    return m


@router.get("/{machine_id}")
def machine_detail(machine_id: int, days: int = Query(default=30, ge=1, le=120), _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = _get(db, machine_id)
    pred = db.scalar(select(Prediction).where(Prediction.machine_id == m.id, Prediction.is_latest.is_(True)))
    last_ts = db.scalar(select(func.max(Reading.timestamp)).where(Reading.machine_id == m.id))
    readings: list[dict] = []
    if last_ts is not None:
        since = last_ts - timedelta(days=days)
        # 6 extra readings before the window so the rolling features of the first point are complete.
        rows = list(db.scalars(select(Reading).where(Reading.machine_id == m.id, Reading.timestamp >= since - timedelta(days=2)).order_by(Reading.timestamp)))
        if rows:
            vals = np.array([[getattr(r, s) for s in SENSORS] for r in rows], dtype=float)
            try:
                _, bundle = registry.active_bundle(db)
                flags = anomaly_flags(bundle, m.type, vals)
            except registry.ModelUnavailable:
                flags = np.zeros(len(rows), dtype=bool)
            for r, f in zip(rows, flags):
                if r.timestamp < since:
                    continue
                readings.append({"t": r.timestamp.isoformat(), **{s: getattr(r, s) for s in SENSORS}, "anomaly": bool(f), "source": r.source})
    open_alerts = db.scalar(select(func.count(Alert.id)).where(Alert.machine_id == m.id, Alert.status.in_(OPEN_STATUSES))) or 0
    failures = [{"t": f.timestamp.isoformat(), "mode": f.mode} for f in db.scalars(select(FailureEvent).where(FailureEvent.machine_id == m.id).order_by(FailureEvent.timestamp))]
    maint = db.scalars(select(MaintenanceLog).where(MaintenanceLog.machine_id == m.id).order_by(MaintenanceLog.date.desc()).limit(20))
    data = machine_dict(m, pred, open_alerts, last_ts)
    data.update({
        "readings": readings,
        "reading_count": db.scalar(select(func.count(Reading.id)).where(Reading.machine_id == m.id)) or 0,
        "contributions": (pred.contributions if pred else None) or [],
        "recommended_action": action_for(pred),
        "failures": failures,
        "maintenance": [{"id": x.id, "date": x.date.isoformat(), "issue": x.issue, "action_taken": x.action_taken, "cost": x.cost, "technician": x.technician, "status": x.status} for x in maint],
    })
    return data


@router.post("", status_code=201)
def create_machine(body: MachineIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if db.scalar(select(Machine).where(func.lower(Machine.code) == body.code.lower())):
        raise HTTPException(409, f"Machine code {body.code} is already in use.")
    m = Machine(**body.model_dump())
    db.add(m)
    db.flush()
    log_activity(db, admin.email, "machine_create", "machine", m.id, f"Added {m.code} {m.name}")
    db.commit()
    return machine_dict(m)


@router.put("/{machine_id}")
def update_machine(machine_id: int, body: MachineIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    m = _get(db, machine_id)
    clash = db.scalar(select(Machine).where(func.lower(Machine.code) == body.code.lower(), Machine.id != m.id))
    if clash:
        raise HTTPException(409, f"Machine code {body.code} is already in use.")
    type_changed = m.type != body.type
    for k, v in body.model_dump().items():
        setattr(m, k, v)
    db.flush()
    if type_changed:  # normal operating point changed -> re-score
        from ..services.predictions import refresh_predictions
        refresh_predictions(db, [m.id])
    log_activity(db, admin.email, "machine_update", "machine", m.id, f"Updated {m.code}")
    db.commit()
    pred = db.scalar(select(Prediction).where(Prediction.machine_id == m.id, Prediction.is_latest.is_(True)))
    return machine_dict(m, pred)


@router.delete("/{machine_id}")
def delete_machine(machine_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    m = _get(db, machine_id)
    code = m.code
    db.delete(m)
    log_activity(db, admin.email, "machine_delete", "machine", machine_id, f"Deleted {code} and its readings, predictions, alerts and maintenance records")
    db.commit()
    return {"ok": True}
