import type { CityFetcher } from './types.ts';
import { KarlsruheFetcher } from './karlsruhe.ts';
import { FreiburgFetcher } from './freiburg.ts';

export * from './types.ts';
export * from './karlsruhe.ts';
export * from './freiburg.ts';

export const FETCHERS: CityFetcher[] = [
  new KarlsruheFetcher(),
  new FreiburgFetcher()
];

export const FETCHER_MAP = new Map<string, CityFetcher>(
  FETCHERS.map((f) => [f.id, f])
);

export function getCityFetcher(cityId: string): CityFetcher {
  const fetcher = FETCHER_MAP.get(cityId.toLowerCase());
  if (!fetcher) {
    const known = FETCHERS.map((f) => f.id).join(', ');
    throw new Error(`Unknown city "${cityId}". Known cities: ${known}`);
  }
  return fetcher;
}
