import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { CategoryKey, StreetDataFile } from '$lib/types';

export function normalizeStreet(street: string) {
  return street.trim().replace(/ß/g, 'ss').replace(/\s+/g, ' ').toUpperCase();
}

// A street prepared for lookup: schedule arrays become Sets of day indices for
// O(1) "is this street collected on day N for category C" membership tests.
export type StreetEntry = {
  street: string;
  geometry: Geometry | null;
  schedule: Partial<Record<CategoryKey, Set<number>>>;
};

export function buildStreetLookup(source: StreetDataFile): Map<string, StreetEntry> {
  return new Map(
    source.streets.map((entry) => {
      const schedule: StreetEntry['schedule'] = {};
      for (const [key, indices] of Object.entries(entry.schedule)) {
        schedule[key as CategoryKey] = new Set(indices);
      }
      return [normalizeStreet(entry.street), { street: entry.street, geometry: entry.geometry, schedule }];
    })
  );
}

export type SelectedStreet = { street: string; geometry: Geometry | null; categories: CategoryKey[] };

/**
 * All streets collected on `dayIndex` for any of the `enabled` categories, each
 * tagged with the matching category keys. Drives both the street list and the
 * map. `dayIndex < 0` (no day selected) yields an empty list.
 */
export function selectStreetsForDay(
  lookup: Map<string, StreetEntry>,
  dayIndex: number,
  enabled: Set<CategoryKey>
): SelectedStreet[] {
  if (dayIndex < 0) return [];

  const selected: SelectedStreet[] = [];
  for (const entry of lookup.values()) {
    const categories: CategoryKey[] = [];
    for (const key of enabled) {
      if (entry.schedule[key]?.has(dayIndex)) categories.push(key);
    }
    if (categories.length > 0) selected.push({ street: entry.street, geometry: entry.geometry, categories });
  }
  return selected.sort((a, b) => a.street.localeCompare(b.street, 'de'));
}

/**
 * One Feature per (street, category) pair so the map can color each line by its
 * category. Streets without geometry are skipped (they still appear in the list).
 */
export function buildFeatureCollection(selected: SelectedStreet[]): FeatureCollection {
  const features: Feature[] = [];
  for (const { street, geometry, categories } of selected) {
    if (!geometry) continue;
    for (const category of categories) {
      features.push({ type: 'Feature', properties: { street, category }, geometry } as Feature);
    }
  }
  return { type: 'FeatureCollection', features };
}
