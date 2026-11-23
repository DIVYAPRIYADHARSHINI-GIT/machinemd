"""Model registry: list versions, metrics, feature importance, activate, light retrain, delete."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ml.train import LIGHT, MODEL_LABELS, TrainConfig, train_bundle

from .. import config
from ..db import get_db
from ..models import ModelVersion, User
from ..security import get_current_user, require_admin
from ..services import registry
from ..services.bootstrap import dataset_from_db, register_bundle
from ..services.predictions import log_activity, refresh_predictions

router = APIRouter(prefix="/models", tags=["models"])

METRIC_KEYS = ("accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc")


def version_dict(v: ModelVersion, full: bool = False) -> dict:
    s = v.summary
    d = {
        "id": v.id, "version": v.version, "created_at": v.created_at.isoformat(), "mode": v.mode,
        "primary_model": v.primary_model, "primary_label": MODEL_LABELS.get(v.primary_model, v.primary_model),
        "is_active": v.is_active, "is_bundled": v.is_bundled, "file_available": registry.model_path(v) is not None,
        "train_rows": v.train_rows, "test_rows": v.test_rows, "notes": v.notes, "created_by": v.created_by,
        "train_seconds": s.get("train_seconds"),
        "metrics": {k: {m: s["metrics"][k][m] for m in METRIC_KEYS} for k in ("rf", "gb")},
        "rul": s.get("rul_metrics"),
        "data": s.get("data"),
        "config": s.get("config"),
    }
    if full:
        d["curves"] = {k: {"roc": s["metrics"][k]["roc_curve"], "pr": s["metrics"][k]["pr_curve"], "confusion_matrix": s["metrics"][k]["confusion_matrix"],
                           "threshold": s["metrics"][k]["threshold"], "positive_rate": s["metrics"][k]["positive_rate"]} for k in ("rf", "gb")}
        d["anomaly"] = s.get("anomaly")
    return d


@router.get("")
def list_versions(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [version_dict(v) for v in db.scalars(select(ModelVersion).order_by(ModelVersion.created_at.desc(), ModelVersion.id.desc()))]


def _get(db: Session, version: str) -> ModelVersion:
    v = db.scalar(select(ModelVersion).where(ModelVersion.version == version))
    if v is None:
        raise HTTPException(404, f"Model version {version} not found.")
    return v


@router.get("/active")
def active(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    v = registry.active_row(db)
    if v is None:
        raise HTTPException(404, "No active model.")
    return version_dict(v, full=True)


@router.get("/{version}/metrics")
def metrics(version: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return version_dict(_get(db, version), full=True)


@router.get("/{version}/feature-importance")
def feature_importance(version: str, model: str = "primary", _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    v = _get(db, version)
    key = v.primary_model if model == "primary" else model
    if key not in ("rf", "gb"):
        raise HTTPException(422, "model must be 'primary', 'rf' or 'gb'.")
    imp = v.summary["importance"][key]
    return {"version": v.version, "model": key, "model_label": MODEL_LABELS[key], "method": imp["method"], "features": imp["features"], "sensors": imp["sensors"]}


@router.post("/{version}/activate")
def activate(version: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    v = _get(db, version)
    if registry.model_path(v) is None:
        raise HTTPException(409, f"The model file for {version} is no longer available (temporary storage was reset). Retrain to create a new version.")
    registry.load_bundle(v)  # fail before switching if it cannot load
    for other in db.scalars(select(ModelVersion)):
        other.is_active = other.id == v.id
    db.flush()
    t0 = time.perf_counter()
    n = refresh_predictions(db)
    log_activity(db, admin.email, "model_activate", "model", v.version, f"Activated {v.version} ({MODEL_LABELS[v.primary_model]}); re-scored {n} machines")
    db.commit()
    return {"ok": True, "active": v.version, "machines_rescored": n, "seconds": round(time.perf_counter() - t0, 2)}


class RetrainIn(BaseModel):
    serving_model: str = Field(default="auto", pattern="^(auto|rf|gb)$")
    activate: bool = False
    notes: str = Field(default="", max_length=300)


@router.post("/retrain", status_code=201)
def retrain(body: RetrainIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Light retrain on the current database (a few seconds). Saved to temporary storage."""
    t0 = time.perf_counter()
    ds = dataset_from_db(db)
    cfg = TrainConfig(**{**LIGHT.__dict__, "prefer": body.serving_model})
    version = registry.next_version(db)
    try:
        bundle = train_bundle(ds, cfg, version=version, notes=body.notes or f"Light retrain by {admin.email} ({ds.n} readings).")
    except ValueError as e:
        raise HTTPException(422, str(e))
    file_name = registry.save_bundle(bundle, config.RUNTIME_MODELS)
    row = register_bundle(db, bundle, file_name, bundled=False, created_by=admin.email, activate=body.activate)
    n = 0
    if body.activate:
        db.flush()
        n = refresh_predictions(db)
    log_activity(db, admin.email, "model_retrain", "model", version,
                 f"Light retrain {version} on {ds.n} readings in {bundle['train_seconds']}s" + (f"; activated and re-scored {n} machines" if body.activate else ""))
    db.commit()
    return {"ok": True, "version": version_dict(row, full=True), "seconds": round(time.perf_counter() - t0, 2), "machines_rescored": n,
            "note": "Retrained models are saved to temporary storage and are removed when the server restarts."}


@router.delete("/{version}")
def delete_version(version: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    v = _get(db, version)
    if v.is_active:
        raise HTTPException(400, "The active model cannot be deleted. Activate another version first.")
    if v.is_bundled:
        raise HTTPException(400, "Pre-trained versions shipped with the app cannot be deleted.")
    p = config.RUNTIME_MODELS / v.file_name
    if p.exists():
        p.unlink()
    db.delete(v)
    log_activity(db, admin.email, "model_delete", "model", version, f"Deleted model version {version}")
    db.commit()
    return {"ok": True}
