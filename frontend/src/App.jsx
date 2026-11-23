import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { CardSkeleton } from './components/ui';
import { useAuth } from './lib/auth';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Machines = lazy(() => import('./pages/Machines'));
const MachineDetail = lazy(() => import('./pages/MachineDetail'));
const DataPage = lazy(() => import('./pages/Data'));
const ModelLab = lazy(() => import('./pages/ModelLab'));
const WhatIf = lazy(() => import('./pages/WhatIf'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Maintenance = lazy(() => import('./pages/Maintenance'));
const Reports = lazy(() => import('./pages/Reports'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

function PageFallback() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}

function RequireAuth({ children, admin = false }) {
  const { user, loading, isAdmin, signedOut } = useAuth();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          <p className="muted mt-3 text-sm">Loading MachineMD…</p>
        </div>
      </div>
    );
  }
  // Only remember the page when the session ended unexpectedly (expired / deep link). After a
  // deliberate sign-out the next person should start on the dashboard, not on the previous
  // user's last page (BUG-05).
  if (!user) return <Navigate to="/login" replace state={signedOut ? undefined : { from: loc.pathname + loc.search }} />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        {[
          ['/', Dashboard],
          ['/machines', Machines],
          ['/machines/:id', MachineDetail],
          ['/data', DataPage],
          ['/model-lab', ModelLab],
          ['/what-if', WhatIf],
          ['/alerts', Alerts],
          ['/maintenance', Maintenance],
          ['/reports', Reports],
          ['/settings', Settings],
          ['*', NotFound],
        ].map(([path, C]) => (
          <Route
            key={path}
            path={path}
            element={
              <Suspense fallback={<PageFallback />}>
                <C />
              </Suspense>
            }
          />
        ))}
        <Route
          path="/users"
          element={
            <RequireAuth admin>
              <Suspense fallback={<PageFallback />}>
                <Users />
              </Suspense>
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
