import { useEffect, useState } from 'react';
import { DEFAULT_CROPS, DEFAULT_CROP_KEY, type Crop } from '@akilimo/shared';

// The crops AKILIMO offers (managed in the Akilimo API's admin area), for the crop selector. They come
// through this site's server (/api/crops), which falls back to the built-in list (cassava) when the API
// has no crop list yet, so the selector always has something to show.
export function useCrops(country: string | undefined): Crop[] {
  const [crops, setCrops] = useState<Crop[]>(DEFAULT_CROPS);

  useEffect(() => {
    let live = true;
    const query = country ? `?country=${encodeURIComponent(country)}` : '';
    fetch(`/api/crops${query}`, { credentials: 'same-origin' })
      .then(res => (res.ok ? (res.json() as Promise<{ crops?: Crop[] }>) : null))
      .then(body => { if (live && body?.crops?.length) setCrops(body.crops); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [country]);

  return crops;
}

const STORAGE_KEY = 'akilimo-crop';

// The remembered choice (private browsing may refuse storage; then the default is used)
export const savedCropKey = (): string => {
  try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_CROP_KEY; } catch { return DEFAULT_CROP_KEY; }
};
export const saveCropKey = (key: string) => {
  try { localStorage.setItem(STORAGE_KEY, key); } catch { /* not remembered */ }
};
