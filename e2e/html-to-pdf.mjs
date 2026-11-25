// Print an HTML file in reports/ to an A4 PDF with headless Chrome.
// Usage: node html-to-pdf.mjs MachineMD_Progress_Report_25-11-2026.html "Footer text"
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './lib.mjs';

const [file, footer = 'MachineMD | Progress Report'] = process.argv.slice(2);
const src = path.resolve('../reports', file);
const browser = await launch();
const page = await browser.newPage();
await page.goto(`file://${src}`, { waitUntil: 'load' });
const missing = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
const out = src.replace(/\.html$/, '.pdf');
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="font-size:7.5pt;color:#888;width:100%;padding:0 18mm;text-align:right">${footer} | Page <span class="pageNumber"></span></div>`,
  margin: { top: '18mm', bottom: '18mm', left: '20mm', right: '20mm' },
});
await browser.close();
console.log(`Wrote ${out} (${fs.statSync(out).size.toLocaleString()} bytes); missing images: ${missing.length ? missing.join(', ') : 0}`);
