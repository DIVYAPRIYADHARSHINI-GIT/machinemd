"""Reports: aggregated data for the PDF report (rendered on the frontend) and CSV exports."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ml.config import SENSORS
from ml.train import MODEL_LABELS

from .. import config
from ..csvutil import to_csv
from ..db import get_db
from ..models import Alert, Machine, MaintenanceLog, Prediction, Reading, User, utcnow
from ..security import get_current_user
from ..services import registry
from ..services.predictions import OPEN_STATUSES, latest_prediction_map

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/summary")
def report_summary(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Everything the PDF report needs, in one call."""
    machines = list(db.scalars(select(Machine).order_by(Machine.code)))
    preds = latest_prediction_map(db)
    scored = [preds[m.id] for m in machines if m.id in preds]
    dist = {lvl: sum(1 for p in scored if p.risk_level == lvl) for lvl in ("High", "Medium", "Low")}
    risky = sorted((m for m in machines if m.id in preds and preds[m.id].risk_level in ("High", "Medium")), key=lambda m: -preds[m.id].failure_probability)
    high_risk = []
    for m in risky:
        p = preds[m.id]
        top = [c["label"] for c in (p.contributions or []) if c.get("risk_drop", 0) > 0.02][:2]
        high_risk.append({"code": m.code, "name": m.name, "type": m.type, "location": m.location, "risk_level": p.risk_level,
                          "failure_probability": p.failure_probability, "health_score": p.health_score, "rul_days": p.rul_days, "drivers": top})
    v = registry.active_row(db)
    model = None
    if v:
        s = v.summary
        model = {"version": v.version, "primary": v.primary_model, "primary_label": MODEL_LABELS[v.primary_model], "created_at": v.created_at.isoformat(),
                 "mode": v.mode, "metrics": {k: {m: s["metrics"][k][m] for m in ("accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc")} | {"confusion_matrix": s["metrics"][k]["confusion_matrix"]} for k in ("rf", "gb")},
                 "rul": s["rul_metrics"], "data": s["data"], "top_sensors": s["importance"][v.primary_model]["sensors"][:6]}
    maint = db.execute(select(MaintenanceLog, Machine).join(Machine, Machine.id == MaintenanceLog.machine_id)).all()
    by_type: dict[str, dict] = {}
    by_month: dict[str, float] = {}
    for x, m in maint:
        t = by_type.setdefault(m.type, {"type": m.type, "records": 0, "cost": 0.0})
        t["records"] += 1
        t["cost"] += x.cost
        key = x.date.strftime("%Y-%m")
        by_month[key] = by_month.get(key, 0.0) + x.cost
    alerts_open = db.scalar(select(func.count(Alert.id)).where(Alert.status.in_(OPEN_STATUSES))) or 0
    return {
        "generated_at": utcnow().isoformat(),
        "fleet": {"machines": len(machines), "scored": len(scored), "distribution": dist,
                  "avg_health_score": round(sum(p.health_score for p in scored) / len(scored), 1) if scored else None,
                  "open_alerts": alerts_open, "anomalies": sum(1 for p in scored if p.anomaly),
                  "readings": db.scalar(select(func.count(Reading.id))) or 0},
        "high_risk": high_risk,
        "model": model,
        "maintenance": {"records": len(maint), "total_cost": round(sum(x.cost for x, _ in maint), 2),
                        "by_type": sorted(by_type.values(), key=lambda r: -r["cost"]),
                        "by_month": [{"month": k, "cost": round(v_, 2)} for k, v_ in sorted(by_month.items())],
                        "open_jobs": sum(1 for x, _ in maint if x.status != "Completed")},
        "storage_note": config.STORAGE_NOTE,
    }


def _csv(name: str, header: list[str], rows: list[list]) -> Response:
    stamp = utcnow().strftime("%Y%m%d")
    return Response(content="\ufeff" + to_csv(header, rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="machinemd_{name}_{stamp}.csv"'})


@router.get("/export/{kind}")
def export_csv(kind: str, machine_id: int | None = None, limit: int = Query(default=5000, ge=1, le=20000),
               _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if kind == "machines":
        preds = latest_prediction_map(db)
        rows = []
        for m in db.scalars(select(Machine).order_by(Machine.code)):
            p = preds.get(m.id)
            rows.append([m.code, m.name, m.type, m.location, m.install_date.isoformat(), m.status,
                         p.risk_level if p else "", p.failure_probability if p else "", p.health_score if p else "", p.rul_days if p else "", p.anomaly if p else ""])
        return _csv("machines", ["code", "name", "type", "location", "install_date", "status", "risk_level", "failure_probability", "health_score", "rul_days", "anomaly"], rows)
    if kind == "predictions":
        q = select(Prediction, Machine.code).join(Machine, Machine.id == Prediction.machine_id)
        if machine_id:
            q = q.where(Prediction.machine_id == machine_id)
        rows = [[c, p.reading_time.isoformat(), p.model_version, p.failure_probability, p.health_score, p.risk_level, p.rul_days, p.anomaly]
                for p, c in db.execute(q.order_by(Prediction.reading_time.desc()).limit(limit))]
        return _csv("predictions", ["machine_code", "reading_time", "model_version", "failure_probability", "health_score", "risk_level", "rul_days", "anomaly"], rows)
    if kind == "readings":
        q = select(Reading, Machine.code).join(Machine, Machine.id == Reading.machine_id)
        if machine_id:
            q = q.where(Reading.machine_id == machine_id)
        rows = [[c, r.timestamp.strftime("%Y-%m-%d %H:%M"), *[getattr(r, s) for s in SENSORS], r.source]
                for r, c in db.execute(q.order_by(Reading.timestamp.desc()).limit(limit))]
        return _csv("readings", ["machine_code", "timestamp", *SENSORS, "source"], rows)
    if kind == "maintenance":
        rows = [[m.code, x.date.isoformat(), x.issue, x.action_taken, x.cost, x.technician, x.status]
                for x, m in db.execute(select(MaintenanceLog, Machine).join(Machine, Machine.id == MaintenanceLog.machine_id).order_by(MaintenanceLog.date.desc()))]
        return _csv("maintenance", ["machine_code", "date", "issue", "action_taken", "cost", "technician", "status"], rows)
    if kind == "alerts":
        rows = [[m.code, a.created_at.isoformat(), a.risk_level, a.failure_probability, a.status, a.acknowledged_by or "", a.message]
                for a, m in db.execute(select(Alert, Machine).join(Machine, Machine.id == Alert.machine_id).order_by(Alert.created_at.desc()))]
        return _csv("alerts", ["machine_code", "created_at", "risk_level", "failure_probability", "status", "acknowledged_by", "message"], rows)
    raise HTTPException(404, "Unknown export. Use machines, predictions, readings, maintenance or alerts.")
