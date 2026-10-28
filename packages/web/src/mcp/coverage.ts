import { useEffect, useState } from 'react';
import { findCountry, type GeoJsonLike } from '@akilimo/shared';

// The area where AKILIMO can give recommendations, per country, as GeoJSON. It comes from the Akilimo
// API through this site's server (/api/coverage/<country>) and changes only when the yield data does,
// so each country is fetched once per visit. A missing answer (an API without the supported area yet,
// or a network error) is not an error for the UI: there is just no overlay and no early check.
const loaded = new Map<string, Promise<GeoJsonLike | null>>();

export function loadCoverage(country: string): Promise<GeoJsonLike | null> {
  const code = country.toUpperCase();
  let pending = loaded.get(code);
  if (!pending) {
    pending = fetch(`/api/coverage/${code}`, { credentials: 'same-origin' })
      .then(res => (res.ok ? (res.json() as Promise<GeoJsonLike>) : null))
      .catch(() => null);
    loaded.set(code, pending);
    // Do not remember a failure: try again the next time the country is shown
    void pending.then(geojson => { if (geojson === null) loaded.delete(code); });
  }
  return pending;
}

export function useCoverage(country: string | undefined): { geojson: GeoJsonLike | null; loading: boolean } {
  const supported = !!findCountry(country?.toUpperCase());
  const [state, setState] = useState<{ country?: string; geojson: GeoJsonLike | null; loading: boolean }>({ geojson: null, loading: false });

  useEffect(() => {
    if (!supported || !country) {
      setState({ geojson: null, loading: false });
      return;
    }
    let live = true;
    setState(prev => ({ geojson: prev.country === country ? prev.geojson : null, country, loading: true }));
    loadCoverage(country).then(geojson => live && setState({ country, geojson, loading: false }));
    return () => { live = false; };
  }, [country, supported]);

  return { geojson: state.country === country ? state.geojson : null, loading: state.loading };
}
