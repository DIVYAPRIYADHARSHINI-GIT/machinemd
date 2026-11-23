import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { useConfirm, useToast } from '../components/feedback';
import { CardSkeleton, Field, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, dt } from '../lib/format';
import { useApi } from '../lib/useApi';

function Thresholds() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { data, reload } = useApi('/settings');
  const [medium, setMedium] = useState(30);
  const [high, setHigh] = useState(60);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) {
      setMedium(Math.round(data.risk_thresholds.medium * 100));
      setHigh(Math.round(data.risk_thresholds.high * 100));
    }
  }, [data]);
  const invalid = medium >= high || medium < 1 || high > 99;

  async function save() {
    setBusy(true);
    try {
      await api('/settings/thresholds', { method: 'PUT', body: { medium: medium / 100, high: high / 100 } });
      toast.success('Risk thresholds saved; risk levels and alerts updated.');
      reload(true);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <CardSkeleton rows={4} />;
  return (
    <div className="card card-pad">
      <h2 className="card-title">Risk thresholds</h2>
      <p className="muted mb-4 text-xs">The failure probability (within 7 days) at which a machine becomes Medium or High risk. Medium and High risk raise alerts. Health score = 100 × (1 − probability).</p>
      <div className="mb-4 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="flex h-full">
          <div className="bg-emerald-500" style={{ width: `${medium}%` }} />
          <div className="bg-amber-500" style={{ width: `${Math.max(0, high - medium)}%` }} />
          <div className="flex-1 bg-red-500" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Medium risk from ${medium}%`} htmlFor="th-medium" error={medium >= high ? 'Must be lower than the High threshold' : null}>
          <input id="th-medium" type="range" min="1" max="98" value={medium} onChange={(e) => setMedium(Number(e.target.value))} className="w-full" disabled={!isAdmin} data-testid="th-medium" />
        </Field>
        <Field label={`High risk from ${high}%`} htmlFor="th-high">
          <input id="th-high" type="range" min="2" max="99" value={high} onChange={(e) => setHigh(Number(e.target.value))} className="w-full" disabled={!isAdmin} data-testid="th-high" />
        </Field>
      </div>
      {isAdmin ? (
        <button className="btn-primary mt-4" onClick={save} disabled={busy || invalid} data-testid="th-save">
          {busy ? 'Saving…' : 'Save thresholds'}
        </button>
      ) : (
        <p className="muted mt-4 flex items-center gap-1.5 text-xs">
          <Icon name="lock" className="h-3.5 w-3.5" /> Only admins can change thresholds.
        </p>
      )}
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    const er = {};
    if (!f.current) er.current = 'Enter your current password';
    if (f.next.length < 8 || !/[A-Za-z]/.test(f.next) || !/\d/.test(f.next)) er.next = 'At least 8 characters with a letter and a number';
    if (f.next !== f.confirm) er.confirm = 'Passwords do not match';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { current_password: f.current, new_password: f.next } });
      toast.success('Password changed');
      setF({ current: '', next: '', confirm: '' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="card card-pad" onSubmit={save} noValidate>
      <h2 className="card-title mb-4">Change password</h2>
      <div className="space-y-3">
        <Field label="Current password" error={errors.current} htmlFor="pw-cur">
          <input id="pw-cur" type="password" autoComplete="current-password" className="input" value={f.current} onChange={set('current')} />
        </Field>
        <Field label="New password" error={errors.next} htmlFor="pw-new" hint="At least 8 characters with a letter and a number">
          <input id="pw-new" type="password" autoComplete="new-password" className="input" value={f.next} onChange={set('next')} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm} htmlFor="pw-conf">
          <input id="pw-conf" type="password" autoComplete="new-password" className="input" value={f.confirm} onChange={set('confirm')} />
        </Field>
      </div>
      <button className="btn-primary mt-4" disabled={busy} type="submit">
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

function SystemInfo() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const health = useApi('/health');
  async function resetDemo() {
    const ok = await confirm({ title: 'Reset demo data?', message: 'All changes (uploads, edits, maintenance, retrained models, users) are discarded and the original seeded data and models are restored. You will stay signed in.', confirmLabel: 'Reset demo', danger: true });
    if (!ok) return;
    try {
      await api('/admin/reset-demo', { method: 'POST' });
      toast.success('Demo data reset to the original seed.');
      setTimeout(() => window.location.assign('/'), 800);
    } catch (e) {
      toast.error(e.message);
    }
  }
  const h = health.data;
  return (
    <div className="card card-pad">
      <h2 className="card-title mb-3">System</h2>
      {h ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="muted">API status</dt>
          <dd className={h.status === 'ok' ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-amber-600'}>{h.status}</dd>
          <dt className="muted">Active model</dt>
          <dd>{h.model.active_version}</dd>
          <dt className="muted">Environment</dt>
          <dd>{h.environment}</dd>
          <dt className="muted">Machines / readings</dt>
          <dd className="tabular">
            {h.database.machines} / {h.database.readings.toLocaleString('en-IN')}
          </dd>
          <dt className="muted">App version</dt>
          <dd>{h.version}</dd>
        </dl>
      ) : (
        <p className="muted text-sm">Loading…</p>
      )}
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">{h?.storage?.note || 'Demo storage is temporary.'}</div>
      {isAdmin && (
        <button className="btn-secondary mt-4 text-red-600 dark:text-red-400" onClick={resetDemo} data-testid="reset-demo">
          <Icon name="refresh" className="h-4 w-4" /> Reset demo data
        </button>
      )}
    </div>
  );
}

function Activity() {
  const { data } = useApi('/activity?limit=25');
  return (
    <div className="card">
      <div className="px-4 pt-4 sm:px-5">
        <h2 className="card-title">Activity log</h2>
        <p className="muted text-xs">Latest 25 actions</p>
      </div>
      <ul className="divide-y divide-slate-100 px-4 py-2 text-sm sm:px-5 dark:divide-slate-800" data-testid="activity-log">
        {(data || []).map((a) => (
          <li key={a.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <span>
              <span className="font-medium">{a.user || 'system'}</span> <span className="muted">· {a.detail || a.action}</span>
            </span>
            <span className="muted shrink-0 text-xs" title={dt(a.created_at)}>
              {ago(a.created_at)}
            </span>
          </li>
        ))}
        {data && !data.length && <li className="muted py-4">No activity yet.</li>}
      </ul>
    </div>
  );
}

export default function Settings() {
  return (
    <div>
      <PageHeader title="Settings" subtitle="Risk thresholds, your password and system information" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Thresholds />
        <ChangePassword />
        <SystemInfo />
        <Activity />
      </div>
    </div>
  );
}
