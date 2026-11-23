"""Inference + explainability on top of a trained bundle (fast, request-safe).

Everything here works on small windows (7 readings per machine) so each call
is a handful of milliseconds.

Explainability without SHAP - local what-if
-------------------------------------------
For one machine (or one simulated reading), each sensor in turn is moved to
its design-normal value for the machine type over the whole 7-reading window
(which also removes that sensor's trend and noise), the model is re-run, and
the drop in failure probability is that sensor's contribution. All 1 + 6
variants are scored in a single ``predict_proba`` call.
"""

from __future__ import annotations

import numpy as np

from .config import RUL_CAP_DAYS, SENSOR_META, SENSORS, WINDOW, normal_value
from .features import features_for_machine, normalize, window_features

DEFAULT_THRESHOLDS = {"medium": 0.30, "high": 0.60}


def risk_level(prob: float, thresholds: dict | None = None) -> str:
    th = thresholds or DEFAULT_THRESHOLDS
    if prob >= th["high"]:
        return "High"
    if prob >= th["medium"]:
        return "Medium"
    return "Low"


def health_score(prob: float) -> int:
    return int(round(100.0 * (1.0 - float(prob))))


def _classifier(bundle: dict, which: str | None = None):
    return bundle["models"][which or bundle["primary"]]


def steady_window(values: dict[str, float]) -> np.ndarray:
    """A single reading treated as a steady state: 7 identical readings (zero trend)."""
    row = np.array([[float(values[s]) for s in SENSORS]])
    return np.repeat(row, WINDOW, axis=0)


def window_with_current(history: np.ndarray, values: dict[str, float]) -> np.ndarray:
    """The simulated reading REPLACES the machine's newest reading: previous 6 real readings + it.

    ``history`` is the machine's latest 7-reading window (oldest first). Because the sliders
    start at the newest real reading, unchanged values reproduce the live prediction exactly.
    """
    cur = np.array([[float(values[s]) for s in SENSORS]])
    hist = np.asarray(history, dtype=float)[:-1][-(WINDOW - 1):]
    if hist.shape[0] < WINDOW - 1:
        pad = np.repeat(hist[:1] if len(hist) else cur, WINDOW - 1 - hist.shape[0], axis=0)
        hist = np.vstack([pad, hist])
    return np.vstack([hist, cur])


def _last_feature_rows(machine_type: str, windows: list[np.ndarray]) -> np.ndarray:
    return np.vstack([window_features(normalize(machine_type, w))[-1:] for w in windows])


def score_windows(bundle: dict, machine_type: str, windows: list[np.ndarray], which: str | None = None) -> dict:
    X = _last_feature_rows(machine_type, windows)
    prob = _classifier(bundle, which).predict_proba(X)[:, 1]
    rul = np.clip(bundle["models"]["rul"].predict(X), 0, RUL_CAP_DAYS)
    iso = bundle["models"]["iso"]
    anomaly_score = -iso.decision_function(X)  # > 0 means anomalous
    return {"prob": prob, "rul": rul, "anomaly_score": anomaly_score, "anomaly": anomaly_score > 0}


def contributions(bundle: dict, machine_type: str, window: np.ndarray) -> list[dict]:
    """Top contributing sensors via the local what-if method (see module docstring)."""
    variants = [window]
    for j, s in enumerate(SENSORS):
        w = window.copy()
        w[:, j] = normal_value(machine_type, s)
        variants.append(w)
    probs = _classifier(bundle).predict_proba(_last_feature_rows(machine_type, variants))[:, 1]
    base = float(probs[0])
    out = []
    for j, s in enumerate(SENSORS):
        drop = base - float(probs[j + 1])
        out.append({
            "sensor": s,
            "label": SENSOR_META[s]["label"],
            "unit": SENSOR_META[s]["unit"],
            "current": round(float(window[-1, j]), 3),
            "normal": round(normal_value(machine_type, s), 3),
            "risk_drop": round(drop, 4),
            "risk_if_normal": round(float(probs[j + 1]), 4),
        })
    return sorted(out, key=lambda r: r["risk_drop"], reverse=True)


