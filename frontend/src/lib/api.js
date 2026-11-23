// Thin fetch wrapper: JWT header, JSON/blob handling, readable errors, slow-request signal.

const TOKEN_KEY = 'machinemd-token';
let onUnauthorized = () => {};
const slowListeners = new Set();
let pendingSlow = 0;

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

/** Subscribe to "a request has been running for > 2.5 s" (cold start on Vercel). */
export function onSlowChange(fn) {
  slowListeners.add(fn);
  return () => slowListeners.delete(fn);
}
const emitSlow = () => slowListeners.forEach((fn) => fn(pendingSlow > 0));

/* ------------------------------------------------------------------ change journal (BUG-07)
 * Vercel runs several serverless instances, each with its own /tmp database. Every admin
 * change comes back with a server-signed description in X-MachineMD-Op; we keep them in order
 * and send them with each request so whichever instance answers replays what it missed.
 * Shared through localStorage so every tab of this browser sees the same data. */
const JOURNAL_KEY = 'machinemd-journal';
const JOURNAL_MAX_CHARS = 12000; // must match the server's MAX_JOURNAL_CHARS

function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function readJournal() {
  try {
    const j = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
function writeJournal(ops) {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(ops));
  } catch {
    /* storage full - the journal is best-effort */
  }
}
export function clearJournal() {
  localStorage.removeItem(JOURNAL_KEY);
  journalHeaderCache = { src: '', value: '' };
}
function recordOp(encoded) {
  try {
    const op = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
    if (op.p === '/api/admin/reset-demo') {
      writeJournal([op]); // everything before a reset is obsolete
      return;
    }
    const ops = readJournal().filter((o) => o.id !== op.id);
    ops.push(op);
    writeJournal(ops);
  } catch {
    /* ignore malformed header */
  }
}
let journalHeaderCache = { src: '', value: '' };
async function journalHeader() {
  const src = localStorage.getItem(JOURNAL_KEY) || '';
  if (!src || src === '[]') return '';
  if (journalHeaderCache.src === src) return journalHeaderCache.value;
  let ops = readJournal();
  const encode = async (list) => {
    const json = new TextEncoder().encode(JSON.stringify(list));
    if (typeof CompressionStream !== 'undefined') {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'));
      return `z:${b64url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
    }
    return `j:${b64url(json)}`;
  };
  let value = await encode(ops);
  // Too long: drop the oldest changes (keeping a leading reset if there is one).
  while (value.length > JOURNAL_MAX_CHARS && ops.length > 1) {
    ops = ops[0].p === '/api/admin/reset-demo' && ops.length > 2 ? [ops[0], ...ops.slice(2)] : ops.slice(1);
    value = await encode(ops);
  }
  if (value.length > JOURNAL_MAX_CHARS) value = '';
  writeJournal(ops);
  journalHeaderCache = { src: localStorage.getItem(JOURNAL_KEY) || '', value };
  return value;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = 'GET', body, form, raw = false, timeout = 60000, signal } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  const journal = await journalHeader();
  if (journal) headers['X-MachineMD-Journal'] = journal;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => ctrl.abort());
  let slow = false;
  const slowTimer = setTimeout(() => {
    slow = true;
    pendingSlow += 1;
    emitSlow();
  }, 2500);
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError' && signal?.aborted) throw e;
    throw new ApiError(e.name === 'AbortError' ? 'The server took too long to respond. Please try again.' : 'Cannot reach the server. Check your connection and try again.', 0);
  } finally {
    clearTimeout(timer);
    clearTimeout(slowTimer);
    if (slow) {
      pendingSlow -= 1;
      emitSlow();
    }
  }
  const op = res.headers.get('X-MachineMD-Op');
  if (op) recordOp(op);
  if (res.status === 401 && token && !path.startsWith('/auth/login')) {
    onUnauthorized();
  }
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* not JSON */
    }
    const msg = (data && (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))) || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, data);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

/** Download an authenticated file (CSV export, template). */
export async function download(path, fallbackName) {
  const res = await api(path, { raw: true });
  const cd = res.headers.get('Content-Disposition') || '';
  const name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
