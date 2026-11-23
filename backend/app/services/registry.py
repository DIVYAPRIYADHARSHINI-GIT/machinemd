"""Model registry: joblib bundles on disk + metadata rows in ``model_versions``.

Bundled versions (trained by ``scripts/seed_and_train.py``) live in
``backend/data/models`` and ship with the repo. Light-retrained versions are
written to the runtime dir (``/tmp/machinemd/models``) and disappear on restart.
Loaded bundles are cached in memory per process.
"""

from __future__ import annotations

import threading
from pathlib import Path

import joblib
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import config
from ..models import ModelVersion

_cache: dict[str, dict] = {}
_lock = threading.Lock()


class ModelUnavailable(RuntimeError):
    pass


def model_path(row: ModelVersion) -> Path | None:
    for base in (config.RUNTIME_MODELS, config.BUNDLED_MODELS):
        p = base / row.file_name
        if p.exists():
            return p
    return None


def load_bundle(row: ModelVersion) -> dict:
    with _lock:
        if row.version in _cache:
            return _cache[row.version]
        path = model_path(row)
        if path is None:
            raise ModelUnavailable(f"Model file {row.file_name} for {row.version} is missing.")
        bundle = joblib.load(path)
        _cache[row.version] = bundle
        return bundle


def save_bundle(bundle: dict, directory: Path) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    file_name = f"machinemd-{bundle['version']}.joblib"
    tmp = directory / (file_name + ".tmp")
    joblib.dump(bundle, tmp, compress=3)
    tmp.replace(directory / file_name)
    with _lock:
        _cache[bundle["version"]] = bundle
    return file_name


def active_row(db: Session) -> ModelVersion | None:
    return db.scalar(select(ModelVersion).where(ModelVersion.is_active.is_(True)))


def active_bundle(db: Session) -> tuple[ModelVersion, dict]:
    row = active_row(db)
    if row is None:
        raise ModelUnavailable("No active model version.")
    return row, load_bundle(row)


def next_version(db: Session) -> str:
    n = 0
    for (v,) in db.execute(select(ModelVersion.version)):
        digits = "".join(ch for ch in v.split("-")[0] if ch.isdigit())
        if digits:
            n = max(n, int(digits))
    return f"v{n + 1}"


def clear_cache() -> None:
    with _lock:
        _cache.clear()
