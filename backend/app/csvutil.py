"""Small, strict CSV helpers (stdlib csv; no pandas)."""

from __future__ import annotations

import csv
import io
import re

from fastapi import HTTPException, UploadFile

from . import config


def norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (h or "").strip().lower()).strip("_")


# Common header spellings -> canonical field.
ALIASES: dict[str, list[str]] = {
    "machine_code": ["machine_code", "machine", "code", "machine_id", "asset", "asset_id", "asset_code", "equipment"],
    "machine_type": ["machine_type", "type", "equipment_type", "asset_type"],
    "timestamp": ["timestamp", "time", "datetime", "date_time", "date", "reading_time", "ts"],
    "temperature": ["temperature", "temp", "temp_c", "temperature_c"],
    "vibration": ["vibration", "vib", "vibration_mm_s", "vibration_mms"],
    "pressure": ["pressure", "pres", "pressure_bar"],
    "rpm": ["rpm", "speed", "rotational_speed"],
    "running_hours": ["running_hours", "run_hours", "hours", "operating_hours", "runtime_hours"],
    "current": ["current", "current_draw", "amps", "current_a", "ampere"],
    "failure": ["failure", "failed", "failure_event", "is_failure"],
}


def suggest_mapping(headers: list[str], fields: list[str]) -> dict[str, str | None]:
    normed = {norm_header(h): h for h in headers}
    out: dict[str, str | None] = {}
    for f in fields:
        out[f] = next((normed[a] for a in ALIASES.get(f, [f]) if a in normed), None)
    return out


async def read_csv_upload(file: UploadFile, max_rows: int) -> tuple[list[str], list[dict[str, str]]]:
    if file is None or not file.filename:
        raise HTTPException(400, "No file was uploaded.")
    if not file.filename.lower().endswith((".csv", ".txt")):
        raise HTTPException(400, "Please upload a .csv file.")
    raw = await file.read(config.UPLOAD_MAX_BYTES + 1)
    if len(raw) > config.UPLOAD_MAX_BYTES:
        raise HTTPException(413, f"File is too large (limit {config.UPLOAD_MAX_BYTES // 1024} KB). Split it into smaller files.")
    if not raw.strip():
        raise HTTPException(400, "The uploaded file is empty.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
        delim = dialect.delimiter
    except csv.Error:
        delim = ","
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    try:
        headers = [h.strip() for h in next(reader)]
    except StopIteration:
        raise HTTPException(400, "The uploaded file is empty.")
    if len([h for h in headers if h]) < 2:
        raise HTTPException(400, "Could not find a header row with column names.")
    rows: list[dict[str, str]] = []
    for i, rec in enumerate(reader):
        if not any(c.strip() for c in rec):
            continue
        if len(rows) >= max_rows:
            raise HTTPException(413, f"Too many rows: the limit is {max_rows} data rows per upload so requests stay fast.")
        rows.append({h: (rec[j].strip() if j < len(rec) else "") for j, h in enumerate(headers)} | {"__line__": str(i + 2), "__extra__": str(len(rec) > len(headers))})
    if not rows:
        raise HTTPException(400, "The file has a header row but no data rows.")
    return headers, rows


def to_csv(header: list[str], rows: list[list]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()
