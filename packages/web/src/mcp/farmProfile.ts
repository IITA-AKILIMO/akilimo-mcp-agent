import { useCallback, useEffect, useState } from 'react';
import { FarmProfileSchema, type FarmProfile } from '@akilimo/shared';
import { deleteFarmProfile, getFarmProfile, saveFarmProfile } from '../account/api';
import { read, write } from './keys';

// The details a farmer already gave for a country (location, size, prices, ...), so the forms start filled in. A signed-in
// user's are kept in their account (they follow them to other devices); for a guest, or on a server without accounts, they
// stay in this browser. Loaded once per country; the forms save them when a step is finished and the user agreed.
export type FarmStore = 'account' | 'browser';

const VALID_COUNTRY = /^[A-Za-z]{2}$/; // only a real ISO 2-letter code is looked up or saved
const localKey = (country: string) => `farm-profile-${country.toUpperCase()}`;
const REMEMBER_KEY = 'farm-profile-remember';

// A damaged or old value in the browser is ignored, never shown to the forms
const readLocal = (country: string): FarmProfile | null => {
  const parsed = FarmProfileSchema.safeParse(read<unknown>(localKey(country), null));
  return parsed.success ? parsed.data : null;
};

// Whether the user wants their details remembered (on by default; remembered in this browser)
export const readRemember = () => read<boolean>(REMEMBER_KEY, true);
export const writeRemember = (on: boolean) => write(REMEMBER_KEY, on);

export function useFarmProfile(country: string) {
  const [profile, setProfile] = useState<FarmProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [store, setStore] = useState<FarmStore>('browser');

  useEffect(() => {
    let live = true;
    setReady(false);
    // No country chosen yet: nothing to look up
    if (!VALID_COUNTRY.test(country)) { setProfile(null); setReady(true); return () => { live = false; }; }
    (async () => {
      try {
        const answer = await getFarmProfile(country);
        if (!live) return;
        setStore('account');
        setProfile(answer.profile);
      } catch {
        // Not signed in, or no accounts on this server: this browser keeps it
        if (!live) return;
        setStore('browser');
        setProfile(readLocal(country));
      }
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, [country]);

  // Adds the given details to what is already remembered (details from other forms are kept)
  const save = useCallback(async (details: FarmProfile) => {
    if (!VALID_COUNTRY.test(country)) return;
    const merged: FarmProfile = { ...(profile ?? {}), ...details };
    const checked = FarmProfileSchema.safeParse(merged);
    if (!checked.success) return; // never keep something the server would refuse
    if (store === 'account') {
      try {
        await saveFarmProfile(country, checked.data);
        setProfile(checked.data);
        return;
      } catch { /* the session ended: keep it in the browser instead */ }
    }
    write(localKey(country), checked.data);
    setProfile(checked.data);
  }, [country, profile, store]);

  const forget = useCallback(async () => {
    if (!VALID_COUNTRY.test(country)) return;
    if (store === 'account') await deleteFarmProfile(country).catch(() => undefined);
    write(localKey(country), undefined);
    setProfile(null);
  }, [country, store]);

  return { profile, ready, store, save, forget };
}

// Only the fields that have a value, so saving never wipes what another form remembered
export const defined = <T extends Record<string, unknown>>(values: T): T =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== '' && !(typeof v === 'number' && !Number.isFinite(v)))) as T;
