import { useEffect, useState } from 'react';
import { Field } from './ui';
import { api } from '../lib/api';
import { MACHINE_TYPES, today } from '../lib/format';
import { Modal, useToast } from './feedback';

const EMPTY = { code: '', name: '', type: 'Pump', location: '', install_date: '', status: 'Active' };

export default function MachineForm({ open, onClose, machine, locations = [], onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(machine ? { code: machine.code, name: machine.name, type: machine.type, location: machine.location, install_date: machine.install_date, status: machine.status } : EMPTY);
      setErrors({});
    }
  }, [open, machine]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e = {};
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/.test(form.code.trim())) e.code = '2-30 letters, numbers, - or _ (e.g. PMP-009)';
    if (form.name.trim().length < 2) e.name = 'Name is required';
    if (form.location.trim().length < 2) e.location = 'Location is required';
    if (!form.install_date) e.install_date = 'Install date is required';
    else if (form.install_date > today()) e.install_date = 'Install date cannot be in the future';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    try {
      const body = { ...form, code: form.code.trim(), name: form.name.trim(), location: form.location.trim() };
      const res = machine ? await api(`/machines/${machine.id}`, { method: 'PUT', body }) : await api('/machines', { method: 'POST', body });
      toast.success(machine ? `Saved ${res.code}` : `Added ${res.code}. Add readings (Data page) to get predictions.`);
      onSaved?.(res);
      onClose();
    } catch (err) {
      if (err.data?.errors) {
        const e = {};
        err.data.errors.forEach((x) => (e[x.field] = x.message));
        setErrors(e);
      }
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={machine ? `Edit ${machine.code}` : 'Add machine'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy} data-testid="machine-save">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Machine code" error={errors.code} htmlFor="m-code">
          <input id="m-code" className="input" value={form.code} onChange={set('code')} placeholder="PMP-009" />
        </Field>
        <Field label="Type" error={errors.type} htmlFor="m-type">
          <select id="m-type" className="input" value={form.type} onChange={set('type')}>
            {MACHINE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Name" error={errors.name} htmlFor="m-name">
            <input id="m-name" className="input" value={form.name} onChange={set('name')} placeholder="Coolant Pump C" />
          </Field>
        </div>
        <Field label="Location" error={errors.location} htmlFor="m-loc">
          <input id="m-loc" className="input" list="m-locations" value={form.location} onChange={set('location')} placeholder="Plant A - Line 1" />
          <datalist id="m-locations">
            {locations.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </Field>
        <Field label="Install date" error={errors.install_date} htmlFor="m-date">
          <input id="m-date" type="date" className="input" max={today()} value={form.install_date} onChange={set('install_date')} />
        </Field>
        <Field label="Status" htmlFor="m-status">
          <select id="m-status" className="input" value={form.status} onChange={set('status')}>
            {['Active', 'Under Maintenance', 'Inactive'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
