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

from . import config
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
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition", "X-Response-Time"],
)


@app.middleware("http")
async def ready_and_timing(request: Request, call_next):
    start = time.perf_counter()
    if request.url.path.startswith("/api") and request.url.path not in ("/api/docs", "/api/openapi.json"):
        try:
            bootstrap.ensure_ready()
        except Exception as exc:  # pragma: no cover - surfaced through /api/health
            log.exception("Start-up failed")
            return JSONResponse(status_code=503, content={"detail": f"Service is starting up or misconfigured: {exc}", "code": "startup_failed"})
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
