import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Icon from '../components/Icon';
import { ChartTooltip } from '../components/charts';
import { Modal, useConfirm, useToast } from '../components/feedback';
import { CardSkeleton, ErrorState, PageHeader, StatusBadge, Tabs } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dt, num } from '../lib/format';
import { useChartTheme } from '../lib/theme';
import { useApi } from '../lib/useApi';

const MODEL_COLORS = { rf: '#0d9488', gb: '#6366f1' };
const MODEL_NAMES = { rf: 'Random Forest', gb: 'Gradient Boosting' };
const METRICS = [
  ['accuracy', 'Accuracy'],
  ['precision', 'Precision'],
  ['recall', 'Recall'],
  ['f1', 'F1 score'],
  ['roc_auc', 'ROC-AUC'],
  ['pr_auc', 'PR-AUC'],
];

function ConfusionMatrix({ cm, label }) {
  const total = cm.tn + cm.fp + cm.fn + cm.tp;
  const cell = (v, good, title) => (
    <div className={`flex flex-col items-center justify-center rounded-lg p-3 ${good ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100' : 'bg-red-50 text-red-900 dark:bg-red-950/60 dark:text-red-100'}`} title={title}>
      <span className="tabular text-2xl font-semibold">{v.toLocaleString('en-IN')}</span>
      <span className="text-[11px] opacity-80">{((v / total) * 100).toFixed(1)}%</span>
      <span className="mt-0.5 text-[10px] font-medium uppercase opacity-70">{title}</span>
    </div>
  );
  return (
    <div data-testid={`cm-${label}`}>
      <p className="mb-2 text-sm font-medium">{MODEL_NAMES[label]}</p>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-1.5 text-xs">
        <div />
        <div className="muted text-center font-medium">Predicted: no failure</div>
        <div className="muted text-center font-medium">Predicted: failure</div>
        <div className="muted flex items-center pr-1 font-medium [writing-mode:vertical-rl] rotate-180 sm:[writing-mode:horizontal-tb] sm:rotate-0">Actual: no failure</div>
        {cell(cm.tn, true, 'True negative')}
        {cell(cm.fp, false, 'False alarm')}
        <div className="muted flex items-center pr-1 font-medium [writing-mode:vertical-rl] rotate-180 sm:[writing-mode:horizontal-tb] sm:rotate-0">Actual: failure</div>
        {cell(cm.fn, false, 'Missed failure')}
        {cell(cm.tp, true, 'Caught failure')}
      </div>
    </div>
  );
}

