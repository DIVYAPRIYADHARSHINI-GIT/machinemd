"""Predictions: latest per machine, per-machine + history, single (from values), batch CSV, refresh."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ml.config import SENSORS
from ml.serve import score_many, steady_window

from .. import config
from ..csvutil import read_csv_upload, suggest_mapping
from ..db import get_db
from ..models import Machine, Prediction, User
from ..security import get_current_user, require_admin
from ..services import registry
from ..services.predictions import action_for, get_thresholds, latest_prediction_map, log_activity, prediction_dict, refresh_predictions
from ..validation import check_machine_type, check_sensor, check_sensors

router = APIRouter(prefix="/predictions", tags=["predictions"])


class SingleIn(BaseModel):
    machine_type: str = Field(description="Pump, Motor, Compressor or AC Unit")
    temperature: float
    vibration: float
    pressure: float
    rpm: float
    running_hours: float
    current: float


@router.get("/latest")
def latest(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    preds = latest_prediction_map(db)
    out = []
    for m in db.scalars(select(Machine).order_by(Machine.code)):
        p = preds.get(m.id)
        out.append({"machine_id": m.id, "code": m.code, "name": m.name, "type": m.type, "prediction": prediction_dict(p)})
    return sorted(out, key=lambda r: -(r["prediction"] or {}).get("failure_probability", -1))


@router.get("/machine/{machine_id}")
def for_machine(machine_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = db.get(Machine, machine_id)
    if m is None:
        raise HTTPException(404, "Machine not found.")
    p = db.scalar(select(Prediction).where(Prediction.machine_id == m.id, Prediction.is_latest.is_(True)))
    if p is None:
        raise HTTPException(404, f"No prediction yet for {m.code}: it has no sensor readings.")
    return {"machine_id": m.id, "code": m.code, **prediction_dict(p), "contributions": p.contributions or [], "recommended_action": action_for(p)}


@router.get("/machine/{machine_id}/history")
def history(machine_id: int, days: int = Query(default=90, ge=1, le=365), _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = db.get(Machine, machine_id)
    if m is None:
        raise HTTPException(404, "Machine not found.")
    rows = list(db.scalars(select(Prediction).where(Prediction.machine_id == m.id).order_by(Prediction.reading_time.desc()).limit(days * 2)))
    return [prediction_dict(p) for p in reversed(rows)]


@router.post("/single")
def single(body: SingleIn, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        mtype = check_machine_type(body.machine_type)
        vals = check_sensors(body.model_dump())
    except ValueError as e:
        raise HTTPException(422, str(e))
    _, bundle = registry.active_bundle(db)
    res = score_many(bundle, [(mtype, steady_window(vals))], get_thresholds(db))[0]
    return {"machine_type": mtype, "input": vals, **res, "note": "Single-reading prediction assumes the values are steady (no trend)."}


@router.post("/batch")
async def batch(file: UploadFile = File(...), _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Score a small CSV of readings (one row = one steady-state reading). Needs machine_type or machine_code."""
    headers, rows = await read_csv_upload(file, config.BATCH_MAX_ROWS)
    mp = suggest_mapping(headers, ["machine_code", "machine_type", *SENSORS])
    missing = [s for s in SENSORS if not mp.get(s)]
    if not mp.get("machine_code") and not mp.get("machine_type"):
        missing.insert(0, "machine_type (or machine_code)")
    if missing:
        raise HTTPException(422, f"Missing required column(s): {', '.join(missing)}. Download the template for the expected format.")
    machines = {m.code.lower(): m for m in db.scalars(select(Machine))}
    items, meta, errors = [], [], []
    for row in rows:
        errs = []
        mtype = None
        code = row.get(mp["machine_code"], "").strip() if mp.get("machine_code") else ""
        if mp.get("machine_type") and row.get(mp["machine_type"], "").strip():
            try:
                mtype = check_machine_type(row[mp["machine_type"]])
            except ValueError as e:
                errs.append(str(e))
        elif code:
            m = machines.get(code.lower())
            if m is None:
                errs.append(f"Unknown machine code '{code}' (or add a machine_type column)")
            else:
                mtype = m.type
        else:
            errs.append("Machine type is required")
        vals = {}
        for s in SENSORS:
            try:
                vals[s] = check_sensor(s, row.get(mp[s], ""))
            except ValueError as e:
                errs.append(str(e))
        if errs:
            errors.append({"line": int(row["__line__"]), "errors": errs})
        else:
            items.append((mtype, steady_window(vals)))
            meta.append({"line": int(row["__line__"]), "machine_code": code or None, "machine_type": mtype, **vals})
    results = []
    if items:
        _, bundle = registry.active_bundle(db)
        for m, r in zip(meta, score_many(bundle, items, get_thresholds(db))):
            top = [c["label"] for c in r["contributions"] if c["risk_drop"] > 0.02][:2]
            results.append({**m, **{k: r[k] for k in ("failure_probability", "health_score", "risk_level", "rul_days", "rul_capped", "anomaly")}, "top_sensors": top})
    summary = {lvl: sum(1 for r in results if r["risk_level"] == lvl) for lvl in ("High", "Medium", "Low")}
    return {"file_name": file.filename, "rows": len(rows), "scored": len(results), "error_rows": len(errors), "summary": summary, "results": results, "errors": errors[:200]}


@router.post("/refresh")
def refresh(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    n = refresh_predictions(db)
    log_activity(db, admin.email, "predictions_refresh", "predictions", None, f"Re-scored {n} machines")
    db.commit()
    return {"ok": True, "machines_scored": n}

