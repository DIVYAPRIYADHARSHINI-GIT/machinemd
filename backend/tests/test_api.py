"""API + ML acceptance tests (run: python -m pytest backend/tests -q)."""

from __future__ import annotations

import io
import time

from ml.config import normal_reading


# ---------------------------------------------------------------- auth & roles
def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok" and d["model"]["ok"] and d["database"]["machines"] == 30


def test_login_both_roles_and_me(client, admin, viewer):
    assert client.get("/api/auth/me", headers=admin).json()["role"] == "admin"
    assert client.get("/api/auth/me", headers=viewer).json()["role"] == "viewer"


def test_login_wrong_password_and_rate_limit(client):
    for _ in range(5):
        r = client.post("/api/auth/login", json={"email": "admin@machinemd.com", "password": "nope"})
        assert r.status_code == 401
    r = client.post("/api/auth/login", json={"email": "admin@machinemd.com", "password": "Admin@123"})
    assert r.status_code == 429 and "Retry-After" in r.headers


def test_login_validation(client):
    r = client.post("/api/auth/login", json={"email": "not-an-email", "password": "x"})
    assert r.status_code == 422 and r.json()["code"] == "validation_error"


def test_unauthenticated_and_logout(client, admin):
    assert client.get("/api/machines").status_code == 401
    assert client.post("/api/auth/logout", headers=admin).status_code == 200
    assert client.get("/api/auth/me", headers=admin).status_code == 401


def test_viewer_cannot_modify_anything(client, viewer):
    reads = ["/api/dashboard/summary", "/api/machines", "/api/machines/1", "/api/alerts", "/api/maintenance", "/api/models", "/api/reports/summary"]
    for path in reads:
        assert client.get(path, headers=viewer).status_code == 200, path
    v = normal_reading("Pump")
    writes = [
        ("post", "/api/machines", {"code": "X-1", "name": "X", "type": "Pump", "location": "L1", "install_date": "2020-01-01"}),
        ("put", "/api/machines/1", {"code": "X-1", "name": "X", "type": "Pump", "location": "L1", "install_date": "2020-01-01"}),
        ("delete", "/api/machines/1", None),
        ("post", "/api/readings", {"machine_id": 1, **v}),
        ("post", "/api/models/retrain", {}),
        ("post", "/api/models/v2/activate", None),
        ("post", "/api/maintenance", {"machine_id": 1, "issue": "abc", "action_taken": "abc", "cost": 1, "date": "2026-01-01", "technician": "Me"}),
        ("delete", "/api/maintenance/1", None),
        ("post", "/api/alerts/1/acknowledge", None),
        ("get", "/api/users", None),
        ("post", "/api/users", {"email": "a@b.co", "name": "AB", "role": "viewer", "password": "abcd1234"}),
        ("put", "/api/settings/thresholds", {"medium": 0.2, "high": 0.5}),
        ("post", "/api/predictions/refresh", None),
        ("post", "/api/admin/reset-demo", None),
    ]
    for method, path, body in writes:
        r = getattr(client, method)(path, headers=viewer, **({"json": body} if body is not None else {}))
        assert r.status_code == 403, f"{method} {path} -> {r.status_code}"
    files = {"file": ("x.csv", b"machine_code,timestamp\nA,B\n", "text/csv")}
    assert client.post("/api/readings/upload", headers=viewer, files=files).status_code == 403


# ---------------------------------------------------------------- ML
def test_metrics_are_real_and_not_perfect(client, admin):
    v = client.get("/api/models/active", headers=admin).json()
    for k in ("rf", "gb"):
        m = v["metrics"][k]
        assert 0.5 < m["roc_auc"] < 0.99, m  # informative but not suspiciously perfect
        assert m["recall"] < 0.99 and m["precision"] > 0.3
        cm = v["curves"][k]["confusion_matrix"]
        assert cm["tn"] + cm["fp"] + cm["fn"] + cm["tp"] == v["test_rows"]
        assert len(v["curves"][k]["roc"]) > 5 and len(v["curves"][k]["pr"]) > 5
    d = v["data"]
    assert d["train_period"]["end"] < d["test_period"]["start"]  # chronological split
    assert 0.04 <= d["positive_rate"] <= 0.10  # class imbalance in the requested range


