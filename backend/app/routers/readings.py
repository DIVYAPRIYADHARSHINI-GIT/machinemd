"""Sensor readings: list, add one, CSV template, CSV bulk upload (preview + import)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ml.config import SENSOR_META, SENSORS

from .. import config
from ..csvutil import read_csv_upload, suggest_mapping, to_csv
from ..db import get_db
from ..models import FailureEvent, Machine, Reading, User, utcnow
from ..security import get_current_user, require_admin
from ..services.predictions import log_activity, refresh_predictions
from ..validation import check_sensor, parse_timestamp

router = APIRouter(prefix="/readings", tags=["readings"])

UPLOAD_FIELDS = ["machine_code", "timestamp", *SENSORS, "failure"]
REQUIRED_FIELDS = ["machine_code", "timestamp", *SENSORS]


class ReadingIn(BaseModel):
    machine_id: int
    timestamp: datetime | None = None
    temperature: float
    vibration: float
    pressure: float
    rpm: float
    running_hours: float
    current: float

    @field_validator(*SENSORS)
    @classmethod
    def _range(cls, v, info):
        return check_sensor(info.field_name, v)


def reading_dict(r: Reading, code: str | None = None) -> dict:
    return {"id": r.id, "machine_id": r.machine_id, "machine_code": code, "timestamp": r.timestamp.isoformat(), "source": r.source, **{s: getattr(r, s) for s in SENSORS}}


@router.get("")
def list_readings(
    machine_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Reading, Machine.code).join(Machine, Machine.id == Reading.machine_id)
    cq = select(func.count(Reading.id))
    if machine_id is not None:
        q = q.where(Reading.machine_id == machine_id)
        cq = cq.where(Reading.machine_id == machine_id)
    rows = db.execute(q.order_by(Reading.timestamp.desc(), Reading.id.desc()).offset(offset).limit(limit)).all()
    return {"total": db.scalar(cq) or 0, "items": [reading_dict(r, code) for r, code in rows]}


@router.post("", status_code=201)
def add_reading(body: ReadingIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    m = db.get(Machine, body.machine_id)
    if m is None:
        raise HTTPException(404, "Machine not found.")
    last = db.scalar(select(func.max(Reading.timestamp)).where(Reading.machine_id == m.id))
    ts = (body.timestamp.replace(tzinfo=None, microsecond=0) if body.timestamp else utcnow().replace(minute=0, second=0))
    if body.timestamp is None and last is not None and ts <= last:
        ts = last + timedelta(hours=6)
    if db.scalar(select(Reading.id).where(Reading.machine_id == m.id, Reading.timestamp == ts)):
        raise HTTPException(409, f"{m.code} already has a reading at {ts:%Y-%m-%d %H:%M}.")
    r = Reading(machine_id=m.id, timestamp=ts, source="manual", **{s: getattr(body, s) for s in SENSORS})
    db.add(r)
    db.flush()
    refresh_predictions(db, [m.id])
    log_activity(db, admin.email, "reading_add", "machine", m.id, f"Added a reading for {m.code} at {ts:%Y-%m-%d %H:%M}")
    db.commit()
    return reading_dict(r, m.code)


@router.get("/template")
def template(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    codes = [c for (c,) in db.execute(select(Machine.code).order_by(Machine.code).limit(2))] or ["PMP-001", "MTR-001"]
    header = UPLOAD_FIELDS
    rows = [
        [codes[0], "2026-11-23 12:00", 58.4, 2.9, 6.0, 1748, 1210.5, 18.2, 0],
        [codes[0], "2026-11-23 18:00", 58.9, 3.0, 5.98, 1751, 1216.0, 18.4, 0],
        [codes[-1], "2026-11-23 12:00", 66.2, 1.9, 2.5, 1479, 640.0, 24.1, 0],
    ]
    units = "# Units: " + ", ".join(f"{s}={SENSOR_META[s]['unit']}" for s in SENSORS) + "; failure: 1 if the machine failed at this time (optional)"
    body = to_csv(header, rows)
    return Response(content=body, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="machinemd_readings_template.csv"', "X-Template-Notes": units.encode("ascii", "ignore").decode()})


def _validate_rows(db: Session, rows: list[dict], mapping: dict[str, str | None]) -> tuple[list[dict], list[dict]]:
    machines = {m.code.lower(): m for m in db.scalars(select(Machine))}
    existing: dict[int, set] = {}
    valid, errors = [], []
    seen: set = set()
    for row in rows:
        line = int(row["__line__"])
        errs: list[str] = []
        get = lambda f: row.get(mapping[f], "") if mapping.get(f) else ""  # noqa: E731
        code = get("machine_code").strip()
        m = machines.get(code.lower()) if code else None
        if not code:
            errs.append("Machine code is required")
        elif m is None:
            errs.append(f"Unknown machine code '{code}'")
        ts = None
        try:
            ts = parse_timestamp(get("timestamp"))
            if ts > utcnow() + timedelta(days=1):
                errs.append(f"Timestamp {ts:%Y-%m-%d %H:%M} is in the future")
        except ValueError as e:
            errs.append(str(e))
        vals = {}
        for s in SENSORS:
            try:
                vals[s] = check_sensor(s, get(s))
            except ValueError as e:
                errs.append(str(e))
        failure = False
        fv = get("failure").strip().lower()
        if fv in ("1", "true", "yes", "y"):
            failure = True
        elif fv not in ("", "0", "false", "no", "n"):
            errs.append(f"Failure must be 0 or 1 (got '{fv}')")
        if row.get("__extra__") == "True":
            errs.append("Row has more values than there are columns")
        if m is not None and ts is not None:
            key = (m.id, ts)
            if key in seen:
                errs.append(f"Duplicate row for {m.code} at {ts:%Y-%m-%d %H:%M} in this file")
            else:
                if m.id not in existing:
                    existing[m.id] = {t for (t,) in db.execute(select(Reading.timestamp).where(Reading.machine_id == m.id))}
                if ts in existing[m.id]:
                    errs.append(f"{m.code} already has a reading at {ts:%Y-%m-%d %H:%M}")
            seen.add(key)
        if errs:
            errors.append({"line": line, "machine_code": code, "errors": errs, "raw": {k: v for k, v in row.items() if not k.startswith("__")}})
        else:
            valid.append({"line": line, "machine_id": m.id, "machine_code": m.code, "timestamp": ts, "failure": failure, **vals})
    return valid, errors


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    mapping: str | None = Form(default=None, description="JSON object: canonical field -> CSV column"),
    dry_run: bool = Form(default=True),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Validate a CSV of readings. ``dry_run=true`` returns the preview and per-row errors only;
    ``dry_run=false`` also imports the valid rows (invalid rows are skipped and reported)."""
    headers, rows = await read_csv_upload(file, config.UPLOAD_MAX_ROWS)
    suggested = suggest_mapping(headers, UPLOAD_FIELDS)
    if mapping:
        try:
            user_map = json.loads(mapping)
            assert isinstance(user_map, dict)
        except (ValueError, AssertionError):
            raise HTTPException(400, "Column mapping must be a JSON object.")
        bad = [v for v in user_map.values() if v and v not in headers]
        if bad:
            raise HTTPException(400, f"Mapped column(s) not in the file: {', '.join(bad)}")
        used = {k: (v or None) for k, v in user_map.items() if k in UPLOAD_FIELDS}
        mp = {f: used.get(f, suggested.get(f)) if f not in used else used[f] for f in UPLOAD_FIELDS}
    else:
        mp = suggested
    missing = [f for f in REQUIRED_FIELDS if not mp.get(f)]
    base = {"file_name": file.filename, "headers": headers, "suggested_mapping": suggested, "mapping": mp, "total_rows": len(rows), "required_fields": REQUIRED_FIELDS, "fields": UPLOAD_FIELDS}
    if missing:
        return base | {"ok": False, "missing_fields": missing, "valid_rows": 0, "error_rows": 0, "errors": [], "preview": [], "imported": 0,
                       "message": f"Map these required columns before importing: {', '.join(missing)}"}
    valid, errors = _validate_rows(db, rows, mp)
    preview = [{**{k: v for k, v in r.items() if k != "machine_id"}, "timestamp": r["timestamp"].isoformat()} for r in valid[:20]]
    imported, failures_added, refreshed = 0, 0, 0
    if not dry_run and valid:
        db.bulk_insert_mappings(Reading, [{"machine_id": r["machine_id"], "timestamp": r["timestamp"], "source": "upload", **{s: r[s] for s in SENSORS}} for r in valid])
        for r in valid:
            if r["failure"]:
                db.add(FailureEvent(machine_id=r["machine_id"], timestamp=r["timestamp"], mode="Reported in upload", source="upload"))
                failures_added += 1
        imported = len(valid)
        db.flush()
        refreshed = refresh_predictions(db, {r["machine_id"] for r in valid})
        log_activity(db, admin.email, "readings_upload", "readings", None, f"Imported {imported} rows from {file.filename} ({len(errors)} rows rejected)")
        db.commit()
    return base | {
        "ok": True, "missing_fields": [], "dry_run": dry_run, "valid_rows": len(valid), "error_rows": len(errors),
        "errors": errors[:200], "preview": preview, "imported": imported, "failures_added": failures_added, "machines_rescored": refreshed,
        "message": (f"Imported {imported} rows; {len(errors)} rows were rejected." if not dry_run else f"{len(valid)} rows are valid and {len(errors)} have errors."),
    }


@router.get("/sensors")
def sensor_meta(_: User = Depends(get_current_user)):
    from ml.config import SENSOR_LIMITS
    return [{"sensor": s, **SENSOR_META[s], "min": SENSOR_LIMITS[s][0], "max": SENSOR_LIMITS[s][1]} for s in SENSORS]

