"""Shared ML constants: sensors, machine-type profiles, label horizon.

Every module (generator, features, training, serving) imports from here so the
training pipeline and the live API can never disagree on a sensor name, a unit
or what "normal" means for a machine type.
"""

from __future__ import annotations

SENSORS: list[str] = ["temperature", "vibration", "pressure", "rpm", "running_hours", "current"]

SENSOR_META: dict[str, dict] = {
    "temperature": {"label": "Temperature", "unit": "°C"},
    "vibration": {"label": "Vibration", "unit": "mm/s"},
    "pressure": {"label": "Pressure", "unit": "bar"},
    "rpm": {"label": "RPM", "unit": "rpm"},
    "running_hours": {"label": "Running hours", "unit": "h"},
    "current": {"label": "Current draw", "unit": "A"},
}

MACHINE_TYPES: list[str] = ["Pump", "Motor", "Compressor", "AC Unit"]

# Design-normal operating point (mean, noise sigma) per machine type.
# running_hours is "hours since last service", so its normal is a fresh service.
TYPE_PROFILES: dict[str, dict[str, tuple[float, float]]] = {
    "Pump": {
        "temperature": (58.0, 1.4), "vibration": (2.8, 0.22), "pressure": (6.0, 0.14),
        "rpm": (1750.0, 14.0), "running_hours": (0.0, 0.0), "current": (18.0, 0.55),
    },
    "Motor": {
        "temperature": (66.0, 1.6), "vibration": (1.9, 0.17), "pressure": (2.5, 0.07),
        "rpm": (1480.0, 11.0), "running_hours": (0.0, 0.0), "current": (24.0, 0.75),
    },
    "Compressor": {
        "temperature": (82.0, 1.9), "vibration": (3.6, 0.28), "pressure": (8.5, 0.19),
        "rpm": (2950.0, 22.0), "running_hours": (0.0, 0.0), "current": (36.0, 1.05),
    },
    "AC Unit": {
        "temperature": (46.0, 1.4), "vibration": (1.4, 0.13), "pressure": (16.0, 0.38),
        "rpm": (1150.0, 11.0), "running_hours": (0.0, 0.0), "current": (11.0, 0.45),
    },
}

# Normalisation scale per sensor: deviations are expressed as a fraction of the
# type's normal value (running hours use a fixed 1,000 h scale), which makes
# features comparable across machine types.
RUNNING_HOURS_SCALE = 1000.0
# Typical running hours for a healthy machine mid-way through a service interval;
# the what-if explainer moves running hours towards this value, not to zero.
RUNNING_HOURS_TYPICAL = 900.0

# Slider ranges for the what-if simulator (shared by API metadata and validation).
SENSOR_LIMITS: dict[str, tuple[float, float]] = {
    "temperature": (-20.0, 200.0),
    "vibration": (0.0, 50.0),
    "pressure": (0.0, 60.0),
    "rpm": (0.0, 10000.0),
    "running_hours": (0.0, 100000.0),
    "current": (0.0, 500.0),
}

READINGS_PER_DAY = 4  # one reading every 6 hours
WINDOW = 7  # rolling window (readings) for mean / std / slope
HORIZON_DAYS = 7  # label: "fails within the next 7 days"
HORIZON_READINGS = HORIZON_DAYS * READINGS_PER_DAY
RUL_CAP_DAYS = 14.0  # RUL is regressed on min(days-to-failure, 14); ">14 days" means no failure expected soon


def normal_value(machine_type: str, sensor: str) -> float:
    if sensor == "running_hours":
        return RUNNING_HOURS_TYPICAL
    return TYPE_PROFILES[machine_type][sensor][0]


def scale_value(machine_type: str, sensor: str) -> float:
    if sensor == "running_hours":
        return RUNNING_HOURS_SCALE
    return TYPE_PROFILES[machine_type][sensor][0]


def normal_reading(machine_type: str) -> dict[str, float]:
    return {s: normal_value(machine_type, s) for s in SENSORS}
