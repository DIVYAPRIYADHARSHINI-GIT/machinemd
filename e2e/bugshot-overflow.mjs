// Evidence screenshot for a mobile overflow: outline elements wider than the viewport and show the page scrolled sideways.
import { go, launch, login, newPage, overflowX, shot, sleep } from './lib.mjs';

const [route, name, selectorText] = process.argv.slice(2);
const browser = await launch();
const page = await newPage(browser, { width: 390, height: 844, mobile: true });
await login(page, 'admin@machinemd.com', 'Admin@123');
await go(page, route);
const ov = await overflowX(page);
await page.evaluate((t) => {
  const W = document.documentElement.clientWidth;
  let first = null;
  for (const el of document.querySelectorAll('main *')) {
    const b = el.getBoundingClientRect();
    const p = el.parentElement.getBoundingClientRect();
    if (b.right > W + 1 && p.right <= W + 1) {
      el.style.outline = '3px solid #dc2626';
      el.style.outlineOffset = '-3px';
      if (!first && (!t || el.textContent.includes(t))) first = el;
    }
  }
  first?.scrollIntoView({ block: 'center' });
  const tag = document.createElement('div');
  tag.textContent = `Page is ${document.documentElement.scrollWidth}px wide on a ${W}px screen (overflows by ${document.documentElement.scrollWidth - W}px)`;
  Object.assign(tag.style, { position: 'fixed', left: '8px', bottom: '8px', right: '8px', background: '#dc2626', color: '#fff', font: '600 12px Inter, sans-serif', padding: '8px 10px', borderRadius: '8px', zIndex: 9999 });
  document.body.appendChild(tag);
  window.scrollBy(400, 0);
}, selectorText || '');
await sleep(300);
console.log('overflowX', ov, await shot(page, name));
await browser.close();
