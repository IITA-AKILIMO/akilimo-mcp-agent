import React, { useEffect } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';

// Map view per Akilimo country (GET /v1/countries); anything else starts on sub-Saharan Africa
const COUNTRY_VIEWS: Record<string, { center: [number, number]; zoom: number }> = {
  NG: { center: [9.08, 8.68], zoom: 6 },
  TZ: { center: [-6.37, 34.89], zoom: 6 },
  RW: { center: [-1.94, 29.87], zoom: 8 },
  GH: { center: [7.95, -1.02], zoom: 7 },
  BI: { center: [-3.37, 29.92], zoom: 8 },
};
const DEFAULT_VIEW = { center: [2, 18] as [number, number], zoom: 4 };

// ~11 m precision is plenty for a field and avoids storing exact farm coordinates
const round = (n: number) => Math.round(n * 10_000) / 10_000;

interface Props {
  lat?: number;
  lon?: number;
  country?: string;
  onChange: (lat: number, lon: number) => void;
}

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

// Recentres on the farm's country when it changes, unless a point has already been picked
const FollowCountry: React.FC<{ country?: string; hasPoint: boolean }> = ({ country, hasPoint }) => {
  const map = useMap();
  useEffect(() => {
    if (hasPoint) return;
    const view = COUNTRY_VIEWS[country?.toUpperCase() ?? ''] ?? DEFAULT_VIEW;
    map.setView(view.center, view.zoom);
  }, [country, hasPoint, map]);
  return null;
};

export const MapPicker: React.FC<Props> = ({ lat, lon, country, onChange }) => {
  const hasPoint = typeof lat === 'number' && typeof lon === 'number';
  const view = hasPoint
    ? { center: [lat, lon] as [number, number], zoom: 10 }
    : COUNTRY_VIEWS[country?.toUpperCase() ?? ''] ?? DEFAULT_VIEW;

  return (
    <div>
      <div className="small mb-1 d-flex align-items-center gap-1">
        <MapPin size={14} className="text-akilimo" />
        {hasPoint ? <>Field location <span className="font-monospace">{lat}, {lon}</span></> : 'Click the map to set the field location'}
      </div>
      <MapContainer center={view.center} zoom={view.zoom} className="map-picker rounded border" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <TrackSize />
        <ClickToPick onPick={onChange} />
        <FollowCountry country={country} hasPoint={hasPoint} />
        {hasPoint && <CircleMarker center={[lat, lon]} radius={8} pathOptions={{ color: '#2d5a27', fillColor: '#a3c585', fillOpacity: 0.9 }} />}
      </MapContainer>
    </div>
  );
};
