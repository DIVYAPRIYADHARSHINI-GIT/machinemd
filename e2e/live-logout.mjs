// Live evidence for BUG-08: after sign-out, is the old token rejected by every Vercel instance?
// Usage: BASE_URL=https://... node live-logout.mjs [shotName]
import { BASE, launch, login, newPage, shot, sleep } from './lib.mjs';

const name = process.argv[2];
const browser = await launch();
const page = await newPage(browser);
await login(page, 'admin@machinemd.com', 'Admin@123');
const token = await page.evaluate(() => localStorage.getItem('machinemd-token'));
await page.click('[data-testid=logout]');
await page.waitForSelector('#email');
// Send the old token the way the app would (with this browser's change journal).
const results = await page.evaluate(async (t) => {
  const H = { Authorization: `Bearer ${t}` };
  const ops = JSON.parse(localStorage.getItem('machinemd-journal') || '[]');
  if (ops.length) {
    const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const stream = new Blob([new TextEncoder().encode(JSON.stringify(ops))]).stream().pipeThrough(new CompressionStream('deflate'));
    H['X-MachineMD-Journal'] = `z:${b64url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
  }
  return Promise.all(Array.from({ length: 12 }, () => fetch('/api/auth/me', { headers: H, cache: 'no-store' }).then((r) => r.status)));
}, token);
const accepted = results.filter((s) => s === 200).length;
console.log(`old token after sign-out: ${accepted}/12 parallel requests still accepted ->`, results.join(','));
if (name) {
  await page.evaluate((txt, TXT_OK) => {
    const tag = document.createElement('div');
    tag.textContent = txt;
    Object.assign(tag.style, { position: 'fixed', left: '16px', right: '16px', top: '16px', background: (TXT_OK) ? '#16a34a' : '#dc2626', color: '#fff', font: '600 13px Inter, sans-serif', padding: '10px 12px', borderRadius: '8px', zIndex: 9999 });
    document.body.appendChild(tag);
  }, accepted ? `Signed out. The old token was then sent 12 times in parallel: ${accepted}/12 accepted (${results.join(', ')}) - the logout denylist lives in one instance's /tmp database` : `Signed out. The old token was then sent 12 times in parallel: 0/12 accepted (${results.join(', ')}) - every instance applied the journaled logout`, accepted === 0);
  await sleep(200);
  console.log(await shot(page, name));
}
await browser.close();
console.log(BASE);
