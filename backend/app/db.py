"""SQLAlchemy engine/session bound to the runtime copy of the SQLite file."""

from __future__ import annotations

import shutil
import threading
from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from . import config


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal: sessionmaker | None = None
_lock = threading.Lock()


def _make_engine():
    eng = create_engine(
        f"sqlite:///{config.RUNTIME_DB}",
        connect_args={"check_same_thread": False, "timeout": 15},
        future=True,
    )

    @event.listens_for(eng, "connect")
    def _pragmas(dbapi_conn, _):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=MEMORY")  # no -journal files next to the db
        cur.execute("PRAGMA synchronous=OFF")  # /tmp storage is ephemeral anyway
        cur.close()

    return eng


def copy_seed_if_needed() -> str:
    """Copy the bundled seeded database to the writable runtime dir on cold start.

    Returns ``"existing"``, ``"copied"`` or ``"missing"`` (no bundled seed - the
    caller self-heals by generating data).
    """
    config.RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    config.RUNTIME_MODELS.mkdir(parents=True, exist_ok=True)
    if config.RUNTIME_DB.exists() and config.RUNTIME_DB.stat().st_size > 0:
        return "existing"
    if config.BUNDLED_DB.exists():
        tmp = config.RUNTIME_DB.with_suffix(".copying")
        shutil.copyfile(config.BUNDLED_DB, tmp)
        tmp.replace(config.RUNTIME_DB)
        return "copied"
    return "missing"


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        with _lock:
            if _engine is None:
                config.RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
                _engine = _make_engine()
                _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False, future=True)
    return _engine


def reset_engine() -> None:
    """Dispose the engine (used by tests and the reset/self-heal path)."""
    global _engine, _SessionLocal
    with _lock:
        if _engine is not None:
            _engine.dispose()
        _engine = None
        _SessionLocal = None


def session_factory() -> sessionmaker:
    get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_db() -> Iterator[Session]:
    db = session_factory()()
    try:
        yield db
    finally:
        db.close()
