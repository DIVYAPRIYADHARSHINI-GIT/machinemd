"""Shared validation helpers and constants."""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone

from ml.config import MACHINE_TYPES, SENSOR_LIMITS, SENSOR_META, SENSORS

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
MACHINE_STATUSES = ["Active", "Under Maintenance", "Inactive"]
MAINT_STATUSES = ["Scheduled", "In Progress", "Completed"]
ROLES = ["admin", "viewer"]


def validate_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
        raise ValueError("Password must contain at least one letter and one number")
    return v


def check_sensor(name: str, value) -> float:
    """Parse and range-check one sensor value; raises ValueError with a readable message."""
    label = SENSOR_META[name]["label"]
    if value is None or (isinstance(value, str) and value.strip() == ""):
        raise ValueError(f"{label} is required")
    try:
        x = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a number (got '{value}')")
    if not math.isfinite(x):
        raise ValueError(f"{label} must be a finite number")
    lo, hi = SENSOR_LIMITS[name]
    if not lo <= x <= hi:
        raise ValueError(f"{label} {x:g} is outside the allowed range {lo:g} to {hi:g} {SENSOR_META[name]['unit']}")
    return x


def check_sensors(values: dict) -> dict[str, float]:
    return {s: check_sensor(s, values.get(s)) for s in SENSORS}


def check_machine_type(v: str) -> str:
    for t in MACHINE_TYPES:
        if v.strip().lower() == t.lower():
            return t
    raise ValueError(f"Machine type must be one of: {', '.join(MACHINE_TYPES)}")


TS_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d", "%d/%m/%Y %H:%M", "%d/%m/%Y")


def parse_timestamp(v: str) -> datetime:
    s = (v or "").strip()
    if not s:
        raise ValueError("Timestamp is required")
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is not None:  # store everything as naive UTC
            dt = dt.astimezone(timezone.utc)
        return dt.replace(tzinfo=None, microsecond=0)
    except ValueError:
        pass
    for fmt in TS_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"Timestamp '{s}' is not a recognised date/time (use YYYY-MM-DD HH:MM)")
