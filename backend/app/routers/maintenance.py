"""Maintenance log CRUD. Logging maintenance on a machine with an open alert marks it Handled."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Alert, Machine, MaintenanceLog, User
from ..security import get_current_user, require_admin
from ..services.predictions import handle_alerts_for_machine, log_activity
from ..validation import MAINT_STATUSES

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


class MaintenanceIn(BaseModel):
    machine_id: int
    issue: str = Field(min_length=3, max_length=300)
    action_taken: str = Field(min_length=3, max_length=2000)
    cost: float = Field(ge=0, le=10_000_000)
    date: date
    technician: str = Field(min_length=2, max_length=120)
    status: str = "Completed"
    handle_alert: bool = True

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in MAINT_STATUSES:
            raise ValueError(f"Status must be one of: {', '.join(MAINT_STATUSES)}")
        return v

    @field_validator("date")
    @classmethod
    def _date(cls, v: date) -> date:
        if v > date.today() + timedelta(days=365):
            raise ValueError("Date is more than a year in the future")
        if v.year < 2000:
            raise ValueError("Date looks wrong (before 2000)")
        return v

    @field_validator("issue", "action_taken", "technician")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("This field is required")
        return v


def maint_dict(x: MaintenanceLog, m: Machine | None) -> dict:
    return {"id": x.id, "machine_id": x.machine_id, "machine_code": m.code if m else None, "machine_name": m.name if m else None,
            "machine_type": m.type if m else None, "issue": x.issue, "action_taken": x.action_taken, "cost": x.cost,
            "date": x.date.isoformat(), "technician": x.technician, "status": x.status, "created_at": x.created_at.isoformat()}


@router.get("")
def list_maintenance(
    machine_id: int | None = None,
    status: str | None = None,
    search: str | None = Query(default=None, max_length=100),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(MaintenanceLog, Machine).join(Machine, Machine.id == MaintenanceLog.machine_id)
    if machine_id is not None:
        q = q.where(MaintenanceLog.machine_id == machine_id)
    if status:
        q = q.where(MaintenanceLog.status == status)
    rows = db.execute(q.order_by(MaintenanceLog.date.desc(), MaintenanceLog.id.desc())).all()
    out = [maint_dict(x, m) for x, m in rows]
    if search:
        s = search.lower()
        out = [r for r in out if s in f"{r['machine_code']} {r['machine_name']} {r['issue']} {r['technician']} {r['action_taken']}".lower()]
    return out


@router.post("", status_code=201)
def create(body: MaintenanceIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    m = db.get(Machine, body.machine_id)
    if m is None:
        raise HTTPException(404, "Machine not found.")
    x = MaintenanceLog(**body.model_dump(exclude={"handle_alert"}), created_by=admin.id)
    db.add(x)
    db.flush()
    handled = handle_alerts_for_machine(db, m, x.id) if body.handle_alert else 0
    log_activity(db, admin.email, "maintenance_create", "maintenance", x.id,
                 f"Logged maintenance for {m.code}: {x.issue}" + (f" (handled {handled} alert{'s' if handled != 1 else ''})" if handled else ""))
    db.commit()
    return maint_dict(x, m) | {"alerts_handled": handled}


@router.put("/{log_id}")
def update(log_id: int, body: MaintenanceIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    x = db.get(MaintenanceLog, log_id)
    if x is None:
        raise HTTPException(404, "Maintenance record not found.")
    m = db.get(Machine, body.machine_id)
    if m is None:
        raise HTTPException(404, "Machine not found.")
    for k, v in body.model_dump(exclude={"handle_alert"}).items():
        setattr(x, k, v)
    log_activity(db, admin.email, "maintenance_update", "maintenance", x.id, f"Updated maintenance #{x.id} for {m.code}")
    db.commit()
    return maint_dict(x, m)


@router.delete("/{log_id}")
def delete(log_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    x = db.get(MaintenanceLog, log_id)
    if x is None:
        raise HTTPException(404, "Maintenance record not found.")
    for a in db.scalars(select(Alert).where(Alert.maintenance_id == x.id)):
        a.maintenance_id = None
    db.delete(x)
    log_activity(db, admin.email, "maintenance_delete", "maintenance", log_id, f"Deleted maintenance #{log_id}")
    db.commit()
    return {"ok": True}
