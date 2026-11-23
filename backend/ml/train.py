"""Model training, evaluation and the serialisable model bundle.

One training run produces one *model version* (a joblib bundle) containing:

* ``rf``  - RandomForestClassifier, ``class_weight="balanced_subsample"``,
            probabilities calibrated on out-of-bag predictions
* ``gb``  - HistGradientBoostingClassifier (scikit-learn's gradient boosting
            implementation), ``class_weight="balanced"``
* ``rul`` - RandomForestRegressor on days-to-failure (capped at 14)
* ``iso`` - IsolationForest fitted on healthy training readings
* metrics for every model on the held-out *future* period, ROC / PR curve data,
  confusion matrices, global feature importance and dataset statistics.

Both classifiers carry monotonic constraints from domain knowledge (hotter,
shakier, higher current -> never lower risk), which keeps the what-if simulator
physically sensible. By default the classifier with the higher test F1 at the
0.5 operating threshold (PR-AUC as tie-break - both suit a ~7 % positive
class better than accuracy) becomes the bundle's ``primary`` model used for
live predictions; the other is kept for side-by-side comparison.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest, RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import (
    accuracy_score, average_precision_score, confusion_matrix, f1_score, mean_absolute_error,
    mean_squared_error, precision_recall_curve, precision_score, r2_score, recall_score, roc_auc_score, roc_curve,
)

from .config import HORIZON_DAYS, RUL_CAP_DAYS, SENSORS, WINDOW
from .dataset import Dataset, time_split
from .features import FEATURE_NAMES, feature_label, feature_sensor, monotonic_constraints, rul_constraints

MODEL_LABELS = {"rf": "Random Forest", "gb": "Gradient Boosting"}


@dataclass
class TrainConfig:
    rf_trees: int = 200
    rf_depth: int = 12
    gb_iter: int = 250
    rul_trees: int = 120
    iso_trees: int = 150
    seed: int = 7
    mode: str = "full"  # "full" (local script) or "light" (in-app retrain)
    balanced: bool = True  # class-imbalance handling via class weights (False = ablation baseline)
    prefer: str = "auto"  # serving classifier: "auto" (best test F1), "rf" or "gb"


LIGHT = TrainConfig(rf_trees=60, rf_depth=10, gb_iter=100, rul_trees=40, iso_trees=60, mode="light")


class CalibratedForest:
    """Random Forest + Platt scaling fitted on its out-of-bag (OOB) predictions.

    ``class_weight="balanced_subsample"`` pushes the forest's raw probabilities
    up (a healthy machine scored ~0.24), which would make the health score lie.
    A 1-D logistic fit on the OOB logit maps them back to observed failure
    rates. OOB predictions come from trees that never saw that row, so the
    calibration uses no test data and no in-sample leakage. The map is
    monotonic increasing, so ranking metrics (ROC-AUC, PR-AUC) and the
    monotonic sensor constraints are preserved.
    """

    def __init__(self, forest: RandomForestClassifier, a: float, b: float) -> None:
        self.forest = forest
        self.a = a
        self.b = b
        self.classes_ = forest.classes_

    @property
    def feature_importances_(self) -> np.ndarray:
        return self.forest.feature_importances_

    @staticmethod
    def _logit(p: np.ndarray) -> np.ndarray:
        p = np.clip(p, 1e-4, 1 - 1e-4)
        return np.log(p / (1 - p))

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        raw = self.forest.predict_proba(X)[:, 1]
        p = 1.0 / (1.0 + np.exp(-(self.a * self._logit(raw) + self.b)))
        return np.column_stack([1 - p, p])

    @classmethod
    def fit(cls, X: np.ndarray, y: np.ndarray, **params) -> "CalibratedForest":
        from sklearn.linear_model import LogisticRegression

        forest = RandomForestClassifier(oob_score=True, **params).fit(X, y)
        oob = forest.oob_decision_function_[:, 1]
        ok = np.isfinite(oob)
        lr = LogisticRegression(C=1e4).fit(cls._logit(oob[ok]).reshape(-1, 1), y[ok])
        a, b = float(lr.coef_[0, 0]), float(lr.intercept_[0])
        if a <= 0:  # degenerate fit - keep raw probabilities
            a, b = 1.0, 0.0
        return cls(forest, a, b)


def _downsample_curve(x: np.ndarray, y: np.ndarray, n: int = 60) -> list[dict]:
    if len(x) > n:
        idx = np.unique(np.linspace(0, len(x) - 1, n).round().astype(int))
        x, y = x[idx], y[idx]
    return [{"x": round(float(a), 4), "y": round(float(b), 4)} for a, b in zip(x, y)]


def evaluate_classifier(y_true: np.ndarray, proba: np.ndarray, threshold: float = 0.5) -> dict:
    pred = (proba >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    fpr, tpr, _ = roc_curve(y_true, proba)
    prec, rec, _ = precision_recall_curve(y_true, proba)
    order = np.argsort(rec)
    return {
        "threshold": threshold,
        "accuracy": round(float(accuracy_score(y_true, pred)), 4),
        "precision": round(float(precision_score(y_true, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, pred, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_true, proba)), 4),
        "pr_auc": round(float(average_precision_score(y_true, proba)), 4),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "roc_curve": _downsample_curve(fpr, tpr),
        "pr_curve": _downsample_curve(rec[order], prec[order]),
        "positive_rate": round(float(y_true.mean()), 4),
        # Accuracy of always predicting "no failure" - the bar any real model must clear.
        "majority_baseline_accuracy": round(float(1 - y_true.mean()), 4),
    }


def _importance_rows(values: np.ndarray) -> list[dict]:
    total = float(values.sum()) or 1.0
    rows = [
        {"feature": f, "label": feature_label(f), "sensor": feature_sensor(f), "importance": round(float(v) / total, 5)}
        for f, v in zip(FEATURE_NAMES, values)
    ]
    return sorted(rows, key=lambda r: r["importance"], reverse=True)


def _sensor_importance(rows: list[dict]) -> list[dict]:
    agg: dict[str, float] = {s: 0.0 for s in SENSORS}
    for r in rows:
        agg[r["sensor"]] += r["importance"]
    return sorted(({"sensor": s, "importance": round(v, 5)} for s, v in agg.items()), key=lambda r: r["importance"], reverse=True)


def _permutation_importance(model, X: np.ndarray, y: np.ndarray, seed: int, repeats: int = 3) -> np.ndarray:
    """Drop in PR-AUC when one feature is shuffled (used for the GB model, which has no impurity importance)."""
    rng = np.random.default_rng(seed)
    base = average_precision_score(y, model.predict_proba(X)[:, 1])
    out = np.zeros(X.shape[1])
    for j in range(X.shape[1]):
        drops = []
        for _ in range(repeats):
            Xp = X.copy()
            Xp[:, j] = rng.permutation(Xp[:, j])
            drops.append(base - average_precision_score(y, model.predict_proba(Xp)[:, 1]))
        out[j] = max(float(np.mean(drops)), 0.0)
    return out


def train_bundle(ds: Dataset, cfg: TrainConfig = TrainConfig(), version: str = "v1", notes: str = "") -> dict:
    t_start = time.perf_counter()
    split = time_split(ds)
    lab = ~np.isnan(ds.y_fail)
    tr, te = split.train & lab, split.test & lab
    Xtr, ytr = ds.X[tr], ds.y_fail[tr].astype(int)
    Xte, yte = ds.X[te], ds.y_fail[te].astype(int)
    if ytr.sum() < 5 or yte.sum() < 2:
        raise ValueError("Not enough failure examples in the train/test periods to train a classifier.")
    cst = monotonic_constraints()

    rf = CalibratedForest.fit(
        Xtr, ytr, n_estimators=cfg.rf_trees, max_depth=cfg.rf_depth, min_samples_leaf=4, max_features="sqrt",
        class_weight="balanced_subsample" if cfg.balanced else None, monotonic_cst=cst, random_state=cfg.seed, n_jobs=1,
    )
    gb = HistGradientBoostingClassifier(
        max_iter=cfg.gb_iter, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=20, l2_regularization=1.0,
        class_weight="balanced" if cfg.balanced else None, monotonic_cst=cst, random_state=cfg.seed, early_stopping=False,
    ).fit(Xtr, ytr)

    metrics = {k: evaluate_classifier(yte, m.predict_proba(Xte)[:, 1]) for k, m in (("rf", rf), ("gb", gb))}
    if cfg.prefer in ("rf", "gb"):
        primary = cfg.prefer
    else:
        # Operating-point quality first (F1 at the 0.5 threshold), ranking quality as tie-break.
        primary = max(("rf", "gb"), key=lambda k: (metrics[k]["f1"], metrics[k]["pr_auc"]))

    rf_imp = _importance_rows(rf.feature_importances_)
    gb_imp = _importance_rows(_permutation_importance(gb, Xte, yte, cfg.seed, repeats=2 if cfg.mode == "light" else 3))
    importance = {
        "rf": {"method": "Mean decrease in impurity", "features": rf_imp, "sensors": _sensor_importance(rf_imp)},
        "gb": {"method": "Permutation importance (drop in PR-AUC on the test period)", "features": gb_imp, "sensors": _sensor_importance(gb_imp)},
    }

    # Remaining useful life (days), trained on the same time split.
    rlab = ~np.isnan(ds.y_rul)
    rtr, rte = split.train & rlab, split.test & rlab
    rul = RandomForestRegressor(
        n_estimators=cfg.rul_trees, max_depth=cfg.rf_depth, min_samples_leaf=5, max_features=0.5, monotonic_cst=rul_constraints(), random_state=cfg.seed, n_jobs=1,
    ).fit(ds.X[rtr], ds.y_rul[rtr])
    rul_pred = rul.predict(ds.X[rte])
    yr = ds.y_rul[rte]
    near = yr < RUL_CAP_DAYS
    rul_metrics = {
        "mae_days": round(float(mean_absolute_error(yr, rul_pred)), 3),
        "rmse_days": round(float(np.sqrt(mean_squared_error(yr, rul_pred))), 3),
        "r2": round(float(r2_score(yr, rul_pred)), 4),
        "mae_days_near_failure": round(float(mean_absolute_error(yr[near], rul_pred[near])), 3) if near.any() else None,
        "baseline_mae_days": round(float(mean_absolute_error(yr, np.full_like(yr, ds.y_rul[rtr].mean()))), 3),
        "n_test": int(rte.sum()),
        "cap_days": RUL_CAP_DAYS,
    }

    # Anomaly detector on readings far from any failure (the "normal" envelope).
    healthy = split.train & (np.nan_to_num(ds.y_rul, nan=0) >= RUL_CAP_DAYS)
    iso = IsolationForest(n_estimators=cfg.iso_trees, contamination=0.02, random_state=cfg.seed, n_jobs=1).fit(ds.X[healthy])
    iso_flag = iso.predict(ds.X[te]) == -1
    anomaly_stats = {
        "contamination": 0.02,
        "test_flag_rate": round(float(iso_flag.mean()), 4),
        "flag_rate_within_horizon": round(float(iso_flag[yte == 1].mean()), 4) if (yte == 1).any() else None,
        "flag_rate_healthy": round(float(iso_flag[yte == 0].mean()), 4),
    }

    def _period(mask: np.ndarray) -> dict:
        tt = ds.t[mask]
        return {"start": datetime.fromtimestamp(float(tt.min()), timezone.utc).isoformat(), "end": datetime.fromtimestamp(float(tt.max()), timezone.utc).isoformat()}

    n_machines = len(set(ds.machine.tolist()))
    return {
        "version": version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": cfg.mode,
        "notes": notes,
        "primary": primary,
        "models": {"rf": rf, "gb": gb, "rul": rul, "iso": iso},
        "metrics": metrics,
        "rul_metrics": rul_metrics,
        "anomaly": anomaly_stats,
        "importance": importance,
        "feature_names": FEATURE_NAMES,
        "config": {
            "rf_trees": cfg.rf_trees, "rf_depth": cfg.rf_depth, "gb_iter": cfg.gb_iter, "rul_trees": cfg.rul_trees,
            "iso_trees": cfg.iso_trees, "prefer": cfg.prefer, "class_weight": "balanced" if cfg.balanced else "none", "window": WINDOW, "horizon_days": HORIZON_DAYS, "seed": cfg.seed,
        },
        "data": {
            "rows_total": ds.n,
            "rows_labelled": int(lab.sum()),
            "rows_censored": int((~lab).sum()),
            "train_rows": int(tr.sum()),
            "test_rows": int(te.sum()),
            "train_positive": int(ytr.sum()),
            "test_positive": int(yte.sum()),
            "positive_rate": round(float(ds.y_fail[lab].mean()), 4),
            "machines": n_machines,
            "train_period": _period(tr),
            "test_period": _period(te),
            "gap_days": split.gap_days,
            "split": "chronological: train = before (cutoff - 7 days), test = after cutoff",
        },
        "train_seconds": round(time.perf_counter() - t_start, 2),
    }


def bundle_summary(bundle: dict) -> dict:
    """JSON-safe summary (everything except the fitted estimators)."""
    return {k: v for k, v in bundle.items() if k != "models"}
