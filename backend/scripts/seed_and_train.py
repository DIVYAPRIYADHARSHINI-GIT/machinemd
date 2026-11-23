"""Generate data, seed the SQLite file, train the models and write everything into the repo.

    python backend/scripts/seed_and_train.py

Writes (all committed to git, all read by the live app):

* ``backend/data/machinemd.db``             - seeded database (users, machines, readings, ...)
* ``backend/data/models/machinemd-v1.joblib`` - Random Forest serving model (active)
* ``backend/data/models/machinemd-v2.joblib`` - same data, Gradient Boosting serving model
* ``backend/data/metrics.json``             - real evaluation metrics of every version

Heavy training happens here, never inside a web request.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from sqlalchemy import create_engine, event, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import config  # noqa: E402
from app.db import Base  # noqa: E402
from app.models import ModelVersion  # noqa: E402
from app.services.bootstrap import seed_database  # noqa: E402
from ml.train import TrainConfig  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=42, help="random seed for the synthetic fleet")
    ap.add_argument("--out", type=Path, default=config.BUNDLED_DIR, help="output directory (default backend/data)")
    args = ap.parse_args()

    out: Path = args.out
    models_dir = out / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    for old in models_dir.glob("*.joblib"):
        old.unlink()
    db_path = out / "machinemd.db"
    if db_path.exists():
        db_path.unlink()

    engine = create_engine(f"sqlite:///{db_path}", future=True)

    @event.listens_for(engine, "connect")
    def _fk(conn, _):  # noqa: ANN001
        conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True, expire_on_commit=False)
    t0 = time.perf_counter()
    with Session() as db:
        summary = seed_database(
            db, seed=args.seed, model_dir=models_dir, bundled_models=True,
            train_configs=[
                (TrainConfig(prefer="rf"), "Pre-trained by seed_and_train.py (full settings). Serving model: Random Forest with out-of-bag probability calibration."),
                (TrainConfig(prefer="gb"), "Pre-trained by seed_and_train.py on the same data (full settings). Serving model: Gradient Boosting, kept for comparison."),
            ],
        )
        versions = list(db.scalars(select(ModelVersion).order_by(ModelVersion.id)))
        metrics = {
            v.version: {
                "active": v.is_active, "primary": v.primary_model, "created_at": v.created_at.isoformat(),
                "classifiers": {k: {m: v.summary["metrics"][k][m] for m in ("accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc", "confusion_matrix", "majority_baseline_accuracy")} for k in ("rf", "gb")},
                "rul": v.summary["rul_metrics"], "anomaly": v.summary["anomaly"], "data": v.summary["data"],
                "top_sensors_rf": v.summary["importance"]["rf"]["sensors"],
            }
            for v in versions
        }
    engine.dispose()
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2))
    sizes = {p.name: f"{p.stat().st_size / 1e6:.2f} MB" for p in [db_path, *sorted(models_dir.glob('*.joblib'))]}
    print(json.dumps({"summary": summary, "files": sizes, "total_seconds": round(time.perf_counter() - t0, 1)}, indent=2))
    for v, m in metrics.items():
        print(f"\n{v} (serving={m['primary']}, active={m['active']})")
        for k, c in m["classifiers"].items():
            print(f"  {k}: acc={c['accuracy']} prec={c['precision']} rec={c['recall']} f1={c['f1']} roc_auc={c['roc_auc']} pr_auc={c['pr_auc']} cm={c['confusion_matrix']}")
        print(f"  RUL: MAE={m['rul']['mae_days']} d (baseline {m['rul']['baseline_mae_days']} d), R2={m['rul']['r2']}")


if __name__ == "__main__":
    main()
