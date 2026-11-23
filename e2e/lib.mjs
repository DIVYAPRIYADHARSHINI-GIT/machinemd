// Shared helpers for MachineMD browser checks (puppeteer-core + the installed Google Chrome).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
export const SHOTS = path.resolve(process.env.SHOTS_DIR || '../reports/screenshots');
export const DOWNLOADS = path.resolve('.downloads');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 180_000,
    args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1440,900'],
  });
}

/** New tab with console / page / network error capture. */
export async function newPage(browser, { width = 1440, height = 900, dark = false, mobile = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  page.problems = [];
  page.expectedHttp = 0; // deliberate 4xx probes (wrong password, viewer write attempts) bump this
  page.clientErrors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Chrome logs every 4xx as "Failed to load resource"; those are tracked separately below.
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
    page.problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText || '';
    if (!f.includes('ERR_ABORTED')) page.problems.push(`requestfailed: ${r.url()} ${f}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) page.problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
    else if (r.status() >= 400 && r.url().includes('/api/')) page.clientErrors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true, browserContextId: ctx.id }).catch((e) => page.problems.push(`download setup: ${e.message}`));
  await page.evaluateOnNewDocument((d) => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.setItem('machinemd-theme', d ? 'dark' : 'light');
      sessionStorage.setItem('e2e-init', '1');
    }
  }, dark);
  page.ctx = ctx;
  return page;
}

export async function shot(page, name, { fullPage = false } = {}) {
  await sleep(350);
  const file = path.join(SHOTS, name.endsWith('.png') ? name : `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return path.basename(file);
}

export async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  if (!(await page.$('#email'))) {
    // Already signed in from an earlier step: start from a clean session.
    await page.evaluate(() => localStorage.removeItem('machinemd-token'));
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  }
  await page.waitForSelector('#email');
  await page.$eval('#email', (el) => (el.value = ''));
  await page.type('#email', email);
  await page.type('#password', password);
  await Promise.all([page.waitForFunction(() => location.pathname !== '/login', { timeout: 90_000 }), page.click('button[type=submit]')]);
  await settle(page);
}

export async function settle(page, idle = 400) {
  await page.waitForNetworkIdle({ idleTime: idle, timeout: 30_000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .skeleton'), { timeout: 20_000 }).catch(() => {});
}

export async function go(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2' });
  await settle(page);
}

/** Click the first visible element (button/link/tab) whose text includes `text`. */
export async function clickText(page, text, selector = 'button, a, [role=tab], label') {
  const ok = await page.evaluate(
    (t, sel) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null && e.textContent.trim().includes(t));
      if (el) el.click();
      return !!el;
    },
    text,
    selector,
  );
  if (!ok) throw new Error(`No clickable element with text "${text}"`);
  await sleep(150);
}

export const text = (page) => page.evaluate(() => document.body.innerText);

/** Same journal handling as frontend/src/lib/api.js, so test calls see every instance's changes. */
export async function api(page, method, p, body) {
  return page.evaluate(
    async (m, u, b) => {
      const b64url = (bytes) => {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      };
      const headers = { Authorization: `Bearer ${localStorage.getItem('machinemd-token')}`, ...(b ? { 'Content-Type': 'application/json' } : {}) };
      const ops = JSON.parse(localStorage.getItem('machinemd-journal') || '[]');
      if (ops.length) {
        const stream = new Blob([new TextEncoder().encode(JSON.stringify(ops))]).stream().pipeThrough(new CompressionStream('deflate'));
        headers['X-MachineMD-Journal'] = `z:${b64url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
      }
      const r = await fetch(`/api${u}`, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
      const op = r.headers.get('X-MachineMD-Op');
      if (op) {
        const parsed = JSON.parse(atob(op.replace(/-/g, '+').replace(/_/g, '/')));
        const next = parsed.p === '/api/admin/reset-demo' ? [parsed] : [...ops.filter((o) => o.id !== parsed.id), parsed];
        localStorage.setItem('machinemd-journal', JSON.stringify(next));
      }
      let data = null;
      try {
        data = await r.json();
      } catch {
        /* */
      }
      return { status: r.status, data };
    },
    method,
    p,
    body,
  );
}

/** Horizontal overflow of the document (mobile layout check). */
export const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

export class Results {
  constructor(name) {
    this.name = name;
    this.items = [];
  }
  ok(id, desc, pass, detail = '') {
    this.items.push({ id, desc, pass: !!pass, detail: String(detail).slice(0, 400) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${desc}${detail && !pass ? ` -- ${detail}` : ''}`);
    return !!pass;
  }
  save(file) {
    const passed = this.items.filter((i) => i.pass).length;
    fs.writeFileSync(file, JSON.stringify({ name: this.name, base: BASE, when: new Date().toISOString(), passed, total: this.items.length, items: this.items }, null, 2));
    console.log(`\n${passed}/${this.items.length} checks passed -> ${file}`);
    return passed === this.items.length;
  }
}
