"""Request-scoped clock.

Normally ``now_utc()`` is the real time. While a journaled change is being
*replayed* on another serverless instance (see ``app/sync.py``) it returns the
time the change originally happened, so timestamps written by the replay are
identical on every instance.
"""

from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timezone

op_time_var: ContextVar[datetime | None] = ContextVar("machinemd_op_time", default=None)


def now_utc() -> datetime:
    """Naive UTC timestamp (SQLite stores naive datetimes)."""
    v = op_time_var.get()
    if v is not None:
        return v
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
