import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import MaintenanceForm from '../components/MaintenanceForm';
import { useConfirm, useToast } from '../components/feedback';
import { EmptyState, ErrorState, Kpi, PageHeader, Skeleton, StatusBadge, ViewerNotice } from '../components/ui';
import { api, download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateOnly, inr } from '../lib/format';
import { useApi } from '../lib/useApi';

export default function Maintenance() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi('/maintenance');
  const machines = useApi('/machines');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [machine, setMachine] = useState('');
  const [form, setForm] = useState({ open: false, record: null });

  const rows = useMemo(() => {
    if (!data) return [];
    const n = q.trim().toLowerCase();
    return data.filter((r) => (!status || r.status === status) && (!machine || String(r.machine_id) === machine) && (!n || `${r.machine_code} ${r.machine_name} ${r.issue} ${r.technician} ${r.action_taken}`.toLowerCase().includes(n)));
  }, [data, q, status, machine]);

  const totals = useMemo(() => {
    if (!data) return null;
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    return { count: rows.length, cost, open: rows.filter((r) => r.status !== 'Completed').length, avg: rows.length ? cost / rows.length : 0 };
  }, [data, rows]);

  async function remove(r) {
    const ok = await confirm({ title: 'Delete maintenance record?', message: `Delete "${r.issue}" for ${r.machine_code} on ${dateOnly(r.date)}? This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api(`/maintenance/${r.id}`, { method: 'DELETE' });
      toast.success('Maintenance record deleted');
      reload(true);
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Maintenance log"
        subtitle="Corrective and preventive work across the fleet"
        actions={
          <>
            <button className="btn-secondary" onClick={() => download('/reports/export/maintenance', 'maintenance.csv').catch((e) => toast.error(e.message))}>
              <Icon name="download" className="h-4 w-4" /> Export CSV
            </button>
            {isAdmin && (
              <button className="btn-primary" onClick={() => setForm({ open: true, record: null })} data-testid="add-maintenance">
                <Icon name="plus" className="h-4 w-4" /> Log maintenance
              </button>
            )}
          </>
        }
      />
      {!isAdmin && <ViewerNotice />}
      {totals && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Kpi label="Records" value={totals.count} icon="maintenance" tone="brand" />
          <Kpi label="Total cost" value={inr(totals.cost)} icon="reports" tone="slate" testId="maint-total" />
          <Kpi label="Average cost" value={inr(totals.avg)} icon="activity" tone="slate" />
          <Kpi label="Open jobs" value={totals.open} hint="Scheduled or in progress" icon="clock" tone={totals.open ? 'amber' : 'green'} />
        </div>
      )}
      <div className="card card-pad mb-4 grid gap-3 sm:grid-cols-3">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search issue, technician…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search maintenance" />
        </div>
        <select className="input" value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Filter by machine">
          <option value="">All machines</option>
          {(machines.data || []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.code} · {m.name}
            </option>
          ))}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {['Scheduled', 'In Progress', 'Completed'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="card overflow-x-auto">
          {loading && !data ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon="maintenance" title="No maintenance records" action={isAdmin && <button className="btn-primary" onClick={() => setForm({ open: true, record: null })}>Log maintenance</button>}>
              {data?.length ? 'No records match these filters.' : 'Logged work appears here.'}
            </EmptyState>
          ) : (
            <table className="table" data-testid="maintenance-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Machine</th>
                  <th>Issue</th>
                  <th className="hidden lg:table-cell">Action taken</th>
                  <th>Cost</th>
                  <th className="hidden md:table-cell">Technician</th>
                  <th>Status</th>
                  {isAdmin && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{dateOnly(r.date)}</td>
                    <td>
                      <Link to={`/machines/${r.machine_id}`} className="font-medium hover:text-brand-700 dark:hover:text-brand-300">
                        {r.machine_code}
                      </Link>
                      <p className="muted text-xs">{r.machine_name}</p>
                    </td>
                    <td className="max-w-xs">{r.issue}</td>
                    <td className="muted hidden max-w-sm text-xs lg:table-cell">{r.action_taken}</td>
                    <td className="tabular whitespace-nowrap">{inr(r.cost)}</td>
                    <td className="hidden md:table-cell">{r.technician}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    {isAdmin && (
                      <td className="text-right whitespace-nowrap">
                        <button className="btn-ghost btn-sm" aria-label="Edit record" onClick={() => setForm({ open: true, record: r })} data-testid="edit-maintenance">
                          <Icon name="edit" className="h-4 w-4" />
                        </button>
                        <button className="btn-ghost btn-sm text-red-600 dark:text-red-400" aria-label="Delete record" onClick={() => remove(r)}>
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <MaintenanceForm open={form.open} record={form.record} onClose={() => setForm({ open: false, record: null })} machines={machines.data || []} onSaved={() => reload(true)} />
    </div>
  );
}
