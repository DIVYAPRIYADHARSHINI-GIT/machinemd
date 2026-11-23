import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Icon from '../components/Icon';
import { ChartTooltip } from '../components/charts';
import { useToast } from '../components/feedback';
import { CardSkeleton, ErrorState, PageHeader, RiskBadge } from '../components/ui';
import { download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { buildFleetReport } from '../lib/pdfReport';
import { inr, pct } from '../lib/format';
import { useChartTheme } from '../lib/theme';
import { useApi } from '../lib/useApi';

const EXPORTS = [
  ['machines', 'Machines + latest prediction', 'One row per machine with risk, health score and RUL'],
  ['predictions', 'Prediction history', 'Daily predictions for every machine (up to 5,000 rows)'],
  ['readings', 'Sensor readings', 'Most recent 5,000 sensor readings'],
  ['alerts', 'Alerts', 'All alerts with status and acknowledgement'],
  ['maintenance', 'Maintenance log', 'All maintenance records with cost'],
];

export default function Reports() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/reports/summary');
  const [busy, setBusy] = useState('');
  const t = useChartTheme();

  async function pdf() {
    setBusy('pdf');
    try {
      await buildFleetReport(data, { author: `${user.name} (${user.email})` });
      toast.success('PDF report downloaded');
    } catch (e) {
      toast.error(`Could not create the PDF: ${e.message}`);
    } finally {
      setBusy('');
    }
  }

  async function csv(kind) {
    setBusy(kind);
    try {
      const name = await download(`/reports/export/${kind}`, `${kind}.csv`);
      toast.success(`Downloaded ${name}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  }

  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Download a PDF fleet report or raw data as CSV"
        actions={
          <button className="btn-primary" onClick={pdf} disabled={!data || busy === 'pdf'} data-testid="pdf-button">
            <Icon name="file" className="h-4 w-4" /> {busy === 'pdf' ? 'Building PDF…' : 'Download PDF report'}
          </button>
        }
      />
      {loading && !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton rows={6} />
          <CardSkeleton rows={6} />
        </div>
      ) : (
        <>
          <div className="card card-pad mb-4">
            <h2 className="card-title">PDF report preview</h2>
            <p className="muted mb-4 text-xs">The PDF contains these four sections, generated in your browser from live data.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <h3 className="text-sm font-semibold">1 · Fleet health summary</h3>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  {[
                    ['Machines', data.fleet.machines],
                    ['Avg health', data.fleet.avg_health_score],
                    ['Open alerts', data.fleet.open_alerts],
                    ['High risk', data.fleet.distribution.High],
                    ['Medium risk', data.fleet.distribution.Medium],
                    ['Low risk', data.fleet.distribution.Low],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="muted text-xs">{k}</dt>
                      <dd className="tabular text-lg font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <h3 className="text-sm font-semibold">3 · Model performance ({data.model?.version}, {data.model?.primary_label})</h3>
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="muted text-left">
                      <th className="py-1 font-medium">Model</th>
                      <th className="font-medium">Precision</th>
                      <th className="font-medium">Recall</th>
                      <th className="font-medium">F1</th>
                      <th className="font-medium">ROC-AUC</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {['rf', 'gb'].map((k) => (
                      <tr key={k}>
                        <td className="py-1">{k === 'rf' ? 'Random Forest' : 'Gradient Boosting'}</td>
                        <td>{data.model.metrics[k].precision.toFixed(3)}</td>
                        <td>{data.model.metrics[k].recall.toFixed(3)}</td>
                        <td>{data.model.metrics[k].f1.toFixed(3)}</td>
                        <td>{data.model.metrics[k].roc_auc.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted mt-2 text-xs">RUL MAE {data.model.rul.mae_days} days · test period of {data.model.data.test_rows.toLocaleString('en-IN')} readings</p>
              </section>
              <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <h3 className="text-sm font-semibold">2 · High- and medium-risk machines ({data.high_risk.length})</h3>
                <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {data.high_risk.slice(0, 6).map((m) => (
                    <li key={m.code} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="truncate">
                        {m.code} <span className="muted">· {m.name}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular text-xs">{pct(m.failure_probability)}</span>
                        <RiskBadge level={m.risk_level} />
                      </span>
                    </li>
                  ))}
                  {!data.high_risk.length && <li className="muted py-2">No machines at medium or high risk.</li>}
                </ul>
              </section>
              <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <h3 className="text-sm font-semibold">
                  4 · Maintenance cost · {inr(data.maintenance.total_cost)} over {data.maintenance.records} records
                </h3>
                <div className="mt-2 h-40">
                  <ResponsiveContainer>
                    <BarChart data={data.maintenance.by_month} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                      <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: t.axis }} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={36} />
                      <Tooltip content={<ChartTooltip valueFormatter={(v) => inr(v)} />} />
                      <Bar dataKey="cost" name="Cost" fill="#0d9488" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>
          </div>

          <div className="card">
            <div className="px-4 pt-4 sm:px-5">
              <h2 className="card-title">CSV exports</h2>
              <p className="muted text-xs">UTF-8 CSV files that open in Excel or Google Sheets.</p>
            </div>
            <ul className="divide-y divide-slate-100 px-2 py-2 dark:divide-slate-800">
              {EXPORTS.map(([kind, label, desc]) => (
                <li key={kind} className="flex items-center justify-between gap-3 px-2 py-3">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="muted text-xs">{desc}</p>
                  </div>
                  <button className="btn-secondary btn-sm" onClick={() => csv(kind)} disabled={busy === kind} data-testid={`csv-${kind}`}>
                    <Icon name="download" className="h-3.5 w-3.5" /> {busy === kind ? 'Downloading…' : 'CSV'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
