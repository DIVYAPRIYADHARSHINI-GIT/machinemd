"""BUG-07 regression: two serverless instances with separate /tmp databases stay consistent.

Starts two real uvicorn processes, each with its own MACHINEMD_DATA_DIR (exactly like two Vercel
instances), makes changes on instance A, then sends only the journal to instance B and checks that
B shows the same data. Also checks that a forged (unsigned) journal entry is rejected.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path

import httpx
import pytest

BACKEND = Path(__file__).resolve().parents[1]


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="module")
def instances():
    procs, urls = [], []
    env_base = dict(os.environ, MACHINEMD_JWT_SECRET="multi-instance-test-secret-0123456789abcdef")
    for _ in range(2):
        port = _free_port()
        env = dict(env_base, MACHINEMD_DATA_DIR=tempfile.mkdtemp(prefix="mmd-inst-"))
        p = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port), "--log-level", "warning"],
                             cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        procs.append(p)
        urls.append(f"http://127.0.0.1:{port}/api")
    for u in urls:
        for _ in range(100):
            try:
                if httpx.get(f"{u}/health", timeout=2).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.2)
        else:
            raise RuntimeError(f"{u} did not start")
    yield urls
    for p in procs:
        p.terminate()
        p.wait(timeout=10)


class Client:
    """Minimal stand-in for the browser's journal handling in frontend/src/lib/api.js."""

    def __init__(self, base_urls):
        self.urls = base_urls
        self.journal: list[dict] = []
        self.token = None

    def header(self):
        if not self.journal:
            return {}
        raw = zlib.compress(json.dumps(self.journal).encode())
        return {"X-MachineMD-Journal": "z:" + base64.urlsafe_b64encode(raw).decode().rstrip("=")}

    def req(self, inst, method, path, **kw):
        h = {**self.header(), **({"Authorization": f"Bearer {self.token}"} if self.token else {}), **kw.pop("headers", {})}
        r = httpx.request(method, self.urls[inst] + path, headers=h, timeout=60, **kw)
        op = r.headers.get("X-MachineMD-Op")
        if op:
            self.journal.append(json.loads(base64.urlsafe_b64decode(op + "=" * (-len(op) % 4))))
        return r

    def login(self, inst, email, pw):
        r = self.req(inst, "POST", "/auth/login", json={"email": email, "password": pw})
        self.token = r.json()["access_token"]


def test_changes_on_one_instance_appear_on_the_other(instances):
    c = Client(instances)
    c.login(0, "admin@machinemd.com", "Admin@123")
    # Instance A: acknowledge an alert, log maintenance (handles it), add a machine, change thresholds, retrain.
    alert = c.req(0, "GET", "/alerts?status=active&risk=High").json()[0]
    assert c.req(0, "POST", f"/alerts/{alert['id']}/acknowledge").status_code == 200
    m = c.req(0, "POST", "/maintenance", json={"machine_id": alert["machine_id"], "issue": "Bearing noise", "action_taken": "Replaced bearing",
                                                "cost": 12345, "date": "2026-11-23", "technician": "R. Kumar"}).json()
    assert m["alerts_handled"] == 1
    assert c.req(0, "POST", "/machines", json={"code": "PMP-777", "name": "Sync Pump", "type": "Pump", "location": "Plant A - Line 1",
                                                "install_date": "2022-01-01"}).status_code == 201
    assert c.req(0, "PUT", "/settings/thresholds", json={"medium": 0.25, "high": 0.55}).status_code == 200
    r = c.req(0, "POST", "/models/retrain", json={"activate": True, "serving_model": "gb"})
    assert r.status_code == 201
    new_version = r.json()["version"]["version"]
    assert len(c.journal) == 5

    # Instance B has never seen these requests - only the journal header.
    def snapshot(inst):
        d = c.req(inst, "GET", "/dashboard/summary").json()
        return {
            "kpis": {k: d["kpis"][k] for k in ("machines_monitored", "high_risk", "medium_risk", "low_risk", "avg_health_score", "open_alerts")},
            "alert": next(a for a in c.req(inst, "GET", f"/alerts?machine_id={alert['machine_id']}").json() if a["id"] == alert["id"])["status"],
            "maintenance": [(x["id"], x["issue"], x["cost"]) for x in c.req(inst, "GET", "/maintenance").json()[:3]],
            "versions": [(v["version"], v["is_active"], v["metrics"]["gb"]["f1"]) for v in c.req(inst, "GET", "/models").json()],
            "thresholds": c.req(inst, "GET", "/settings").json()["risk_thresholds"],
            "machines": sorted(x["code"] for x in c.req(inst, "GET", "/machines").json()),
        }

    a, b = snapshot(0), snapshot(1)
    assert b == a
    assert b["alert"] == "Handled" and "PMP-777" in b["machines"] and b["thresholds"] == {"medium": 0.25, "high": 0.55}
    assert (new_version, True) in [(v, act) for v, act, _ in b["versions"]]
    # Replaying again is a no-op (idempotent).
    assert snapshot(1) == a


def test_forged_journal_entry_is_rejected(instances):
    c = Client(instances)
    c.login(1, "viewer@machinemd.com", "Viewer@123")
    forged = {"id": "forged000000000000", "t": int(time.time()), "m": "DELETE", "p": "/api/machines/1", "b": "",
              "u": {"id": "1", "e": "admin@machinemd.com", "r": "admin"}, "sig": "0" * 32}
    c.journal.append(forged)
    assert c.req(1, "GET", "/machines/1").status_code == 200  # still exists: the forged op was ignored


def test_journal_is_not_needed_locally(instances):
    """A single instance answers normally without any journal header (local runs, tests)."""
    r = httpx.get(instances[0] + "/health", timeout=10)
    assert r.status_code == 200 and "X-MachineMD-Op" not in r.headers