function CurveChart({ curves, kind, testId }) {
  const t = useChartTheme();
  const isRoc = kind === 'roc';
  return (
    <div className="h-72" data-testid={testId}>
      <ResponsiveContainer>
        <LineChart margin={{ top: 8, right: 12, left: -8, bottom: 14 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" domain={[0, 1]} ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]} tick={{ fontSize: 11, fill: t.axis }} label={{ value: isRoc ? 'False positive rate' : 'Recall', position: 'insideBottom', offset: -8, fontSize: 11, fill: t.axis }} />
          <YAxis type="number" domain={[0, 1]} ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]} tick={{ fontSize: 11, fill: t.axis }} label={{ value: isRoc ? 'True positive rate' : 'Precision', angle: -90, position: 'insideLeft', offset: 18, fontSize: 11, fill: t.axis }} />
          <Tooltip content={<ChartTooltip labelFormatter={(l) => `${isRoc ? 'FPR' : 'Recall'} ${Number(l).toFixed(2)}`} valueFormatter={(v) => Number(v).toFixed(3)} />} />
          <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          {isRoc && <Line data={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} dataKey="y" name="Random guess" stroke={t.axis} strokeDasharray="4 4" dot={false} isAnimationActive={false} legendType="none" />}
          {Object.entries(curves).map(([k, c]) => (
            <Line key={k} data={c[kind]} dataKey="y" name={MODEL_NAMES[k]} stroke={MODEL_COLORS[k]} strokeWidth={2} dot={false} isAnimationActive={false} type="linear" />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Importance({ version, model }) {
  const t = useChartTheme();
  const { data, loading } = useApi(`/models/${version}/feature-importance?model=${model}`);
  const [view, setView] = useState('sensors');
  if (loading || !data) return <div className="skeleton h-72" />;
  const rows = view === 'sensors' ? data.sensors.map((s) => ({ label: s.sensor.replace('_', ' '), value: s.importance * 100 })) : data.features.slice(0, 12).map((f) => ({ label: f.label, value: f.importance * 100 }));
  return (
    <div data-testid="feature-importance">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="muted text-xs">
          {data.model_label} · {data.method}
        </p>
        <Tabs value={view} onChange={setView} tabs={[{ value: 'sensors', label: 'By sensor' }, { value: 'features', label: 'Top 12 features' }]} />
      </div>
      <div style={{ height: view === 'sensors' ? 240 : 360 }}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 20, left: 4, bottom: 0 }}>
            <CartesianGrid stroke={t.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: t.axis }} unit="%" />
            <YAxis type="category" dataKey="label" width={view === 'sensors' ? 100 : 190} tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)}%`} />} />
            <Bar dataKey="value" name="Share of importance" fill={MODEL_COLORS[data.model]} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ModelLab() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const versions = useApi('/models');
  const [selected, setSelected] = useState(null);
  const active = versions.data?.find((v) => v.is_active);
  const current = selected || active?.version;
  const detail = useApi(current ? `/models/${current}/metrics` : null, [current]);
  const [impModel, setImpModel] = useState('primary');
  const [retrainOpen, setRetrainOpen] = useState(false);
  const [retrain, setRetrain] = useState({ serving_model: 'auto', activate: false, notes: '' });
  const [busy, setBusy] = useState('');

  async function activate(v) {
    const ok = await confirm({
      title: `Activate ${v.version}?`,
      message: `All 30 machines will be re-scored with ${v.version} (${v.primary_label}). Dashboard, alerts and predictions will update.`,
      confirmLabel: 'Activate',
    });
    if (!ok) return;
    setBusy(v.version);
    try {
      const r = await api(`/models/${v.version}/activate`, { method: 'POST' });
      toast.success(`${r.active} is now active; ${r.machines_rescored} machines re-scored in ${r.seconds}s.`);
      versions.reload(true);
      setSelected(r.active);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  }

  async function runRetrain() {
    setBusy('retrain');
    try {
      const r = await api('/models/retrain', { method: 'POST', body: retrain, timeout: 55000 });
      toast.success(`Trained ${r.version.version} in ${r.seconds}s${retrain.activate ? ' and activated it' : ''}.`);
      setRetrainOpen(false);
      versions.reload(true);
      setSelected(r.version.version);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  }

  async function remove(v) {
    const ok = await confirm({ title: `Delete ${v.version}?`, message: 'This removes the model file and its metrics from the registry.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api(`/models/${v.version}`, { method: 'DELETE' });
      toast.success(`Deleted ${v.version}`);
      if (selected === v.version) setSelected(null);
      versions.reload(true);
    } catch (e) {
      toast.error(e.message);
    }
  }

  if (versions.error) return <ErrorState error={versions.error} onRetry={versions.reload} />;
  const d = detail.data;

  return (
    <div>
      <PageHeader
        title="Model Lab"
        subtitle="Compare models, inspect evaluation on the held-out future period, and manage versions"
        actions={
          isAdmin ? (
            <button className="btn-primary" onClick={() => setRetrainOpen(true)} data-testid="retrain-open">
              <Icon name="refresh" className="h-4 w-4" /> Light retrain
            </button>
          ) : (
            <span className="badge bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
              <Icon name="eye" className="h-3.5 w-3.5" /> Read-only
            </span>
          )
        }
      />

      {!d ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton rows={6} />
          <CardSkeleton rows={6} />
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="muted">Showing</span>
            <select className="input w-auto py-1.5" value={current} onChange={(e) => setSelected(e.target.value)} aria-label="Model version" data-testid="version-select">
              {versions.data.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version} · {v.primary_label}
                  {v.is_active ? ' (active)' : ''}
                </option>
              ))}
            </select>
            <span className="muted text-xs">
              trained {dt(d.created_at)} · {d.mode === 'full' ? 'full settings (local script)' : 'light in-app retrain'} · train {d.data.train_rows.toLocaleString('en-IN')} / test {d.data.test_rows.toLocaleString('en-IN')} readings
            </span>
          </div>

          <div className="card overflow-x-auto">
            <div className="px-4 pt-4 sm:px-5">
              <h2 className="card-title">Model comparison</h2>
              <p className="muted text-xs">
                Failure within 7 days · test period {dt(d.data.test_period.start, { year: false })} – {dt(d.data.test_period.end, { year: false })} ({d.data.test_positive} failure-window readings, {(d.curves.rf.positive_rate * 100).toFixed(1)}% positive) · threshold 0.5
              </p>
            </div>
            <table className="table mt-2" data-testid="comparison-table">
              <thead>
                <tr>
                  <th>Model</th>
                  {METRICS.map(([k, l]) => (
                    <th key={k}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {['rf', 'gb'].map((k) => (
                  <tr key={k}>
                    <td className="whitespace-nowrap">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: MODEL_COLORS[k] }} />
                      <span className="font-medium">{MODEL_NAMES[k]}</span>
                      {d.primary_model === k && <span className="badge ml-2 bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100">serving</span>}
                    </td>
                    {METRICS.map(([m]) => {
                      const best = d.metrics[k][m] >= Math.max(d.metrics.rf[m], d.metrics.gb[m]);
                      return (
                        <td key={m} className={`tabular ${best ? 'font-semibold' : 'muted'}`}>
                          {d.metrics[k][m].toFixed(3)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="muted text-xs">Always "no failure" baseline</td>
                  <td className="muted tabular text-xs">{(1 - d.curves.rf.positive_rate).toFixed(3)}</td>
                  <td className="muted text-xs">0.000</td>
                  <td className="muted text-xs">0.000</td>
                  <td className="muted text-xs">0.000</td>
                  <td className="muted text-xs">0.500</td>
                  <td className="muted tabular text-xs">{d.curves.rf.positive_rate.toFixed(3)}</td>
                </tr>
              </tbody>
            </table>
            <div className="grid gap-3 border-t border-slate-100 px-4 py-3 text-xs sm:grid-cols-3 sm:px-5 dark:border-slate-800">
              <p>
                <span className="font-semibold">Remaining useful life</span> (Random Forest Regressor): MAE <span className="tabular font-semibold">{d.rul.mae_days} days</span> vs {d.rul.baseline_mae_days} days for a constant guess · R² {d.rul.r2}
              </p>
              <p>
                <span className="font-semibold">Anomaly detector</span> (Isolation Forest): flags {(d.anomaly.flag_rate_within_horizon * 100).toFixed(0)}% of readings in the week before a failure vs {(d.anomaly.flag_rate_healthy * 100).toFixed(1)}% of healthy readings
              </p>
              <p>
                <span className="font-semibold">Leakage control:</span> chronological split with a {d.data.gap_days}-day gap; features use only the current and previous 6 readings. Class imbalance: class weights ({d.config.class_weight}).
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="card card-pad">
              <h2 className="card-title mb-3">Confusion matrix (test period)</h2>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <ConfusionMatrix cm={d.curves.rf.confusion_matrix} label="rf" />
                <ConfusionMatrix cm={d.curves.gb.confusion_matrix} label="gb" />
              </div>
            </div>
            <div className="card card-pad">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="card-title">Feature importance</h2>
                <select className="input w-auto py-1 text-xs" value={impModel} onChange={(e) => setImpModel(e.target.value)} aria-label="Importance model">
                  <option value="primary">Serving model</option>
                  <option value="rf">Random Forest</option>
                  <option value="gb">Gradient Boosting</option>
                </select>
              </div>
              <Importance version={current} model={impModel} key={`${current}-${impModel}`} />
            </div>
            <div className="card card-pad">
              <h2 className="card-title">ROC curve</h2>
              <p className="muted text-xs">Higher and further left is better · AUC RF {d.metrics.rf.roc_auc.toFixed(3)} / GB {d.metrics.gb.roc_auc.toFixed(3)}</p>
              <CurveChart curves={d.curves} kind="roc" testId="roc-chart" />
            </div>
            <div className="card card-pad">
              <h2 className="card-title">Precision-recall curve</h2>
              <p className="muted text-xs">Better suited to rare failures · AP RF {d.metrics.rf.pr_auc.toFixed(3)} / GB {d.metrics.gb.pr_auc.toFixed(3)}</p>
              <CurveChart curves={d.curves} kind="pr" testId="pr-chart" />
            </div>
          </div>
        </>
      )}

      <div className="card mt-4 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
          <h2 className="card-title">Model versions</h2>
          <p className="muted text-xs">Light-retrained versions are stored temporarily and disappear when the server restarts.</p>
        </div>
        <table className="table mt-2" data-testid="versions-table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Created</th>
              <th>Serving model</th>
              <th className="hidden md:table-cell">F1 (RF / GB)</th>
              <th className="hidden md:table-cell">ROC-AUC (RF / GB)</th>
              <th className="hidden lg:table-cell">Train rows</th>
              <th className="hidden lg:table-cell">Storage</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(versions.data || []).map((v) => (
              <tr key={v.version} className={v.version === current ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''}>
                <td className="whitespace-nowrap">
                  <button className="font-semibold hover:text-brand-700 dark:hover:text-brand-300" onClick={() => setSelected(v.version)}>
                    {v.version}
                  </button>
                  {v.is_active && <span className="badge ml-2 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">active</span>}
                  <p className="muted max-w-xs truncate text-[11px]" title={v.notes}>
                    {v.notes}
                  </p>
                </td>
                <td className="whitespace-nowrap text-xs">{dt(v.created_at)}</td>
                <td>{v.primary_label}</td>
                <td className="tabular hidden md:table-cell">
                  {v.metrics.rf.f1.toFixed(3)} / {v.metrics.gb.f1.toFixed(3)}
                </td>
                <td className="tabular hidden md:table-cell">
                  {v.metrics.rf.roc_auc.toFixed(3)} / {v.metrics.gb.roc_auc.toFixed(3)}
                </td>
                <td className="tabular hidden lg:table-cell">{num(v.train_rows, 0)}</td>
                <td className="hidden lg:table-cell">
                  <StatusBadge status={v.is_bundled ? 'Completed' : 'Scheduled'} />
                  <span className="muted ml-1 text-[11px]">{v.is_bundled ? 'bundled' : 'temporary'}</span>
                </td>
                <td className="text-right whitespace-nowrap">
                  {isAdmin && !v.is_active && (
                    <button className="btn-secondary btn-sm" onClick={() => activate(v)} disabled={!!busy || !v.file_available} data-testid={`activate-${v.version}`}>
                      {busy === v.version ? 'Activating…' : 'Activate'}
                    </button>
                  )}
                  {isAdmin && !v.is_active && !v.is_bundled && (
                    <button className="btn-ghost btn-sm text-red-600 dark:text-red-400" onClick={() => remove(v)} aria-label={`Delete ${v.version}`}>
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  )}
                  {!isAdmin && <span className="muted text-xs">{v.is_active ? 'in use' : '—'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={retrainOpen}
        onClose={() => busy !== 'retrain' && setRetrainOpen(false)}
        title="Light retrain"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRetrainOpen(false)} disabled={busy === 'retrain'}>
              Cancel
            </button>
            <button className="btn-primary" onClick={runRetrain} disabled={busy === 'retrain'} data-testid="retrain-run">
              {busy === 'retrain' ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Training…
                </>
              ) : (
                'Train new version'
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <p className="muted">
            Trains a Random Forest, a Gradient Boosting classifier, the RUL regressor and the anomaly detector on all readings currently in the database, with lighter settings so it finishes in a few seconds. The same time-based split and class weights are used.
          </p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
            The new model is saved to temporary storage. On the hosted version it is removed when the server restarts; the pre-trained versions always remain.
          </div>
          <div>
            <label className="label" htmlFor="rt-serving">
              Serving model for predictions
            </label>
            <select id="rt-serving" className="input" value={retrain.serving_model} onChange={(e) => setRetrain((r) => ({ ...r, serving_model: e.target.value }))}>
              <option value="auto">Automatic (best F1 on the test period)</option>
              <option value="rf">Random Forest</option>
              <option value="gb">Gradient Boosting</option>
            </select>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={retrain.activate} onChange={(e) => setRetrain((r) => ({ ...r, activate: e.target.checked }))} className="h-4 w-4 rounded" />
            Activate immediately and re-score all machines
          </label>
          <div>
            <label className="label" htmlFor="rt-notes">
              Notes (optional)
            </label>
            <input id="rt-notes" className="input" maxLength={300} value={retrain.notes} onChange={(e) => setRetrain((r) => ({ ...r, notes: e.target.value }))} placeholder="After uploading November data" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
