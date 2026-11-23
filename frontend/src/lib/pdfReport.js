// Fleet report PDF, generated in the browser with jsPDF (no server-side PDF library needed).
// jsPDF is imported lazily so it only downloads when a report is generated.

const BRAND = [15, 118, 110];
const RISK_RGB = { High: [220, 38, 38], Medium: [217, 119, 6], Low: [22, 163, 74] };
// Helvetica in jsPDF has no rupee glyph - use "Rs." in the PDF.
const money = (v) => `Rs. ${Math.round(v).toLocaleString('en-IN')}`;
const pct = (p, d = 0) => `${(p * 100).toFixed(d)}%`;

export async function buildFleetReport(r, { author }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 0;

  // Header band
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 70, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('MachineMD', M, 32);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Fleet health report', M, 51);
  const gen = new Date(`${r.generated_at}Z`);
  doc.setFontSize(9);
  doc.text(`Generated ${gen.toLocaleString('en-IN')}`, W - M, 32, { align: 'right' });
  doc.text(`By ${author}`, W - M, 47, { align: 'right' });
  doc.setTextColor(15, 23, 42);
  y = 100;

  const h2 = (t) => {
    if (y > 740) {
      doc.addPage();
      y = 50;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...BRAND);
    doc.text(t, M, y);
    doc.setDrawColor(204, 251, 241);
    doc.setLineWidth(1.5);
    doc.line(M, y + 5, W - M, y + 5);
    doc.setTextColor(15, 23, 42);
    y += 22;
  };

  // 1. Fleet summary - KPI boxes
  h2('1. Fleet health summary');
  const f = r.fleet;
  const kpis = [
    ['Machines', String(f.machines)],
    ['High risk', String(f.distribution.High)],
    ['Medium risk', String(f.distribution.Medium)],
    ['Low risk', String(f.distribution.Low)],
    ['Avg health', f.avg_health_score == null ? '-' : String(f.avg_health_score)],
    ['Open alerts', String(f.open_alerts)],
  ];
  const bw = (W - 2 * M - 5 * 8) / 6;
  kpis.forEach(([label, val], i) => {
    const x = M + i * (bw + 8);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, bw, 50, 4, 4, 'FD');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(label.toUpperCase(), x + 8, y + 15);
    doc.setFontSize(17);
    doc.setFont('helvetica', 'bold');
    const c = label === 'High risk' ? RISK_RGB.High : label === 'Medium risk' ? RISK_RGB.Medium : label === 'Low risk' ? RISK_RGB.Low : [15, 23, 42];
    doc.setTextColor(...c);
    doc.text(val, x + 8, y + 38);
    doc.setFont('helvetica', 'normal');
  });
  doc.setTextColor(15, 23, 42);
  y += 64;
  // Risk distribution bar
  const total = f.distribution.High + f.distribution.Medium + f.distribution.Low || 1;
  let x = M;
  ['High', 'Medium', 'Low'].forEach((lvl) => {
    const w = ((W - 2 * M) * f.distribution[lvl]) / total;
    if (w > 0) {
      doc.setFillColor(...RISK_RGB[lvl]);
      doc.rect(x, y, w, 10, 'F');
      x += w;
    }
  });
  y += 24;
  doc.setFontSize(9.5);
  doc.text(`${f.readings.toLocaleString('en-IN')} sensor readings analysed. ${f.anomalies} machine(s) currently show an anomalous sensor pattern.`, M, y);
  y += 22;

  // 2. High-risk machines
  h2('2. High- and medium-risk machines');
  if (r.high_risk.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Machine', 'Type', 'Location', 'Risk', 'Failure prob.', 'Health', 'RUL', 'Main drivers']],
      body: r.high_risk.map((m) => [`${m.code}\n${m.name}`, m.type, m.location, m.risk_level, pct(m.failure_probability, 1), String(m.health_score), m.rul_days >= 13.95 ? '>14 d' : `${m.rul_days.toFixed(1)} d`, m.drivers.join(', ') || '-']),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: BRAND, fontSize: 8 },
      columnStyles: { 3: { fontStyle: 'bold' } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 3) d.cell.styles.textColor = RISK_RGB[d.cell.raw] || [15, 23, 42];
      },
    });
    y = doc.lastAutoTable.finalY + 24;
  } else {
    doc.setFontSize(10);
    doc.text('No machines are currently at medium or high risk.', M, y);
    y += 24;
  }

  // 3. Model performance
  h2('3. Model performance');
  const mdl = r.model;
  if (mdl) {
    doc.setFontSize(9.5);
    doc.text(`Active model ${mdl.version} (serving: ${mdl.primary_label}), trained ${new Date(`${mdl.created_at}Z`).toLocaleDateString('en-IN')}. Evaluated on the held-out future period`, M, y);
    y += 13;
    doc.text(`(${mdl.data.test_rows.toLocaleString('en-IN')} readings, ${mdl.data.test_positive} within 7 days of a failure). Train/test split is chronological with a ${mdl.data.gap_days}-day gap.`, M, y);
    y += 8;
    const names = { rf: 'Random Forest', gb: 'Gradient Boosting' };
    autoTable(doc, {
      startY: y + 6,
      margin: { left: M, right: M },
      head: [['Model', 'Accuracy', 'Precision', 'Recall', 'F1', 'ROC-AUC', 'PR-AUC', 'TP / FP / FN / TN']],
      body: ['rf', 'gb'].map((k) => {
        const m = mdl.metrics[k];
        const cm = m.confusion_matrix;
        return [`${names[k]}${k === mdl.primary ? ' (serving)' : ''}`, m.accuracy.toFixed(3), m.precision.toFixed(3), m.recall.toFixed(3), m.f1.toFixed(3), m.roc_auc.toFixed(3), m.pr_auc.toFixed(3), `${cm.tp} / ${cm.fp} / ${cm.fn} / ${cm.tn}`];
      }),
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: BRAND, fontSize: 8 },
    });
    y = doc.lastAutoTable.finalY + 14;
    doc.setFontSize(9.5);
    doc.text(`Remaining useful life regressor: MAE ${mdl.rul.mae_days} days (constant-guess baseline ${mdl.rul.baseline_mae_days} days), R2 ${mdl.rul.r2}.`, M, y);
    y += 14;
    doc.text(`Most important sensors: ${mdl.top_sensors.slice(0, 4).map((s) => `${s.sensor.replace('_', ' ')} (${(s.importance * 100).toFixed(0)}%)`).join(', ')}.`, M, y);
    y += 24;
  }

  // 4. Maintenance cost
  h2('4. Maintenance cost');
  const mt = r.maintenance;
  doc.setFontSize(9.5);
  doc.text(`${mt.records} maintenance records, total ${money(mt.total_cost)}; ${mt.open_jobs} job(s) scheduled or in progress.`, M, y);
  y += 8;
  autoTable(doc, {
    startY: y + 6,
    margin: { left: M, right: W / 2 + 10 },
    head: [['Machine type', 'Records', 'Cost']],
    body: mt.by_type.map((t) => [t.type, String(t.records), money(t.cost)]),
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: BRAND, fontSize: 8 },
  });
  const left = doc.lastAutoTable.finalY;
  autoTable(doc, {
    startY: y + 6,
    margin: { left: W / 2 + 10, right: M },
    head: [['Month', 'Cost']],
    body: mt.by_month.map((m) => [m.month, money(m.cost)]),
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: BRAND, fontSize: 8 },
  });
  y = Math.max(left, doc.lastAutoTable.finalY) + 24;

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text('MachineMD - synthetic demo data. Predictions support, not replace, engineering judgement.', M, 820);
    doc.text(`Page ${i} of ${pages}`, W - M, 820, { align: 'right' });
  }
  const stamp = gen.toISOString().slice(0, 10);
  doc.save(`MachineMD_Fleet_Report_${stamp}.pdf`);
}
