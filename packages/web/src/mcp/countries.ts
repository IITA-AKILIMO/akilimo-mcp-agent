import { useCallback, useEffect, useState } from 'react';
import type { Country } from '@akilimo/shared';

// The countries AKILIMO supports. They come from the Akilimo API through this site's server
// (/api/countries) and are never written in the code, so adding a country there adds it here. The list is
// fetched once per visit and shared by every component that asks for it.
let pending: Promise<Country[]> | null = null;

function loadCountries(): Promise<Country[]> {
  if (!pending) {
    pending = fetch('/api/countries', { credentials: 'same-origin' })
      .then(async res => {
        const body = (await res.json().catch(() => ({}))) as { countries?: Country[]; error?: string };
        if (!res.ok || !Array.isArray(body.countries)) throw new Error(body.error ?? `Cannot load the countries (${res.status})`);
        return body.countries;
      });
    // A failure is not remembered: the next ask (or the Retry button) tries again
    pending.catch(() => { pending = null; });
  }
  return pending;
}

let current: Country[] = [];

export function useCountries(): { countries: Country[]; loading: boolean; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ countries: Country[]; loading: boolean; error: string | null }>({ countries: current, loading: current.length === 0, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    if (current.length === 0) setState(s => ({ ...s, loading: true, error: null }));
    loadCountries().then(
      countries => { current = countries; if (live) setState({ countries, loading: false, error: null }); },
      (e: unknown) => { if (live) setState({ countries: current, loading: false, error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { live = false; };
  }, [attempt]);

  const reload = useCallback(() => { pending = null; setAttempt(a => a + 1); }, []);
  return { ...state, reload };
}
