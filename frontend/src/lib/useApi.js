import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Fetch a GET endpoint; returns { data, error, loading, reload }. */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const ctrlRef = useRef(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!path) return;
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await api(path, { signal: ctrl.signal });
        if (!ctrl.signal.aborted) setState({ data, error: null, loading: false });
      } catch (e) {
        if (e.name === 'AbortError') return;
        setState((s) => ({ ...s, error: e, loading: false }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps],
  );

  useEffect(() => {
    load();
    return () => ctrlRef.current?.abort();
  }, [load]);

  return { ...state, reload: load };
}
