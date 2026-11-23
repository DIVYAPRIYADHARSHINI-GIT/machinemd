import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Icon from '../components/Icon';
import { ChartTooltip } from '../components/charts';
import { CardSkeleton, EmptyState, ErrorState, HealthBar, Kpi, PageHeader, RiskBadge, Skeleton, StatusBadge } from '../components/ui';
import { ago, pct, RISK_COLORS, rul, shortDate } from '../lib/format';
import { useChartTheme } from '../lib/theme';
import { useApi } from '../lib/useApi';

function RiskDonut({ data }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="level" innerRadius="64%" outerRadius="100%" paddingAngle={data.filter((d) => d.count).length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.level} fill={RISK_COLORS[d.level]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v} machines`} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-2xl font-semibold">{total}</span>
          <span className="muted text-xs">machines</span>
        </div>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {data.map((d) => (
          <li key={d.level}>
            <Link to={`/machines?risk=${d.level}`} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: RISK_COLORS[d.level] }} />
                {d.level} risk
              </span>
              <span className="tabular font-semibold">
                {d.count} <span className="muted font-normal">({total ? Math.round((d.count / total) * 100) : 0}%)</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HealthTrend({ data }) {
  const t = useChartTheme();
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="healthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip labelFormatter={(l) => shortDate(l)} />} />
          <Area type="monotone" dataKey="avg_health" name="Average health" stroke="#0d9488" strokeWidth={2} fill="url(#healthFill)" isAnimationActive={false} />
          <Area type="monotone" dataKey="min_health" name="Lowest machine" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" fill="none" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Dashboard() {
  const { data, error, loading, reload } = useApi('/dashboard/summary');

  if (error) return <ErrorState error={error} onRetry={reload} />;
  const k = data?.kpis;
  return (
    <div>
      <PageHeader
        title="Fleet dashboard"
        subtitle={k ? `${k.machines_monitored} machines · ${k.readings.toLocaleString('en-IN')} sensor readings · last reading ${ago(k.last_reading_at)} · model ${data.model_version}` : 'Loading fleet status…'}
        actions={
          <button className="btn-secondary" onClick={() => reload()} disabled={loading}>
            <Icon name="refresh" className="h-4 w-4" /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {loading && !data ? (
          Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} rows={1} />)
        ) : (
          <>
            <Kpi testId="kpi-machines" label="Machines monitored" value={k.machines_monitored} hint={`${k.active_machines} active`} icon="machines" tone="brand" to="/machines" />
            <Kpi testId="kpi-high" label="High risk" value={k.high_risk} hint="Failure likely within 7 days" icon="warning" tone="red" to="/machines?risk=High" />
            <Kpi testId="kpi-medium" label="Medium risk" value={k.medium_risk} hint="Plan an inspection" icon="clock" tone="amber" to="/machines?risk=Medium" />
            <Kpi testId="kpi-health" label="Avg health score" value={k.avg_health_score ?? '—'} hint="0 = failing, 100 = healthy" icon="pulse" tone="green" />
            <Kpi testId="kpi-alerts" label="Open alerts" value={k.open_alerts} hint={`${k.anomalies} sensor anomalies now`} icon="alerts" tone={k.open_alerts ? 'red' : 'slate'} to="/alerts" />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
            <h2 className="card-title">Machines ranked by risk</h2>
            <Link to="/machines" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              View all
            </Link>
          </div>
          <div className="mt-2 overflow-x-auto">
            {loading && !data ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-6" />
                ))}
              </div>
            ) : (
              <table className="table" data-testid="ranking-table">
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Risk</th>
                    <th className="hidden sm:table-cell">Failure prob.</th>
                    <th>Health</th>
                    <th className="hidden md:table-cell">Remaining life</th>
                    <th className="hidden xl:table-cell">Main driver</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ranking.slice(0, 8).map((r) => (
                    <tr key={r.machine_id}>
                      <td>
                        <Link to={`/machines/${r.machine_id}`} className="font-medium hover:text-brand-700 dark:hover:text-brand-300">
                          {r.name}
                        </Link>
                        <p className="muted text-xs">
                          {r.code} · {r.type}
                        </p>
                      </td>
                      <td>
                        <RiskBadge level={r.prediction?.risk_level} />
                      </td>
                      <td className="tabular hidden sm:table-cell">{pct(r.prediction?.failure_probability, 1)}</td>
                      <td>
                        <HealthBar value={r.prediction?.health_score} compact />
                      </td>
                      <td className="tabular hidden md:table-cell">{rul(r.prediction)}</td>
                      <td className="muted hidden text-xs xl:table-cell">{r.top_sensor || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card card-pad">
          <h2 className="card-title mb-3">Risk distribution</h2>
          {loading && !data ? <Skeleton className="h-44" /> : <RiskDonut data={data.risk_distribution} />}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card card-pad lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="card-title">Fleet health score trend</h2>
            <span className="muted text-xs">Last 30 days · daily average</span>
          </div>
          {loading && !data ? <Skeleton className="h-64" /> : data.health_trend.length ? <HealthTrend data={data.health_trend} /> : <EmptyState title="No prediction history yet" />}
        </div>
        <div className="card">
          <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
            <h2 className="card-title">Recent alerts</h2>
            <Link to="/alerts" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              All alerts
            </Link>
          </div>
          {loading && !data ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : data.recent_alerts.length ? (
            <ul className="divide-y divide-slate-100 px-2 py-2 dark:divide-slate-800">
              {data.recent_alerts.map((a) => (
                <li key={a.id}>
                  <Link to={`/machines/${a.machine_id}`} className="flex items-start gap-3 rounded-md px-2 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: RISK_COLORS[a.risk_level] }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {a.machine_name} <span className="muted font-normal">· {a.machine_code}</span>
                      </p>
                      <p className="muted text-xs">
                        {a.risk_level} risk · {pct(a.failure_probability)} · {ago(a.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="check" title="No alerts">
              All machines are within normal limits.
            </EmptyState>
          )}
        </div>
      </div>

      {data?.by_type && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {data.by_type.map((t) => (
            <div key={t.type} className="card card-pad">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{t.type}s</p>
                <span className="muted text-xs">{t.machines} units</span>
              </div>
              <HealthBar value={t.avg_health != null ? Math.round(t.avg_health) : null} />
              <p className="muted mt-2 text-xs">
                <span className="text-red-600 dark:text-red-400">{t.high} high</span> · <span className="text-amber-600 dark:text-amber-400">{t.medium} medium</span> · {t.low} low
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
