import { useRef, useState } from 'react';
import Icon from '../components/Icon';
import { useToast } from '../components/feedback';
import { EmptyState, Field, PageHeader, RiskBadge, Tabs, ViewerNotice } from '../components/ui';
import { api, download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dt, num, pct, SENSOR_META, SENSORS } from '../lib/format';
import { useApi } from '../lib/useApi';

const FIELD_LABELS = { machine_code: 'Machine code', timestamp: 'Timestamp', failure: 'Failure flag (optional)', ...Object.fromEntries(SENSORS.map((s) => [s, `${SENSOR_META[s].label} (${SENSOR_META[s].unit})`])) };

function FileDrop({ file, onFile, accept = '.csv', testId }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${over ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-300 dark:border-slate-700'}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
      }}
    >
      <Icon name="upload" className="h-7 w-7 text-slate-400" />
      <p className="mt-2 text-sm font-medium">{file ? file.name : 'Drop a CSV file here'}</p>
      <p className="muted text-xs">{file ? `${(file.size / 1024).toFixed(1)} KB` : 'or choose a file · max 2,000 rows / 512 KB'}</p>
      <button type="button" className="btn-secondary mt-3" onClick={() => ref.current?.click()}>
        Choose file
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        data-testid={testId}
        onChange={(e) => {
          if (e.target.files[0]) onFile(e.target.files[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function UploadReadings() {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState(null);

  async function send(f, map, dryRun) {
    const form = new FormData();
    form.append('file', f);
    form.append('dry_run', dryRun ? 'true' : 'false');
    if (map) form.append('mapping', JSON.stringify(map));
    return api('/readings/upload', { method: 'POST', form });
  }

  async function onFile(f) {
    setFile(f);
    setImported(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await send(f, null, true);
      setResult(r);
      setMapping(r.mapping);
    } catch (e) {
      toast.error(e.message);
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  async function revalidate(map) {
    setMapping(map);
    setBusy(true);
    try {
      setResult(await send(file, map, true));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setBusy(true);
    try {
      const r = await send(file, mapping, false);
      setImported(r);
      setResult(r);
      toast.success(r.message);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4">
        <div className="card card-pad">
          <h2 className="card-title mb-1">1 · Choose a CSV</h2>
          <p className="muted mb-3 text-xs">One row per reading. Column names are matched automatically and can be changed below.</p>
          <FileDrop file={file} onFile={onFile} testId="upload-input" />
          <button className="btn-ghost mt-3 w-full" onClick={() => download('/readings/template', 'machinemd_readings_template.csv').catch((e) => toast.error(e.message))} data-testid="download-template">
            <Icon name="download" className="h-4 w-4" /> Download CSV template
          </button>
        </div>
        {result && (
          <div className="card card-pad">
            <h2 className="card-title mb-3">2 · Column mapping</h2>
            <div className="space-y-2.5">
              {result.fields.map((f) => (
                <div key={f} className="grid grid-cols-[1fr_1.1fr] items-center gap-2">
                  <label className="text-xs font-medium" htmlFor={`map-${f}`}>
                    {FIELD_LABELS[f]}
                    {result.required_fields.includes(f) && <span className="text-red-500"> *</span>}
                  </label>
                  <select id={`map-${f}`} className="input py-1.5 text-xs" value={mapping?.[f] || ''} onChange={(e) => revalidate({ ...mapping, [f]: e.target.value || null })} disabled={busy || !!imported}>
                    <option value="">— not mapped —</option>
                    {result.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4 lg:col-span-2">
        {!result ? (
          <div className="card">
            <EmptyState icon="data" title={busy ? 'Validating…' : 'No file selected'}>
              Upload a CSV to see a preview and a per-row validation report before anything is saved.
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="card card-pad">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="card-title">3 · Validation result</h2>
                  <p className="muted text-xs">{result.file_name} · {result.total_rows} data rows</p>
                </div>
                <div className="flex flex-wrap gap-2 text-sm" data-testid="upload-summary">
                  <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{result.valid_rows} valid</span>
                  <span className={`badge ${result.error_rows ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{result.error_rows} with errors</span>
                </div>
              </div>
              {!result.ok && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100" role="alert">
                  {result.message}
                </div>
              )}
              {imported ? (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100" data-testid="import-done">
                  <strong>Imported {imported.imported} rows.</strong> {imported.error_rows ? `${imported.error_rows} rows with errors were skipped. ` : ''}
                  {imported.machines_rescored} machine{imported.machines_rescored === 1 ? '' : 's'} re-scored with the active model.
                </div>
              ) : (
                result.ok && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button className="btn-primary" onClick={doImport} disabled={busy || !result.valid_rows} data-testid="import-button">
                      {busy ? 'Working…' : `Import ${result.valid_rows} valid row${result.valid_rows === 1 ? '' : 's'}`}
                    </button>
                    {result.error_rows > 0 && <span className="muted text-xs">Rows with errors are skipped and listed below.</span>}
                  </div>
                )
              )}
            </div>

            {result.errors?.length > 0 && (
              <div className="card overflow-x-auto" data-testid="error-report">
                <div className="px-4 pt-4 sm:px-5">
                  <h3 className="card-title text-red-700 dark:text-red-300">Row errors</h3>
                  <p className="muted text-xs">Line numbers refer to the CSV file (line 1 is the header).</p>
                </div>
                <table className="table mt-2">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Machine</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e) => (
                      <tr key={e.line}>
                        <td className="tabular">{e.line}</td>
                        <td>{e.machine_code || '—'}</td>
                        <td className="text-red-700 dark:text-red-300">
                          <ul className="list-disc space-y-0.5 pl-4 text-xs">
                            {e.errors.map((m) => (
                              <li key={m}>{m}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.preview?.length > 0 && (
              <div className="card overflow-x-auto">
                <div className="px-4 pt-4 sm:px-5">
                  <h3 className="card-title">Preview of valid rows</h3>
                  <p className="muted text-xs">First {result.preview.length} of {result.valid_rows}</p>
                </div>
                <table className="table mt-2" data-testid="preview-table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Machine</th>
                      <th>Timestamp</th>
                      {SENSORS.map((s) => (
                        <th key={s}>{SENSOR_META[s].label}</th>
                      ))}
                      <th>Failure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.preview.map((r) => (
                      <tr key={r.line}>
                        <td className="tabular">{r.line}</td>
                        <td>{r.machine_code}</td>
                        <td className="whitespace-nowrap">{dt(r.timestamp)}</td>
                        {SENSORS.map((s) => (
                          <td key={s} className="tabular">
                            {num(r[s], 2)}
                          </td>
                        ))}
                        <td>{r.failure ? 'Yes' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AddReading() {
  const toast = useToast();
  const machines = useApi('/machines');
  const [machineId, setMachineId] = useState('');
  const [vals, setVals] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);

  async function prefill(id) {
    setMachineId(id);
    setErrors({});
    if (!id) return;
    try {
      const d = await api(`/whatif/defaults?machine_id=${id}`);
      setVals(Object.fromEntries(d.sliders.map((s) => [s.sensor, String(s.value)])));
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function save() {
    const e = {};
    if (!machineId) e.machine = 'Choose a machine';
    SENSORS.forEach((s) => {
      if (vals[s] === undefined || vals[s] === '' || Number.isNaN(Number(vals[s]))) e[s] = 'Enter a number';
    });
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = { machine_id: Number(machineId), ...Object.fromEntries(SENSORS.map((s) => [s, Number(vals[s])])) };
      const r = await api('/readings', { method: 'POST', body });
      const pred = await api(`/predictions/machine/${machineId}`);
      setLast({ reading: r, pred });
      toast.success(`Reading saved for ${r.machine_code}; machine re-scored.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card card-pad lg:col-span-2">
        <h2 className="card-title mb-1">Add a single reading</h2>
        <p className="muted mb-4 text-xs">Values are pre-filled from the machine's latest reading. The reading is stamped 6 hours after the previous one and the machine is re-scored immediately.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Machine" error={errors.machine} htmlFor="ar-machine">
              <select id="ar-machine" className="input" value={machineId} onChange={(e) => prefill(e.target.value)}>
                <option value="">Select a machine…</option>
                {(machines.data || []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {SENSORS.map((s) => (
            <Field key={s} label={`${SENSOR_META[s].label} (${SENSOR_META[s].unit})`} error={errors[s]} htmlFor={`ar-${s}`}>
              <input id={`ar-${s}`} type="number" step="any" inputMode="decimal" className="input" value={vals[s] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [s]: e.target.value }))} />
            </Field>
          ))}
        </div>
        <button className="btn-primary mt-4" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save reading'}
        </button>
      </div>
      <div className="card card-pad">
        <h2 className="card-title mb-3">Result</h2>
        {last ? (
          <div className="space-y-2 text-sm">
            <p>
              {last.reading.machine_code} at {dt(last.reading.timestamp)}
            </p>
            <p className="flex items-center gap-2">
              Risk <RiskBadge level={last.pred.risk_level} /> {pct(last.pred.failure_probability, 1)}
            </p>
            <p>Health score: <strong>{last.pred.health_score}</strong></p>
          </div>
        ) : (
          <p className="muted text-sm">The new prediction appears here.</p>
        )}
      </div>
    </div>
  );
}

function BatchPredict() {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  async function onFile(f) {
    setFile(f);
    setBusy(true);
    setRes(null);
    try {
      const form = new FormData();
      form.append('file', f);
      setRes(await api('/predictions/batch', { method: 'POST', form }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card card-pad">
        <h2 className="card-title mb-1">Batch prediction</h2>
        <p className="muted mb-3 text-xs">
          Score up to 500 hypothetical readings without saving them. Columns: <code>machine_type</code> (or <code>machine_code</code>) and the six sensors. Each row is treated as a steady reading.
        </p>
        <FileDrop file={file} onFile={onFile} testId="batch-input" />
        {busy && <p className="muted mt-3 text-sm">Scoring…</p>}
      </div>
      <div className="card overflow-x-auto lg:col-span-2">
        {!res ? (
          <EmptyState icon="lab" title="No batch scored yet">The template from the Upload tab also works here.</EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5">
              <h3 className="card-title mr-2">{res.scored} rows scored</h3>
              <span className="badge bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">{res.summary.High} high</span>
              <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">{res.summary.Medium} medium</span>
              <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{res.summary.Low} low</span>
              {res.error_rows > 0 && <span className="badge bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{res.error_rows} rows skipped</span>}
            </div>
            <table className="table mt-2" data-testid="batch-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Machine</th>
                  <th>Risk</th>
                  <th>Health</th>
                  <th>RUL</th>
                  <th>Drivers</th>
                </tr>
              </thead>
              <tbody>
                {res.results.map((r) => (
                  <tr key={r.line}>
                    <td className="tabular">{r.line}</td>
                    <td>{r.machine_code || r.machine_type}</td>
                    <td>
                      <RiskBadge level={r.risk_level} /> <span className="muted tabular text-xs">{pct(r.failure_probability, 1)}</span>
                    </td>
                    <td className="tabular">{r.health_score}</td>
                    <td className="tabular">{r.rul_capped ? '>14 d' : `${r.rul_days} d`}</td>
                    <td className="muted text-xs">{r.top_sensors.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {res.errors.length > 0 && (
              <div className="px-4 pb-4 text-xs text-red-700 sm:px-5 dark:text-red-300">
                {res.errors.map((e) => (
                  <p key={e.line}>
                    Line {e.line}: {e.errors.join('; ')}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function DataPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState(isAdmin ? 'upload' : 'batch');
  const readings = useApi('/readings?limit=1');
  return (
    <div>
      <PageHeader title="Data" subtitle={readings.data ? `${readings.data.total.toLocaleString('en-IN')} sensor readings stored` : 'Sensor data management'} />
      {!isAdmin && <ViewerNotice>You have read-only access: uploading and adding readings is available to admins. You can still run batch predictions, which save nothing.</ViewerNotice>}
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[...(isAdmin ? [{ value: 'upload', label: 'Upload CSV' }, { value: 'add', label: 'Add reading' }] : []), { value: 'batch', label: 'Batch prediction' }]}
        />
      </div>
      {tab === 'upload' && isAdmin && <UploadReadings />}
      {tab === 'add' && isAdmin && <AddReading />}
      {tab === 'batch' && <BatchPredict />}
    </div>
  );
}
