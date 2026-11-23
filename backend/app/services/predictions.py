"""Prediction refresh, alert generation and shared helpers used by the routers."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

import numpy as np
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ml.config import SENSORS, WINDOW
from ml.serve import DEFAULT_THRESHOLDS, recommended_action, risk_level, score_many

from ..models import ActivityLog, Alert, Machine, Prediction, Reading, Setting, utcnow
from . import registry

OPEN_STATUSES = ("Open", "Acknowledged")


# ---------------------------------------------------------------- settings
def get_thresholds(db: Session) -> dict:
    row = db.get(Setting, "risk_thresholds")
    if row and isinstance(row.value, dict) and "medium" in row.value and "high" in row.value:
        return {"medium": float(row.value["medium"]), "high": float(row.value["high"])}
    return dict(DEFAULT_THRESHOLDS)


def log_activity(db: Session, user_email: str | None, action: str, entity: str | None = None, entity_id=None, detail: str = "") -> None:
    db.add(ActivityLog(user_email=user_email, action=action, entity=entity, entity_id=None if entity_id is None else str(entity_id), detail=detail[:1000]))


# ---------------------------------------------------------------- readings
def reading_values(r: Reading) -> list[float]:
    return [float(getattr(r, s)) for s in SENSORS]


def latest_windows(db: Session, machine_ids: Iterable[int] | None = None) -> dict[int, tuple[np.ndarray, datetime]]:
    """Last ``WINDOW`` readings (oldest first) + newest timestamp, per machine, in one query."""
    rn = func.row_number().over(partition_by=Reading.machine_id, order_by=Reading.timestamp.desc()).label("rn")
    sub = select(Reading.machine_id, Reading.timestamp, *[getattr(Reading, s) for s in SENSORS], rn)
    if machine_ids is not None:
        sub = sub.where(Reading.machine_id.in_(list(machine_ids)))
    sub = sub.subquery()
    rows = db.execute(select(sub).where(sub.c.rn <= WINDOW).order_by(sub.c.machine_id, sub.c.timestamp)).all()
    out: dict[int, list] = {}
    for r in rows:
        out.setdefault(r.machine_id, []).append(r)
    result = {}
    for mid, rs in out.items():
        arr = np.array([[float(getattr(r, s)) for s in SENSORS] for r in rs])
        if arr.shape[0] < WINDOW:  # pad short histories with the first reading (zero trend)
            arr = np.vstack([np.repeat(arr[:1], WINDOW - arr.shape[0], axis=0), arr])
        result[mid] = (arr, rs[-1].timestamp)
    return result


# ---------------------------------------------------------------- predictions + alerts
def refresh_predictions(db: Session, machine_ids: Iterable[int] | None = None) -> int:
    """Re-score the newest window of each machine with the active model; update alerts.

    One batched model call for the whole fleet. A prediction row for the same
    reading time is updated in place (e.g. after activating a new model) rather
    than duplicated, so history stays one row per scored reading.
    """
    _, bundle = registry.active_bundle(db)
    th = get_thresholds(db)
    q = select(Machine)
    if machine_ids is not None:
        q = q.where(Machine.id.in_(list(machine_ids)))
    machines = {m.id: m for m in db.scalars(q)}
    windows = latest_windows(db, machines.keys())
    ids = [mid for mid in machines if mid in windows]
    results = score_many(bundle, [(machines[mid].type, windows[mid][0]) for mid in ids], th)
    for mid, res in zip(ids, results):
        ts = windows[mid][1]
        db.execute(update(Prediction).where(Prediction.machine_id == mid, Prediction.is_latest.is_(True)).values(is_latest=False))
        pred = db.scalar(select(Prediction).where(Prediction.machine_id == mid, Prediction.reading_time == ts))
        if pred is None:
            pred = Prediction(machine_id=mid, reading_time=ts)
            db.add(pred)
        pred.model_version = res["model_version"]
        pred.failure_probability = res["failure_probability"]
        pred.health_score = res["health_score"]
        pred.risk_level = res["risk_level"]
        pred.rul_days = res["rul_days"]
        pred.anomaly = res["anomaly"]
        pred.anomaly_score = res["anomaly_score"]
        pred.contributions = res["contributions"]
        pred.is_latest = True
        pred.created_at = utcnow()
        db.flush()
        sync_alert(db, machines[mid], pred)
    # Machines whose readings were all removed lose their latest prediction.
    return len(ids)


def _alert_message(m: Machine, pred: Prediction) -> str:
    top = [c["label"] for c in (pred.contributions or []) if c.get("risk_drop", 0) > 0.02][:2]
    drivers = f" Main drivers: {', '.join(top)}." if top else ""
    rul = "more than 14" if pred.rul_days >= 13.95 else f"about {pred.rul_days:.1f}"
    return (f"{m.name} ({m.code}) is at {pred.risk_level.lower()} risk of failure: "
            f"{pred.failure_probability * 100:.0f}% probability within 7 days, estimated remaining life {rul} days.{drivers}")


def sync_alert(db: Session, m: Machine, pred: Prediction) -> None:
    """Create/update the machine's alert from its latest prediction.

    * High or Medium risk -> one open alert per machine (updated, never duplicated).
    * If maintenance already covered this reading (``alert_suppressed_until``),
      no new alert is raised until a newer reading is still risky.
    """
    existing = db.scalar(select(Alert).where(Alert.machine_id == m.id, Alert.status.in_(OPEN_STATUSES)).order_by(Alert.id.desc()))
    if pred.risk_level == "Low":
        return
    if existing is not None:
        if existing.risk_level != pred.risk_level and pred.risk_level == "High" and existing.risk_level == "Medium":
            existing.status = "Open"  # escalation re-opens an acknowledged alert
        existing.risk_level = pred.risk_level
        existing.failure_probability = pred.failure_probability
        existing.prediction_id = pred.id
        existing.message = _alert_message(m, pred)
        return
    if m.alert_suppressed_until is not None and pred.reading_time <= m.alert_suppressed_until:
        return
    db.add(Alert(machine_id=m.id, prediction_id=pred.id, risk_level=pred.risk_level, failure_probability=pred.failure_probability, message=_alert_message(m, pred), status="Open"))


def reclassify_risk(db: Session) -> None:
    """Re-apply (new) thresholds to the stored latest predictions and their alerts."""
    th = get_thresholds(db)
    for pred in db.scalars(select(Prediction).where(Prediction.is_latest.is_(True))):
        pred.risk_level = risk_level(pred.failure_probability, th)
        m = db.get(Machine, pred.machine_id)
        if m:
            sync_alert(db, m, pred)


def handle_alerts_for_machine(db: Session, machine: Machine, maintenance_id: int) -> int:
    alerts = list(db.scalars(select(Alert).where(Alert.machine_id == machine.id, Alert.status.in_(OPEN_STATUSES))))
    now = utcnow()
    for a in alerts:
        a.status = "Handled"
        a.handled_at = now
        a.maintenance_id = maintenance_id
    latest_ts = db.scalar(select(func.max(Reading.timestamp)).where(Reading.machine_id == machine.id))
    machine.alert_suppressed_until = latest_ts
    return len(alerts)


def latest_prediction_map(db: Session) -> dict[int, Prediction]:
    return {p.machine_id: p for p in db.scalars(select(Prediction).where(Prediction.is_latest.is_(True)))}


def prediction_dict(p: Prediction | None) -> dict | None:
    if p is None:
        return None
    return {
        "id": p.id, "reading_time": p.reading_time.isoformat(), "created_at": p.created_at.isoformat(),
        "model_version": p.model_version, "failure_probability": p.failure_probability, "health_score": p.health_score,
        "risk_level": p.risk_level, "rul_days": p.rul_days, "rul_capped": p.rul_days >= 13.95,
        "anomaly": p.anomaly, "anomaly_score": p.anomaly_score,
    }


def action_for(p: Prediction | None) -> dict | None:
    if p is None:
        return None
    return recommended_action(p.risk_level, p.rul_days, p.contributions or [])


def purge_machine_predictions(db: Session, machine_id: int) -> None:
    db.execute(delete(Prediction).where(Prediction.machine_id == machine_id))