def test_predictions_present_for_every_machine(client, viewer):
    rows = client.get("/api/predictions/latest", headers=viewer).json()
    assert len(rows) == 30 and all(r["prediction"] for r in rows)
    assert any(r["prediction"]["risk_level"] == "High" for r in rows)


def test_whatif_temperature_and_vibration_raise_risk(client, viewer):
    for mtype in ("Pump", "Motor", "Compressor", "AC Unit"):
        base = normal_reading(mtype)
        r0 = client.post("/api/whatif", headers=viewer, json={"machine_type": mtype, **base}).json()
        hot = dict(base, temperature=base["temperature"] * 1.18, vibration=base["vibration"] * 2.0)
        r1 = client.post("/api/whatif", headers=viewer, json={"machine_type": mtype, **hot}).json()
        assert r1["failure_probability"] > r0["failure_probability"] + 0.1, (mtype, r0, r1)
        assert r1["health_score"] < r0["health_score"]
        assert r1["rul_days"] <= r0["rul_days"]
        top = [c["sensor"] for c in r1["contributions"][:2]]
        assert set(top) == {"temperature", "vibration"}, top
        # Monotonic: each step up in temperature never lowers risk.
        last = -1.0
        for k in (0, 0.05, 0.1, 0.15, 0.2, 0.3):
            p = client.post("/api/whatif", headers=viewer, json={"machine_type": mtype, **dict(base, temperature=base["temperature"] * (1 + k))}).json()["failure_probability"]
            assert p >= last - 1e-9
            last = p


def test_whatif_machine_matches_live_prediction(client, viewer):
    """BUG-06 regression: unchanged sliders for a machine reproduce its live prediction."""
    for r in client.get("/api/predictions/latest", headers=viewer).json():
        d = client.get(f"/api/whatif/defaults?machine_id={r['machine_id']}", headers=viewer).json()
        body = {s["sensor"]: s["value"] for s in d["sliders"]} | {"machine_id": r["machine_id"], "mode": "trend"}
        sim = client.post("/api/whatif", headers=viewer, json=body).json()
        assert abs(sim["failure_probability"] - r["prediction"]["failure_probability"]) < 0.002, (r["code"], sim["failure_probability"], r["prediction"])


def test_whatif_validation(client, viewer):
    base = normal_reading("Pump")
    r = client.post("/api/whatif", headers=viewer, json={"machine_type": "Pump", **dict(base, temperature=999)})
    assert r.status_code == 422 and "Temperature" in r.json()["detail"]
    r = client.post("/api/whatif", headers=viewer, json={"machine_type": "Boiler", **base})
    assert r.status_code == 422


def test_single_and_batch_prediction(client, viewer):
    base = normal_reading("Motor")
    r = client.post("/api/predictions/single", headers=viewer, json={"machine_type": "Motor", **base})
    assert r.status_code == 200 and r.json()["risk_level"] == "Low"
    csv = "machine_type,temperature,vibration,pressure,rpm,running_hours,current\nMotor,66,1.9,2.5,1480,900,24\nMotor,80,4.5,2.3,1440,2500,27\nMotor,abc,1,1,1,1,1\n"
    r = client.post("/api/predictions/batch", headers=viewer, files={"file": ("b.csv", csv.encode(), "text/csv")})
    d = r.json()
    assert r.status_code == 200 and d["scored"] == 2 and d["error_rows"] == 1
    assert d["results"][1]["failure_probability"] > d["results"][0]["failure_probability"]


