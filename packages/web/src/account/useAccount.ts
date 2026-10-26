import { useCallback, useEffect, useState } from 'react';
import { getStatus, signIn, signOut, signUp, type User } from './api';

// Signed-in user, if any. `enabled` is false when the server has no database (guest-only)
export function useAccount() {
  const [enabled, setEnabled] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getStatus()
      .then(s => { setEnabled(s.enabled); setUser(s.user); })
      .catch(() => setEnabled(false))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setUser((await signIn(email, password)).user);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    setUser((await signUp(name, email, password)).user);
  }, []);

  const logout = useCallback(async () => {
    await signOut().catch(() => undefined);
    setUser(null);
  }, []);

  return { enabled, user, ready, login, register, logout };
}
