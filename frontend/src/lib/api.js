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