def test_retrain_creates_version_and_activation_changes_predictions(client, admin):
    before = {r["code"]: r["prediction"]["failure_probability"] for r in client.get("/api/predictions/latest", headers=admin).json()}
    t0 = time.perf_counter()
    r = client.post("/api/models/retrain", headers=admin, json={"serving_model": "gb", "activate": False})
    assert r.status_code == 201, r.text
    assert time.perf_counter() - t0 < 10
    new = r.json()["version"]["version"]
    versions = [v["version"] for v in client.get("/api/models", headers=admin).json()]
    assert new in versions and len(versions) == 3
    r = client.post(f"/api/models/{new}/activate", headers=admin)
    assert r.status_code == 200 and r.json()["active"] == new
    after = {r["code"]: r["prediction"] for r in client.get("/api/predictions/latest", headers=admin).json()}
    assert all(p["model_version"] == new for p in after.values())
    assert any(abs(after[c]["failure_probability"] - before[c]) > 1e-3 for c in before)


def test_activate_bundled_v2(client, admin):
    r = client.post("/api/models/v2/activate", headers=admin)
    assert r.status_code == 200
    assert client.get("/api/models/active", headers=admin).json()["version"] == "v2"


# ---------------------------------------------------------------- data upload
def test_template_download(client, viewer):
    r = client.get("/api/readings/template", headers=viewer)
    assert r.status_code == 200 and r.text.startswith("machine_code,timestamp,temperature")


def test_upload_with_bad_row(client, admin):
    csv = (
        "Machine,Time,Temp,Vibration,Pressure,RPM,Hours,Amps\n"
        "PMP-001,2026-11-24 00:00,58.1,2.8,6.0,1750,1500,18\n"
        "PMP-001,2026-11-24 06:00,hot,2.8,6.0,1750,1506,18\n"
        "ZZZ-999,2026-11-24 06:00,58,2.8,6.0,1750,1506,18\n"
        "PMP-002,2026-11-24 00:00,58.4,2.9,6.0,1748,900,18.1\n"
    )
    files = lambda: {"file": ("r.csv", csv.encode(), "text/csv")}  # noqa: E731
    preview = client.post("/api/readings/upload", headers=admin, files=files(), data={"dry_run": "true"}).json()
    assert preview["mapping"]["temperature"] == "Temp" and preview["mapping"]["current"] == "Amps"
    assert preview["valid_rows"] == 2 and preview["error_rows"] == 2 and preview["imported"] == 0
    lines = {e["line"]: e["errors"] for e in preview["errors"]}
    assert "must be a number" in lines[3][0] and "Unknown machine code" in lines[4][0]
    total0 = client.get("/api/readings?limit=1", headers=admin).json()["total"]
    done = client.post("/api/readings/upload", headers=admin, files=files(), data={"dry_run": "false"}).json()
    assert done["imported"] == 2
    assert client.get("/api/readings?limit=1", headers=admin).json()["total"] == total0 + 2
    # Re-uploading the same rows is rejected as duplicates.
    again = client.post("/api/readings/upload", headers=admin, files=files(), data={"dry_run": "true"}).json()
    assert again["valid_rows"] == 0


def test_upload_missing_columns_and_limits(client, admin):
    r = client.post("/api/readings/upload", headers=admin, files={"file": ("r.csv", b"machine_code,timestamp\nPMP-001,2026-01-01\n", "text/csv")})
    assert r.status_code == 200 and r.json()["ok"] is False and "temperature" in r.json()["missing_fields"]
    r = client.post("/api/readings/upload", headers=admin, files={"file": ("r.txt", b"", "text/csv")})
    assert r.status_code == 400
    big = "machine_code,timestamp,temperature,vibration,pressure,rpm,running_hours,current\n" + "PMP-001,2026-01-01,1,1,1,1,1,1\n" * 2001
    r = client.post("/api/readings/upload", headers=admin, files={"file": ("r.csv", big.encode(), "text/csv")})
    assert r.status_code == 413


