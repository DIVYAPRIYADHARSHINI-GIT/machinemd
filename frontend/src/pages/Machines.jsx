import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import MachineForm from '../components/MachineForm';
import { useConfirm, useToast } from '../components/feedback';
import { EmptyState, ErrorState, HealthBar, PageHeader, RiskBadge, Skeleton, StatusBadge } from '../components/ui';
import { api, download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, MACHINE_TYPES, pct, rul } from '../lib/format';
import { useApi } from '../lib/useApi';

const COLUMNS = [
  { key: 'name', label: 'Machine', get: (m) => m.name.toLowerCase() },
  { key: 'type', label: 'Type', get: (m) => m.type, cls: 'hidden md:table-cell' },
  { key: 'location', label: 'Location', get: (m) => m.location, cls: 'hidden lg:table-cell' },
  { key: 'risk', label: 'Risk', get: (m) => (m.prediction ? m.prediction.failure_probability : -1) },
  { key: 'health', label: 'Health score', get: (m) => m.prediction?.health_score ?? 999 },
  { key: 'rul', label: 'Remaining life', get: (m) => m.prediction?.rul_days ?? 999, cls: 'hidden sm:table-cell' },
  { key: 'status', label: 'Status', get: (m) => m.status, cls: 'hidden xl:table-cell' },
];

