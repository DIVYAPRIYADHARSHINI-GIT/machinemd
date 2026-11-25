// Live-only check: does state written on one serverless instance show up on the others?
// Fires parallel reads (which makes Vercel spread them over several instances) and reports
// what each one returned. Usage: BASE_URL=https://... node live-instances.mjs [shotName]
import { api, BASE, go, launch, login, newPage, shot, sleep } from './lib.mjs';

const name = process.argv[2];
const browser = await launch();
const page = await newPage(browser);
await login(page, 'admin@machinemd.com', 'Admin@123');
const probe = async () =>
  page.evaluate(async () => {
    const H = { Authorization: `Bearer ${localStorage.getItem('machinemd-token')}` };
    // Send the change journal exactly like the app does (pass ?nojournal to see the raw problem).
    const ops = JSON.parse(localStorage.getItem('machinemd-journal') || '[]');
    if (ops.length && !window.__noJournal) {
      const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const stream = new Blob([new TextEncoder().encode(JSON.stringify(ops))]).stream().pipeThrough(new CompressionStream('deflate'));
      H['X-MachineMD-Journal'] = `z:${b64url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
    }
    const runs = await Promise.all(
      Array.from({ length: 12 }, async () => {
        const r = await fetch('/api/models', { headers: H, cache: 'no-store' });
        const inst = r.headers.get('x-machinemd-instance') || '?';
        return { status: r.status, inst, versions: r.ok ? (await r.json()).map((v) => v.version).join(',') : `HTTP ${r.status}` };
      }),
    );
    return runs;
  });
if (process.env.NO_JOURNAL) await page.evaluate(() => (window.__noJournal = true));
const retrain = await api(page, 'POST', '/models/retrain', { activate: false, notes: 'live multi-instance check' });
const created = retrain.data?.version?.version;
console.log('retrain ->', retrain.status, created);
await sleep(500);
const runs = await probe();
const seen = runs.filter((r) => r.versions.split(',').includes(created)).length;
console.log(`parallel reads that see ${created}: ${seen}/${runs.length}`);
console.log(runs.map((r) => `${r.inst}:${r.versions}`).join('\n'));
if (name) {
  await go(page, '/model-lab');
  await page.evaluate((txt, TXT_OK) => {
    const tag = document.createElement('div');
    tag.textContent = txt;
    Object.assign(tag.style, { position: 'fixed', left: '280px', top: '78px', right: '24px', background: (TXT_OK) ? '#16a34a' : '#dc2626', color: '#fff', font: '600 13px Inter, sans-serif', padding: '8px 12px', borderRadius: '8px', zIndex: 9999 });
    document.body.appendChild(tag);
  }, seen === runs.length ? `Retrained ${created}; all ${runs.length} of ${runs.length} parallel API calls see it (journal replayed on every instance)` : `Retrained ${created} a moment ago; only ${seen} of ${runs.length} parallel API calls can see it (each Vercel instance has its own /tmp database)`, seen === runs.length);
  console.log(await shot(page, name));
}
await browser.close();
process.exit(seen === runs.length ? 0 : 1);
