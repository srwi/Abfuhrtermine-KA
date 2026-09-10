import type { CategoryKey, CategoryMeta } from '../lib/shared.ts';
import type { CityInfo } from '../../src/lib/cities.ts';

// Per category, the array of ISO date strings ("YYYY-MM-DD") on which collection occurs.
export type StreetScheduleDates = Partial<Record<CategoryKey, string[]>>;

export interface CityFetcher extends CityInfo {
  readonly categories: CategoryMeta[];
  readonly requiresOsmHouseNumbers?: boolean;

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
