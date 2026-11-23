import { Link } from 'react-router-dom';
import Icon from './Icon';
import { healthColor, RISK_COLORS } from '../lib/format';

export function RiskBadge({ level }) {
  if (!level) return <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">No data</span>;
  const cls = {
    High: 'bg-red-100 text-red-800 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900',
    Medium: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900',
    Low: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900',
  }[level];
  return (
    <span className={`badge ${cls}`} data-risk={level}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_COLORS[level] }} />
      {level}
    </span>
  );
}

export function StatusBadge({ status }) {
  const cls = {
    Open: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
    Acknowledged: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    Handled: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    Completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    'In Progress': 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    Scheduled: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
    Active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    'Under Maintenance': 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    Inactive: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  }[status] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function HealthBar({ value, compact = false }) {
  if (value == null) return <span className="muted text-xs">—</span>;
  return (
    <div className={`flex items-center gap-2 ${compact ? 'min-w-24' : 'min-w-32'}`} title={`Health score ${value}/100`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="Health score">
        <div className="h-full rounded-full" style={{ width: `${Math.max(value, 2)}%`, background: healthColor(value) }} />
      </div>
      <span className="tabular w-8 text-right text-xs font-semibold">{value}</span>
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }) {
  return <div className={`skeleton ${className}`} />;
}

export function CardSkeleton({ rows = 4, className = '' }) {
  return (
    <div className={`card card-pad space-y-3 ${className}`} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" />
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'info', title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center" data-testid="empty-state">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <Icon name={icon} />
      </div>
      <p className="font-medium">{title}</p>
      {children && <p className="muted mt-1 max-w-sm text-sm">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="card card-pad flex flex-col items-center gap-3 py-10 text-center" role="alert">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300">
        <Icon name="warning" />
      </div>
      <p className="font-medium">Could not load this data</p>
      <p className="muted max-w-md text-sm">{error?.message || 'Unknown error'}</p>
      {onRetry && (
        <button className="btn-secondary" onClick={() => onRetry()}>
          <Icon name="refresh" className="h-4 w-4" /> Try again
        </button>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="muted mb-1 inline-flex items-center gap-1 text-xs hover:text-brand-700 dark:hover:text-brand-300">
            <Icon name="arrowLeft" className="h-3.5 w-3.5" /> {back.label}
          </Link>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="muted mt-0.5 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint, icon, tone = 'slate', to, testId }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    red: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300',
    green: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300',
    brand: 'bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200',
  };
  const body = (
    <div className="card card-pad flex h-full items-start justify-between gap-3 transition-shadow hover:shadow-md" data-testid={testId}>
      <div className="min-w-0">
        <p className="muted text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className="tabular mt-1.5 text-2xl font-semibold sm:text-3xl" data-testid={testId ? `${testId}-value` : undefined}>{value}</p>
        {hint && <p className="muted mt-1 truncate text-xs">{hint}</p>}
      </div>
      {icon && (
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </div>
      )}
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

/** Read-only notice for viewers on pages with edit actions. */
export function ViewerNotice({ children = 'You have read-only access. Editing is available to admins.' }) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-200" data-testid="viewer-notice">
      <Icon name="eye" className="h-4 w-4 shrink-0" />
      {children}
    </div>
  );
}

export function Field({ label, error, children, hint, htmlFor }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p> : hint ? <p className="muted mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 dark:bg-slate-800/70" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${value === t.value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
