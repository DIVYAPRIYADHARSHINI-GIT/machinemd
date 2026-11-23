import { useState } from 'react';
import Icon from '../components/Icon';
import { Modal, useConfirm, useToast } from '../components/feedback';
import { ErrorState, Field, PageHeader, Skeleton, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dt } from '../lib/format';
import { useApi } from '../lib/useApi';

function UserForm({ open, onClose, user, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setF(user ? { name: user.name, email: user.email, role: user.role, is_active: user.is_active, password: '' } : { name: '', email: '', role: 'viewer', password: '', is_active: true });
      setErrors({});
    }
  }
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save() {
    const e = {};
    if ((f.name || '').trim().length < 2) e.name = 'Name is required';
    if (!user && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(f.email || '')) e.email = 'Enter a valid e-mail';
    if ((!user || f.password) && (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password))) e.password = 'At least 8 characters with a letter and a number';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (user) await api(`/users/${user.id}`, { method: 'PUT', body: { name: f.name.trim(), role: f.role, is_active: f.is_active, ...(f.password ? { password: f.password } : {}) } });
      else await api('/users', { method: 'POST', body: { name: f.name.trim(), email: f.email.trim(), role: f.role, password: f.password } });
      toast.success(user ? 'User updated' : `User ${f.email} created`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? `Edit ${user.email}` : 'Add user'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy} data-testid="user-save">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.name} htmlFor="u-name">
          <input id="u-name" className="input" value={f.name || ''} onChange={set('name')} />
        </Field>
        <Field label="E-mail" error={errors.email} htmlFor="u-email">
          <input id="u-email" type="email" className="input" value={f.email || ''} onChange={set('email')} disabled={!!user} />
        </Field>
        <Field label="Role" htmlFor="u-role">
          <select id="u-role" className="input" value={f.role || 'viewer'} onChange={set('role')}>
            <option value="viewer">Viewer (read-only)</option>
            <option value="admin">Admin (full access)</option>
          </select>
        </Field>
        <Field label={user ? 'New password (optional)' : 'Password'} error={errors.password} htmlFor="u-pw" hint="At least 8 characters with a letter and a number">
          <input id="u-pw" type="password" autoComplete="new-password" className="input" value={f.password || ''} onChange={set('password')} />
        </Field>
        {user && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="h-4 w-4" checked={!!f.is_active} onChange={set('is_active')} /> Account active
          </label>
        )}
      </div>
    </Modal>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi('/users');
  const [form, setForm] = useState({ open: false, user: null });

  async function remove(u) {
    const ok = await confirm({ title: `Delete ${u.email}?`, message: 'The user will no longer be able to sign in. This cannot be undone.', confirmLabel: 'Delete user', danger: true });
    if (!ok) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      toast.success(`Deleted ${u.email}`);
      reload(true);
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Admins have full access; viewers can see everything but change nothing"
        actions={
          <button className="btn-primary" onClick={() => setForm({ open: true, user: null })} data-testid="add-user">
            <Icon name="plus" className="h-4 w-4" /> Add user
          </button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="card overflow-x-auto">
          {loading && !data ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : (
            <table className="table" data-testid="users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="hidden md:table-cell">Last sign-in</th>
                  <th className="hidden md:table-cell">Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <p className="font-medium">
                        {u.name} {u.id === me.id && <span className="muted text-xs">(you)</span>}
                      </p>
                      <p className="muted text-xs">{u.email}</p>
                    </td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{u.role === 'admin' ? 'Admin' : 'Viewer'}</span>
                    </td>
                    <td>
                      <StatusBadge status={u.is_active ? 'Active' : 'Inactive'} />
                    </td>
                    <td className="hidden text-xs md:table-cell">{dt(u.last_login_at)}</td>
                    <td className="hidden text-xs md:table-cell">{dt(u.created_at)}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost btn-sm" aria-label={`Edit ${u.email}`} onClick={() => setForm({ open: true, user: u })}>
                        <Icon name="edit" className="h-4 w-4" />
                      </button>
                      {u.id !== me.id && (
                        <button className="btn-ghost btn-sm text-red-600 dark:text-red-400" aria-label={`Delete ${u.email}`} onClick={() => remove(u)}>
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <UserForm open={form.open} user={form.user} onClose={() => setForm({ open: false, user: null })} onSaved={() => reload(true)} />
    </div>
  );
}
