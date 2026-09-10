import type { StreetGeometry } from './shared.ts';

export const CLUSTER_GAP_METERS = 400;
export const COORD_DECIMALS = 5;

export type Line = [number, number][];

export function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const meanLat = ((a[1] + b[1]) / 2) * toRad;
  const dx = (b[0] - a[0]) * toRad * Math.cos(meanLat);
  const dy = (b[1] - a[1]) * toRad;
  return Math.sqrt(dx * dx + dy * dy) * R;
}

export function geometryLines(geometry: GeoJSON.Geometry): Line[] {
  if (geometry.type === 'LineString') return [geometry.coordinates as Line];
  if (geometry.type === 'MultiLineString') return geometry.coordinates as Line[];
  return [];
}

export function geometryFromLines(lines: Line[]): GeoJSON.Geometry {
  return lines.length === 1
    ? { type: 'LineString', coordinates: lines[0] }
    : { type: 'MultiLineString', coordinates: lines };
}

export function roundCoord(c: number): number {
  return Number(c.toFixed(COORD_DECIMALS));
}

export function roundGeometry(geometry: GeoJSON.Geometry): GeoJSON.Geometry {
  if (geometry.type === 'Point') {
    return { type: 'Point', coordinates: [roundCoord(geometry.coordinates[0]), roundCoord(geometry.coordinates[1])] };
  }
  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: geometry.coordinates.map((c) => [roundCoord(c[0]), roundCoord(c[1])]) };
  }
  if (geometry.type === 'MultiLineString') {
    return {
      type: 'MultiLineString',
      coordinates: geometry.coordinates.map((line) => line.map((c) => [roundCoord(c[0]), roundCoord(c[1])]))
    };
  }
  return geometry;
}

export function lineDistanceMeters(a: Line, b: Line): number {
  let min = Infinity;
  for (const pa of a) {
    for (const pb of b) {
      const d = distanceMeters(pa, pb);
      if (d < min) min = d;
    }
  }
  return min;
}

export function clusterLines(lines: Line[], maxGapMeters: number): Line[][] {
  const clusters: Line[][] = [];
  for (const line of lines) {
    const matching: number[] = [];
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].some((other) => lineDistanceMeters(line, other) <= maxGapMeters)) {
        matching.push(i);
      }
    }
    if (matching.length === 0) {
      clusters.push([line]);
    } else {
      const merged: Line[] = [line];
      for (let i = matching.length - 1; i >= 0; i--) {
        merged.push(...clusters.splice(matching[i], 1)[0]);
      }
      clusters.push(merged);
    }
  }
  return clusters;
}

export function geometryCentroid(geometry: GeoJSON.Geometry): [number, number] | null {
  const lines = geometryLines(geometry);
  if (lines.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  let count = 0;
  for (const line of lines) {
    for (const [lng, lat] of line) {
      sumLng += lng;
      sumLat += lat;
      count++;
    }
  }
  return count > 0 ? [sumLng / count, sumLat / count] : null;
}

/**
 * When a street has disconnected clusters across the city, selects the cluster
 * closest to other streets collected on the same date.
 */
export function disambiguateMultiCluster(
  resolvedGeometry: Map<string, StreetGeometry>,
  dateByStreet: Map<string, string>
) {
  const streetsByDate = new Map<string, string[]>();
  for (const [street, date] of dateByStreet) {
    let list = streetsByDate.get(date);
    if (!list) streetsByDate.set(date, (list = []));
    list.push(street);
  }

  const dateCentroid = new Map<string, [number, number]>();
  for (const [date, streets] of streetsByDate) {
    let sumLng = 0;
    let sumLat = 0;
    let count = 0;
    for (const street of streets) {
      const g = resolvedGeometry.get(street)?.geometry;
      if (!g) continue;
      const c = geometryCentroid(g);
      if (!c) continue;
      sumLng += c[0];
      sumLat += c[1];
      count++;
    }
    if (count > 0) dateCentroid.set(date, [sumLng / count, sumLat / count]);
  }

  for (const [street, entry] of resolvedGeometry) {
    const lines = geometryLines(entry.geometry);
    if (lines.length <= 1) continue;
    const clusters = clusterLines(lines, CLUSTER_GAP_METERS);
    if (clusters.length <= 1) continue;

    const date = dateByStreet.get(street);
    const target = date ? dateCentroid.get(date) : undefined;
    if (!target) continue;

    let bestCluster = clusters[0];
    let bestDist = Infinity;
    for (const cluster of clusters) {
      const c = geometryCentroid(geometryFromLines(cluster));
      if (!c) continue;
      const d = distanceMeters(c, target);
      if (d < bestDist) {
        bestDist = d;
        bestCluster = cluster;
      }
    }
    entry.geometry = geometryFromLines(bestCluster);
  }
}
