// Secondary flows: theme toggle, machine CRUD, users, thresholds, password, add reading, batch prediction, PDF content, expired session.
import fs from 'node:fs';
import path from 'node:path';
import { api, clickText, DOWNLOADS, go, launch, login, newPage, Results, settle, shot, sleep, text } from './lib.mjs';

const R = new Results('MachineMD secondary flows');
const OUT = process.argv[2] || 'results-flows.json';
const prefix = process.env.SHOT_PREFIX || 'scratch/flow-';
const browser = await launch();
try {
  const page = await newPage(browser);
  await login(page, 'admin@machinemd.com', 'Admin@123');
  await api(page, 'POST', '/admin/reset-demo');
  await login(page, 'admin@machinemd.com', 'Admin@123');

  // Theme toggle persists
  await page.click('[data-testid=theme-toggle]');
  await sleep(200);
  const darkNow = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.reload({ waitUntil: 'networkidle2' });
  const darkAfter = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  R.ok('F1', 'Dark-mode toggle switches theme and survives a reload', darkNow && darkAfter);
  await page.click('[data-testid=theme-toggle]');

  // Machine add / validation / edit / delete
  await go(page, '/machines');
  await page.click('[data-testid=add-machine]');
  await page.waitForSelector('#m-code');
  await page.click('[data-testid=machine-save]');
  await sleep(200);
  const v = await text(page);
  R.ok('F2', 'Empty machine form shows field errors', v.includes('Name is required') && v.includes('Install date is required'));
  await page.type('#m-code', 'PMP-100');
  await page.type('#m-name', 'Test Booster Pump');
  await page.type('#m-loc', 'Plant A - Line 1');
  await page.$eval('#m-date', (e) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(e, '2022-03-15');
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('[data-testid=machine-save]');
  await page.waitForSelector('[data-testid=toast-success]', { timeout: 15000 });
  await settle(page);
  R.ok('F3', 'Admin can add a machine', (await text(page)).includes('Test Booster Pump'));
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'), { timeout: 10000 });
  await sleep(300);
  const created = (await api(page, 'GET', '/machines')).data.find((m) => m.code === 'PMP-100');
  await page.click('[aria-label="Edit PMP-100"]');
  await page.waitForSelector('#m-name');
  await page.click('#m-name', { clickCount: 3 });
  await page.type('#m-name', 'Renamed Booster Pump');
  await page.click('[data-testid=machine-save]');
  await page.waitForFunction(() => document.body.innerText.includes('Renamed Booster Pump'), { timeout: 15000 });
  R.ok('F4', 'Admin can edit a machine', true);

  // Add a reading for the new machine -> it gets a prediction
  await go(page, '/data');
  await clickText(page, 'Add reading', '[role=tab]');
  await page.waitForSelector('#ar-machine');
  await page.select('#ar-machine', String(created.id));
  await page.waitForFunction(() => document.querySelector('#ar-temperature')?.value !== '', { timeout: 15000 });
  await clickText(page, 'Save reading');
  await page.waitForFunction(() => document.body.innerText.includes('Health score:'), { timeout: 15000 });
  R.ok('F5', 'Adding a single reading scores a brand-new machine', (await text(page)).includes('Low'));
  await shot(page, `${prefix}add-reading`);

  // Batch prediction (as admin; viewer covered in acceptance)
  await clickText(page, 'Batch prediction', '[role=tab]');
  const batch = 'machine_type,temperature,vibration,pressure,rpm,running_hours,current\nPump,58,2.8,6,1750,900,18\nCompressor,98,8.2,8.0,2880,2400,40\nMotor,abc,1.9,2.5,1480,900,24\n';
  const bp = path.resolve('.downloads/batch.csv');
  fs.writeFileSync(bp, batch);
  await (await page.$('[data-testid=batch-input]')).uploadFile(bp);
  await page.waitForSelector('[data-testid=batch-table]', { timeout: 20000 });
  const bt = await page.$eval('[data-testid=batch-table]', (e) => e.innerText);
  R.ok('F6', 'Batch prediction scores valid rows (healthy pump Low, hot shaky compressor High) and reports the bad row', bt.includes('Low') && bt.includes('High') && (await text(page)).includes('Line 4'), bt);
  await shot(page, `${prefix}batch`);

  // Delete the machine with confirm dialog
  await go(page, '/machines');
  await page.click('[aria-label="Delete PMP-100"]');
  await page.waitForSelector('[data-testid=confirm-ok]');
  await shot(page, `${prefix}confirm-delete`);
  await page.click('[data-testid=confirm-ok]');
  await page.waitForFunction(() => !document.body.innerText.includes('Renamed Booster Pump'), { timeout: 15000 });
  R.ok('F7', 'Delete asks for confirmation and removes the machine', true);

  // Users: create a viewer, sign in as them
  await go(page, '/users');
  await page.click('[data-testid=add-user]');
  await page.waitForSelector('#u-name');
  await page.type('#u-name', 'Plant Supervisor');
  await page.type('#u-email', 'supervisor@machinemd.com');
  await page.type('#u-pw', 'Plant2026');
  await page.click('[data-testid=user-save]');
  await page.waitForFunction(() => document.body.innerText.includes('supervisor@machinemd.com'), { timeout: 15000 });
  R.ok('F8', 'Admin can create a user', true);

  // Thresholds -> risk counts change, then restore
  const k0 = (await api(page, 'GET', '/dashboard/summary')).data.kpis;
  await api(page, 'PUT', '/settings/thresholds', { medium: 0.1, high: 0.3 });
  const k1 = (await api(page, 'GET', '/dashboard/summary')).data.kpis;
  R.ok('F9', 'Lowering thresholds increases the number of High/Medium machines', k1.high_risk + k1.medium_risk > k0.high_risk + k0.medium_risk, `${k0.high_risk}+${k0.medium_risk} -> ${k1.high_risk}+${k1.medium_risk}`);
  await go(page, '/settings');
  const label = await text(page);
  R.ok('F10', 'Settings page shows the saved thresholds', label.includes('Medium risk from 10%') && label.includes('High risk from 30%'));
  await api(page, 'PUT', '/settings/thresholds', { medium: 0.3, high: 0.6 });

  // PDF content check
  await go(page, '/reports');
  fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.pdf')).forEach((f) => fs.unlinkSync(path.join(DOWNLOADS, f)));
  await page.click('[data-testid=pdf-button]');
  let pdf;
  for (let i = 0; i < 40 && !pdf; i += 1) {
    await sleep(400);
    pdf = fs.readdirSync(DOWNLOADS).find((f) => f.endsWith('.pdf'));
  }
  fs.copyFileSync(path.join(DOWNLOADS, pdf), path.resolve('../reports/evidence-fleet-report.pdf'));
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(path.join(DOWNLOADS, pdf))) }).promise;
  let all = '';
  for (let i = 1; i <= doc.numPages; i += 1) all += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
  const need = ['Fleet health summary', 'High- and medium-risk machines', 'Model performance', 'Maintenance cost', 'Random Forest', 'Gradient Boosting'];
  R.ok('F11', 'PDF contains the 4 required sections and real model metrics', need.every((n) => all.includes(n)), need.filter((n) => !all.includes(n)).join(','));

  // Change password for the new user, then sign in with it
  const sp = await newPage(browser);
  await login(sp, 'supervisor@machinemd.com', 'Plant2026');
  await go(sp, '/settings');
  await sp.type('#pw-cur', 'Plant2026');
  await sp.type('#pw-new', 'Plant2027x');
  await sp.type('#pw-conf', 'Plant2027x');
  await clickText(sp, 'Change password', 'button[type=submit]');
  await sp.waitForSelector('[data-testid=toast-success]', { timeout: 15000 });
  await sp.click('[data-testid=logout]');
  await sp.waitForSelector('#email');
  await login(sp, 'supervisor@machinemd.com', 'Plant2027x');
  // A viewer may see a toast; the dashboard heading appears once the summary loads.
  await sp.waitForFunction(() => document.body.innerText.includes('Fleet dashboard'), { timeout: 20000 }).catch(() => {});
  const after = await text(sp);
  R.ok('F12', 'A user can change their password and sign in with the new one', sp.url().endsWith('/') && after.includes('Fleet dashboard'), `${sp.url()} ${after.slice(0, 300)}`);

  // Logout revokes token; expired/invalid session returns to login with a message
  const tok = await sp.evaluate(() => localStorage.getItem('machinemd-token'));
  await sp.click('[data-testid=logout]');
  await sp.waitForSelector('#email');
  const reuse = await sp.evaluate(async (t) => (await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })).status, tok);
  R.ok('F13', 'Logout revokes the token on the server (reuse -> 401)', reuse === 401, reuse);
  await sp.evaluate(() => localStorage.setItem('machinemd-token', 'eyJhbGciOiJIUzI1NiJ9.e30.invalid'));
  await go(sp, '/machines');
  R.ok('F14', 'An invalid/expired session sends the user back to sign in', sp.url().endsWith('/login'), sp.url());

  // Unknown route
  await go(page, '/does-not-exist');
  R.ok('F15', 'Unknown routes show a friendly 404 page', (await text(page)).includes('Page not found'));
  await sp.ctx.close();
  await page.ctx.close();
} catch (e) {
  R.ok('FATAL', `Run aborted: ${e.message}`, false, e.stack);
} finally {
  await browser.close();
  R.save(OUT);
}
