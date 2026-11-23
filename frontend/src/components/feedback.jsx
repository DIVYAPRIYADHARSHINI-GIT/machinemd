import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';

/* ------------------------------------------------------------------ toasts */
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (type, message, ms = 4500) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t.slice(-3), { id, type, message }]);
      setTimeout(() => remove(id), ms);
    },
    [remove],
  );
  const api = useMemo(() => ({ success: (m) => push('success', m), error: (m) => push('error', m, 7000), info: (m) => push('info', m) }), [push]);
  const styles = {
    success: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
    error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
    info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100',
  };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} data-testid={`toast-${t.type}`} className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3.5 py-3 text-sm shadow-lg ${styles[t.type]}`}>
            <Icon name={t.type === 'success' ? 'check' : t.type === 'error' ? 'warning' : 'info'} className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{t.message}</span>
            <button className="opacity-60 hover:opacity-100" onClick={() => remove(t.id)} aria-label="Dismiss">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

/* ------------------------------------------------------------------ modal */
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null);
  const bodyRef = useRef(null);
  // Keep the latest onClose in a ref: parents usually pass an inline arrow, and re-running the
  // open/close effect on every parent render used to move focus while the user was typing (BUG-03).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const onKey = (e) => e.key === 'Escape' && closeRef.current?.();
    document.addEventListener('keydown', onKey);
    // Focus the first form field in the body - never the header close button - and only if the
    // user has not already clicked into the dialog (BUG-03: Space then pressed the close button).
    const t = setTimeout(() => {
      if (ref.current?.contains(document.activeElement)) return;
      const target = bodyRef.current?.querySelector('input:not([disabled]),select:not([disabled]),textarea') || ref.current?.querySelector('[data-autofocus], .modal-footer button');
      target?.focus();
    }, 30);
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`card flex max-h-[92vh] w-full ${width} flex-col rounded-b-none sm:rounded-xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        <div ref={bodyRef} className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="modal-footer flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ confirm */
const ConfirmContext = createContext(null);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title || 'Are you sure?'}
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => close(false)}>
              Cancel
            </button>
            <button className={state?.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)} data-testid="confirm-ok">
              {state?.confirmLabel || 'Confirm'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{state?.message}</p>
      </Modal>
    </ConfirmContext.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmContext);
