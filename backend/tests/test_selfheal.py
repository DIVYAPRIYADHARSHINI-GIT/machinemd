"""Self-healing start-up, run in subprocesses so module-level config can point at fake bundled dirs."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

SCRIPT = r"""
import json, sys
sys.path.insert(0, {backend!r})
from app import config
from pathlib import Path
config.BUNDLED_DIR = Path({bundled!r}); config.BUNDLED_DB = config.BUNDLED_DIR / "machinemd.db"; config.BUNDLED_MODELS = config.BUNDLED_DIR / "models"
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
h = c.get("/api/health").json()
tok = c.post("/api/auth/login", json={{"email": "admin@machinemd.com", "password": "Admin@123"}}).json()["access_token"]
latest = c.get("/api/predictions/latest", headers={{"Authorization": "Bearer " + tok}}).json()
print(json.dumps({{"health": h, "scored": sum(1 for r in latest if r["prediction"])}}))
"""


def _run(bundled: Path) -> dict:
    env = dict(os.environ, MACHINEMD_DATA_DIR=tempfile.mkdtemp(prefix="mmd-heal-"))
    out = subprocess.run([sys.executable, "-c", SCRIPT.format(backend=str(BACKEND), bundled=str(bundled))],
                         capture_output=True, text=True, env=env, timeout=240)
    assert out.returncode == 0, out.stderr[-2000:]
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_heal_missing_model_files():
    tmp = Path(tempfile.mkdtemp())
    shutil.copy(BACKEND / "data" / "machinemd.db", tmp / "machinemd.db")
    (tmp / "models").mkdir()  # no model files at all
    d = _run(tmp)
    assert d["health"]["status"] == "ok" and d["scored"] == 30
    assert any("trained" in x for x in d["health"]["self_heal"])


def test_heal_missing_database():
    tmp = Path(tempfile.mkdtemp())  # nothing bundled
    d = _run(tmp)
    assert d["health"]["status"] == "ok" and d["health"]["database"]["machines"] == 30 and d["scored"] == 30
    assert any("database missing" in x for x in d["health"]["self_heal"])
