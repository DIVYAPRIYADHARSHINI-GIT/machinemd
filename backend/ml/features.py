"""Feature engineering (numpy only).

For every sensor and every reading the model sees four features computed over
the **last 7 readings of the same machine, up to and including the current
one** (never a future reading):

* ``<sensor>``        - the current value,
* ``<sensor>_mean7``  - rolling mean,
* ``<sensor>_std7``   - rolling standard deviation,
* ``<sensor>_slope7`` - least-squares trend (change per reading).

Values are first expressed relative to the machine type's design-normal
operating point (``(x - normal) / normal``; running hours as ``hours / 1000``)
so a 90 °C compressor and a 46 °C AC unit are on a comparable scale and a
single model serves all four machine types.
"""

from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .config import RUNNING_HOURS_SCALE, SENSOR_META, SENSORS, TYPE_PROFILES, WINDOW

STATS = ["", "_mean7", "_std7", "_slope7"]
FEATURE_NAMES: list[str] = [f"{s}{k}" for s in SENSORS for k in STATS]
N_FEATURES = len(FEATURE_NAMES)
STAT_LABELS = {"": "current", "_mean7": "7-reading mean", "_std7": "7-reading std", "_slope7": "7-reading trend"}


def feature_label(name: str) -> str:
    for s in SENSORS:
        if name.startswith(s):
            suffix = name[len(s):]
            return f"{SENSOR_META[s]['label']} ({STAT_LABELS[suffix]})"
    return name


def feature_sensor(name: str) -> str:
    for s in sorted(SENSORS, key=len, reverse=True):
        if name.startswith(s):
            return s
    return name


def normalize(machine_type: str, values: np.ndarray) -> np.ndarray:
    """(n, 6) raw sensor values -> (n, 6) relative deviations from the type normal."""
    prof = TYPE_PROFILES[machine_type]
    out = np.empty_like(values, dtype=float)
    for j, s in enumerate(SENSORS):
        if s == "running_hours":
            out[:, j] = values[:, j] / RUNNING_HOURS_SCALE
        else:
            mu = prof[s][0]
            out[:, j] = (values[:, j] - mu) / mu
    return out


def denormalize_delta(machine_type: str, sensor: str, delta_norm: float) -> float:
    if sensor == "running_hours":
        return delta_norm * RUNNING_HOURS_SCALE
    return delta_norm * TYPE_PROFILES[machine_type][sensor][0]


_X = np.arange(WINDOW, dtype=float)
_XC = _X - _X.mean()
_SXX = float((_XC ** 2).sum())


def window_features(norm: np.ndarray) -> np.ndarray:
    """(n, 6) normalised readings of ONE machine in time order -> (n, 24) features.

    Early readings (fewer than 7 predecessors) are padded by repeating the first
    reading, which yields a zero trend rather than borrowing data from elsewhere.
    """
    n = norm.shape[0]
    if n == 0:
        return np.zeros((0, N_FEATURES))
    padded = np.vstack([np.repeat(norm[:1], WINDOW - 1, axis=0), norm])
    win = sliding_window_view(padded, WINDOW, axis=0)  # (n, 6, WINDOW)
    mean = win.mean(axis=2)
    std = win.std(axis=2)
    slope = (win * _XC).sum(axis=2) / _SXX
    out = np.empty((n, N_FEATURES))
    for j in range(len(SENSORS)):
        out[:, 4 * j + 0] = norm[:, j]
        out[:, 4 * j + 1] = mean[:, j]
        out[:, 4 * j + 2] = std[:, j]
        out[:, 4 * j + 3] = slope[:, j]
    return out


def features_for_machine(machine_type: str, values: np.ndarray) -> np.ndarray:
    return window_features(normalize(machine_type, np.asarray(values, dtype=float)))


# Monotonic constraints (+1 = higher value can only raise failure risk).
# Domain knowledge: hotter, shakier, higher current, longer since service -> worse;
# pressure and RPM sag -> worse; a more erratic signal (higher rolling std) -> worse.
# With every feature of a sensor constrained, the what-if simulator is
# guaranteed to show non-decreasing risk as temperature or vibration rise.
_RAW_DIRECTION = {"temperature": 1, "vibration": 1, "pressure": -1, "rpm": -1, "running_hours": 1, "current": 1}


def monotonic_constraints() -> list[int]:
    cst: list[int] = []
    for s in SENSORS:
        d = _RAW_DIRECTION[s]
        cst += [d, d, 0 if s == "running_hours" else 1, 0 if s == "running_hours" else d]
    return cst


def rul_constraints() -> list[int]:
    """Remaining useful life moves opposite to risk."""
    return [-c for c in monotonic_constraints()]
