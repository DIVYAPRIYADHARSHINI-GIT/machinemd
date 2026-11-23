"""Build the supervised training set from per-machine reading series.

Labels
------
* ``y_fail`` = 1 when the machine's **next recorded failure** happens within
  ``HORIZON_DAYS`` (7) days of the reading.
* ``y_rul``  = days until the next failure, capped at ``RUL_CAP_DAYS`` (14).

Right-censoring (no invented labels)
------------------------------------
Near the end of the data we do not know whether a machine will fail. A reading
with no observed failure after it is only labelled when at least
``HORIZON_DAYS`` of later data exist (for ``y_fail``) or ``RUL_CAP_DAYS`` (for
``y_rul``); otherwise it is excluded from that target. This is what stops the
machines that are degrading *right now* being taught to the model as healthy.

Leakage control
---------------
Features only use the current and previous 6 readings of the same machine
(see ``features.py``). The train/test split is by time - see ``time_split``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np

from .config import HORIZON_DAYS, RUL_CAP_DAYS
from .features import features_for_machine


@dataclass
class Series:
    machine_id: int | str
    machine_type: str
    timestamps: list[datetime]
    values: np.ndarray  # (n, 6)
    failures: list[datetime]


@dataclass
class Dataset:
    X: np.ndarray
    y_fail: np.ndarray  # float, NaN when censored
    y_rul: np.ndarray  # float, NaN when censored
    t: np.ndarray  # epoch seconds of each reading
    machine: np.ndarray  # machine id per row
    machine_type: np.ndarray
    raw: np.ndarray  # (n, 6) raw sensor values (for the anomaly model / reference stats)
    data_end: float  # epoch seconds of the last reading in the dataset

    @property
    def n(self) -> int:
        return int(self.X.shape[0])


def _epoch(ts: list[datetime]) -> np.ndarray:
    return np.array([t.timestamp() for t in ts], dtype=float)


def build_dataset(series: list[Series]) -> Dataset:
    data_end = max((s.timestamps[-1].timestamp() for s in series if s.timestamps), default=0.0)
    Xs, yf, yr, ts, mids, mtypes, raws = [], [], [], [], [], [], []
    day = 86400.0
    for s in series:
        if len(s.timestamps) == 0:
            continue
        order = np.argsort(_epoch(s.timestamps), kind="stable")
        t = _epoch(s.timestamps)[order]
        vals = np.asarray(s.values, dtype=float)[order]
        X = features_for_machine(s.machine_type, vals)
        fails = np.sort(_epoch(s.failures)) if s.failures else np.array([])
        idx = np.searchsorted(fails, t, side="left")  # next failure at or after the reading
        has_next = idx < len(fails)
        next_fail = np.where(has_next, fails[np.minimum(idx, max(len(fails) - 1, 0))] if len(fails) else 0, np.inf)
        dtf = (next_fail - t) / day  # days to failure (inf when none observed)
        remaining = (data_end - t) / day

        y_fail = np.where(dtf <= HORIZON_DAYS, 1.0, np.where(remaining >= HORIZON_DAYS, 0.0, np.nan))
        y_rul = np.where(np.isfinite(dtf), np.minimum(dtf, RUL_CAP_DAYS), np.where(remaining >= RUL_CAP_DAYS, RUL_CAP_DAYS, np.nan))

        Xs.append(X); yf.append(y_fail); yr.append(y_rul); ts.append(t); raws.append(vals)
        mids.append(np.full(len(t), s.machine_id, dtype=object))
        mtypes.append(np.full(len(t), s.machine_type, dtype=object))
    if not Xs:
        raise ValueError("No readings available to build a training set.")
    return Dataset(
        X=np.vstack(Xs), y_fail=np.concatenate(yf), y_rul=np.concatenate(yr), t=np.concatenate(ts),
        machine=np.concatenate(mids), machine_type=np.concatenate(mtypes), raw=np.vstack(raws), data_end=data_end,
    )


@dataclass
class Split:
    train: np.ndarray  # boolean masks over dataset rows
    test: np.ndarray
    cutoff: float
    gap_days: float


def time_split(ds: Dataset, test_fraction: float = 0.30) -> Split:
    """Chronological split shared by every machine.

    * Test  = readings at or after the cutoff time.
    * Train = readings more than ``HORIZON_DAYS`` *before* the cutoff. The gap
      means no training label looks into the test period (a training reading's
      label depends on failures up to 7 days later).
    Every machine contributes to both sides, so this is a pure "train on the
    past, evaluate on the future" protocol.
    """
    t0, t1 = float(ds.t.min()), float(ds.data_end)
    cutoff = t1 - test_fraction * (t1 - t0)
    gap = HORIZON_DAYS * 86400.0
    train = ds.t < (cutoff - gap)
    test = ds.t >= cutoff
    return Split(train=train, test=test, cutoff=cutoff, gap_days=HORIZON_DAYS)
