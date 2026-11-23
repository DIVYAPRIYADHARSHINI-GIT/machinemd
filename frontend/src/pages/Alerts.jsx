import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import MaintenanceForm from '../components/MaintenanceForm';
import { useToast } from '../components/feedback';
import { EmptyState, ErrorState, PageHeader, RiskBadge, Skeleton, StatusBadge, ViewerNotice } from '../components/ui';
import { api, download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, dt, pct } from '../lib/format';
import { useApi } from '../lib/useApi';

export default function Alerts() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'active';
  const risk = params.get('risk') || '';
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (risk) qs.set('risk', risk);
  const { data, error, loading, reload } = useApi(`/alerts?${qs}`);
  const counts = useApi('/alerts?limit=1000');
  const [busy, setBusy] = useState(null);
  const [maintFor, setMaintFor] = useState(null);

  const set = (k, v) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    if (!v && k === 'risk') p.delete(k);
    setParams(p, { replace: true });
  };

  async function ack(a) {
    setBusy(a.id);
    try {
      await api(`/alerts/${a.id}/acknowledge`, { method: 'POST' });
      toast.success(`Alert for ${a.machine_code} acknowledged`);
      reload(true);
      counts.reload(true);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  const c = (s) => (counts.data || []).filter((a) => (s === 'active' ? a.status !== 'Handled' : a.status === s)).length;
  const STATUS_TABS = [
    ['active', 'Active'],
    ['Open', 'Open'],
    ['Acknowledged', 'Acknowledged'],
    ['Handled', 'Handled'],
    ['', 'All'],
  ];

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Raised automatically when a machine's predicted risk reaches Medium or High"
        actions={
          <button className="btn-secondary" onClick={() => download('/reports/export/alerts', 'alerts.csv').catch((e) => toast.error(e.message))}>
            <Icon name="download" className="h-4 w-4" /> Export CSV
          </button>
        }
      />
      {!isAdmin && <ViewerNotice>You have read-only access. Admins can acknowledge alerts and log maintenance.</ViewerNotice>}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 dark:bg-slate-800/70" role="tablist">
          {STATUS_TABS.map(([v, l]) => (
            <button key={l} role="tab" aria-selected={status === v} onClick={() => set('status', v)} className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${status === v ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-600 dark:text-slate-400'}`} data-testid={`alert-tab-${l.toLowerCase()}`}>
              {l} {counts.data && <span className="muted ml-1 text-xs">{v ? c(v) : counts.data.length}</span>}
            </button>
          ))}
        </div>
        <select className="input sm:w-44" value={risk} onChange={(e) => set('risk', e.target.value)} aria-label="Filter by risk" data-testid="alert-risk">
          <option value="">All risk levels</option>
          <option>High</option>
          <option>Medium</option>
        </select>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="card">
          <EmptyState icon="check" title={status === 'active' ? 'No active alerts' : 'No alerts match this filter'}>
            {status === 'active' ? 'Every machine is currently below the Medium risk threshold, or its alert has been handled.' : 'Try another status or risk level.'}
          </EmptyState>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="alerts-list">
          {data.map((a) => (
            <li key={a.id} className={`card card-pad border-l-4 ${a.risk_level === 'High' ? 'border-l-red-500' : 'border-l-amber-500'} ${a.status === 'Handled' ? 'opacity-80' : ''}`} data-testid="alert-item">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/machines/${a.machine_id}`} className="font-semibold hover:text-brand-700 dark:hover:text-brand-300">
                      {a.machine_name}
                    </Link>
                    <span className="muted text-xs">
                      {a.machine_code} · {a.machine_type} · {a.location}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{a.message}</p>
                  <p className="muted mt-1.5 text-xs">
                    Raised {dt(a.created_at)} ({ago(a.created_at)})
                    {a.acknowledged_by && ` · acknowledged by ${a.acknowledged_by} ${ago(a.acknowledged_at)}`}
                    {a.handled_at && ` · handled ${dt(a.handled_at)}${a.maintenance_id ? ` by maintenance #${a.maintenance_id}` : ''}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <RiskBadge level={a.risk_level} />
                  <span className="tabular text-sm font-semibold">{pct(a.failure_probability)}</span>
                  <StatusBadge status={a.status} />
                  {isAdmin && a.status === 'Open' && (
                    <button className="btn-secondary btn-sm" onClick={() => ack(a)} disabled={busy === a.id} data-testid="ack-button">
                      <Icon name="check" className="h-3.5 w-3.5" /> {busy === a.id ? 'Saving…' : 'Acknowledge'}
                    </button>
                  )}
                  {isAdmin && a.status !== 'Handled' && (
                    <button className="btn-primary btn-sm" onClick={() => setMaintFor(a)} data-testid="alert-log-maintenance">
                      <Icon name="maintenance" className="h-3.5 w-3.5" /> Log maintenance
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <MaintenanceForm
        open={!!maintFor}
        onClose={() => setMaintFor(null)}
        machines={maintFor ? [{ id: maintFor.machine_id, code: maintFor.machine_code, name: maintFor.machine_name }] : []}
        machineId={maintFor?.machine_id}
        presetIssue={maintFor ? `${maintFor.risk_level} risk alert (${pct(maintFor.failure_probability)} failure probability)` : ''}
        onSaved={() => {
          reload(true);
          counts.reload(true);
        }}
      />
    </div>
  );
}
