// Exploratory sweep: every page x (desktop light, desktop dark, mobile) - logs problems and takes scratch screenshots.
import { go, launch, login, newPage, overflowX, shot, sleep } from './lib.mjs';

const ROUTES = ['/', '/machines', '/machines/16', '/data', '/model-lab', '/what-if', '/alerts', '/maintenance', '/reports', '/users', '/settings'];
const VARIANTS = (process.env.VARIANTS || 'desktop-light,desktop-dark,mobile-light').split(',');
const OPTS = {
  'desktop-light': { width: 1440, height: 900 },
  'desktop-dark': { width: 1440, height: 900, dark: true },
  'mobile-light': { width: 390, height: 844, mobile: true },
  'mobile-dark': { width: 390, height: 844, mobile: true, dark: true },
};
const browser = await launch();
const prefix = process.env.PREFIX || 'scratch/';
for (const v of VARIANTS) {
  const page = await newPage(browser, OPTS[v]);
  await login(page, process.env.EMAIL || 'admin@machinemd.com', process.env.PASSWORD || 'Admin@123');
  for (const r of ROUTES) {
    page.problems.length = 0;
    await go(page, r);
    await sleep(500);
    const ov = await overflowX(page);
    const name = `${prefix}${v}-${r === '/' ? 'dashboard' : r.slice(1).replace(/\//g, '-')}`;
    await shot(page, name, { fullPage: true });
    console.log(`${v} ${r} overflowX=${ov} problems=${page.problems.length}${page.problems.length ? `\n   ${page.problems.join('\n   ')}` : ''}`);
  }
  await page.ctx.close();
}
await browser.close();
