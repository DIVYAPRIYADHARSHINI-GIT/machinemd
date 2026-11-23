"""Dashboard summary: KPIs, ranking, risk distribution, fleet health trend, recent alerts."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Alert, Machine, Prediction, Reading, User
from ..security import get_current_user
from ..services.predictions import OPEN_STATUSES, latest_prediction_map, prediction_dict
from .alerts import alert_dict

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(trend_days: int = Query(default=30, ge=7, le=90), _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    machines = list(db.scalars(select(Machine).order_by(Machine.code)))
    preds = latest_prediction_map(db)
    scored = [preds[m.id] for m in machines if m.id in preds]
    dist = {lvl: sum(1 for p in scored if p.risk_level == lvl) for lvl in ("High", "Medium", "Low")}
    open_alerts = db.scalar(select(func.count(Alert.id)).where(Alert.status.in_(OPEN_STATUSES))) or 0
    avg_health = round(sum(p.health_score for p in scored) / len(scored), 1) if scored else None

    ranking = sorted(
        ({"machine_id": m.id, "code": m.code, "name": m.name, "type": m.type, "location": m.location, "status": m.status,
          "prediction": prediction_dict(preds.get(m.id)),
          "top_sensor": next((c["label"] for c in (preds[m.id].contributions or []) if c.get("risk_drop", 0) > 0.02), None) if m.id in preds else None}
         for m in machines),
        key=lambda r: -(r["prediction"] or {}).get("failure_probability", -1),
    )

    # Fleet health trend: average daily health score over the last N days of prediction history.
    last = db.scalar(select(func.max(Prediction.reading_time)))
    trend = []
    if last is not None:
        since = last - timedelta(days=trend_days)
        day = func.date(Prediction.reading_time)
        rows = db.execute(
            select(day.label("d"), func.avg(Prediction.health_score), func.min(Prediction.health_score),
                   func.sum(case((Prediction.risk_level == "High", 1), else_=0)), func.count(func.distinct(Prediction.machine_id)))
            .where(Prediction.reading_time >= since).group_by(day).order_by(day)
        ).all()
        trend = [{"date": d, "avg_health": round(float(a), 1), "min_health": int(mn), "high_risk": int(h or 0), "machines": int(n)} for d, a, mn, h, n in rows]

    by_type = {}
    for m in machines:
        p = preds.get(m.id)
        t = by_type.setdefault(m.type, {"type": m.type, "machines": 0, "high": 0, "medium": 0, "low": 0, "health_sum": 0.0, "scored": 0})
        t["machines"] += 1
        if p:
            t[p.risk_level.lower()] += 1
            t["health_sum"] += p.health_score
            t["scored"] += 1
    types = [{k: v for k, v in t.items() if k not in ("health_sum", "scored")} | {"avg_health": round(t["health_sum"] / t["scored"], 1) if t["scored"] else None} for t in by_type.values()]

    recent = db.execute(select(Alert, Machine).join(Machine, Machine.id == Alert.machine_id).order_by(Alert.created_at.desc(), Alert.id.desc()).limit(6)).all()
    return {
        "kpis": {
            "machines_monitored": len(machines),
            "machines_scored": len(scored),
            "active_machines": sum(1 for m in machines if m.status == "Active"),
            "high_risk": dist["High"], "medium_risk": dist["Medium"], "low_risk": dist["Low"],
            "avg_health_score": avg_health, "open_alerts": open_alerts,
            "anomalies": sum(1 for p in scored if p.anomaly),
            "readings": db.scalar(select(func.count(Reading.id))) or 0,
            "last_reading_at": last.isoformat() if last else None,
        },
        "risk_distribution": [{"level": k, "count": v} for k, v in dist.items()],
        "ranking": ranking,
        "health_trend": trend,
        "by_type": types,
        "recent_alerts": [alert_dict(a, m) for a, m in recent],
        "model_version": scored[0].model_version if scored else None,
    }
