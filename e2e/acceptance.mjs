// End-to-end acceptance checks through the real UI (and the API for numbers).
// Usage: BASE_URL=http://localhost:5173 node acceptance.mjs [results-file]
import fs from 'node:fs';
import path from 'node:path';
import { api, BASE, clickText, DOWNLOADS, go, launch, login, newPage, overflowX, Results, settle, shot, sleep, text } from './lib.mjs';

const R = new Results('MachineMD acceptance');
const OUT = process.argv[2] || 'results-local.json';
const LIVE = !BASE.includes('localhost');
const prefix = process.env.SHOT_PREFIX || '';
const browser = await launch();
const problems = [];
const clientErrors = [];
const collect = (page, where) => {
  page.problems.splice(0).forEach((p) => problems.push(`${where}: ${p}`));
  page.clientErrors.splice(0).forEach((p) => clientErrors.push(`${where}: ${p}`));
};

async function setRange(page, sel, value) {
  await page.$eval(
    sel,
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}
async function whatifState(page) {
  await sleep(250);
  await page.waitForFunction(() => !document.body.innerText.includes('updating…') || true);
  await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
  return page.evaluate(() => ({
    risk: Number(document.querySelector('[data-testid=gauge-value]')?.textContent.replace('%', '')),
    health: Number(document.querySelector('[data-testid=whatif-health]')?.textContent),
    rul: document.querySelector('[data-testid=whatif-rul]')?.textContent.trim(),
    level: document.querySelector('[data-testid=whatif-risk]')?.textContent.trim(),
  }));
}

try {
  // ------------------------------------------------------------ 0. reset demo state
  // Done in the same browser context as the run, so the reset stays in this browser's change
  // journal and every serverless instance applies it (BUG-07).
  const page = await newPage(browser);
  {
    await login(page, 'admin@machinemd.com', 'Admin@123');
    const r = await api(page, 'POST', '/admin/reset-demo');
    R.ok('A0', 'Demo data reset to the committed seed before the run', r.status === 200, JSON.stringify(r));
    await page.evaluate(() => localStorage.removeItem('machinemd-token'));
  }

  // ------------------------------------------------------------ 1. Login page
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  R.ok('L1', 'Login page renders with demo accounts', /demo accounts/i.test(await text(page)));
  await shot(page, `${prefix}WORKING-01-login`);
  await page.type('#email', 'admin@machinemd.com');
  await page.type('#password', 'wrong-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-testid=login-error]', { timeout: 30000 });
  R.ok('L2', 'Wrong password shows a clear error', (await text(page)).includes('Incorrect e-mail or password'));
  const health = await page.evaluate(async () => (await fetch('/api/health')).json());
  R.ok('H1', '/api/health reports ok with the pre-trained model loaded', health.status === 'ok' && health.model.ok && health.model.active_version === 'v1', JSON.stringify(health.model));

  // ------------------------------------------------------------ 2. Admin login + dashboard
  await login(page, 'admin@machinemd.com', 'Admin@123');
  R.ok('L3', 'Admin can sign in and lands on the dashboard', (await text(page)).includes('Fleet dashboard'));
  R.ok('L4', 'Top bar shows the Admin role', (await page.$eval('[data-testid=role-label]', (e) => e.textContent)) === 'Admin');
  R.ok('U1', 'Storage-is-temporary note is visible in the app', !!(await page.$('[data-testid=storage-banner]')));
  await shot(page, `${prefix}WORKING-02-dashboard`, { fullPage: true });
  collect(page, 'dashboard');

  const dash = (await api(page, 'GET', '/dashboard/summary')).data;
  const machines = (await api(page, 'GET', '/machines')).data;
  const activeAlerts = (await api(page, 'GET', '/alerts?status=active')).data;
  const kpi = async (id) => page.$eval(`[data-testid=${id}-value]`, (e) => e.textContent.trim());
  const count = (lvl) => machines.filter((m) => m.prediction?.risk_level === lvl).length;
  const avg = Math.round((machines.reduce((s, m) => s + m.prediction.health_score, 0) / machines.length) * 10) / 10;
  R.ok('D1', 'Dashboard KPI "machines monitored" matches the machine list', (await kpi('kpi-machines')) === String(machines.length), `${await kpi('kpi-machines')} vs ${machines.length}`);
  R.ok('D2', 'Dashboard KPI "high risk" matches machines with High risk', (await kpi('kpi-high')) === String(count('High')), `${await kpi('kpi-high')} vs ${count('High')}`);
  R.ok('D3', 'Dashboard KPI "medium risk" matches machines with Medium risk', (await kpi('kpi-medium')) === String(count('Medium')));
  R.ok('D4', 'Dashboard KPI "avg health score" equals the mean of all machine health scores', (await kpi('kpi-health')) === String(avg), `${await kpi('kpi-health')} vs ${avg}`);
  R.ok('D5', 'Dashboard KPI "open alerts" matches the active alerts list', (await kpi('kpi-alerts')) === String(activeAlerts.length), `${await kpi('kpi-alerts')} vs ${activeAlerts.length}`);
  R.ok('D6', 'Ranked table lists the highest-risk machine first', (await page.$eval('[data-testid=ranking-table] tbody tr td', (e) => e.textContent)).includes(dash.ranking[0].name));
  R.ok('D7', 'Risk donut and health trend charts render', (await page.$$('.recharts-surface')).length >= 2);

  // ------------------------------------------------------------ 3. Predictions present + real metrics
  R.ok('P1', 'Every machine has a prediction from the pre-trained model', machines.every((m) => m.prediction && m.prediction.model_version === 'v1'));
  R.ok('P2', 'At least one machine is High risk (degrading machines detected)', count('High') >= 1, `High=${count('High')}`);
  const active = (await api(page, 'GET', '/models/active')).data;
  const m = active.metrics;
  const plausible = ['rf', 'gb'].every((k) => m[k].roc_auc > 0.6 && m[k].roc_auc < 0.99 && m[k].recall < 0.99);
  R.ok('P3', 'Metrics are real and not suspiciously perfect (0.6 < ROC-AUC < 0.99, recall < 0.99)', plausible, JSON.stringify({ rf: m.rf, gb: m.gb }));
  const cm = active.curves.rf.confusion_matrix;
  R.ok('P4', 'Confusion matrix cells add up to the test-set size', cm.tn + cm.fp + cm.fn + cm.tp === active.test_rows);
  R.ok('P5', 'Train period ends before the test period starts (time split, no leakage)', active.data.train_period.end < active.data.test_period.start, JSON.stringify(active.data.train_period) + JSON.stringify(active.data.test_period));

  // ------------------------------------------------------------ 4. Machines list
  await go(page, '/machines');
  R.ok('M1', 'Machines table lists all 30 machines', (await page.$$('[data-testid=machines-table] tbody tr')).length === 30);
  await page.select('[data-testid=filter-risk]', 'High');
  await sleep(300);
  const highRows = (await page.$$('[data-testid=machines-table] tbody tr')).length;
  R.ok('M2', 'Risk filter shows only High-risk machines', highRows === count('High'), `${highRows} vs ${count('High')}`);
  await page.select('[data-testid=filter-risk]', '');
  await page.type('[data-testid=machine-search]', 'compressor');
  await sleep(300);
  const compRows = (await page.$$('[data-testid=machines-table] tbody tr')).length;
  R.ok('M3', 'Search filters the table (compressor -> 7 rows)', compRows === 7, compRows);
  await page.$eval('[data-testid=machine-search]', (e) => (e.value = ''));
  await go(page, '/machines');
  await page.click('[data-testid=sort-health]');
  await sleep(300);
  const firstHealth = await page.$eval('[data-testid=machines-table] tbody tr [role=meter]', (e) => Number(e.getAttribute('aria-valuenow')));
  R.ok('M4', 'Sorting by health score ascending puts the least healthy machine first', firstHealth === Math.min(...machines.map((x) => x.prediction.health_score)), firstHealth);
  await page.click('[data-testid=sort-risk]');
  await sleep(300);
  await shot(page, `${prefix}WORKING-03-machines-list`);

  // ------------------------------------------------------------ 5. Machine detail
  const top = dash.ranking[0];
  await go(page, `/machines/${top.machine_id}`);
  const dtxt = await text(page);
  R.ok('MD1', 'Machine detail shows health score, RUL and a recommended action', !!(await page.$('[data-testid=detail-health]')) && !!(await page.$('[data-testid=detail-rul]')) && !!(await page.$('[data-testid=recommended-action]')));
  R.ok('MD2', 'Five sensor trend charts are drawn', (await page.$$('[data-testid^=chart-]')).length === 5);
  R.ok('MD3', 'Top contributing sensors are listed', dtxt.includes('Top contributing sensors') && dtxt.includes('Vibration'));
  R.ok('MD4', 'Anomaly points are marked on the sensor charts', /\d+ anomal/.test(dtxt));
  await shot(page, `${prefix}WORKING-04-machine-detail`, { fullPage: true });
  collect(page, 'machine detail');

  // ------------------------------------------------------------ 6. What-if
  await go(page, '/what-if?type=Compressor');
  await page.waitForSelector('[data-testid=gauge-value]');
  const s0 = await whatifState(page);
  const tSlider = await page.$eval('[data-testid=slider-temperature]', (e) => ({ max: Number(e.max), value: Number(e.value) }));
  await setRange(page, '[data-testid=slider-temperature]', Math.round(tSlider.value * 1.2));
  const s1 = await whatifState(page);
  const vSlider = await page.$eval('[data-testid=slider-vibration]', (e) => ({ value: Number(e.value) }));
  await setRange(page, '[data-testid=slider-vibration]', Math.round(vSlider.value * 2.2 * 100) / 100);
  const s2 = await whatifState(page);
  R.ok('W1', 'Raising temperature raises the risk', s1.risk > s0.risk, `${s0.risk}% -> ${s1.risk}%`);
  R.ok('W2', 'Raising vibration as well raises the risk further and lowers health and RUL', s2.risk > s1.risk && s2.health < s0.health && parseFloat(s2.rul.replace('>', '')) < 14, JSON.stringify({ s0, s1, s2 }));
  R.ok('W3', 'Health score = 100 - risk%', Math.abs(s2.health - (100 - s2.risk)) <= 1, JSON.stringify(s2));
  const bars = await page.$$eval('[data-testid=whatif-contrib] .recharts-bar-rectangle', (els) => els.length);
  R.ok('W4', '"What changed the risk most" chart has bars', bars >= 2, bars);
  await shot(page, `${prefix}WORKING-07-what-if`);
  await clickText(page, 'Set all to normal');
  const s3 = await whatifState(page);
  R.ok('W5', 'Back to normal values returns to Low risk', s3.level === 'Low' && s3.risk < s2.risk, JSON.stringify(s3));

  // ------------------------------------------------------------ 7. CSV upload with a bad row
  await go(page, '/data');
  await clickText(page, 'Download CSV template');
  await sleep(1200);
  const tpl = fs.readdirSync(DOWNLOADS).find((f) => f.startsWith('machinemd_readings_template'));
  R.ok('C1', 'CSV template downloads', !!tpl, fs.readdirSync(DOWNLOADS).join(','));
  // Timestamps strictly between the last seeded reading and "now", with minutes unique to this run,
  // so the two valid rows never collide with the seed. The earlier "now - 30 h" could land exactly
  // on a seeded 6-hourly reading as the day went on (test-data issue, found live).
  const seedEnd = new Date((await api(page, 'GET', '/dashboard/summary')).data.kpis.last_reading_at + 'Z');
  const runMinute = 1 + (Date.now() % 58);
  const pad = (n) => String(n).padStart(2, '0');
  const ts = (h) => {
    const d = new Date(seedEnd.getTime() + h * 3600e3 + runMinute * 60e3);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };
  const csv = ['Asset,Time,Temp_C,Vibration,Pressure,RPM,Hours,Amps', `PMP-001,${ts(1)},58.4,2.9,6.0,1748,1500,18.2`, `PMP-001,${ts(2)},abc,2.9,6.0,1750,1506,18.3`, `PMP-002,${ts(1)},58.9,2.8,6.01,1752,900,18.1`, `ZZZ-999,${ts(1)},58,2.8,6,1750,800,18`].join('\n');
  const csvPath = path.resolve('.downloads/upload-with-bad-row.csv');
  fs.writeFileSync(csvPath, csv);
  const input = await page.$('[data-testid=upload-input]');
  await input.uploadFile(csvPath);
  await page.waitForSelector('[data-testid=upload-summary]', { timeout: 30000 });
  await settle(page);
  const sum = await page.$eval('[data-testid=upload-summary]', (e) => e.textContent);
  const errText = await page.$eval('[data-testid=error-report]', (e) => e.innerText).catch(() => '');
  R.ok('C2', 'Column mapping auto-detects non-standard headers (Temp_C, Amps, Asset)', (await page.$eval('#map-temperature', (e) => e.value)) === 'Temp_C' && (await page.$eval('#map-current', (e) => e.value)) === 'Amps');
  R.ok('C3', 'Preview reports 2 valid rows and 2 rows with errors', sum.includes('2 valid') && sum.includes('2 with errors'), sum);
  R.ok('C4', 'Per-row error report explains the bad row (line 3: temperature not a number; line 5: unknown machine)', /3[\s\S]*Temperature must be a number/.test(errText) && errText.includes("Unknown machine code 'ZZZ-999'"), errText);
  await shot(page, `${prefix}WORKING-05-data-upload-preview`, { fullPage: true });
  const before = (await api(page, 'GET', '/readings?limit=1')).data.total;
  await page.click('[data-testid=import-button]');
  await page.waitForSelector('[data-testid=import-done]', { timeout: 30000 });
  const after = (await api(page, 'GET', '/readings?limit=1')).data.total;
  R.ok('C5', 'Importing loads exactly the 2 valid rows and skips the bad ones', after === before + 2, `${before} -> ${after}`);
  await shot(page, `${prefix}WORKING-05b-data-imported`);

  // ------------------------------------------------------------ 8. Retrain + activate changes predictions
  const predsBefore = Object.fromEntries((await api(page, 'GET', '/predictions/latest')).data.map((r) => [r.code, r.prediction.failure_probability]));
  await go(page, '/model-lab');
  R.ok('ML1', 'Model Lab shows comparison table, confusion matrices, ROC, PR and feature importance', !!(await page.$('[data-testid=comparison-table]')) && !!(await page.$('[data-testid=cm-rf]')) && !!(await page.$('[data-testid=roc-chart] .recharts-line')) && !!(await page.$('[data-testid=pr-chart] .recharts-line')) && !!(await page.$('[data-testid=feature-importance] .recharts-bar-rectangle')));
  await shot(page, `${prefix}WORKING-06-model-lab`, { fullPage: true });
  await page.click('[data-testid=retrain-open]');
  await page.select('#rt-serving', 'gb');
  const t0 = Date.now();
  await page.click('[data-testid=retrain-run]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=retrain-run]'), { timeout: 60000 });
  const trainSecs = (Date.now() - t0) / 1000;
  await settle(page);
  const versions = (await api(page, 'GET', '/models')).data;
  const newV = versions.find((v) => !v.is_bundled);
  R.ok('ML2', `Light retrain creates a new model version (took ${trainSecs.toFixed(1)} s)`, !!newV && versions.length === 3 && trainSecs < 30, versions.map((v) => v.version).join(','));
  await page.click(`[data-testid=activate-${newV.version}]`);
  await page.click('[data-testid=confirm-ok]');
  await page.waitForFunction((v) => document.body.innerText.includes(`${v} is now active`), { timeout: 30000 }, newV.version);
  const predsAfter = (await api(page, 'GET', '/predictions/latest')).data;
  const changed = predsAfter.filter((r) => Math.abs(r.prediction.failure_probability - predsBefore[r.code]) > 0.001).length;
  R.ok('ML3', 'Activating the new version re-scores every machine with it and changes predictions', predsAfter.every((r) => r.prediction.model_version === newV.version) && changed > 0, `${changed} machines changed`);
  await shot(page, `${prefix}WORKING-06b-model-lab-new-version`);
  // Put v1 back so later checks use the pre-trained model.
  await api(page, 'POST', '/models/v1/activate');

  // ------------------------------------------------------------ 9. Alerts + maintenance handles the alert
  await go(page, '/alerts');
  const alertsNow = (await api(page, 'GET', '/alerts?status=active&risk=High')).data;
  R.ok('AL1', 'A high-risk machine has an open alert', alertsNow.length >= 1, alertsNow.length);
  await shot(page, `${prefix}WORKING-08-alerts`, { fullPage: true });
  const target = alertsNow[0];
  // Acknowledge via the UI
  await page.evaluate((code) => {
    const card = [...document.querySelectorAll('[data-testid=alert-item]')].find((c) => c.innerText.includes(code));
    card.querySelector('[data-testid=ack-button]').click();
  }, target.machine_code);
  await sleep(1200);
  const acked = (await api(page, 'GET', `/alerts?machine_id=${target.machine_id}&status=active`)).data[0];
  R.ok('AL2', 'Acknowledge button changes the alert to Acknowledged', acked?.status === 'Acknowledged', JSON.stringify(acked?.status));
  const openBefore = (await api(page, 'GET', '/dashboard/summary')).data.kpis.open_alerts;
  await page.evaluate((code) => {
    const card = [...document.querySelectorAll('[data-testid=alert-item]')].find((c) => c.innerText.includes(code));
    card.querySelector('[data-testid=alert-log-maintenance]').click();
  }, target.machine_code);
  await page.waitForSelector('#mt-action');
  await page.type('#mt-action', 'Replaced drive-end bearing and realigned the coupling');
  await page.type('#mt-cost', '42000');
  await page.type('#mt-tech', 'R. Kumar');
  await page.click('[data-testid=maintenance-save]');
  await page.waitForSelector('[data-testid=toast-success]', { timeout: 20000 });
  await settle(page);
  const handled = (await api(page, 'GET', `/alerts?machine_id=${target.machine_id}`)).data.find((a) => a.id === target.id);
  const openAfter = (await api(page, 'GET', '/dashboard/summary')).data.kpis.open_alerts;
  R.ok('AL3', 'Logging maintenance marks the high-risk alert as Handled', handled.status === 'Handled' && !!handled.maintenance_id, JSON.stringify(handled));
  R.ok('AL4', 'Open-alert count on the dashboard drops by one', openAfter === openBefore - 1, `${openBefore} -> ${openAfter}`);
  await page.click('[data-testid=alert-tab-handled]');
  await settle(page);
  await shot(page, `${prefix}WORKING-08b-alerts-handled`);

  // ------------------------------------------------------------ 10. Maintenance log add + edit
  await go(page, '/maintenance');
  R.ok('MT1', 'Maintenance log lists the new record', (await text(page)).includes('Replaced drive-end bearing'));
  await page.click('[data-testid=edit-maintenance]');
  await page.waitForSelector('#mt-cost');
  // Clear the number field the way a user does (select all, then delete). Setting .value directly
  // does not update React state, and headless Chrome ignores triple-click / Cmd+A selection on
  // type=number inputs, so the earlier test appended to the old value (test-harness issue, not an app bug).
  await page.focus('#mt-cost');
  await page.$eval('#mt-cost', (e) => e.select()); // HTMLInputElement.select() works on number inputs
  await page.keyboard.press('Backspace');
  await page.type('#mt-cost', '45500');
  const typedCost = await page.$eval('#mt-cost', (e) => e.value);
  R.ok('MT1b', 'Cost field holds exactly the typed value before saving', typedCost === '45500', typedCost);
  await page.click('[data-testid=maintenance-save]');
  await page.waitForSelector('[data-testid=toast-success], [data-testid=toast-error]', { timeout: 20000 });
  await settle(page);
  R.ok('MT2', 'Editing a maintenance record saves the new cost', (await text(page)).includes('45,500'));
  await shot(page, `${prefix}WORKING-09-maintenance`);

  // ------------------------------------------------------------ 11. Reports
  await go(page, '/reports');
  await shot(page, `${prefix}WORKING-10-reports`, { fullPage: true });
  fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.pdf')).forEach((f) => fs.unlinkSync(path.join(DOWNLOADS, f)));
  await page.click('[data-testid=pdf-button]');
  let pdf = null;
  for (let i = 0; i < 40 && !pdf; i += 1) {
    await sleep(500);
    pdf = fs.readdirSync(DOWNLOADS).find((f) => f.startsWith('MachineMD_Fleet_Report') && f.endsWith('.pdf'));
  }
  const pdfOk = pdf && fs.readFileSync(path.join(DOWNLOADS, pdf)).subarray(0, 5).toString() === '%PDF-';
  R.ok('R1', 'PDF report downloads and is a valid PDF', pdfOk, pdf);
  await page.click('[data-testid=csv-machines]');
  await sleep(1500);
  const machinesCsv = fs.readdirSync(DOWNLOADS).find((f) => f.startsWith('machinemd_machines_'));
  R.ok('R2', 'CSV export downloads', !!machinesCsv && fs.readFileSync(path.join(DOWNLOADS, machinesCsv), 'utf8').split('\n').length >= 31);

  // ------------------------------------------------------------ 12. Users + settings
  await go(page, '/users');
  R.ok('US1', 'Users page lists both demo accounts', (await text(page)).includes('viewer@machinemd.com'));
  await shot(page, `${prefix}WORKING-11-users`);
  await go(page, '/settings');
  await shot(page, `${prefix}WORKING-12-settings`);
  collect(page, 'admin pages');

  // ------------------------------------------------------------ 13. Timing: every API call within the Vercel limit
  const timings = await page.evaluate(async () => {
    const H = { Authorization: `Bearer ${localStorage.getItem('machinemd-token')}` };
    const paths = ['/dashboard/summary', '/machines', '/machines/1', '/predictions/latest', '/models', '/models/active', '/alerts', '/maintenance', '/reports/summary', '/reports/export/readings', '/whatif/defaults?machine_id=1', '/predictions/machine/1/history', '/activity'];
    const out = {};
    for (const p of paths) {
      const t = performance.now();
      await (await fetch(`/api${p}`, { headers: H })).text();
      out[p] = Math.round(performance.now() - t);
    }
    return out;
  });
  const slowest = Math.max(...Object.values(timings));
  R.ok('T1', `Every read endpoint answers well within the function limit (slowest ${slowest} ms)`, slowest < (LIVE ? 10000 : 2000), JSON.stringify(timings));
  fs.writeFileSync(OUT.replace('.json', '-timings.json'), JSON.stringify({ timings, retrain_seconds: trainSecs }, null, 2));
  await page.ctx.close();

  // ------------------------------------------------------------ 14. Viewer
  const vp = await newPage(browser);
  await login(vp, 'viewer@machinemd.com', 'Viewer@123');
  R.ok('V1', 'Viewer can sign in', (await vp.$eval('[data-testid=role-label]', (e) => e.textContent)) === 'Viewer');
  const navText = await vp.$eval('nav', (e) => e.innerText);
  R.ok('V2', 'Users page is hidden from the viewer navigation', !navText.includes('Users'));
  await go(vp, '/users');
  R.ok('V3', 'Viewer opening /users is redirected away', !(await text(vp)).includes('Add user'));
  await go(vp, '/machines');
  R.ok('V4', 'Machines page hides Add / Edit / Delete for the viewer', !(await vp.$('[data-testid=add-machine]')) && !(await vp.$('[aria-label^="Delete "]')));
  await go(vp, `/machines/${top.machine_id}`);
  R.ok('V5', 'Machine detail hides "Log maintenance" for the viewer', !(await vp.$('[data-testid=log-maintenance]')));
  await go(vp, '/alerts');
  R.ok('V6', 'Alerts page hides Acknowledge for the viewer and shows a read-only notice', !(await vp.$('[data-testid=ack-button]')) && !!(await vp.$('[data-testid=viewer-notice]')));
  await shot(vp, `${prefix}WORKING-13-viewer-alerts-readonly`);
  await go(vp, '/model-lab');
  R.ok('V7', 'Model Lab hides retrain and activate for the viewer', !(await vp.$('[data-testid=retrain-open]')) && !(await vp.$('[data-testid^=activate-]')));
  await go(vp, '/data');
  R.ok('V8', 'Data page hides upload for the viewer', !(await vp.$('[data-testid=upload-input]')) && !!(await vp.$('[data-testid=viewer-notice]')));
  await go(vp, '/maintenance');
  R.ok('V9', 'Maintenance page hides add/edit for the viewer', !(await vp.$('[data-testid=add-maintenance]')) && !(await vp.$('[data-testid=edit-maintenance]')));
  await go(vp, '/settings');
  R.ok('V10', 'Threshold sliders are disabled for the viewer', await vp.$eval('[data-testid=th-medium]', (e) => e.disabled));
  const blocked = [];
  for (const [mth, p, body] of [
    ['POST', '/machines', { code: 'X-1', name: 'Xx', type: 'Pump', location: 'L1', install_date: '2020-01-01' }],
    ['DELETE', '/machines/1'],
    ['POST', '/models/retrain', {}],
    ['POST', '/models/v2/activate'],
    ['POST', '/maintenance', { machine_id: 1, issue: 'abc', action_taken: 'abc', cost: 1, date: '2026-01-01', technician: 'Me' }],
    ['POST', `/alerts/${activeAlerts[0]?.id || 1}/acknowledge`],
    ['PUT', '/settings/thresholds', { medium: 0.2, high: 0.5 }],
    ['GET', '/users'],
  ]) {
    const r = await api(vp, mth, p, body);
    blocked.push(`${mth} ${p}=${r.status}`);
  }
  R.ok('V11', 'API blocks every viewer write with 403', blocked.every((b) => b.endsWith('=403')), blocked.join(', '));
  collect(vp, 'viewer');
  await vp.ctx.close();

  // ------------------------------------------------------------ 15. Mobile + dark spot checks
  const mp = await newPage(browser, { width: 390, height: 844, mobile: true, dark: true });
  await login(mp, 'admin@machinemd.com', 'Admin@123');
  const widths = {};
  for (const r of ['/', '/machines', `/machines/${top.machine_id}`, '/model-lab', '/what-if', '/alerts', '/maintenance', '/reports', '/data', '/settings', '/users']) {
    await go(mp, r);
    widths[r] = await overflowX(mp);
  }
  R.ok('RS1', 'No horizontal overflow on any page at 390 px (mobile, dark)', Object.values(widths).every((w) => w <= 0), JSON.stringify(widths));
  await go(mp, '/');
  await shot(mp, `${prefix}WORKING-14-mobile-dark-dashboard`);
  await mp.click('[data-testid=menu-button]');
  await sleep(300);
  await shot(mp, `${prefix}WORKING-15-mobile-menu`);
  collect(mp, 'mobile');
  await mp.ctx.close();

  R.ok('E1', 'No console errors, page errors, 5xx responses or failed requests during the run', problems.length === 0, problems.join(' | '));
  // Every 4xx seen must be one of the deliberate negative tests (wrong password, viewer write probes, /users redirect).
  const deliberate = (e) => / 401 POST \/api\/auth\/login$/.test(e) || e.startsWith('viewer: 403 ');
  const unexpected = clientErrors.filter((e) => !deliberate(e));
  console.log('4xx seen:', clientErrors.join(' | '));
  R.ok('E2', `Only deliberate 4xx responses occurred (${clientErrors.length}: wrong-password login + viewer write probes)`, unexpected.length === 0, unexpected.join(' | '));
} catch (e) {
  R.ok('FATAL', `Run aborted: ${e.message}`, false, e.stack);
} finally {
  await browser.close();
  R.save(OUT);
}
