"""Runtime configuration.

Two storage locations:

* **Bundled (read-only):** ``backend/data`` in the repo - the seeded SQLite file
  ``machinemd.db`` and pre-trained model files under ``models/``. These are
  committed to git and shipped with the Vercel function.
* **Runtime (writable):** ``MACHINEMD_DATA_DIR`` (default ``/tmp/machinemd``).
  On a cold start the seeded database is copied here and every write goes to
  the copy; light-retrained model files are saved here too. On Vercel ``/tmp``
  is the only writable path and it is wiped when the instance is recycled,
  which is why data changes and retrained models reset on restart.

Locally the same layout is used, so ``uvicorn`` behaves exactly like Vercel and
the committed seed files are never modified by using the app.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
BUNDLED_DIR = BACKEND_DIR / "data"
BUNDLED_DB = BUNDLED_DIR / "machinemd.db"
BUNDLED_MODELS = BUNDLED_DIR / "models"

RUNTIME_DIR = Path(os.environ.get("MACHINEMD_DATA_DIR") or Path(tempfile.gettempdir()) / "machinemd")
RUNTIME_DB = RUNTIME_DIR / "machinemd.db"
RUNTIME_MODELS = RUNTIME_DIR / "models"

APP_VERSION = "1.0.0"
IS_VERCEL = bool(os.environ.get("VERCEL"))

_DEFAULT_SECRET = "machinemd-demo-secret-set-MACHINEMD_JWT_SECRET-in-production"
JWT_SECRET = os.environ.get("MACHINEMD_JWT_SECRET") or _DEFAULT_SECRET
JWT_SECRET_CONFIGURED = JWT_SECRET != _DEFAULT_SECRET
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("MACHINEMD_JWT_EXPIRE_MINUTES", "480"))

# Comma-separated list; same-origin (the Vercel deployment) needs no CORS at all.
CORS_ORIGINS = [o.strip() for o in os.environ.get("MACHINEMD_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]

LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 300

UPLOAD_MAX_ROWS = 2000
UPLOAD_MAX_BYTES = 512 * 1024
BATCH_MAX_ROWS = 500

STORAGE_NOTE = (
    "Demo storage is temporary: on the hosted (Vercel) version the database lives in /tmp, "
    "so uploaded data, edits and retrained models reset when the server restarts."
)
