"""MachineMD FastAPI application.

All routes live under ``/api``. The same app runs locally (``uvicorn``) and on
Vercel (``api/index.py`` imports ``app``). Start-up is lazy and idempotent: the
first request copies the seeded SQLite file to the writable runtime directory
(or regenerates it if missing) and makes sure a model can be loaded.
"""

from __future__ import annotations

import logging
import time
import traceback

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config, sync
from .clock import op_time_var
from .routers import alerts, auth, dashboard, machines, maintenance, models_api, predictions, readings, reports, system, users, whatif
from .services import bootstrap
from .services.registry import ModelUnavailable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("machinemd")

app = FastAPI(
    title="MachineMD API",
    version=config.APP_VERSION,
    description="Predictive maintenance API: failure risk, health score, remaining useful life, anomalies and explanations.",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-MachineMD-Journal"],
    expose_headers=["Content-Disposition", "X-Response-Time", "X-MachineMD-Op"],
)


async def _upload_payload(request: Request, raw: bytes) -> dict | None:
    """For an imported CSV upload, keep the CSV text + mapping so other instances can replay it."""
    form = await request.form()
    if str(form.get("dry_run", "true")).lower() in ("true", "1", "yes"):
        return None
    f = form.get("file")
    if f is None or not hasattr(f, "read"):
        return None
    await f.seek(0)
    content = (await f.read()).decode("utf-8-sig", errors="replace")
    await f.seek(0)
    return {"name": getattr(f, "filename", "upload.csv"), "csv": content, "mapping": form.get("mapping") or ""}


@app.middleware("http")
async def ready_and_timing(request: Request, call_next):
    start = time.perf_counter()
    path = request.url.path
    if path.startswith("/api") and path not in ("/api/docs", "/api/openapi.json"):
        try:
            bootstrap.ensure_ready()
        except Exception as exc:  # pragma: no cover - surfaced through /api/health
            log.exception("Start-up failed")
            return JSONResponse(status_code=503, content={"detail": f"Service is starting up or misconfigured: {exc}", "code": "startup_failed"})

    internal = sync.parse_internal(request.headers.get(sync.INTERNAL_HEADER))
    if internal is not None:
        # An in-process replay of a journaled change: run it at the original time and record it.
        op_id, t = internal
        token = op_time_var.set(sync.ts_to_dt(t))
        try:
            response = await call_next(request)
        finally:
            op_time_var.reset(token)
        if response.status_code < 400:
            sync.mark_applied(op_id)
        return response

    # Multi-instance consistency (BUG-07): replay changes this instance has not seen yet.
    journal = request.headers.get(sync.JOURNAL_HEADER)
    is_write = sync.is_journaled_write(request.method, path)
    if journal or is_write:
        async with sync.replay_lock:
            if journal:
                await sync.replay_missing(app, journal)
            if not is_write:
                response = await call_next(request)
            else:
                body = await request.body()
                upload = await _upload_payload(request, body) if path.startswith("/api/readings/upload") else None
                if path.startswith("/api/readings/upload") and upload is None:
                    response = await call_next(request)  # dry-run preview: nothing to journal
                else:
                    op_id, t = sync.new_op_id(), sync.now_ts()
                    token = op_time_var.set(sync.ts_to_dt(t))
                    try:
                        response = await call_next(request)
                    finally:
                        op_time_var.reset(token)
                    if response.status_code < 400:
                        sync.mark_applied(op_id)
                        op = sync.build_op(op_id, t, request.method, path + (f"?{request.url.query}" if request.url.query else ""),
                                           "" if upload else body.decode("utf-8", errors="replace"), request.headers.get("authorization"), upload)
                        if op is not None:
                            encoded = sync.encode_op_header(op)
                            if len(encoded) <= sync.MAX_OP_HEADER_CHARS:
                                response.headers[sync.OP_HEADER] = encoded
                            else:
                                log.warning("Change %s too large to journal (%d chars); other instances will not see it", op_id, len(encoded))
    else:
        response = await call_next(request)
    response.headers["X-Response-Time"] = f"{(time.perf_counter() - start) * 1000:.0f}ms"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path.startswith("/api"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


# ------------------------------------------------------------------ centralized errors
def _error(status_code: int, detail, code: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": detail, "code": code, **extra})


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    codes = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
             409: "conflict", 413: "payload_too_large", 422: "validation_error", 429: "rate_limited"}
    resp = _error(exc.status_code, exc.detail, codes.get(exc.status_code, "error"))
    if getattr(exc, "headers", None):
        resp.headers.update(exc.headers)
    return resp


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    errors = []
    for e in exc.errors():
        loc = [str(p) for p in e.get("loc", []) if p not in ("body", "query", "path")]
        msg = e.get("msg", "Invalid value").removeprefix("Value error, ")
        if e.get("type") == "json_invalid":
            loc, msg = [], "Request body is not valid JSON"
        errors.append({"field": ".".join(loc) or "request", "message": msg})
    summary = "; ".join(f"{x['field']}: {x['message']}" for x in errors[:3])
    return _error(422, f"Invalid input - {summary}", "validation_error", errors=errors)


@app.exception_handler(ModelUnavailable)
async def model_unavailable(request: Request, exc: ModelUnavailable):
    return _error(503, str(exc), "model_unavailable")


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.error("Unhandled error on %s %s\n%s", request.method, request.url.path, traceback.format_exc())
    return _error(500, "Something went wrong on the server. The error was logged.", "internal_error")


for r in (auth, users, machines, readings, predictions, models_api, whatif, maintenance, alerts, dashboard, reports, system):
    app.include_router(r.router, prefix="/api")


@app.get("/api", include_in_schema=False)
def api_root():
    return {"name": "MachineMD API", "version": config.APP_VERSION, "docs": "/api/docs", "health": "/api/health"}


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
def api_not_found(path: str):
    raise HTTPException(404, f"API endpoint /api/{path} does not exist.")
