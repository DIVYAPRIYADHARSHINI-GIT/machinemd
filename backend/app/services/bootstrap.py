"""Seeding, training-from-database and self-healing start-up.

``seed_database`` is used by ``scripts/seed_and_train.py`` (full training,
writes into the repo) and by ``ensure_ready`` when the app starts with no
database at all (light training, writes into /tmp).
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ml.config import SENSORS
from ml.dataset import Series, build_dataset
from ml.generator import FAILURE_MODES, TECHNICIANS, generate_fleet
from ml.serve import DEFAULT_THRESHOLDS, history_predictions, risk_level
from ml.train import LIGHT, TrainConfig, bundle_summary, train_bundle

from .. import config
from ..db import Base, copy_seed_if_needed, get_engine, reset_engine, session_factory
from ..models import (
    ActivityLog, Alert, FailureEvent, Machine, MaintenanceLog, ModelVersion, Prediction, Reading, Setting, User, utcnow,
)
from ..security import hash_password
from . import registry
from .predictions import refresh_predictions

log = logging.getLogger("machinemd.bootstrap")

DEMO_USERS = [
    ("admin@machinemd.com", "Admin User", "admin", "Admin@123"),
    ("viewer@machinemd.com", "Viewer User", "viewer", "Viewer@123"),
]


# ------------------------------------------------------------------ training data
def dataset_from_db(db: Session):
    machines = {m.id: m for m in db.scalars(select(Machine))}
    cols = [Reading.machine_id, Reading.timestamp] + [getattr(Reading, s) for s in SENSORS]
    rows = db.execute(select(*cols).order_by(Reading.machine_id, Reading.timestamp)).all()
    fails: dict[int, list[datetime]] = {}
    for fe in db.scalars(select(FailureEvent)):
        fails.setdefault(fe.machine_id, []).append(fe.timestamp)
    by_m: dict[int, list] = {}
    for r in rows:
        by_m.setdefault(r[0], []).append(r)
    series = []
    for mid, rs in by_m.items():
        if mid not in machines or len(rs) < 2:
            continue
        series.append(Series(
            machine_id=mid, machine_type=machines[mid].type, timestamps=[r[1] for r in rs],
            values=np.array([[float(x) for x in r[2:]] for r in rs]), failures=fails.get(mid, []),
        ))
    return build_dataset(series)


def register_bundle(db: Session, bundle: dict, file_name: str, bundled: bool, created_by: str | None, activate: bool) -> ModelVersion:
    summary = bundle_summary(bundle)
    row = ModelVersion(
        version=bundle["version"], file_name=file_name, mode=bundle["mode"], primary_model=bundle["primary"],
        train_rows=summary["data"]["train_rows"], test_rows=summary["data"]["test_rows"], summary=summary,
        is_active=False, is_bundled=bundled, notes=bundle.get("notes", ""), created_by=created_by,
        created_at=datetime.fromisoformat(bundle["created_at"]).replace(tzinfo=None, microsecond=0),
    )
    db.add(row)
    db.flush()
    if activate:
        for other in db.scalars(select(ModelVersion).where(ModelVersion.id != row.id)):
            other.is_active = False
        row.is_active = True
    return row


# ------------------------------------------------------------------ seeding
def seed_database(db: Session, *, seed: int = 42, train_configs: list[tuple[TrainConfig, str]] | None = None,
                  model_dir: Path, bundled_models: bool, end: datetime | None = None) -> dict:
    """Generate the synthetic fleet, write every table, train and register models."""
    t0 = time.perf_counter()
    if end is None:
        now = utcnow().replace(minute=0, second=0)
        end = now.replace(hour=(now.hour // 6) * 6)
    fleet = generate_fleet(seed=seed, end=end)

    for email, name, role, pw in DEMO_USERS:
        db.add(User(email=email, name=name, role=role, password_hash=hash_password(pw), created_at=fleet.start))
    db.add(Setting(key="risk_thresholds", value=dict(DEFAULT_THRESHOLDS)))
    db.flush()
    admin_id = db.scalar(select(User.id).where(User.role == "admin"))

    rng = np.random.default_rng(seed + 1)
    machine_rows: list[tuple[Machine, object]] = []
    for m in fleet.machines:
        row = Machine(code=m.code, name=m.name, type=m.type, location=m.location, install_date=m.install_date, status=m.status, created_at=fleet.start)
        db.add(row)
        machine_rows.append((row, m))
    db.flush()

    reading_dicts = []
    for row, m in machine_rows:
        for ts, v in zip(m.timestamps, m.values):
            reading_dicts.append({"machine_id": row.id, "timestamp": ts, "source": "seed", **{s: float(v[j]) for j, s in enumerate(SENSORS)}})
        for f in m.failures:
            ft = fleet.start + timedelta(days=f.day)
            db.add(FailureEvent(machine_id=row.id, timestamp=ft.replace(microsecond=0), mode=FAILURE_MODES[f.mode], source="seed"))
            # Corrective maintenance after each failure.
            db.add(MaintenanceLog(
                machine_id=row.id, issue=f"Unplanned breakdown - {FAILURE_MODES[f.mode].lower()}",
                action_taken={"wear": "Replaced bearings, realigned shaft and re-lubricated.",
                              "fast": "Replaced failed coupling and damaged impeller; full functional test.",
                              "electrical": "Rewound motor winding, replaced contactor and tested insulation.",
                              "thermal": "Cleaned heat exchanger, replaced cooling fan and thermal paste."}[f.mode],
                cost=float(round(rng.uniform(25000, 180000), -2)), date=(ft + timedelta(hours=12)).date(),
                technician=str(rng.choice(TECHNICIANS)), status="Completed", created_by=admin_id, created_at=ft + timedelta(hours=12),
            ))
        for sd in m.services:
            st = fleet.start + timedelta(days=sd)
            db.add(MaintenanceLog(
                machine_id=row.id, issue="Scheduled preventive service", action_taken="Oil and filter change, belt inspection, sensor calibration.",
                cost=float(round(rng.uniform(4000, 15000), -2)), date=st.date(), technician=str(rng.choice(TECHNICIANS)),
                status="Completed", created_by=admin_id, created_at=st,
            ))
    db.bulk_insert_mappings(Reading, reading_dicts)
    db.flush()

    # ---- train
    ds = dataset_from_db(db)
    configs = train_configs or [(LIGHT, "Self-healed model trained at start-up (light settings).")]
    rows: list[ModelVersion] = []
    bundles = []
    for i, (cfg, notes) in enumerate(configs):
        bundle = train_bundle(ds, cfg, version=f"v{i + 1}", notes=notes)
        file_name = registry.save_bundle(bundle, model_dir)
        rows.append(register_bundle(db, bundle, file_name, bundled_models, "seed script" if bundled_models else "system", activate=False))
        bundles.append(bundle)
    # Activate the version flagged as default (the first config).
    rows[0].is_active = True
    active = bundles[0]
    db.flush()

    # ---- prediction history: one prediction per machine per day (last reading of the day)
    th = dict(DEFAULT_THRESHOLDS)
    pred_dicts = []
    for row, m in machine_rows:
        days = np.array([(ts - fleet.start).days for ts in m.timestamps])
        last_of_day = np.nonzero(np.r_[days[1:] != days[:-1], True])[0]
        hp = history_predictions(active, m.type, m.values, last_of_day)
        for k, idx in enumerate(last_of_day):
            p = float(hp["prob"][k])
            pred_dicts.append({
                "machine_id": row.id, "reading_time": m.timestamps[idx], "created_at": m.timestamps[idx],
                "model_version": active["version"], "failure_probability": round(p, 4), "health_score": int(round(100 * (1 - p))),
                "risk_level": risk_level(p, th), "rul_days": round(float(hp["rul"][k]), 1),
                "anomaly": bool(hp["anomaly_score"][k] > 0), "anomaly_score": round(float(hp["anomaly_score"][k]), 4),
                "contributions": None, "is_latest": False,
            })
    db.bulk_insert_mappings(Prediction, pred_dicts)
    db.flush()

    # Historical alerts: failures the model flagged in the week before they happened (handled by the repair).
    for row, m in machine_rows:
        for f in m.failures:
            ft = fleet.start + timedelta(days=f.day)
            first = db.scalar(select(Prediction).where(
                Prediction.machine_id == row.id, Prediction.reading_time >= ft - timedelta(days=7), Prediction.reading_time < ft,
                Prediction.risk_level.in_(("High", "Medium"))).order_by(Prediction.reading_time))
            if first is None:
                continue
            mlog = db.scalar(select(MaintenanceLog).where(MaintenanceLog.machine_id == row.id, MaintenanceLog.date == (ft + timedelta(hours=12)).date()))
            db.add(Alert(
                machine_id=row.id, prediction_id=first.id, risk_level=first.risk_level, failure_probability=first.failure_probability,
                message=f"{row.name} ({row.code}) showed {first.risk_level.lower()} failure risk ({first.failure_probability * 100:.0f}%).",
                status="Handled", created_at=first.reading_time, handled_at=ft + timedelta(hours=12), maintenance_id=mlog.id if mlog else None,
            ))
    db.flush()

    # Latest prediction (with explanations) + live alerts.
    refresh_predictions(db)
    # A planned job for the machine under maintenance, for realism.
    mm = next(r for r, m in machine_rows if r.status == "Under Maintenance")
    db.add(MaintenanceLog(machine_id=mm.id, issue="Planned overhaul", action_taken="Gearbox overhaul in progress; parts on order.",
                          cost=42000.0, date=(end + timedelta(days=2)).date(), technician="S. Iyer", status="In Progress", created_by=admin_id, created_at=end))
    for r in db.scalars(select(Prediction).where(Prediction.is_latest.is_(True))):
        r.created_at = end
    for a in db.scalars(select(Alert).where(Alert.status == "Open")):
        a.created_at = end
    db.add(ActivityLog(user_email="system", action="seed", entity="database",
                       detail=f"Seeded {len(machine_rows)} machines, {len(reading_dicts)} readings; trained {', '.join(r.version for r in rows)}.", created_at=end))
    db.commit()
    return {
        "machines": len(machine_rows), "readings": len(reading_dicts), "predictions": len(pred_dicts),
        "failures": sum(len(m.failures) for _, m in machine_rows), "versions": [r.version for r in rows],
        "seconds": round(time.perf_counter() - t0, 1), "start": fleet.start.isoformat(), "end": end.isoformat(),
    }


# ------------------------------------------------------------------ self-healing start-up
_ready = False
_ready_lock = threading.Lock()
STATUS: dict = {"db": None, "model": None, "healed": []}


def _heal_model(db: Session) -> None:
    row = registry.active_row(db)
    if row is not None and registry.model_path(row) is not None:
        STATUS["model"] = row.version
        return
    # Fall back to the newest version whose file still exists.
    for cand in db.scalars(select(ModelVersion).order_by(ModelVersion.created_at.desc())):
        if registry.model_path(cand) is not None:
            for other in db.scalars(select(ModelVersion)):
                other.is_active = other.id == cand.id
            db.commit()
            refresh_predictions(db)
            db.commit()
            STATUS["healed"].append(f"active model file missing; activated {cand.version}")
            STATUS["model"] = cand.version
            return
    # No usable model file at all: train a light model from the database.
    ds = dataset_from_db(db)
    version = registry.next_version(db) + "-heal"
    bundle = train_bundle(ds, LIGHT, version=version, notes="Self-healed: no model file was found at start-up.")
    file_name = registry.save_bundle(bundle, config.RUNTIME_MODELS)
    register_bundle(db, bundle, file_name, bundled=False, created_by="system", activate=True)
    db.commit()
    refresh_predictions(db)
    db.commit()
    STATUS["healed"].append(f"no model file found; trained {version}")
    STATUS["model"] = version


def ensure_ready() -> None:
    """Idempotent cold-start: copy the seed DB to /tmp, or rebuild it; make sure a model loads."""
    global _ready
    if _ready:
        return
    with _ready_lock:
        if _ready:
            return
        state = copy_seed_if_needed()
        STATUS["db"] = state
        engine = get_engine()
        if state == "missing":
            log.warning("No seeded database found - generating a fresh one (self-heal).")
            Base.metadata.create_all(engine)
            with session_factory()() as db:
                summary = seed_database(db, model_dir=config.RUNTIME_MODELS, bundled_models=False)
            STATUS["healed"].append(f"database missing; generated {summary['readings']} readings")
        else:
            Base.metadata.create_all(engine)  # no-op for a complete seed; adds any missing table
            with session_factory()() as db:
                if db.scalar(select(func.count(User.id))) == 0:
                    raise RuntimeError("Database has no users; delete it to regenerate.")
        with session_factory()() as db:
            _heal_model(db)
        _ready = True


def reset_runtime() -> None:
    """Forget the runtime database so the next request copies the seed again (tests / admin reset)."""
    global _ready
    with _ready_lock:
        reset_engine()
        registry.clear_cache()
        for p in (config.RUNTIME_DB,):
            if p.exists():
                p.unlink()
        _ready = False
        STATUS.update({"db": None, "model": None, "healed": []})
