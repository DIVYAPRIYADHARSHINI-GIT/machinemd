"""Keep many serverless instances consistent without an external database (BUG-07).

The problem
-----------
Vercel runs several instances of the Python function at once, and each has its
own ``/tmp`` copy of the seeded SQLite file. A change handled by instance A (a
maintenance record, an acknowledged alert, a retrained model ...) was invisible
to instance B, so the UI flickered between old and new data.

The fix: a signed, client-held change journal
---------------------------------------------
1. Every successful admin write is described as an *op*
   ``{id, t, m, p, b, u, f?}`` (id, original time, method, path, raw body,
   user, optional uploaded CSV), signed with HMAC-SHA256 using the JWT secret,
   and returned to the browser in the ``X-MachineMD-Op`` response header.
2. The browser keeps the ops in order (localStorage) and sends them with every
   API request in ``X-MachineMD-Journal`` (deflate + base64url).
3. Before handling any request an instance replays, in order, the ops it has
   not applied yet (``applied_ops`` table) through the same FastAPI routes, as
   the original user and at the original time (``app.clock``). The replayed
   rows are therefore identical to the ones on the instance that handled the
   original request (same ids, same timestamps, same deterministic retrain).

Security: ops are only replayed when their signature is valid, so a client
cannot forge an admin action. Passwords are never stored in the journal: they
are replaced by a bcrypt hash, which replayed requests may set directly
(only when the request carries the server-generated internal replay header).

Locally there is one process, so every op is already applied and replay is a
no-op.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import uuid
import zlib
from datetime import datetime, timezone

import jwt

from . import config
from .clock import op_time_var
from .db import session_factory
from .models import AppliedOp
from .security import hash_password

log = logging.getLogger("machinemd.sync")

JOURNAL_HEADER = "x-machinemd-journal"
OP_HEADER = "X-MachineMD-Op"
INTERNAL_HEADER = "x-machinemd-internal"  # "<op id>.<op time>.<hmac>" - only the server can produce it
MAX_JOURNAL_CHARS = 12000
MAX_OP_HEADER_CHARS = 7000
MAX_OPS = 200

JOURNALED_PREFIXES = (
    "/api/machines", "/api/readings", "/api/predictions/refresh", "/api/models", "/api/maintenance",
    "/api/alerts", "/api/users", "/api/settings", "/api/auth/change-password", "/api/admin/reset-demo",
)

replay_lock = asyncio.Lock()


# ------------------------------------------------------------------ helpers
def is_journaled_write(method: str, path: str) -> bool:
    return method in ("POST", "PUT", "PATCH", "DELETE") and path.startswith(JOURNALED_PREFIXES)


def _canon(op: dict) -> bytes:
    return json.dumps({k: v for k, v in op.items() if k != "sig"}, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sign(op: dict) -> str:
    return hmac.new(config.JWT_SECRET.encode(), _canon(op), hashlib.sha256).hexdigest()[:32]


def verify(op: dict) -> bool:
    sig = op.get("sig")
    return isinstance(sig, str) and hmac.compare_digest(sig, sign(op))


def internal_value(op_id: str, t: int) -> str:
    mac = hmac.new(config.JWT_SECRET.encode(), f"internal|{op_id}|{t}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"{op_id}.{t}.{mac}"


def parse_internal(value: str | None) -> tuple[str, int] | None:
    """Validate the internal replay header; returns (op_id, time) or None."""
    if not value:
        return None
    try:
        op_id, t, _ = value.split(".")
        if hmac.compare_digest(value, internal_value(op_id, int(t))):
            return op_id, int(t)
    except (ValueError, TypeError):
        pass
    return None


def ts_to_dt(t: int) -> datetime:
    return datetime.fromtimestamp(int(t), timezone.utc).replace(tzinfo=None)


def now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def new_op_id() -> str:
    return uuid.uuid4().hex[:20]


def encode_op_header(op: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(op, separators=(",", ":"), ensure_ascii=True).encode()).decode().rstrip("=")


def decode_journal(raw: str | None) -> list[dict]:
    """Header formats: ``z:<base64url(zlib(json))>`` or ``j:<base64url(json)>``."""
    if not raw or len(raw) > MAX_JOURNAL_CHARS + 2 or raw[1:2] != ":":
        return []
    try:
        data = base64.urlsafe_b64decode(raw[2:] + "=" * (-len(raw[2:]) % 4))
        if raw[0] == "z":
            data = zlib.decompress(data)
        ops = json.loads(data)
    except Exception:  # noqa: BLE001 - a malformed journal must never break the request
        log.warning("Malformed journal header ignored")
        return []
    out = []
    for op in ops[:MAX_OPS] if isinstance(ops, list) else []:
        if isinstance(op, dict) and isinstance(op.get("id"), str) and isinstance(op.get("p"), str) and verify(op) \
                and is_journaled_write(str(op.get("m")), op["p"].split("?")[0]):
            out.append(op)
        else:
            log.warning("Rejected journal entry with a missing or invalid signature")
    return out


def applied_ids(ids: list[str]) -> set[str]:
    if not ids:
        return set()
    with session_factory()() as db:
        return {r for (r,) in db.query(AppliedOp.op_id).filter(AppliedOp.op_id.in_(ids)).all()}


def mark_applied(op_id: str, ok: bool = True) -> None:
    with session_factory()() as db:
        if db.get(AppliedOp, op_id) is None:
            db.add(AppliedOp(op_id=op_id, ok=ok))
            db.commit()


# ------------------------------------------------------------------ building an op from an original request
def _scrub_passwords(path: str, body: str) -> str:
    """Replace plaintext passwords with bcrypt hashes before the op leaves the server."""
    if not (path.startswith("/api/users") or path.startswith("/api/auth/change-password")) or not body:
        return body
    try:
        data = json.loads(body)
    except ValueError:
        return body
    if isinstance(data, dict):
        for k in ("password", "new_password"):
            if isinstance(data.get(k), str) and data[k] and not data[k].startswith("__hash__:"):
                data[k] = "__hash__:" + hash_password(data[k])
        if "current_password" in data:
            data["current_password"] = "__skip__"
    return json.dumps(data, separators=(",", ":"))


def build_op(op_id: str, t: int, method: str, path: str, body: str, auth_header: str | None, upload: dict | None) -> dict | None:
    token = (auth_header or "").removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM], options={"verify_exp": False})
    except jwt.InvalidTokenError:
        return None
    op = {"id": op_id, "t": t, "m": method, "p": path, "b": _scrub_passwords(path, body),
          "u": {"id": str(payload.get("sub")), "e": payload.get("email"), "r": payload.get("role")}}
    if upload:
        op["f"] = upload
    op["sig"] = sign(op)
    return op


# ------------------------------------------------------------------ in-process replay through the ASGI app
def _multipart(fields: dict[str, str], file_field: str, filename: str, content: str) -> tuple[bytes, str]:
    boundary = "mmd" + uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\nContent-Type: text/csv\r\n\r\n'.encode()
                 + content.encode() + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


async def _asgi_call(app, method: str, path: str, headers: dict[str, str], body: bytes) -> int:
    raw_path, _, query = path.partition("?")
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "http",
        "path": raw_path, "raw_path": raw_path.encode(), "query_string": query.encode(), "root_path": "",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()] + [(b"content-length", str(len(body)).encode())],
        "client": ("127.0.0.1", 0), "server": ("replay", 80), "state": {},
    }
    sent = False
    status = {"code": 500}

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.sleep(3600)
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.start":
            status["code"] = message["status"]

    await app(scope, receive, send)
    return status["code"]


def _replay_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user.get("id")), "email": user.get("e"), "role": user.get("r"), "iat": now,
               "exp": int(now.timestamp()) + 120, "jti": "replay-" + uuid.uuid4().hex}
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


async def replay_missing(app, raw_header: str | None) -> int:
    """Apply, in order, the journal ops this instance has not applied yet. Caller holds ``replay_lock``."""
    ops = decode_journal(raw_header)
    if not ops:
        return 0
    done = applied_ids([o["id"] for o in ops])
    replayed = 0
    for op in ops:
        if op["id"] in done:
            continue
        if applied_ids([op["id"]]):  # a reset earlier in this loop rebuilt the table
            continue
        headers = {"authorization": f"Bearer {_replay_token(op.get('u') or {})}", INTERNAL_HEADER: internal_value(op["id"], int(op["t"]))}
        if op.get("f"):
            f = op["f"]
            fields = {"dry_run": "false", **({"mapping": f["mapping"]} if f.get("mapping") else {})}
            body, ctype = _multipart(fields, "file", f.get("name") or "upload.csv", f.get("csv") or "")
        else:
            body, ctype = (op.get("b") or "").encode(), "application/json"
        headers["content-type"] = ctype
        try:
            code = await _asgi_call(app, op["m"], op["p"], headers, body)
        except Exception:  # noqa: BLE001
            log.exception("Replay of %s %s failed", op.get("m"), op.get("p"))
            code = 500
        if code >= 400:
            log.warning("Replay of %s %s returned %s", op["m"], op["p"], code)
            mark_applied(op["id"], ok=False)
        replayed += 1
    if replayed:
        log.info("Replayed %d journaled change(s) on this instance", replayed)
    return replayed


__all__ = ["op_time_var", "replay_lock"]
