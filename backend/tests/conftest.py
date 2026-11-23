"""Test fixtures: every test session uses its own temporary runtime directory, so the
committed seed database and model files are only ever read (exactly like Vercel)."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ["MACHINEMD_DATA_DIR"] = tempfile.mkdtemp(prefix="machinemd-test-")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.security import login_limiter  # noqa: E402
from app.services import bootstrap  # noqa: E402


def _token(client: TestClient, email: str, pw: str) -> dict:
    r = client.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def client():
    """Fresh copy of the seed database for every test."""
    bootstrap.reset_runtime()
    login_limiter._hits.clear()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def admin(client):
    return _token(client, "admin@machinemd.com", "Admin@123")


@pytest.fixture()
def viewer(client):
    return _token(client, "viewer@machinemd.com", "Viewer@123")
