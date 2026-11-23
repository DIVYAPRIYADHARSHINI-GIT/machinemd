// Find elements that stick out past the viewport on a mobile width. Usage: node overflow.mjs /route [shotName]
import { go, launch, login, newPage, overflowX, shot } from './lib.mjs';

const routes = process.argv[2] ? [process.argv[2]] : ['/', '/reports'];
const browser = await launch();
const page = await newPage(browser, { width: 390, height: 844, mobile: true });
await login(page, 'admin@machinemd.com', 'Admin@123');
for (const r of routes) {
  await go(page, r);
  const culprits = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.right > W + 1 && b.width > 0) {
        const parentOver = el.parentElement && el.parentElement.getBoundingClientRect().right > W + 1;
        if (!parentOver) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} right=${Math.round(b.right)} text="${el.textContent.trim().slice(0, 40)}"`);
      }
    }
    return out.slice(0, 10);
  });
  console.log(r, 'overflowX', await overflowX(page), '\n ', culprits.join('\n  '));
  if (process.argv[3]) {
    await page.evaluate(() => window.scrollTo(document.documentElement.scrollWidth, 0));
    console.log('shot', await shot(page, process.argv[3]));
  }
}
await browser.close();