# ---------------------------------------------------------------- alerts & maintenance
def test_high_risk_alert_handled_by_maintenance(client, admin):
    alerts = client.get("/api/alerts?status=active&risk=High", headers=admin).json()
    assert alerts, "a high-risk machine must have an open alert"
    a = alerts[0]
    r = client.post(f"/api/alerts/{a['id']}/acknowledge", headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "Acknowledged"
    assert client.post(f"/api/alerts/{a['id']}/acknowledge", headers=admin).status_code == 409
    open_before = client.get("/api/dashboard/summary", headers=admin).json()["kpis"]["open_alerts"]
    r = client.post("/api/maintenance", headers=admin, json={
        "machine_id": a["machine_id"], "issue": "High vibration alert", "action_taken": "Replaced bearings", "cost": 45000,
        "date": "2026-11-23", "technician": "R. Kumar", "status": "Completed"})
    assert r.status_code == 201 and r.json()["alerts_handled"] == 1
    handled = [x for x in client.get(f"/api/alerts?machine_id={a['machine_id']}", headers=admin).json() if x["id"] == a["id"]][0]
    assert handled["status"] == "Handled" and handled["maintenance_id"] == r.json()["id"]
    assert client.get("/api/dashboard/summary", headers=admin).json()["kpis"]["open_alerts"] == open_before - 1
    # Re-scoring the same readings must not re-raise the handled alert.
    client.post("/api/predictions/refresh", headers=admin)
    assert not [x for x in client.get(f"/api/alerts?machine_id={a['machine_id']}&status=active", headers=admin).json()]


def test_maintenance_crud_validation(client, admin):
    bad = client.post("/api/maintenance", headers=admin, json={"machine_id": 1, "issue": "", "action_taken": "x", "cost": -5, "date": "2026-01-01", "technician": "A"})
    assert bad.status_code == 422
    r = client.post("/api/maintenance", headers=admin, json={"machine_id": 1, "issue": "Belt check", "action_taken": "Tightened belt", "cost": 900, "date": "2026-11-20", "technician": "M. Shah", "status": "Scheduled"})
    mid = r.json()["id"]
    r = client.put(f"/api/maintenance/{mid}", headers=admin, json={"machine_id": 1, "issue": "Belt check", "action_taken": "Replaced belt", "cost": 1900, "date": "2026-11-20", "technician": "M. Shah", "status": "Completed"})
    assert r.status_code == 200 and r.json()["cost"] == 1900
    assert client.delete(f"/api/maintenance/{mid}", headers=admin).status_code == 200


# ---------------------------------------------------------------- dashboard consistency
def test_dashboard_numbers_match_data(client, viewer):
    d = client.get("/api/dashboard/summary", headers=viewer).json()
    machines = client.get("/api/machines", headers=viewer).json()
    alerts = client.get("/api/alerts?status=active", headers=viewer).json()
    k = d["kpis"]
    assert k["machines_monitored"] == len(machines)
    for lvl, key in (("High", "high_risk"), ("Medium", "medium_risk"), ("Low", "low_risk")):
        assert k[key] == sum(1 for m in machines if m["prediction"]["risk_level"] == lvl)
    assert k["open_alerts"] == len(alerts)
    avg = round(sum(m["prediction"]["health_score"] for m in machines) / len(machines), 1)
    assert k["avg_health_score"] == avg


def test_thresholds_change_risk_levels(client, admin):
    r = client.put("/api/settings/thresholds", headers=admin, json={"medium": 0.6, "high": 0.4})
    assert r.status_code == 422
    r = client.put("/api/settings/thresholds", headers=admin, json={"medium": 0.01, "high": 0.02})
    assert r.status_code == 200
    k = client.get("/api/dashboard/summary", headers=admin).json()["kpis"]
    assert k["high_risk"] > 4


# ---------------------------------------------------------------- CRUD + misc
def test_machine_crud(client, admin):
    body = {"code": "PMP-900", "name": "Test Pump", "type": "pump", "location": "Plant A - Line 1", "install_date": "2021-05-01"}
    r = client.post("/api/machines", headers=admin, json=body)
    assert r.status_code == 201 and r.json()["type"] == "Pump"
    assert client.post("/api/machines", headers=admin, json=body).status_code == 409
    mid = r.json()["id"]
    r = client.post("/api/readings", headers=admin, json={"machine_id": mid, **normal_reading("Pump")})
    assert r.status_code == 201
    assert client.get(f"/api/predictions/machine/{mid}", headers=admin).status_code == 200
    assert client.delete(f"/api/machines/{mid}", headers=admin).status_code == 200
    assert client.get(f"/api/machines/{mid}", headers=admin).status_code == 404
    bad = client.post("/api/machines", headers=admin, json={**body, "code": "bad code!", "install_date": "2999-01-01"})
    assert bad.status_code == 422


def test_users_and_change_password(client, admin):
    r = client.post("/api/users", headers=admin, json={"email": "new@machinemd.com", "name": "New Person", "role": "viewer", "password": "weak"})
    assert r.status_code == 422
    r = client.post("/api/users", headers=admin, json={"email": "new@machinemd.com", "name": "New Person", "role": "viewer", "password": "Strong123"})
    assert r.status_code == 201
    tok = client.post("/api/auth/login", json={"email": "new@machinemd.com", "password": "Strong123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.post("/api/auth/change-password", headers=h, json={"current_password": "wrong", "new_password": "Better123"}).status_code == 400
    assert client.post("/api/auth/change-password", headers=h, json={"current_password": "Strong123", "new_password": "Better123"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "new@machinemd.com", "password": "Better123"}).status_code == 200
    me = client.get("/api/auth/me", headers=admin).json()
    assert client.delete(f"/api/users/{me['id']}", headers=admin).status_code == 400


def test_exports_and_report(client, viewer):
    for kind in ("machines", "predictions", "readings", "maintenance", "alerts"):
        r = client.get(f"/api/reports/export/{kind}", headers=viewer)
        assert r.status_code == 200 and "attachment" in r.headers["content-disposition"], kind
    rep = client.get("/api/reports/summary", headers=viewer).json()
    assert rep["fleet"]["machines"] == 30 and rep["model"]["version"] == "v1" and rep["maintenance"]["total_cost"] > 0


def test_unknown_endpoint_and_errors(client, admin):
    r = client.get("/api/does-not-exist", headers=admin)
    assert r.status_code == 404 and r.json()["code"] == "not_found"
    assert client.get("/api/machines/99999", headers=admin).status_code == 404


def test_every_endpoint_is_fast(client, admin):
    paths = ["/api/dashboard/summary", "/api/machines", "/api/machines/1", "/api/predictions/latest", "/api/models", "/api/models/active",
             "/api/alerts", "/api/maintenance", "/api/reports/summary", "/api/reports/export/readings", "/api/whatif/defaults?machine_id=1"]
    for p in paths:
        t0 = time.perf_counter()
        assert client.get(p, headers=admin).status_code == 200
        assert time.perf_counter() - t0 < 2.0, p


def test_seed_files_untouched(client, admin):
    """Writes go to the runtime copy; the committed seed database is never modified."""
    from app import config
    before = config.BUNDLED_DB.stat().st_mtime
    client.post("/api/machines", headers=admin, json={"code": "TMP-1", "name": "Tmp", "type": "Motor", "location": "X1", "install_date": "2020-01-01"})
    assert config.BUNDLED_DB.stat().st_mtime == before
    assert str(config.RUNTIME_DB).startswith(str(config.RUNTIME_DIR))


def test_io_import():  # keep io imported for the CSV tests above
    assert io.StringIO("x").read() == "x"
