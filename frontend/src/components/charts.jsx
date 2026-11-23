import { useChartTheme } from '../lib/theme';

/** Themed tooltip content for Recharts. */
export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }) {
  const t = useChartTheme();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border px-3 py-2 text-xs shadow-lg" style={{ background: t.tooltipBg, borderColor: t.tooltipBorder, color: t.text }}>
      {label != null && <p className="mb-1 font-semibold">{labelFormatter ? labelFormatter(label, payload) : label}</p>}
      {payload
        .filter((p) => p.value != null && p.type !== 'none')
        .map((p) => (
          <p key={p.dataKey + p.name} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
            <span className="opacity-75">{p.name}:</span>
            <span className="tabular font-medium">{valueFormatter ? valueFormatter(p.value, p) : p.value}</span>
          </p>
        ))}
    </div>
  );
}

/** Semi-circle risk gauge (pure SVG). */
export function RiskGauge({ probability, thresholds = { medium: 0.3, high: 0.6 }, size = 220 }) {
  const p = Math.max(0, Math.min(1, probability ?? 0));
  const r = 80;
  const cx = 100;
  const cy = 100;
  const arc = (a0, a1) => {
    const s = Math.PI * (1 - a0);
    const e = Math.PI * (1 - a1);
    return `M ${cx + r * Math.cos(s)} ${cy - r * Math.sin(s)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(e)} ${cy - r * Math.sin(e)}`;
  };
  const ang = Math.PI * (1 - p);
  const nx = cx + (r - 14) * Math.cos(ang);
  const ny = cy - (r - 14) * Math.sin(ang);
  const color = p >= thresholds.high ? '#dc2626' : p >= thresholds.medium ? '#d97706' : '#16a34a';
  return (
    <svg viewBox="0 0 200 120" width={size} className="max-w-full" role="img" aria-label={`Failure risk ${(p * 100).toFixed(0)} percent`}>
      <path d={arc(0, thresholds.medium)} stroke="#16a34a" strokeOpacity=".25" strokeWidth="16" fill="none" />
      <path d={arc(thresholds.medium, thresholds.high)} stroke="#d97706" strokeOpacity=".25" strokeWidth="16" fill="none" />
      <path d={arc(thresholds.high, 1)} stroke="#dc2626" strokeOpacity=".25" strokeWidth="16" fill="none" />
      {p > 0.001 && <path d={arc(0, p)} stroke={color} strokeWidth="16" fill="none" strokeLinecap="butt" style={{ transition: 'all .3s' }} />}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="currentColor" strokeWidth="3" strokeLinecap="round" style={{ transition: 'all .3s' }} />
      <circle cx={cx} cy={cy} r="5" fill="currentColor" />
      <text x={cx} y={cy - 26} textAnchor="middle" fontSize="26" fontWeight="700" fill={color} data-testid="gauge-value">
        {(p * 100).toFixed(0)}%
      </text>
      <text x="20" y="116" fontSize="9" fill="currentColor" opacity=".6">0%</text>
      <text x="168" y="116" fontSize="9" fill="currentColor" opacity=".6">100%</text>
    </svg>
  );
}
