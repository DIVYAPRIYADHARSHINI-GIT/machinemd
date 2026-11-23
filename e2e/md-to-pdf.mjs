// Render a Markdown file in reports/ to a styled A4 PDF with headless Chrome.
// Usage: node md-to-pdf.mjs MachineMD_Final_Report.md "Footer text"
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { launch } from './lib.mjs';

const [file, footer = 'MachineMD'] = process.argv.slice(2);
const R = path.resolve('../reports');
const md = fs.readFileSync(path.join(R, file), 'utf8');
const css = `
  body { font: 10pt/1.5 -apple-system, 'Segoe UI', Inter, Helvetica, Arial, sans-serif; color: #0f172a; }
  h1 { font-size: 24pt; color: #0f766e; margin: 0 0 4pt; }
  h1 + p strong { font-size: 11.5pt; color: #475569; }
  h2 { font-size: 15pt; color: #115e59; border-bottom: 2px solid #99f6e4; padding-bottom: 3pt; margin-top: 20pt; break-after: avoid; }
  h3 { font-size: 11.5pt; color: #1e293b; margin: 14pt 0 4pt; break-after: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 8.4pt; }
  th, td { border: 1px solid #cbd5e1; padding: 3.5pt 5pt; text-align: left; vertical-align: top; }
  th { background: #f0fdfa; color: #134e4a; }
  tr { break-inside: avoid; }
  code { background: #f1f5f9; padding: 0 3pt; border-radius: 3px; font-size: 8.3pt; }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8pt; font-size: 8pt; line-height: 1.35; break-inside: avoid; }
  pre code { background: none; padding: 0; }
  ul, ol { padding-left: 16pt; } li { margin: 2pt 0; }
  hr { border: 0; border-top: 1px solid #e2e8f0; margin: 14pt 0; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; break-inside: avoid; margin: 6pt 0 10pt; }
  figure { margin: 0; break-inside: avoid; }
  figure img { width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; }
  .pair img { max-height: 210pt; object-fit: contain; object-position: top; background: #f8fafc; }
  .shot { margin: 8pt 0 12pt; } .shot img { max-height: 360pt; object-fit: contain; object-position: top left; }
  figcaption { font-size: 7.8pt; color: #64748b; margin-top: 2pt; }
  a { color: #0f766e; }
`;
const htmlPath = path.join(R, '.tmp-render.html');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${marked.parse(md)}</body></html>`);
const browser = await launch();
const page = await browser.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
const missing = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
const out = path.join(R, file.replace(/\.md$/, '.pdf'));
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="font-size:7.5pt;color:#94a3b8;width:100%;padding:0 14mm;display:flex;justify-content:space-between"><span>${footer}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  margin: { top: '15mm', bottom: '17mm', left: '13mm', right: '13mm' },
});
await browser.close();
fs.unlinkSync(htmlPath);
console.log(`Wrote ${out}; missing images: ${missing.length ? missing.join(', ') : 0}`);
