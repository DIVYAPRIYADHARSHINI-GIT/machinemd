"""Deterministic synthetic sensor-data generator (numpy only, no downloads).

The fleet is 30 machines (Pumps, Motors, Compressors, AC Units) with ~90 days of
readings every 6 hours. Failures follow realistic degradation patterns:

* **Gradual wear (most failures):** over 7-16 days before the failure the
  temperature and vibration climb (convex ramp), current draw creeps up and
  pressure / RPM sag. Vibration also becomes noisier.
* **Fast failures (~25 %):** the same signature compressed into 2-4 days, so
  the model has little warning - these are genuinely hard cases.
* **Electrical faults (~15 %):** mostly current and temperature, little
  vibration - a different signature the model must also learn.
* **Overheating / cooling faults (~20 %):** temperature leads strongly,
  vibration and current only rise mildly.

Realistic confounders keep the problem honest (not perfectly separable):

* load factor random-walk that moves temperature and current together,
* daily temperature cycle,
* per-machine calibration offsets,
* "hot spell" episodes (temperature up for 1-3 days with no failure),
* sensor glitches (single-reading spikes),
* running hours reset at repairs and scheduled services.

Five machines are *currently* degrading towards a failure that lies just after
the end of the data, so the live dashboard has genuinely high-risk machines.
Those future failures are never written to the database (they have not
happened yet), so they cannot leak into training labels.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import numpy as np

from .config import MACHINE_TYPES, READINGS_PER_DAY, SENSORS, TYPE_PROFILES

LOCATIONS = ["Plant A - Line 1", "Plant A - Line 2", "Plant B - Utilities", "Warehouse North", "Office Tower HVAC"]
TYPE_CODES = {"Pump": "PMP", "Motor": "MTR", "Compressor": "CMP", "AC Unit": "ACU"}
TYPE_NAMES = {
    "Pump": ["Coolant Pump", "Feed Water Pump", "Booster Pump", "Transfer Pump", "Chilled Water Pump", "Fire Pump", "Slurry Pump", "Sump Pump"],
    "Motor": ["Conveyor Motor", "Mixer Motor", "Fan Motor", "Crusher Motor", "Extruder Motor", "Winder Motor", "Hoist Motor", "Agitator Motor"],
    "Compressor": ["Air Compressor", "Screw Compressor", "Refrigeration Compressor", "Gas Compressor", "Piston Compressor", "Booster Compressor", "Instrument Air Compressor"],
    "AC Unit": ["Rooftop AC Unit", "Server Room CRAC", "Lobby AC Unit", "Office AC Unit", "Control Room AC", "Lab AC Unit", "Canteen AC Unit"],
}
TYPE_LOCATIONS = {
    "Pump": ["Plant A - Line 1", "Plant B - Utilities", "Plant A - Line 2"],
    "Motor": ["Plant A - Line 1", "Plant A - Line 2", "Warehouse North"],
    "Compressor": ["Plant B - Utilities", "Plant A - Line 2", "Warehouse North"],
    "AC Unit": ["Office Tower HVAC", "Warehouse North", "Plant B - Utilities"],
}
FAILURE_MODES = {
    "wear": "Bearing / mechanical wear",
    "fast": "Sudden mechanical fault",
    "electrical": "Electrical / winding fault",
    "thermal": "Cooling / overheating fault",
}
TECHNICIANS = ["R. Kumar", "S. Iyer", "A. Fernandes", "M. Shah", "P. Nair"]


@dataclass
class Failure:
    day: float  # failure time, in days from the data start
    mode: str
    onset_days: float
    severity: float


@dataclass
class MachineData:
    code: str
    name: str
    type: str
    location: str
    install_date: date
    status: str
    timestamps: list[datetime] = field(default_factory=list)
    values: np.ndarray | None = None  # (n, 6) in SENSORS order
    failures: list[Failure] = field(default_factory=list)  # observed (inside the window)
    future_failure: Failure | None = None  # degrading now, fails after the window
    services: list[float] = field(default_factory=list)  # scheduled service days


@dataclass
class FleetData:
    start: datetime
    end: datetime
    machines: list[MachineData]


def _plan_failures(rng: np.random.Generator, days: int) -> tuple[list[list[Failure]], list[Failure | None]]:
    """Return observed failures per machine and the current (future) degradations."""
    n = 30
    counts = [0] * 10 + [1] * 14 + [2] * 6  # 26 observed failures in the fleet
    rng.shuffle(counts)
    observed: list[list[Failure]] = []
    for c in counts:
        fails: list[Failure] = []
        tries = 0
        while len(fails) < c and tries < 200:
            tries += 1
            day = float(rng.uniform(14, days - 2))
            if any(abs(day - f.day) < 28 for f in fails):
                continue
            mode = rng.choice(["wear", "fast", "electrical", "thermal"], p=[0.42, 0.22, 0.16, 0.20])
            onset = float(rng.uniform(2, 4)) if mode == "fast" else float(rng.uniform(7, 16))
            fails.append(Failure(day=day, mode=str(mode), onset_days=onset, severity=float(rng.uniform(0.75, 1.35))))
        observed.append(sorted(fails, key=lambda f: f.day))

    # Five machines without a recent failure are degrading right now.
    future: list[Failure | None] = [None] * n
    candidates = [i for i in range(n) if not observed[i] or observed[i][-1].day < days - 30]
    rng.shuffle(candidates)
    for i, ahead in zip(candidates[:5], [1.5, 2.5, 4.0, 6.0, 9.0]):
        future[i] = Failure(day=days + ahead, mode="wear", onset_days=float(rng.uniform(10, 14)), severity=float(rng.uniform(0.95, 1.25)))
    # Three more show early, mild symptoms (medium risk territory).
    for i, ahead in zip(candidates[5:8], [8.0, 9.5, 11.0]):
        future[i] = Failure(day=days + ahead, mode="wear", onset_days=float(rng.uniform(16, 19)), severity=float(rng.uniform(0.85, 1.0)))
    return observed, future


def _degradation(day: np.ndarray, failures: list[Failure]) -> tuple[np.ndarray, list[str]]:
    """Progress p in [0, 1] of the active degradation at each time, plus its mode."""
    p = np.zeros_like(day)
    mode = ["wear"] * len(day)
    for f in failures:
        onset = f.day - f.onset_days
        mask = (day >= onset) & (day <= f.day)
        prog = np.clip((day[mask] - onset) / f.onset_days, 0, 1) ** 1.6 * f.severity
        p[mask] = np.maximum(p[mask], prog)
        for idx in np.nonzero(mask)[0]:
            mode[idx] = f.mode
    return p, mode


def generate_fleet(seed: int = 42, days: int = 90, end: datetime | None = None) -> FleetData:
    rng = np.random.default_rng(seed)
    if end is None:
        now = datetime.now().replace(minute=0, second=0, microsecond=0)
        end = now.replace(hour=(now.hour // 6) * 6)
    n_per_day = READINGS_PER_DAY
    n = days * n_per_day
    start = end - timedelta(hours=6 * (n - 1))
    day = np.arange(n, dtype=float) / n_per_day

    types = ["Pump"] * 8 + ["Motor"] * 8 + ["Compressor"] * 7 + ["AC Unit"] * 7
    observed, future = _plan_failures(rng, days)
    machines: list[MachineData] = []
    type_counter = {t: 0 for t in MACHINE_TYPES}

    for i, mtype in enumerate(types):
        k = type_counter[mtype]
        type_counter[mtype] += 1
        code = f"{TYPE_CODES[mtype]}-{k + 1:03d}"
        name = f"{TYPE_NAMES[mtype][k % len(TYPE_NAMES[mtype])]} {chr(65 + k // len(TYPE_NAMES[mtype]))}".strip()
        location = TYPE_LOCATIONS[mtype][k % 3]
        install = (end - timedelta(days=int(rng.integers(300, 3200)))).date()
        m = MachineData(code=code, name=name, type=mtype, location=location, install_date=install, status="Active")
        m.failures = observed[i]
        m.future_failure = future[i]
        prof = TYPE_PROFILES[mtype]

        all_fail = list(m.failures) + ([m.future_failure] if m.future_failure else [])
        p, modes = _degradation(day, all_fail)
        is_elec = np.array([md == "electrical" for md in modes])
        is_therm = np.array([md == "thermal" for md in modes])
        # Per-mode signature multipliers: mechanical (vibration/pressure/rpm), electrical (current), thermal.
        mech = np.where(is_elec, 0.15, np.where(is_therm, 0.35, 1.0))
        elec = np.where(is_elec, 2.2, np.where(is_therm, 0.6, 1.0))
        therm = np.where(is_elec, 1.1, np.where(is_therm, 1.7, 1.0))

        offset = {s: 1 + rng.normal(0, 0.025) for s in SENSORS}
        # Load factor: slow mean-reverting random walk around 1.0.
        load = np.empty(n)
        load[0] = 1.0
        for t in range(1, n):
            load[t] = load[t - 1] + 0.25 * (1.0 - load[t - 1]) + rng.normal(0, 0.03)
        load = np.clip(load, 0.8, 1.2)
        daily = np.sin(2 * np.pi * (day % 1.0))

        # Hot-spell confounders: temperature up without any failure.
        hot = np.zeros(n)
        for _ in range(int(rng.integers(0, 3))):
            s0 = int(rng.integers(0, n - 12))
            ln = int(rng.integers(4, 12))
            hot[s0 : s0 + ln] += rng.uniform(0.05, 0.09) * prof["temperature"][0]

        vals = np.zeros((n, len(SENSORS)))
        tm, ts_ = prof["temperature"]
        vals[:, 0] = tm * offset["temperature"] + 6.0 * (load - 1) * tm / 10 + 1.2 * daily + hot + p * 0.22 * tm * therm + rng.normal(0, ts_, n)
        vm, vs = prof["vibration"]
        vals[:, 1] = vm * offset["vibration"] + p * 1.5 * vm * mech + rng.normal(0, vs, n) * (1 + 1.5 * p * mech)
        pm, ps = prof["pressure"]
        vals[:, 2] = pm * offset["pressure"] * (1 + 0.04 * (load - 1)) - p * 0.10 * pm * mech + rng.normal(0, ps, n)
        rm, rs = prof["rpm"]
        vals[:, 3] = rm * offset["rpm"] - p * 0.025 * rm * mech + rng.normal(0, rs, n)
        cm, cs = prof["current"]
        vals[:, 5] = cm * offset["current"] * load + p * 0.12 * cm * elec + rng.normal(0, cs, n)

        # Running hours since last service: reset at repairs and scheduled services.
        duty = rng.uniform(4.6, 5.9)
        hours = np.empty(n)
        h = float(rng.uniform(150, 2300))
        fail_idx = {int(np.searchsorted(day, f.day)) for f in m.failures}
        for t in range(n):
            if t in fail_idx:
                h = float(rng.uniform(0, 4))
            h += duty + rng.normal(0, 0.3)
            if h > 2600 and rng.random() < 0.08:  # scheduled service
                m.services.append(float(day[t]))
                h = float(rng.uniform(0, 4))
            hours[t] = h
        vals[:, 4] = hours

        # Sensor glitches: isolated spikes that are anomalies but not failures.
        glitch = rng.random(n) < 0.008
        vals[glitch, 1] *= rng.uniform(1.6, 2.2, glitch.sum())
        glitch_t = rng.random(n) < 0.006
        vals[glitch_t, 0] += rng.uniform(5, 9, glitch_t.sum())

        # A failure stops the machine: drop the readings during the repair (~1 day).
        keep = np.ones(n, dtype=bool)
        for f in m.failures:
            keep &= ~((day > f.day) & (day < f.day + 1.0))
        vals = np.round(vals[keep], 3)
        vals[:, 3] = np.round(vals[:, 3], 1)
        vals[:, 4] = np.round(vals[:, 4], 1)
        m.values = vals
        m.timestamps = [start + timedelta(hours=6 * int(t)) for t in np.nonzero(keep)[0]]
        machines.append(m)

    # A couple of machines are not in normal operation, for realism.
    machines[13].status = "Under Maintenance"
    machines[27].status = "Inactive"
    return FleetData(start=start, end=end, machines=machines)
