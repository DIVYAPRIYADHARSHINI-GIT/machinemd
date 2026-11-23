"""What-if simulator: score hypothetical sensor values (optionally on top of a machine's history)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ml.config import SENSOR_LIMITS, SENSOR_META, SENSORS, normal_reading
from ml.serve import recommended_action, score_many, steady_window, window_with_current

from ..db import get_db
from ..models import Machine, User
from ..security import get_current_user
from ..services import registry
from ..services.predictions import get_thresholds, latest_windows
from ..validation import check_machine_type, check_sensors

router = APIRouter(prefix="/whatif", tags=["what-if"])


class WhatIfIn(BaseModel):
    machine_type: str | None = None
    machine_id: int | None = None
    temperature: float
    vibration: float
    pressure: float
    rpm: float
    running_hours: float
    current: float
    mode: str = Field(default="steady", pattern="^(steady|trend)$")


@router.get("/defaults")
def defaults(machine_type: str | None = None, machine_id: int | None = None, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Slider ranges and starting values: the type's normal point, or a machine's latest reading."""
    if machine_id is not None:
        m = db.get(Machine, machine_id)
        if m is None:
            raise HTTPException(404, "Machine not found.")
        mtype = m.type
        win = latest_windows(db, [m.id]).get(m.id)
        start = {s: round(float(win[0][-1, j]), 3) for j, s in enumerate(SENSORS)} if win else normal_reading(mtype)
    else:
        try:
            mtype = check_machine_type(machine_type or "Pump")
        except ValueError as e:
            raise HTTPException(422, str(e))
        start = normal_reading(mtype)
    normal = normal_reading(mtype)
    sliders = []
    for s in SENSORS:
        n = normal[s]
        lo, hi = (0.0, 4000.0) if s == "running_hours" else (round(n * 0.6, 2), round(n * (3.0 if s == "vibration" else 1.6), 2))
        lo, hi = max(lo, SENSOR_LIMITS[s][0]), min(hi, SENSOR_LIMITS[s][1])
        step = 0.1 if s in ("rpm", "running_hours") else (0.001 if n < 10 else 0.01)
        sliders.append({"sensor": s, **SENSOR_META[s], "min": lo, "max": hi, "step": step, "normal": round(n, 2), "value": min(max(start[s], lo), hi)})
    return {"machine_type": mtype, "machine_id": machine_id, "sliders": sliders}


@router.post("")
def whatif(body: WhatIfIn, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return risk, health score, RUL and top contributing sensors for the given values.

    * ``mode=steady`` (default): the values are treated as a steady state (7 identical readings).
    * ``mode=trend``: requires ``machine_id``; the values become the newest reading after the
      machine's last 6 real readings, so trends count too.
    """
    try:
        vals = check_sensors(body.model_dump())
    except ValueError as e:
        raise HTTPException(422, str(e))
    if body.machine_id is not None:
        m = db.get(Machine, body.machine_id)
        if m is None:
            raise HTTPException(404, "Machine not found.")
        mtype = m.type
    else:
        if not body.machine_type:
            raise HTTPException(422, "Provide machine_type or machine_id.")
        try:
            mtype = check_machine_type(body.machine_type)
        except ValueError as e:
            raise HTTPException(422, str(e))
    window = steady_window(vals)
    mode = body.mode
    if mode == "trend" and body.machine_id is None:
        raise HTTPException(422, "mode=trend needs machine_id.")
    if body.machine_id is not None and mode == "trend":
        # The machine's real window, with the slider values as its newest reading. With unchanged
        # sliders this reproduces the live prediction exactly (BUG-06); moving a slider changes the
        # newest reading and therefore the level, spread and trend features together.
        win = latest_windows(db, [body.machine_id]).get(body.machine_id)
        if win:
            window = window_with_current(win[0], vals)
    _, bundle = registry.active_bundle(db)
    th = get_thresholds(db)
    base = score_many(bundle, [(mtype, steady_window(normal_reading(mtype)))], th, explain=False)[0]
    res = score_many(bundle, [(mtype, window)], th)[0]
    return {
        "machine_type": mtype, "input": vals, "mode": mode, **res,
        "baseline_probability": base["failure_probability"],
        "thresholds": th,
        "recommended_action": recommended_action(res["risk_level"], res["rul_days"], res["contributions"]),
    }

