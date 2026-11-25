// Live probe: after "Reset demo data", does EVERY Vercel instance return to the seed?
// Imports two readings, resets, then asks 12 instances in parallel how many readings they hold.
// Usage: BASE_URL=https://... node live-reset.mjs [shotName]
import fs from 'node:fs';
import path from 'node:path';
import { api, go, launch, login, newPage, settle, shot, sleep } from './lib.mjs';

const name = process.argv[2];
const browser = await launch();
const page = await newPage(browser);
await login(page, 'admin@machinemd.com', 'Admin@123');
const ts = (h) => new Date(Date.now() + h * 3600e3).toISOString().slice(0, 13).replace('T', ' ') + ':00';
const csv = ['machine_code,timestamp,temperature,vibration,pressure,rpm,running_hours,current', `PMP-003,${ts(-20)},58,2.8,6,1750,900,18`, `PMP-004,${ts(-20)},58,2.8,6,1750,900,18`].join('\n');
fs.mkdirSync('.downloads', { recursive: true });
const f = path.resolve('.downloads/reset-probe.csv');
fs.writeFileSync(f, csv);
await go(page, '/data');
await (await page.$('[data-testid=upload-input]')).uploadFile(f);
await page.waitForSelector('[data-testid=import-button]');
await settle(page);
await page.click('[data-testid=import-button]');
await page.waitForSelector('[data-testid=import-done]', { timeout: 30000 });
const reset = await api(page, 'POST', '/admin/reset-demo');
await sleep(500);
const totals = await page.evaluate(async () => {
  const H = { Authorization: `Bearer ${localStorage.getItem('machinemd-token')}` };
  const ops = JSON.parse(localStorage.getItem('machinemd-journal') || '[]');
  if (ops.length) {
    const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const stream = new Blob([new TextEncoder().encode(JSON.stringify(ops))]).stream().pipeThrough(new CompressionStream('deflate'));
    H['X-MachineMD-Journal'] = `z:${b64url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
  }
  return Promise.all(Array.from({ length: 12 }, () => fetch('/api/readings?limit=1', { headers: H, cache: 'no-store' }).then((r) => r.json()).then((d) => d.total)));
});
const seedCount = totals.filter((t) => t === 10696).length;
console.log(`reset ${reset.status}; instances back at the 10,696-reading seed: ${seedCount}/12 ->`, totals.join(','));
if (name) {
  await go(page, '/data');
  await page.evaluate((txt, ok) => {
    const tag = document.createElement('div');
    tag.textContent = txt;
    Object.assign(tag.style, { position: 'fixed', left: '280px', right: '24px', top: '78px', background: ok ? '#16a34a' : '#dc2626', color: '#fff', font: '600 13px Inter, sans-serif', padding: '8px 12px', borderRadius: '8px', zIndex: 9999 });
    document.body.appendChild(tag);
  }, `After "Reset demo data": ${seedCount}/12 parallel calls report the 10,696-reading seed (${totals.join(', ')})`, seedCount === 12);
  console.log(await shot(page, name));
}
await browser.close();
process.exit(seedCount === 12 ? 0 : 1);