export default function Machines() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useApi('/machines');
  const meta = useApi('/machines/meta');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const q = params.get('q') || '';
  // The search box keeps its own state and syncs to the URL after a short pause. Writing every
  // keystroke straight to the URL made the controlled input lag and drop characters (BUG-02).
  const [search, setSearch] = useState(q);
  useEffect(() => {
    const h = setTimeout(() => {
      if (search !== (new URLSearchParams(window.location.search).get('q') || '')) {
        setParams((prev) => {
          const p = new URLSearchParams(prev);
          if (search) p.set('q', search);
          else p.delete('q');
          return p;
        }, { replace: true });
      }
    }, 250);
    return () => clearTimeout(h);
  }, [search, setParams]);
  const type = params.get('type') || '';
  const risk = params.get('risk') || '';
  const location = params.get('location') || '';
  const sort = params.get('sort') || 'risk';
  const dir = params.get('dir') || 'desc';

  const setParam = (k, v) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (v) p.set(k, v);
      else p.delete(k);
      return p;
    }, { replace: true });

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    let r = data.filter(
      (m) =>
        (!needle || `${m.code} ${m.name} ${m.location} ${m.type}`.toLowerCase().includes(needle)) &&
        (!type || m.type === type) &&
        (!risk || m.prediction?.risk_level === risk) &&
        (!location || m.location === location),
    );
    const col = COLUMNS.find((c) => c.key === sort) || COLUMNS[3];
    r = [...r].sort((a, b) => {
      const x = col.get(a);
      const y = col.get(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return dir === 'asc' ? c : -c;
    });
    return r;
  }, [data, search, type, risk, location, sort, dir]);

  const toggleSort = (key) => {
    const p = new URLSearchParams(params);
    if (sort === key) p.set('dir', dir === 'asc' ? 'desc' : 'asc');
    else {
      p.set('sort', key);
      p.set('dir', key === 'name' || key === 'type' || key === 'location' || key === 'health' || key === 'rul' ? 'asc' : 'desc');
    }
    setParams(p, { replace: true });
  };

  async function remove(m) {
    const ok = await confirm({
      title: `Delete ${m.code}?`,
      message: `This permanently deletes ${m.name} with all of its sensor readings, predictions, alerts and maintenance records.`,
      confirmLabel: 'Delete machine',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/machines/${m.id}`, { method: 'DELETE' });
      toast.success(`Deleted ${m.code}`);
      reload(true);
    } catch (e) {
      toast.error(e.message);
    }
  }

  const filtersActive = search || type || risk || location;
  const clearAll = () => {
    setSearch('');
    setParams({}, { replace: true });
  };
  const locations = meta.data?.locations || [];

  return (
    <div>
      <PageHeader
        title="Machines"
        subtitle={data ? `${rows.length} of ${data.length} machines` : 'Loading…'}
        actions={
          <>
            <button className="btn-secondary" onClick={() => download('/reports/export/machines', 'machines.csv').catch((e) => toast.error(e.message))}>
              <Icon name="download" className="h-4 w-4" /> Export CSV
            </button>
            {isAdmin && (
              <button
                className="btn-primary"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                data-testid="add-machine"
              >
                <Icon name="plus" className="h-4 w-4" /> Add machine
              </button>
            )}
          </>
        }
      />

      <div className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search code, name, location…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search machines" data-testid="machine-search" />
        </div>
        <select className="input lg:w-40" value={type} onChange={(e) => setParam('type', e.target.value)} aria-label="Filter by type" data-testid="filter-type">
          <option value="">All types</option>
          {MACHINE_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select className="input lg:w-36" value={risk} onChange={(e) => setParam('risk', e.target.value)} aria-label="Filter by risk" data-testid="filter-risk">
          <option value="">All risk levels</option>
          {['High', 'Medium', 'Low'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select className="input lg:w-48" value={location} onChange={(e) => setParam('location', e.target.value)} aria-label="Filter by location" data-testid="filter-location">
          <option value="">All locations</option>
          {locations.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button className="btn-ghost" disabled={!filtersActive} onClick={clearAll}>
          Clear
        </button>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="card overflow-x-auto">
          {loading && !data ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon="search" title="No machines match these filters" action={filtersActive && <button className="btn-secondary" onClick={clearAll}>Clear filters</button>}>
              Try a different search term or remove a filter.
            </EmptyState>
          ) : (
            <table className="table" data-testid="machines-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={c.cls} aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button className="inline-flex items-center gap-1 uppercase hover:text-slate-900 dark:hover:text-white" onClick={() => toggleSort(c.key)} data-testid={`sort-${c.key}`}>
                        {c.label}
                        <span className={sort === c.key ? 'text-brand-600' : 'opacity-30'}>{sort === c.key ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                  ))}
                  {isAdmin && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="cursor-pointer" onClick={() => nav(`/machines/${m.id}`)}>
                    <td>
                      <Link to={`/machines/${m.id}`} className="font-medium hover:text-brand-700 dark:hover:text-brand-300" onClick={(e) => e.stopPropagation()}>
                        {m.name}
                      </Link>
                      <p className="muted text-xs">
                        {m.code}
                        <span className="md:hidden"> · {m.type}</span>
                        {m.open_alerts > 0 && <span className="ml-1.5 text-red-600 dark:text-red-400">· {m.open_alerts} alert</span>}
                      </p>
                    </td>
                    <td className="hidden md:table-cell">{m.type}</td>
                    <td className="muted hidden text-xs lg:table-cell">{m.location}</td>
                    <td>
                      <div className="flex flex-col items-start gap-0.5">
                        <RiskBadge level={m.prediction?.risk_level} />
                        <span className="muted tabular text-[11px]">{pct(m.prediction?.failure_probability, 1)}</span>
                      </div>
                    </td>
                    <td>
                      <HealthBar value={m.prediction?.health_score} compact />
                    </td>
                    <td className="tabular hidden sm:table-cell">{rul(m.prediction)}</td>
                    <td className="hidden xl:table-cell">
                      <StatusBadge status={m.status} />
                      <p className="muted mt-0.5 text-[11px]">read {ago(m.last_reading_at)}</p>
                    </td>
                    {isAdmin && (
                      <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn-ghost btn-sm"
                          aria-label={`Edit ${m.code}`}
                          onClick={() => {
                            setEditing(m);
                            setFormOpen(true);
                          }}
                        >
                          <Icon name="edit" className="h-4 w-4" />
                        </button>
                        <button className="btn-ghost btn-sm text-red-600 dark:text-red-400" aria-label={`Delete ${m.code}`} onClick={() => remove(m)}>
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
      <MachineForm open={formOpen} onClose={() => setFormOpen(false)} machine={editing} locations={locations} onSaved={() => { reload(true); meta.reload(true); }} />
    </div>
  );
}
