"""Vercel serverless entrypoint: exposes the MachineMD FastAPI app.

Vercel's Python runtime imports the ASGI callable named ``app`` from this file.
``vercel.json`` rewrites every ``/api/*`` request here; the FastAPI routes are
already mounted under ``/api``.

Serverless constraints handled
------------------------------
* Read-only filesystem except ``/tmp``: the runtime dir is ``/tmp/machinemd``.
  On cold start the committed seed database (``backend/data/machinemd.db``) is
  copied there; light-retrained models are written there as well.
* The pre-trained model files in ``backend/data/models`` are read in place.
* Everything in ``/tmp`` is lost when the instance is recycled, so data edits
  and retrained models reset - the UI shows this note.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("MACHINEMD_DATA_DIR", "/tmp/machinemd")
sys.path.insert(0, str(ROOT / "backend"))

from app.main import app  # noqa: E402,F401  - Vercel imports this symbol
