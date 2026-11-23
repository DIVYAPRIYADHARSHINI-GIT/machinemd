import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import Icon from '../components/Icon';
import MaintenanceForm from '../components/MaintenanceForm';
import { ChartTooltip } from '../components/charts';
import { CardSkeleton, EmptyState, ErrorState, HealthBar, PageHeader, RiskBadge, StatusBadge, Tabs } from '../components/ui';
import { download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateOnly, dt, healthColor, inr, num, pct, rul, SENSOR_META, shortDate, toDate } from '../lib/format';
import { useChartTheme } from '../lib/theme';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/feedback';

const CHART_SENSORS = ['temperature', 'vibration', 'pressure', 'rpm', 'current'];

function SensorChart({ sensor, readings, failures }) {
  const t = useChartTheme();
  const meta = SENSOR_META[sensor];
  const data = useMemo(() => readings.map((r) => ({ ts: toDate(r.t).getTime(), value: r[sensor], anomaly: r.anomaly ? r[sensor] : null })), [readings, sensor]);
  const anomalies = data.filter((d) => d.anomaly != null).length;
  return (
    <div className="card card-pad" data-testid={`chart-${sensor}`}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="card-title">
          {meta.label} <span className="muted font-normal">({meta.unit})</span>
        </h3>
        <span className="muted text-xs">{anomalies ? `${anomalies} anomal${anomalies === 1 ? 'y' : 'ies'}` : 'no anomalies'}</span>
      </div>
      <div className="h-48">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v) => shortDate(new Date(v).toISOString())} tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} minTickGap={30} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => num(v, sensor === 'rpm' ? 0 : 1)} />
            <Tooltip content={<ChartTooltip labelFormatter={(l) => dt(new Date(l).toISOString())} valueFormatter={(v) => `${num(v, 2)} ${meta.unit}`} />} />
            {failures.map((f) => (
              <ReferenceLine key={f.t} x={toDate(f.t).getTime()} stroke="#dc2626" strokeDasharray="4 3" label={{ value: 'failure', position: 'insideTopLeft', fontSize: 9, fill: '#dc2626' }} />
            ))}
            <Line type="monotone" dataKey="value" name={meta.label} stroke={meta.color} strokeWidth={1.6} dot={false} isAnimationActive={false} />
            <Scatter dataKey="anomaly" name="Anomaly" fill="#dc2626" shape={(p) => (p.cy == null ? null : <circle cx={p.cx} cy={p.cy} r={4} fill="#dc2626" stroke="#fff" strokeWidth={1.2} />)} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Contributions({ items }) {
  const t = useChartTheme();
  const data = items.map((c) => ({ label: c.label, drop: Math.max(0, c.risk_drop) * 100, raw: c }));
  const any = data.some((d) => d.drop > 0.5);
  return (
    <div>
      <div className="h-52">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={t.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: t.axis }} tickFormatter={(v) => `${v.toFixed(0)}`} unit=" pts" domain={[0, (max) => Math.max(5, Math.ceil(max))]} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: t.axis }} width={96} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)} percentage points less risk if normal`} />} />
            <Bar dataKey="drop" name="Risk drop" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.label} fill={d.drop > 10 ? '#dc2626' : d.drop > 2 ? '#d97706' : '#94a3b8'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="muted mt-2 text-xs">
        {any
          ? 'How much the failure probability would drop if each sensor were moved back to its normal value for this machine type (local what-if explanation).'
          : 'No sensor is pushing the risk up noticeably - every sensor is close to normal.'}
      </p>
    </div>
  );
}

export default function MachineDetail() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const { data: m, error, loading, reload } = useApi(`/machines/${id}?days=${days}`);
  const hist = useApi(`/predictions/machine/${id}/history?days=90`);
  const [tab, setTab] = useState('sensors');
  const [maintOpen, setMaintOpen] = useState(false);
  const t = useChartTheme();

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !m)
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <CardSkeleton rows={6} />
        <CardSkeleton rows={6} />
        <CardSkeleton rows={6} />
      </div>
    );

  const p = m.prediction;
  const action = m.recommended_action;
  const urgencyCls = { Urgent: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100', Plan: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100', Routine: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100' };
  const historyData = (hist.data || []).map((h) => ({ ts: toDate(h.reading_time).getTime(), health: h.health_score, prob: h.failure_probability * 100, rul: h.rul_days }));

  return (
    <div>
      <PageHeader
        back={{ to: '/machines', label: 'All machines' }}
        title={m.name}
        subtitle={`${m.code} · ${m.type} · ${m.location} · installed ${dateOnly(m.install_date)}`}
        actions={
          <>
            <Link to={`/what-if?machine=${m.id}`} className="btn-secondary">
              <Icon name="whatif" className="h-4 w-4" /> Simulate
            </Link>
            <button className="btn-secondary" onClick={() => download(`/reports/export/readings?machine_id=${m.id}`, 'readings.csv').catch((e) => toast.error(e.message))}>
              <Icon name="download" className="h-4 w-4" /> Readings CSV
            </button>
            {isAdmin && (
              <button className="btn-primary" onClick={() => setMaintOpen(true)} data-testid="log-maintenance">
                <Icon name="maintenance" className="h-4 w-4" /> Log maintenance
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="card card-pad">
          <p className="muted text-xs font-medium tracking-wide uppercase">Health score</p>
          <div className="mt-2 flex items-end gap-2">
            <span className="tabular text-4xl font-semibold" style={{ color: healthColor(p?.health_score) }} data-testid="detail-health">
              {p?.health_score ?? '—'}
            </span>
            <span className="muted mb-1 text-sm">/ 100</span>
          </div>
          <div className="mt-3">
            <HealthBar value={p?.health_score} />
          </div>
        </div>
        <div className="card card-pad">
          <p className="muted text-xs font-medium tracking-wide uppercase">Failure risk (7 days)</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="tabular text-4xl font-semibold">{pct(p?.failure_probability)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <RiskBadge level={p?.risk_level} />
            {p?.anomaly && <span className="badge bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">Anomalous pattern</span>}
            {m.open_alerts > 0 && <span className="badge bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">{m.open_alerts} open alert</span>}
          </div>
        </div>
        <div className="card card-pad">
          <p className="muted text-xs font-medium tracking-wide uppercase">Remaining useful life</p>
          <p className="tabular mt-2 text-4xl font-semibold" data-testid="detail-rul">
            {rul(p)}
          </p>
          <p className="muted mt-3 text-xs">Random Forest regressor · capped at 14 days</p>
        </div>
        <div className="card card-pad">
          <p className="muted text-xs font-medium tracking-wide uppercase">Status</p>
          <div className="mt-2.5">
            <StatusBadge status={m.status} />
          </div>
          <p className="muted mt-3 text-xs">
            {m.reading_count.toLocaleString('en-IN')} readings · last {dt(m.last_reading_at)}
            <br />
            Model {p?.model_version || '—'} · scored {dt(p?.created_at)}
          </p>
        </div>
      </div>

      {action && (
        <div className={`mt-4 flex items-start gap-3 rounded-xl border px-4 py-3 ${urgencyCls[action.urgency]}`} data-testid="recommended-action">
          <Icon name={action.urgency === 'Routine' ? 'check' : 'warning'} className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">
              Recommended action · {action.urgency}: {action.title}
            </p>
            <p className="mt-0.5 text-sm opacity-90">{action.detail}</p>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card card-pad lg:col-span-1">
          <h2 className="card-title mb-2">Top contributing sensors</h2>
          {m.contributions.length ? <Contributions items={m.contributions} /> : <EmptyState title="No explanation yet">This machine has no readings to explain.</EmptyState>}
        </div>
        <div className="card card-pad lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="card-title">Prediction history</h2>
            <span className="muted text-xs">Health score and failure probability, one point per day</span>
          </div>
          {historyData.length ? (
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={historyData} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v) => shortDate(new Date(v).toISOString())} tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} minTickGap={30} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => dateOnly(new Date(l).toISOString())} valueFormatter={(v, item) => (item.dataKey === 'prob' ? `${v.toFixed(1)}%` : v)} />} />
                  {m.failures.map((f) => (
                    <ReferenceLine key={f.t} x={toDate(f.t).getTime()} stroke="#dc2626" strokeDasharray="4 3" />
                  ))}
                  <Line type="monotone" dataKey="health" name="Health score" stroke="#0d9488" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="prob" name="Failure probability" stroke="#dc2626" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No predictions yet" />
          )}
        </div>
      </div>

      <div className="mt-6 mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'sensors', label: 'Sensor trends' },
            { value: 'maintenance', label: `Maintenance (${m.maintenance.length})` },
            { value: 'failures', label: `Failure history (${m.failures.length})` },
          ]}
        />
        {tab === 'sensors' && (
          <select className="input sm:w-40" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time range">
            {[7, 14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        )}
      </div>

      {tab === 'sensors' &&
        (m.readings.length ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {CHART_SENSORS.map((s) => (
                <SensorChart key={s} sensor={s} readings={m.readings} failures={m.failures} />
              ))}
              <div className="card card-pad flex flex-col justify-center text-sm">
                <p className="card-title mb-2">Reading the charts</p>
                <ul className="muted space-y-1.5 text-xs">
                  <li className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-white dark:ring-slate-900" /> Red dots: readings flagged by the Isolation Forest anomaly detector (unusual combination of level, spread and trend).
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block h-0 w-4 border-t-2 border-dashed border-red-600" /> Dashed red line: a recorded failure.
                  </li>
                  <li>Running hours (hours since last service): {num(m.readings.at(-1)?.running_hours, 0)} h.</li>
                </ul>
              </div>
            </div>
          </>
        ) : (
          <div className="card">
            <EmptyState icon="data" title="No sensor readings for this machine" action={isAdmin && <Link className="btn-primary" to="/data">Upload readings</Link>}>
              Predictions appear after readings are added.
            </EmptyState>
          </div>
        ))}

      {tab === 'maintenance' && (
        <div className="card overflow-x-auto">
          {m.maintenance.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Issue</th>
                  <th className="hidden md:table-cell">Action taken</th>
                  <th>Cost</th>
                  <th className="hidden sm:table-cell">Technician</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {m.maintenance.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap">{dateOnly(x.date)}</td>
                    <td>{x.issue}</td>
                    <td className="muted hidden text-xs md:table-cell">{x.action_taken}</td>
                    <td className="tabular whitespace-nowrap">{inr(x.cost)}</td>
                    <td className="hidden sm:table-cell">{x.technician}</td>
                    <td>
                      <StatusBadge status={x.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon="maintenance" title="No maintenance recorded" />
          )}
        </div>
      )}

      {tab === 'failures' && (
        <div className="card overflow-x-auto">
          {m.failures.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Failure mode</th>
                </tr>
              </thead>
              <tbody>
                {m.failures.map((f) => (
                  <tr key={f.t}>
                    <td>{dt(f.t)}</td>
                    <td>{f.mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon="check" title="No failures recorded for this machine" />
          )}
        </div>
      )}

      <MaintenanceForm
        open={maintOpen}
        onClose={() => setMaintOpen(false)}
        machines={[m]}
        machineId={m.id}
        presetIssue={p && p.risk_level !== 'Low' ? `${p.risk_level} risk alert: ${m.contributions.filter((c) => c.risk_drop > 0.02).slice(0, 2).map((c) => c.label.toLowerCase()).join(' and ') || 'sensor drift'}` : ''}
        onSaved={() => reload(true)}
      />
    </div>
  );
}
