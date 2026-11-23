import { useEffect, useState } from 'react';
import { Field } from './ui';
import { Modal, useToast } from './feedback';
import { api } from '../lib/api';
import { today } from '../lib/format';

const STATUSES = ['Scheduled', 'In Progress', 'Completed'];

export default function MaintenanceForm({ open, onClose, record, machines = [], machineId, presetIssue = '', onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      record
        ? { machine_id: String(record.machine_id), issue: record.issue, action_taken: record.action_taken, cost: String(record.cost), date: record.date, technician: record.technician, status: record.status }
        : { machine_id: machineId ? String(machineId) : '', issue: presetIssue, action_taken: '', cost: '', date: today(), technician: '', status: 'Completed' },
    );
  }, [open, record, machineId, presetIssue]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e = {};
    if (!form.machine_id) e.machine_id = 'Choose a machine';
    if ((form.issue || '').trim().length < 3) e.issue = 'Describe the issue (at least 3 characters)';
    if ((form.action_taken || '').trim().length < 3) e.action_taken = 'Describe the action taken (at least 3 characters)';
    const c = Number(form.cost);
    if (form.cost === '' || Number.isNaN(c) || c < 0) e.cost = 'Enter a cost of 0 or more';
    if (!form.date) e.date = 'Date is required';
    if ((form.technician || '').trim().length < 2) e.technician = 'Technician is required';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    const body = { ...form, machine_id: Number(form.machine_id), cost: Number(form.cost), issue: form.issue.trim(), action_taken: form.action_taken.trim(), technician: form.technician.trim() };
    try {
      const res = record ? await api(`/maintenance/${record.id}`, { method: 'PUT', body }) : await api('/maintenance', { method: 'POST', body });
      toast.success(record ? 'Maintenance record updated' : res.alerts_handled ? `Maintenance logged. ${res.alerts_handled} open alert marked as handled.` : 'Maintenance logged');
      onSaved?.(res);
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
      title={record ? `Edit maintenance #${record.id}` : 'Log maintenance'}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy} data-testid="maintenance-save">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Machine" error={errors.machine_id} htmlFor="mt-machine">
            <select id="mt-machine" className="input" value={form.machine_id || ''} onChange={set('machine_id')} disabled={!!machineId && !record}>
              <option value="">Select a machine…</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} · {m.name}
                  {m.prediction?.risk_level === 'High' ? ' (High risk)' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Issue" error={errors.issue} htmlFor="mt-issue">
            <input id="mt-issue" className="input" value={form.issue || ''} onChange={set('issue')} placeholder="High vibration on drive-end bearing" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Action taken" error={errors.action_taken} htmlFor="mt-action">
            <textarea id="mt-action" rows={3} className="input" value={form.action_taken || ''} onChange={set('action_taken')} placeholder="Replaced bearing, realigned coupling" />
          </Field>
        </div>
        <Field label="Cost (₹)" error={errors.cost} htmlFor="mt-cost">
          <input id="mt-cost" type="number" min="0" step="100" inputMode="decimal" className="input" value={form.cost ?? ''} onChange={set('cost')} />
        </Field>
        <Field label="Date" error={errors.date} htmlFor="mt-date">
          <input id="mt-date" type="date" className="input" value={form.date || ''} onChange={set('date')} />
        </Field>
        <Field label="Technician" error={errors.technician} htmlFor="mt-tech">
          <input id="mt-tech" className="input" value={form.technician || ''} onChange={set('technician')} placeholder="R. Kumar" />
        </Field>
        <Field label="Status" htmlFor="mt-status">
          <select id="mt-status" className="input" value={form.status || 'Completed'} onChange={set('status')}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      {!record && <p className="muted mt-4 text-xs">Logging maintenance on a machine with an open alert marks that alert as handled.</p>}
    </Modal>
  );
}
