import type { CityFetcher } from './types.ts';
import { KarlsruheFetcher } from './karlsruhe.ts';
import { FreiburgFetcher } from './freiburg.ts';
import { AachenFetcher } from './aachen.ts';
import { NuernbergFetcher } from './nuernberg.ts';
import { DarmstadtFetcher } from './darmstadt.ts';
import { JumoMindFetcher, type JumoMindConfig } from './jumomind.ts';
import jumoCitiesRaw from './jumomind-cities.json';

export * from './types.ts';
export * from './karlsruhe.ts';
export * from './freiburg.ts';
export * from './regioit.ts';
export * from './aachen.ts';
export * from './nuernberg.ts';
export * from './jumomind.ts';
export * from './darmstadt.ts';

const jumoCities = jumoCitiesRaw as JumoMindConfig[];

export const JUMOMIND_FETCHERS: CityFetcher[] = jumoCities.map(
  (cfg) => (cfg.id === 'darmstadt' ? new DarmstadtFetcher() : new JumoMindFetcher(cfg))
);

export const FETCHERS: CityFetcher[] = [
  new KarlsruheFetcher(),
  new FreiburgFetcher(),
  new AachenFetcher(),
  new NuernbergFetcher(),
  ...JUMOMIND_FETCHERS
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
