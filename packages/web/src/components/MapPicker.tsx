import React, { useEffect, useRef, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, TriangleAlert } from 'lucide-react';
import { findCountry, geoJsonContains, type Country, type GeoJsonLike } from '@akilimo/shared';
import { useCountries } from '../mcp/countries';
import { useCoverage } from '../mcp/coverage';

// The map starts on the country's position from the Akilimo API (fitted to its supported area or its bounds when
// known); with no country it starts on sub-Saharan Africa
const COUNTRY_ZOOM = 6;
const DEFAULT_VIEW = { center: [2, 18] as [number, number], zoom: 4 };

// ~11 m precision is plenty for a field and avoids storing exact farm coordinates
const round = (n: number) => Math.round(n * 10_000) / 10_000;

interface Props {
  lat?: number;
  lon?: number;
  country?: string;
  onChange: (lat: number, lon: number) => void;
  // Called with the ISO 2-letter code of the picked point's country, when one is found
  onCountry?: (code: string) => void;
  // Called whenever the picked point's standing changes: true inside AKILIMO's supported area, false
  // outside it, null when there is no point or no area is known for the country
  onCoverage?: (covered: boolean | null) => void;
}

type Lookup =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'found'; code: string; name: string }
  | { state: 'none' }
  | { state: 'error' };

// Country-level reverse geocoding with OpenStreetMap Nominatim (the same provider as the map tiles).
// Its usage policy allows occasional interactive lookups like a click; never call it in a loop.
const lookupCountry = async (lat: number, lon: number, signal: AbortSignal) => {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=3&accept-language=en&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const json = await res.json();
  const code = json.address?.country_code as string | undefined;
  return code ? { code: code.toUpperCase(), name: (json.address?.country as string | undefined) ?? code.toUpperCase() } : null;
};

const ClickToPick: React.FC<{ onPick: (lat: number, lon: number) => void }> = ({ onPick }) => {
  useMapEvents({
    click: (e) => onPick(round(e.latlng.lat), round(e.latlng.lng)),
  });
  return null;
};

// Leaflet measures its container once; re-measure when the layout changes (panels, collapsing sections)
const TrackSize: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
};

// The box around every coordinate of a GeoJSON, as [south, west, north, east], or null for an empty one
const geoJsonBounds = (geojson: GeoJsonLike): [[number, number], [number, number]] | null => {
  let s = 90, w = 180, n = -90, e = -180;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); return; }
    c.forEach(walk);
  };
  const features = (geojson as { features?: { geometry?: { coordinates?: unknown } }[] }).features ?? [];
  features.forEach(f => walk(f.geometry?.coordinates));
  return s <= n && w <= e ? [[s, w], [n, e]] : null;
};

// Recentres on the farm's country when it changes (and fits its supported area once that is known), unless
// a point has already been picked
const FollowCountry: React.FC<{ country?: Country | undefined; area: GeoJsonLike | null; hasPoint: boolean }> = ({ country, area, hasPoint }) => {
  const map = useMap();
  useEffect(() => {
    if (hasPoint) return;
    const box = (area && geoJsonBounds(area)) || (country?.bounds ? [[country.bounds[0], country.bounds[1]], [country.bounds[2], country.bounds[3]]] as [[number, number], [number, number]] : null);
    if (box) map.fitBounds(box, { padding: [8, 8] });
    else if (country?.latitude != null && country.longitude != null) map.setView([country.latitude, country.longitude], COUNTRY_ZOOM);
    else map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
  }, [country, area, hasPoint, map]);
  return null;
};

export const MapPicker: React.FC<Props> = ({ lat, lon, country, onChange, onCountry, onCoverage }) => {
  const hasPoint = typeof lat === 'number' && typeof lon === 'number';

  // Where AKILIMO can give advice in this country: drawn on the map and used to warn at once when the
  // picked point lies outside it (the compute service would only answer with an empty result later)
  const { geojson: area } = useCoverage(country);
  const covered = hasPoint && area ? geoJsonContains(area, lat, lon) : null;
  const { countries } = useCountries();
  const supportedCountry = findCountry(countries, country);
  const countryName = supportedCountry?.name ?? country;
  useEffect(() => { onCoverage?.(covered); }, [covered]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = hasPoint
    ? { center: [lat, lon] as [number, number], zoom: 10 }
    : supportedCountry?.latitude != null && supportedCountry.longitude != null ? { center: [supportedCountry.latitude, supportedCountry.longitude] as [number, number], zoom: COUNTRY_ZOOM } : DEFAULT_VIEW;

  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const pick = async (pickedLat: number, pickedLon: number) => {
    onChange(pickedLat, pickedLon);
    if (!onCountry) return;

    // Only the latest click counts
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLookup({ state: 'loading' });
    try {
      const found = await lookupCountry(pickedLat, pickedLon, controller.signal);
      if (controller.signal.aborted) return;
      if (found) {
        onCountry(found.code);
        setLookup({ state: 'found', ...found });
      } else {
        setLookup({ state: 'none' });
      }
    } catch {
      if (!controller.signal.aborted) setLookup({ state: 'error' });
    }
  };

  return (
    <div>
      <div className="small mb-1 d-flex flex-wrap align-items-center gap-1">
        <MapPin size={14} className="text-akilimo" />
        {hasPoint ? <>Field location <span className="font-monospace">{lat}, {lon}</span></> : 'Click the map to set the field location'}
        {lookup.state === 'loading' && <span className="text-body-secondary">· looking up country…</span>}
        {lookup.state === 'found' && (
          findCountry(countries, lookup.code)
            ? <span className="text-body-secondary">· {lookup.name} ({lookup.code})</span>
            : <span className="text-warning-emphasis">· {lookup.name} ({lookup.code}) is not an Akilimo country</span>
        )}
        {lookup.state === 'none' && <span className="text-warning-emphasis">· no country at this point</span>}
        {lookup.state === 'error' && <span className="text-warning-emphasis">· country lookup failed, enter it manually</span>}
      </div>
      {covered === false && (
        <div className="alert alert-warning small py-1 px-2 mb-1 d-flex align-items-start gap-1" role="alert">
          <TriangleAlert size={14} className="flex-shrink-0 mt-1" />
          <span>This spot is outside the area AKILIMO supports in {countryName}. Pick a point inside the green area.</span>
        </div>
      )}
      {covered === true && <div className="small text-success-emphasis mb-1">Inside the area AKILIMO supports.</div>}
      <MapContainer center={view.center} zoom={view.zoom} className="map-picker rounded border" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {area && (
          <GeoJSON key={country} data={area as never} interactive={false}
            style={{ color: '#2d5a27', weight: 1, fillColor: '#6aa84f', fillOpacity: 0.3 }} />
        )}
        <TrackSize />
        <ClickToPick onPick={pick} />
        <FollowCountry country={supportedCountry} area={area} hasPoint={hasPoint} />
        {hasPoint && (
          <CircleMarker center={[lat, lon]} radius={8}
            pathOptions={covered === false ? { color: '#b02a37', fillColor: '#dc3545', fillOpacity: 0.9 } : { color: '#2d5a27', fillColor: '#a3c585', fillOpacity: 0.9 }} />
        )}
      </MapContainer>
      {area && <div className="form-text mt-1">Green: where AKILIMO can give advice in {countryName}.</div>}
    </div>
  );
};
