import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const [expiredMessage, setExpiredMessage] = useState('');
  const [signedOut, setSignedOut] = useState(false);

  const clear = useCallback((msg = '') => {
    tokenStore.clear();
    setUser(null);
    setExpiredMessage(msg);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => clear('Your session has ended. Please sign in again.'));
    if (!tokenStore.get()) return;
    api('/auth/me')
      .then(setUser)
      .catch(() => clear())
      .finally(() => setLoading(false));
  }, [clear]);

  const login = useCallback(async (email, password) => {
    const res = await api('/auth/login', { method: 'POST', body: { email, password } });
    tokenStore.set(res.access_token);
    setExpiredMessage('');
    setSignedOut(false);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* token may already be invalid */
    }
    setSignedOut(true);
    clear();
  }, [clear]);

  const value = useMemo(() => ({ user, loading, login, logout, isAdmin: user?.role === 'admin', expiredMessage, signedOut }), [user, loading, login, logout, expiredMessage, signedOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
