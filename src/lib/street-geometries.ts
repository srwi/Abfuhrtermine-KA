import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { StreetGeometryFile } from '$lib/types';

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const STREET_BATCH_SIZE = 20;

export function normalizeStreet(street: string) {
  return street.trim().replace(/ß/g, 'ss').replace(/\s+/g, ' ').toUpperCase();
}

export function buildGeometryLookup(source: StreetGeometryFile) {
  return new Map(source.streets.map((entry) => [normalizeStreet(entry.street), entry.geometry]));
}

export function buildStreetCollection(streets: string[], geometryLookup: Map<string, Geometry>) {
  const features: Feature[] = streets
    .map((street) => {
      const geometry = geometryLookup.get(normalizeStreet(street));
      if (!geometry) return null;

      return {
        type: 'Feature',
        properties: { street },
        geometry
      } as Feature;
    })
    .filter((feature): feature is Feature => feature !== null);

  return {
    type: 'FeatureCollection',
    features
  } satisfies FeatureCollection;
}

function escapeOverpassRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function streetAliases(street: string) {
  const aliases = new Set<string>([street]);

  if (street.includes('ss')) aliases.add(street.replace(/ss/g, 'ß'));
  if (street.includes('ß')) aliases.add(street.replace(/ß/g, 'ss'));

  return [...aliases];
}

function toStreetGeometryFromWays(ways: Array<{ geometry: Array<{ lon: number; lat: number }> }>): Geometry | null {
  const lines = ways
    .map((way) => way.geometry.map((point) => [point.lon, point.lat] as [number, number]))
    .filter((coordinates) => coordinates.length >= 2);

  if (lines.length === 0) return null;
  if (lines.length === 1) return { type: 'LineString', coordinates: lines[0] };
  return { type: 'MultiLineString', coordinates: lines };
}

async function fetchStreetBatch(streets: string[]): Promise<Map<string, Geometry>> {
  const queryNames = streets.flatMap((street) => streetAliases(street)).map(escapeOverpassRegex);
  const query = `[out:json][timeout:60];
area["name"="Karlsruhe"]["boundary"="administrative"]->.searchArea;
(
  way(area.searchArea)["highway"]["name"~"^(${queryNames.join('|')})$",i];
);
out geom;`;

  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: new URLSearchParams({ data: query })
  });

  if (!response.ok) return new Map();

  const payload = (await response.json()) as {
    elements?: Array<{
      tags?: { name?: string };
      geometry: Array<{ lon: number; lat: number }>;
    }>;
  };

  const grouped = new Map<string, Array<{ geometry: Array<{ lon: number; lat: number }> }>>();

  for (const element of payload.elements ?? []) {
    const name = element.tags?.name?.trim();
    if (!name) continue;

    const bucket = grouped.get(normalizeStreet(name)) ?? [];
    bucket.push({ geometry: element.geometry });
    grouped.set(normalizeStreet(name), bucket);
  }

  const result = new Map<string, Geometry>();
  for (const street of streets) {
    const geometry = toStreetGeometryFromWays(grouped.get(normalizeStreet(street)) ?? []);
    if (geometry) result.set(normalizeStreet(street), geometry);
  }

  return result;
}

export async function resolveStreetCollection(
  streets: string[],
  geometryLookup: Map<string, Geometry>
) {
  const missing = streets.filter((street) => {
    const geometry = geometryLookup.get(normalizeStreet(street));
    return !geometry || geometry.type === 'Point';
  });

  for (let index = 0; index < missing.length; index += STREET_BATCH_SIZE) {
    const batch = missing.slice(index, index + STREET_BATCH_SIZE);
    const fetched = await fetchStreetBatch(batch);

    for (const [key, geometry] of fetched) {
      geometryLookup.set(key, geometry);
    }
  }

  return buildStreetCollection(streets, geometryLookup);
}