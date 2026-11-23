import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import Icon from './Icon';
import { useAuth } from '../lib/auth';
import { onSlowChange } from '../lib/api';
import { useTheme } from '../lib/theme';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/machines', label: 'Machines', icon: 'machines' },
  { to: '/alerts', label: 'Alerts', icon: 'alerts' },
  { to: '/maintenance', label: 'Maintenance', icon: 'maintenance' },
  { to: '/what-if', label: 'What-if simulator', icon: 'whatif' },
  { to: '/model-lab', label: 'Model Lab', icon: 'lab' },
  { to: '/data', label: 'Data', icon: 'data' },
  { to: '/reports', label: 'Reports', icon: 'reports' },
  { to: '/users', label: 'Users', icon: 'users', admin: true },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Logo({ className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-white shadow-sm">
        <Icon name="pulse" className="h-5 w-5" strokeWidth={2.4} />
      </div>
      <div className="leading-tight">
        <p className="text-[15px] font-bold tracking-tight">MachineMD</p>
        <p className="text-[10.5px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">Predictive maintenance</p>
      </div>
    </div>
  );
}

function Sidebar({ onNavigate }) {
  const { isAdmin } = useAuth();
  return (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="px-4 py-4">
        <Logo />
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={n.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-100' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'}`
              }
            >
              <Icon name={n.icon} className="h-[18px] w-[18px]" />
              {n.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        MachineMD v1.0 · synthetic demo data
      </div>
    </nav>
  );
}

function StorageBanner() {
  const [hidden, setHidden] = useState(() => sessionStorage.getItem('machinemd-storage-note') === 'hidden');
  if (hidden) return null;
  return (
    <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:items-center dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100" data-testid="storage-banner">
      <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
      <p className="flex-1">
        <strong>Demo storage is temporary.</strong> On the hosted version data lives in the server's /tmp folder, so uploads, edits and retrained models reset when the server restarts.
      </p>
      <button
        className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
        aria-label="Hide storage note"
        onClick={() => {
          sessionStorage.setItem('machinemd-storage-note', 'hidden');
          setHidden(true);
        }}
      >
        <Icon name="close" className="h-4 w-4" />
      </button>
    </div>
  );
}

function SlowBar() {
  const [slow, setSlow] = useState(false);
  useEffect(() => onSlowChange(setSlow), []);
  if (!slow) return null;
  return (
    <div className="fixed top-3 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-lg dark:bg-white dark:text-slate-900" role="status">
      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-brand-400" />
      Waking up the server, please wait...
    </div>
  );
}

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const { dark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <div className="min-h-screen lg:pl-64">
      <SlowBar />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl dark:bg-slate-900">
            <button className="btn-ghost btn-sm absolute top-4 right-3" onClick={() => setOpen(false)} aria-label="Close menu">
              <Icon name="close" className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-6">
          <button className="btn-ghost btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu" data-testid="menu-button">
            <Icon name="menu" />
          </button>
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="flex-1" />
          <button className="btn-ghost btn-sm" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'} data-testid="theme-toggle">
            <Icon name={dark ? 'sun' : 'moon'} className="h-[18px] w-[18px]" />
          </button>
          <div className="hidden items-center gap-2.5 border-l border-slate-200 pl-3 sm:flex dark:border-slate-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-100">
              {(user?.name || '?').split(' ').map((p) => p[0]).join('').slice(0, 2)}
            </div>
            <div className="leading-tight">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {user?.email} · <span className={isAdmin ? 'text-brand-700 dark:text-brand-300' : ''} data-testid="role-label">{isAdmin ? 'Admin' : 'Viewer'}</span>
              </p>
            </div>
          </div>
          <button className="btn-ghost btn-sm" onClick={logout} aria-label="Sign out" title="Sign out" data-testid="logout">
            <Icon name="logout" className="h-[18px] w-[18px]" />
            <span className="hidden md:inline">Sign out</span>
          </button>
        </div>
        <StorageBanner />
      </header>
      {/* pb-28 keeps the last table row clear of the toast stack at the bottom-right (BUG-04). */}
      <main className="mx-auto max-w-[1400px] px-3 pt-5 pb-28 sm:px-6 sm:pt-6">
        <Outlet />
      </main>
    </div>
  );
}