def score_many(bundle: dict, items: list[tuple[str, np.ndarray]], thresholds: dict | None = None, explain: bool = True) -> list[dict]:
    """Score many (machine_type, window) pairs - with what-if contributions - in ONE model call each.

    Used for whole-fleet refreshes: 30 machines x (1 + 6 variants) = 210 rows.
    """
    if not items:
        return []
    rows, variant_rows = [], []
    for mtype, w in items:
        rows.append(window_features(normalize(mtype, w))[-1])
        if explain:
            for j, s in enumerate(SENSORS):
                v = w.copy()
                v[:, j] = normal_value(mtype, s)
                variant_rows.append(window_features(normalize(mtype, v))[-1])
    X = np.vstack(rows)
    clf = _classifier(bundle)
    prob = clf.predict_proba(X)[:, 1]
    rul = np.clip(bundle["models"]["rul"].predict(X), 0, RUL_CAP_DAYS)
    an = -bundle["models"]["iso"].decision_function(X)
    vprob = clf.predict_proba(np.vstack(variant_rows))[:, 1].reshape(len(items), len(SENSORS)) if explain else None
    out = []
    for i, (mtype, w) in enumerate(items):
        p = float(prob[i])
        res = {
            "failure_probability": round(p, 4), "health_score": health_score(p), "risk_level": risk_level(p, thresholds),
            "rul_days": round(float(rul[i]), 1), "rul_capped": bool(rul[i] >= RUL_CAP_DAYS - 0.05),
            "anomaly": bool(an[i] > 0), "anomaly_score": round(float(an[i]), 4),
            "model_version": bundle["version"], "model": bundle["primary"],
        }
        if explain:
            contrib = []
            for j, s in enumerate(SENSORS):
                contrib.append({
                    "sensor": s, "label": SENSOR_META[s]["label"], "unit": SENSOR_META[s]["unit"],
                    "current": round(float(w[-1, j]), 3), "normal": round(normal_value(mtype, s), 3),
                    "risk_drop": round(p - float(vprob[i, j]), 4), "risk_if_normal": round(float(vprob[i, j]), 4),
                })
            res["contributions"] = sorted(contrib, key=lambda r: r["risk_drop"], reverse=True)
        out.append(res)
    return out


def predict_window(bundle: dict, machine_type: str, window: np.ndarray, thresholds: dict | None = None, explain: bool = True) -> dict:
    sc = score_windows(bundle, machine_type, [window])
    p = float(sc["prob"][0])
    res = {
        "failure_probability": round(p, 4),
        "health_score": health_score(p),
        "risk_level": risk_level(p, thresholds),
        "rul_days": round(float(sc["rul"][0]), 1),
        "rul_capped": bool(sc["rul"][0] >= RUL_CAP_DAYS - 0.05),
        "anomaly": bool(sc["anomaly"][0]),
        "anomaly_score": round(float(sc["anomaly_score"][0]), 4),
        "model_version": bundle["version"],
        "model": bundle["primary"],
    }
    if explain:
        res["contributions"] = contributions(bundle, machine_type, window)
    return res


def history_predictions(bundle: dict, machine_type: str, values: np.ndarray, rows: np.ndarray) -> dict:
    """Predictions for selected reading indices of one machine (vectorised; used for seeding/backfill)."""
    X = features_for_machine(machine_type, values)[rows]
    prob = _classifier(bundle).predict_proba(X)[:, 1]
    rul = np.clip(bundle["models"]["rul"].predict(X), 0, RUL_CAP_DAYS)
    anomaly_score = -bundle["models"]["iso"].decision_function(X)
    return {"prob": prob, "rul": rul, "anomaly_score": anomaly_score}


def anomaly_flags(bundle: dict, machine_type: str, values: np.ndarray) -> np.ndarray:
    X = features_for_machine(machine_type, values)
    return bundle["models"]["iso"].predict(X) == -1


ACTIONS = {
    "temperature": "Check cooling, ventilation and lubrication; inspect for friction hot-spots.",
    "vibration": "Inspect bearings, alignment and mounting; schedule a vibration analysis.",
    "pressure": "Check seals, valves and filters for leaks or blockage.",
    "rpm": "Inspect the drive belt / coupling and verify the load on the machine.",
    "running_hours": "Machine is due for its scheduled service; plan preventive maintenance.",
    "current": "Inspect windings, insulation and electrical connections; check for overload.",
}


def recommended_action(risk: str, rul_days: float, top: list[dict]) -> dict:
    drivers = [c for c in top if c["risk_drop"] > 0.02][:2]
    detail = " ".join(ACTIONS[c["sensor"]] for c in drivers) or "No single sensor stands out."
    if risk == "High":
        when = "within 24 hours" if rul_days <= 3 else "within the next 2-3 days"
        return {"urgency": "Urgent", "title": f"Schedule corrective maintenance {when}", "detail": detail}
    if risk == "Medium":
        return {"urgency": "Plan", "title": "Plan an inspection this week and monitor closely", "detail": detail}
    return {"urgency": "Routine", "title": "Continue routine monitoring", "detail": "All sensors are within the expected operating envelope."}
