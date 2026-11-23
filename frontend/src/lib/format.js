export const SENSORS = ['temperature', 'vibration', 'pressure', 'rpm', 'running_hours', 'current'];
export const SENSOR_META = {
  temperature: { label: 'Temperature', unit: '°C', color: '#ef4444' },
  vibration: { label: 'Vibration', unit: 'mm/s', color: '#8b5cf6' },
  pressure: { label: 'Pressure', unit: 'bar', color: '#0ea5e9' },
  rpm: { label: 'RPM', unit: 'rpm', color: '#f59e0b' },
  running_hours: { label: 'Running hours', unit: 'h', color: '#64748b' },
  current: { label: 'Current draw', unit: 'A', color: '#10b981' },
};
export const MACHINE_TYPES = ['Pump', 'Motor', 'Compressor', 'AC Unit'];
export const RISK_COLORS = { High: '#dc2626', Medium: '#d97706', Low: '#16a34a' };

export const pct = (p, d = 0) => (p == null ? '—' : `${(p * 100).toFixed(d)}%`);
export const num = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export const inr = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
export const rul = (p) => (p == null ? '—' : p.rul_capped || p.rul_days >= 13.95 ? '>14 days' : `${p.rul_days.toFixed(1)} days`);

// The API stores naive UTC timestamps; show them in the viewer's local time.
const asUtc = (s) => (s && !/[zZ]|[+-]\d\d:\d\d$/.test(s) ? `${s}Z` : s);
export const toDate = (s) => (s ? new Date(asUtc(s)) : null);
export function dt(s, opts = {}) {
  const d = toDate(s);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: opts.year === false ? undefined : 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
export function dateOnly(s) {
  if (!s) return '—';
  const d = s.length === 10 ? new Date(`${s}T00:00:00`) : toDate(s);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function shortDate(s) {
  const d = s && s.length === 10 ? new Date(`${s}T00:00:00`) : toDate(s);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';
}
export function ago(s) {
  const d = toDate(s);
  if (!d) return '—';
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  return `${Math.floor(sec / 86400)} d ago`;
}

export function healthColor(h) {
  if (h == null) return '#94a3b8';
  if (h >= 70) return '#16a34a';
  if (h >= 40) return '#d97706';
  return '#dc2626';
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
