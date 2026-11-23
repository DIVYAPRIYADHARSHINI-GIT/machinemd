import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import { Logo } from '../components/Layout';
import { useAuth } from '../lib/auth';
import { onSlowChange } from '../lib/api';
import { useTheme } from '../lib/theme';

const DEMO = [
  { label: 'Admin', email: 'admin@machinemd.com', password: 'Admin@123', note: 'Full access' },
  { label: 'Viewer', email: 'viewer@machinemd.com', password: 'Viewer@123', note: 'Read-only' },
];

function Illustration() {
  // Original line-art: a machine with a health pulse and a falling-risk curve.
  return (
    <svg viewBox="0 0 420 260" className="w-full max-w-md" aria-hidden="true">
      <defs>
        <linearGradient id="g1" x1="0" x2="1">
          <stop offset="0" stopColor="#5eead4" stopOpacity=".9" />
          <stop offset="1" stopColor="#99f6e4" stopOpacity=".3" />
        </linearGradient>
      </defs>
      <rect x="30" y="120" width="170" height="96" rx="14" fill="none" stroke="#99f6e4" strokeWidth="2.5" />
      <circle cx="80" cy="168" r="26" fill="none" stroke="#99f6e4" strokeWidth="2.5" />
      <circle cx="80" cy="168" r="8" fill="#5eead4" />
      <path d="M120 150h56M120 168h44M120 186h50" stroke="#5eead4" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M50 216v18m130-18v18" stroke="#99f6e4" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M30 86h40l12-30 20 58 16-40 10 12h40" fill="none" stroke="url(#g1)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="236" y="40" width="160" height="176" rx="14" fill="#0f766e" fillOpacity=".35" stroke="#5eead4" strokeOpacity=".5" />
      <text x="252" y="68" fill="#ccfbf1" fontSize="12" fontFamily="Inter, sans-serif" fontWeight="600">Health score</text>
      <text x="252" y="104" fill="#fff" fontSize="34" fontFamily="Inter, sans-serif" fontWeight="700">92</text>
      <text x="300" y="104" fill="#99f6e4" fontSize="13" fontFamily="Inter, sans-serif">/100</text>
      <path d="M252 180c22-4 30-30 52-30s26 18 44 12 22-28 32-32" fill="none" stroke="#5eead4" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M252 196h128" stroke="#5eead4" strokeOpacity=".4" />
      <circle cx="380" cy="130" r="4" fill="#fff" />
    </svg>
  );
}

export default function Login() {
  const { user, login, expiredMessage } = useAuth();
  const { dark, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [showPw, setShowPw] = useState(false);

  useEffect(() => onSlowChange(setSlow), []);
  // Warm the serverless function while the user types (cold start on Vercel).
  useEffect(() => {
    fetch('/api/health').catch(() => {});
  }, []);

  if (user) return <Navigate to={loc.state?.from || '/'} replace />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your e-mail and password.');
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      nav(loc.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-800 via-brand-900 to-slate-950 p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
            <Icon name="pulse" className="h-5 w-5" strokeWidth={2.4} />
          </div>
          <span className="text-lg font-bold">MachineMD</span>
        </div>
        <div>
          <h1 className="max-w-md text-3xl leading-tight font-semibold">Know which machine will fail before it does.</h1>
          <p className="mt-3 max-w-md text-brand-100/90">
            Failure risk, health score, remaining useful life and anomaly detection for pumps, motors, compressors and AC units, with an explanation for every prediction.
          </p>
          <div className="mt-8">
            <Illustration />
          </div>
        </div>
        <p className="text-xs text-brand-100/70">Demo application with synthetic sensor data.</p>
      </div>

      <div className="flex flex-col">
        <div className="flex justify-end p-4">
          <button className="btn-ghost btn-sm" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            <Icon name={dark ? 'sun' : 'moon'} className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-10">
          <div className="w-full max-w-sm">
            <Logo className="mb-8 lg:hidden" />
            <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="muted mt-1 text-sm">Use your MachineMD account or a demo login below.</p>

            {expiredMessage && !error && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">{expiredMessage}</div>
            )}

            <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
              <div>
                <label htmlFor="email" className="label">
                  E-mail
                </label>
                <input id="email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </div>
              <div>
                <label htmlFor="password" className="label">
                  Password
                </label>
                <div className="relative">
                  <input id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" className="input pr-16" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" onClick={() => setShowPw((s) => !s)}>
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200" role="alert" data-testid="login-error">
                  <Icon name="warning" className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
              <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>
                {busy ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
              {busy && slow && (
                <p className="flex items-center justify-center gap-2 text-center text-sm text-brand-700 dark:text-brand-300" role="status" data-testid="waking">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
                  Waking up the server, please wait...
                </p>
              )}
            </form>

            <div className="mt-8">
              <p className="muted mb-2 text-xs font-medium tracking-wide uppercase">Demo accounts</p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO.map((d) => (
                  <button
                    key={d.email}
                    type="button"
                    className="card rounded-lg px-3 py-2.5 text-left transition-colors hover:border-brand-400 dark:hover:border-brand-600"
                    onClick={() => {
                      setEmail(d.email);
                      setPassword(d.password);
                      setError('');
                    }}
                    data-testid={`demo-${d.label.toLowerCase()}`}
                  >
                    <p className="text-sm font-semibold">{d.label}</p>
                    <p className="muted truncate text-[11px]">{d.email}</p>
                    <p className="muted text-[11px]">
                      {d.password} · {d.note}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
