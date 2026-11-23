// Simulate a slow cold start (login request delayed 5 s) and capture the "Waking up the server" message.
import { BASE, launch, newPage, shot, sleep } from './lib.mjs';

const name = process.argv[2] || 'working/01b-login-waking-up';
const browser = await launch();
const page = await newPage(browser);
await page.setRequestInterception(true);
page.on('request', async (req) => {
  if (req.url().includes('/api/auth/login')) await sleep(5000);
  req.continue().catch(() => {});
});
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
await page.type('#email', 'admin@machinemd.com');
await page.type('#password', 'Admin@123');
await page.click('button[type=submit]');
await page.waitForSelector('[data-testid=waking]', { timeout: 8000 });
const msg = await page.$eval('[data-testid=waking]', (e) => e.textContent.trim());
console.log('message:', msg, await shot(page, name));
await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 });
console.log('signed in after delay:', page.url());
await browser.close();
