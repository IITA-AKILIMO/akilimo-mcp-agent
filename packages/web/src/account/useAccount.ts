import { useCallback, useEffect, useState } from 'react';
import { getStatus, signIn, signOut, signUp, updatePreferences, type User } from './api';

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

  const login = useCallback(async (login: string, password: string) => {
    setUser((await signIn(login, password)).user);
  }, []);

  const register = useCallback(async (name: string, email: string, username: string, password: string) => {
    setUser((await signUp(name, email, username, password)).user);
  }, []);

  const logout = useCallback(async () => {
    await signOut().catch(() => undefined);
    setUser(null);
  }, []);

  // Saved to the account, so it applies to every conversation and every device the user signs in on
  const setWebSearch = useCallback(async (on: boolean) => {
    setUser((await updatePreferences({ web_search: on })).user);
  }, []);

  return { enabled, user, ready, login, register, logout, setWebSearch };
}
