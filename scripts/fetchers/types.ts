import type { CategoryKey, CategoryMeta } from '../lib/shared.ts';

// Per category, the array of ISO date strings ("YYYY-MM-DD") on which collection occurs.
export type StreetScheduleDates = Partial<Record<CategoryKey, string[]>>;

export interface CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly searchAreaName: string;
  readonly adminLevel: number;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number]; // [south, west, north, east]
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];

  /** Returns all street names in the municipality. */
  fetchStreets(): Promise<string[]>;

  /**
   * Fetches pickup schedules for the given streets.
   * @param streets - The normalized/source street names
   * @param osmHouseNumbers - Optional map of normalized street -> OSM house numbers
   * @returns Map of normalized street -> schedule with ISO date strings
   */
  fetchSchedules(
    streets: string[],
    osmHouseNumbers?: Record<string, string[]>
  ): Promise<Map<string, StreetScheduleDates>>;
}
