import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Icon from '../components/Icon';
import { ChartTooltip, RiskGauge } from '../components/charts';
import { CardSkeleton, ErrorState, PageHeader, RiskBadge } from '../components/ui';
import { api } from '../lib/api';
import { healthColor, MACHINE_TYPES, num, pct } from '../lib/format';
import { useChartTheme } from '../lib/theme';
import { useApi } from '../lib/useApi';

export default function WhatIf() {
  const [params, setParams] = useSearchParams();
  const machineParam = params.get('machine') || '';
  const [mtype, setMtype] = useState(params.get('type') || 'Pump');
  const machines = useApi('/machines');
  const defaultsPath = machineParam ? `/whatif/defaults?machine_id=${machineParam}` : `/whatif/defaults?machine_type=${encodeURIComponent(mtype)}`;
  const defaults = useApi(defaultsPath);
  const [values, setValues] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const reqId = useRef(0);
  const t = useChartTheme();

  useEffect(() => {
    if (defaults.data) setValues(Object.fromEntries(defaults.data.sliders.map((s) => [s.sensor, s.value])));
  }, [defaults.data]);

  const resolvedType = defaults.data?.machine_type || mtype;

  // Debounced scoring: every slider move re-scores within ~150 ms.
  useEffect(() => {
    if (!values) return;
    const id = ++reqId.current;
    setPending(true);
    const h = setTimeout(async () => {
      try {
        // With a machine selected the values are scored on top of its last 6 real readings
        // (trend mode), so unchanged sliders match the machine's live prediction (BUG-06).
        const body = { ...values, ...(machineParam ? { machine_id: Number(machineParam), mode: 'trend' } : { machine_type: resolvedType }) };
        const r = await api('/whatif', { method: 'POST', body });
        if (id === reqId.current) {
          setResult(r);
          setError(null);
        }
      } catch (e) {
        if (id === reqId.current) setError(e);
      } finally {
        if (id === reqId.current) setPending(false);
      }
    }, 150);
    return () => clearTimeout(h);
  }, [values, machineParam, resolvedType]);

  const pickMachine = (id) => {
    const p = new URLSearchParams(params);
    if (id) p.set('machine', id);
    else p.delete('machine');
    setParams(p, { replace: true });
  };

  const reset = () => setValues(Object.fromEntries(defaults.data.sliders.map((s) => [s.sensor, s.value])));
  const toNormal = () => setValues(Object.fromEntries(defaults.data.sliders.map((s) => [s.sensor, s.normal])));

  if (defaults.error) return <ErrorState error={defaults.error} onRetry={defaults.reload} />;
  const selectedMachine = machines.data?.find((m) => String(m.id) === machineParam);
  const contrib = (result?.contributions || []).map((c) => ({ label: c.label, value: Math.max(0, c.risk_drop) * 100 }));

  return (
    <div>
      <PageHeader
        title="What-if simulator"
        subtitle="Move the sensor sliders and see how the active model's failure risk, health score and remaining life respond"
        actions={
          <>
            <button className="btn-secondary" onClick={toNormal} disabled={!defaults.data}>
              Set all to normal
            </button>
            <button className="btn-secondary" onClick={reset} disabled={!defaults.data}>
              <Icon name="refresh" className="h-4 w-4" /> Reset
            </button>
          </>
        }
      />

      <div className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr] lg:items-end">
        <div>
          <label className="label" htmlFor="wi-machine">
            Start from a machine
          </label>
          <select id="wi-machine" className="input" value={machineParam} onChange={(e) => pickMachine(e.target.value)} data-testid="whatif-machine">
            <option value="">— none (use machine type) —</option>
            {(machines.data || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} · {m.name} ({m.prediction?.risk_level || 'no data'})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="wi-type">
            Machine type
          </label>
          <select
            id="wi-type"
            className="input"
            value={resolvedType}
            disabled={!!machineParam}
            onChange={(e) => {
              setMtype(e.target.value);
              const p = new URLSearchParams(params);
              p.set('type', e.target.value);
              setParams(p, { replace: true });
            }}
            data-testid="whatif-type"
          >
            {MACHINE_TYPES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        <p className="muted text-xs">
          {selectedMachine ? (
            <>
              Sliders start at <Link className="text-brand-700 underline dark:text-brand-300" to={`/machines/${selectedMachine.id}`}>{selectedMachine.code}</Link>'s latest reading and are scored as its newest reading after its last 6 real ones, so unchanged values reproduce the live prediction ({pct(selectedMachine.prediction?.failure_probability, 1)}).
            </>
          ) : (
            'Sliders start at the design-normal operating point for this machine type. Values are scored as a steady state (7 identical readings).'
          )}
        </p>
      </div>

      {!values || !defaults.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton rows={8} />
          <CardSkeleton rows={8} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="card card-pad lg:col-span-2">
            <h2 className="card-title mb-4">Sensor values</h2>
            <div className="space-y-5">
              {defaults.data.sliders.map((s) => {
                const v = values[s.sensor];
                const dev = s.sensor === 'running_hours' ? null : ((v - s.normal) / s.normal) * 100;
                return (
                  <div key={s.sensor}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <label htmlFor={`sl-${s.sensor}`} className="text-sm font-medium">
                        {s.label}
                      </label>
                      <div className="flex items-baseline gap-1.5">
                        <input
                          type="number"
                          className="input tabular w-24 px-2 py-1 text-right text-sm"
                          value={v}
                          step={s.step}
                          min={s.min}
                          max={s.max}
                          aria-label={`${s.label} value`}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isNaN(n)) setValues((x) => ({ ...x, [s.sensor]: Math.min(s.max, Math.max(s.min, n)) }));
                          }}
                        />
                        <span className="muted w-10 text-xs">{s.unit}</span>
                      </div>
                    </div>
                    <input
                      id={`sl-${s.sensor}`}
                      type="range"
                      className="w-full"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={v}
                      onChange={(e) => setValues((x) => ({ ...x, [s.sensor]: Number(e.target.value) }))}
                      data-testid={`slider-${s.sensor}`}
                    />
                    <div className="muted flex justify-between text-[11px]">
                      <span>
                        normal {num(s.normal, 2)} {s.unit}
                      </span>
                      {dev != null && Math.abs(dev) >= 0.5 && <span className={Math.abs(dev) > 10 ? 'font-medium text-red-600 dark:text-red-400' : ''}>{dev > 0 ? '+' : ''}{dev.toFixed(1)}% vs normal</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 lg:col-span-3">
            <div className="card card-pad" aria-live="polite">
              <div className="flex items-center justify-between">
                <h2 className="card-title">Predicted outcome</h2>
                <span className={`muted text-xs transition-opacity ${pending ? 'opacity-100' : 'opacity-0'}`}>updating…</span>
              </div>
              {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error.message}</p>}
              {result && (
                <div className="mt-2 grid items-center gap-4 sm:grid-cols-[auto_1fr]">
                  <div className="flex flex-col items-center text-slate-700 dark:text-slate-200">
                    <RiskGauge probability={result.failure_probability} thresholds={result.thresholds} />
                    <p className="muted -mt-1 text-xs">Failure probability within 7 days</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                      <p className="muted text-xs">Risk level</p>
                      <div className="mt-1" data-testid="whatif-risk">
                        <RiskBadge level={result.risk_level} />
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                      <p className="muted text-xs">Health score</p>
                      <p className="tabular mt-0.5 text-2xl font-semibold" style={{ color: healthColor(result.health_score) }} data-testid="whatif-health">
                        {result.health_score}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                      <p className="muted text-xs">Remaining useful life</p>
                      <p className="tabular mt-0.5 text-2xl font-semibold" data-testid="whatif-rul">
                        {result.rul_capped ? '>14' : result.rul_days.toFixed(1)} <span className="text-sm font-normal">days</span>
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                      <p className="muted text-xs">Anomaly detector</p>
                      <p className={`mt-1 text-sm font-semibold ${result.anomaly ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{result.anomaly ? 'Unusual pattern' : 'Normal pattern'}</p>
                    </div>
                    <p className="muted col-span-2 text-xs">
                      Baseline at normal values: {pct(result.baseline_probability, 1)} · thresholds Medium ≥ {pct(result.thresholds.medium)} / High ≥ {pct(result.thresholds.high)} · model {result.model_version}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="card card-pad">
              <h2 className="card-title">What changed the risk most</h2>
              <p className="muted mb-2 text-xs">Drop in failure probability (percentage points) if each sensor alone went back to its normal value.</p>
              <div className="h-60" data-testid="whatif-contrib">
                <ResponsiveContainer>
                  <BarChart data={contrib} layout="vertical" margin={{ top: 0, right: 20, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke={t.grid} strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: t.axis }} domain={[0, (max) => Math.max(5, Math.ceil(max))]} unit=" pts" />
                    <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)} pts`} />} />
                    <ReferenceLine x={0} stroke={t.axis} />
                    <Bar dataKey="value" name="Risk drop" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                      {contrib.map((d) => (
                        <Cell key={d.label} fill={d.value > 10 ? '#dc2626' : d.value > 2 ? '#d97706' : '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {result?.recommended_action && (
                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                  <span className="font-semibold">{result.recommended_action.title}.</span> <span className="muted">{result.recommended_action.detail}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
