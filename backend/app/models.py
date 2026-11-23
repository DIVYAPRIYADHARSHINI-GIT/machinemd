"""ORM tables.

users ─┬─< activity_logs
       └─< maintenance_logs (created_by)
machines ─┬─< readings
          ├─< failure_events
          ├─< predictions ──< alerts
          ├─< alerts >── maintenance_logs (handled_by_maintenance)
          └─< maintenance_logs
model_versions (registry; one row is_active)
settings (key/value JSON: risk thresholds)
revoked_tokens (logout denylist)
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    """Naive UTC timestamp (SQLite stores naive datetimes)."""
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20), default="viewer")  # admin | viewer
    password_hash: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Machine(Base):
    __tablename__ = "machines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(30), index=True)
    location: Mapped[str] = mapped_column(String(120))
    install_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), default="Active")  # Active | Under Maintenance | Inactive
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Readings up to this time are covered by a maintenance action -> no re-alert for them.
    alert_suppressed_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    readings = relationship("Reading", back_populates="machine", cascade="all, delete-orphan", passive_deletes=True)


class Reading(Base):
    __tablename__ = "readings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"))
    timestamp: Mapped[datetime] = mapped_column(DateTime)
    temperature: Mapped[float] = mapped_column(Float)
    vibration: Mapped[float] = mapped_column(Float)
    pressure: Mapped[float] = mapped_column(Float)
    rpm: Mapped[float] = mapped_column(Float)
    running_hours: Mapped[float] = mapped_column(Float)
    current: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(20), default="seed")  # seed | manual | upload

    machine = relationship("Machine", back_populates="readings")
    __table_args__ = (Index("ix_readings_machine_ts", "machine_id", "timestamp"),)


class FailureEvent(Base):
    __tablename__ = "failure_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime)
    mode: Mapped[str] = mapped_column(String(60), default="Unspecified")
    source: Mapped[str] = mapped_column(String(20), default="seed")


class Prediction(Base):
    __tablename__ = "predictions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"))
    reading_time: Mapped[datetime] = mapped_column(DateTime)  # timestamp of the newest reading used
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    model_version: Mapped[str] = mapped_column(String(40))
    failure_probability: Mapped[float] = mapped_column(Float)
    health_score: Mapped[int] = mapped_column(Integer)
    risk_level: Mapped[str] = mapped_column(String(10))
    rul_days: Mapped[float] = mapped_column(Float)
    anomaly: Mapped[bool] = mapped_column(Boolean, default=False)
    anomaly_score: Mapped[float] = mapped_column(Float, default=0.0)
    contributions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    is_latest: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    __table_args__ = (Index("ix_predictions_machine_time", "machine_id", "reading_time"),)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"), index=True)
    prediction_id: Mapped[int | None] = mapped_column(ForeignKey("predictions.id", ondelete="SET NULL"), nullable=True)
    risk_level: Mapped[str] = mapped_column(String(10))
    failure_probability: Mapped[float] = mapped_column(Float)
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="Open", index=True)  # Open | Acknowledged | Handled
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    acknowledged_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    maintenance_id: Mapped[int | None] = mapped_column(ForeignKey("maintenance_logs.id", ondelete="SET NULL"), nullable=True)


class MaintenanceLog(Base):
    __tablename__ = "maintenance_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id", ondelete="CASCADE"), index=True)
    issue: Mapped[str] = mapped_column(String(300))
    action_taken: Mapped[str] = mapped_column(Text)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    date: Mapped[date] = mapped_column(Date)
    technician: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="Completed")  # Scheduled | In Progress | Completed
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[str] = mapped_column(String(40), unique=True)
    file_name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    mode: Mapped[str] = mapped_column(String(10))  # full | light
    primary_model: Mapped[str] = mapped_column(String(10))  # rf | gb
    train_rows: Mapped[int] = mapped_column(Integer)
    test_rows: Mapped[int] = mapped_column(Integer)
    summary: Mapped[dict] = mapped_column(JSON)  # metrics, importance, data stats (no estimators)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    is_bundled: Mapped[bool] = mapped_column(Boolean, default=True)  # shipped in the repo vs /tmp
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    user_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(60))
    entity: Mapped[str | None] = mapped_column(String(40), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    detail: Mapped[str] = mapped_column(Text, default="")


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
