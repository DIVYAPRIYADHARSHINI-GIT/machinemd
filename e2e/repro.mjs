// Reproduce suspected bugs and capture "before" screenshots. Usage: node repro.mjs <bug> <shotName>
import { api, go, launch, login, newPage, shot, sleep } from './lib.mjs';

const [bug, name] = process.argv.slice(2);
const browser = await launch();
const page = await newPage(browser);
await login(page, 'admin@machinemd.com', 'Admin@123');

if (bug === 'search') {
  await go(page, '/machines');
  await page.type('[data-testid=machine-search]', 'compressor'); // normal typing speed of puppeteer (no delay)
  await sleep(500);
  const value = await page.$eval('[data-testid=machine-search]', (e) => e.value);
  const rows = (await page.$$('[data-testid=machines-table] tbody tr')).length;
  console.log({ typed: 'compressor', inputValue: value, rows });
  console.log(await shot(page, name));
}

if (bug === 'modal-focus') {
  await go(page, '/maintenance');
  await page.click('[data-testid=add-maintenance]');
  await page.waitForSelector('#mt-issue');
  await page.click('#mt-issue');
  await page.keyboard.type('Bearing noise', { delay: 40 });
  await sleep(300);
  const state = await page.evaluate(() => ({ value: document.querySelector('#mt-issue')?.value, focused: document.activeElement?.id || document.activeElement?.tagName, modalOpen: !!document.querySelector('[role=dialog]') }));
  console.log({ typed: 'Bearing noise', ...state });
  console.log(await shot(page, name));
}
await browser.close();
