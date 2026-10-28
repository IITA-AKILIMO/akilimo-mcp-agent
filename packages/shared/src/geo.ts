// Just enough GeoJSON for the supported-area check: polygons of a FeatureCollection, Feature or
// geometry, a bounding box, and point-in-polygon with holes. Coordinates are [lon, lat] as in
// GeoJSON. Mirrors App\Support\GeoJson in the Akilimo API, which makes the authoritative decision;
// this copy lets the web UI warn the moment a point is picked, without a request.

export type Position = [number, number];
export type Ring = Position[];
export type Polygon = Ring[]; // first ring is the outer one, the rest are holes

export interface GeoJsonLike {
  type?: string;
  features?: GeoJsonLike[];
  geometry?: GeoJsonLike | null;
  geometries?: GeoJsonLike[];
  coordinates?: unknown;
}

export function polygonsOf(geojson: GeoJsonLike | null | undefined): Polygon[] {
  if (!geojson) return [];
  switch (geojson.type) {
    case 'FeatureCollection': return (geojson.features ?? []).flatMap(polygonsOf);
    case 'Feature': return polygonsOf(geojson.geometry);
    case 'Polygon': return [geojson.coordinates as Polygon];
    case 'MultiPolygon': return (geojson.coordinates as Polygon[]) ?? [];
    case 'GeometryCollection': return (geojson.geometries ?? []).flatMap(polygonsOf);
    default: return [];
  }
}

export interface Bounds { minLon: number; minLat: number; maxLon: number; maxLat: number }

export function boundsOf(geojson: GeoJsonLike | null | undefined): Bounds | null {
  let box: Bounds | null = null;
  for (const polygon of polygonsOf(geojson)) {
    for (const [lon, lat] of polygon[0] ?? []) {
      box = box
        ? { minLon: Math.min(box.minLon, lon), minLat: Math.min(box.minLat, lat), maxLon: Math.max(box.maxLon, lon), maxLat: Math.max(box.maxLat, lat) }
        : { minLon: lon, minLat: lat, maxLon: lon, maxLat: lat };
    }
  }
  return box;
}

const EPSILON = 1e-12;

// 1 inside the ring, 0 outside, -1 on its edge (ray casting)
function ringPosition(x: number, y: number, ring: Ring): 1 | 0 | -1 {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < EPSILON
      && x >= Math.min(xi, xj) - EPSILON && x <= Math.max(xi, xj) + EPSILON
      && y >= Math.min(yi, yj) - EPSILON && y <= Math.max(yi, yj) + EPSILON) return -1;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? 1 : 0;
}

function polygonContains(rings: Polygon, x: number, y: number): boolean {
  if (rings.length === 0) return false;
  const outer = ringPosition(x, y, rings[0]!);
  if (outer === 0) return false;
  if (outer === -1) return true;
  return !rings.slice(1).some(hole => ringPosition(x, y, hole) === 1);
}

// Is the point inside the area? A point exactly on an edge counts as inside.
export function geoJsonContains(geojson: GeoJsonLike | null | undefined, lat: number, lon: number): boolean {
  return polygonsOf(geojson).some(polygon => polygonContains(polygon, lon, lat));
}
