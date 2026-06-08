import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { StreetGeometryFile } from '$lib/types';

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
