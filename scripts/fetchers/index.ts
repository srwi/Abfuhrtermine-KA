import type { CityFetcher } from './types.ts';
import { KarlsruheFetcher } from './karlsruhe.ts';
import { FreiburgFetcher } from './freiburg.ts';
import { AachenFetcher } from './aachen.ts';
import { NuernbergFetcher } from './nuernberg.ts';
import { DarmstadtFetcher } from './darmstadt.ts';
import { RegioItFetcher, type RegioItConfig } from './regioit.ts';
import { HeidelbergFetcher } from './heidelberg.ts';
import { KoelnFetcher } from './koeln.ts';
import { LeipzigFetcher } from './leipzig.ts';
import { MuellmaxFetcher, type MuellmaxConfig } from './muellmax.ts';
import { AbfallPlusFetcher, type AbfallPlusConfig } from './abfallplus.ts';
import { JumoMindFetcher, type JumoMindConfig } from './jumomind.ts';
import { AwidoFetcher, type AwidoConfig } from './awido.ts';
import { CTraceFetcher, type CTraceConfig } from './ctrace.ts';
import { AwshFetcher, type AwshConfig } from './awsh.ts';
import { AwigoFetcher, type AwigoConfig } from './awigo.ts';
import { AhaFetcher, type AhaConfig } from './aha.ts';
import jumoCitiesRaw from './jumomind-cities.json' with { type: 'json' };
import abfallPlusCitiesRaw from './abfallplus-cities.json' with { type: 'json' };
import muellmaxCitiesRaw from './muellmax-cities.json' with { type: 'json' };
import regioItCitiesRaw from './regioit-cities.json' with { type: 'json' };
import awidoCitiesRaw from './awido-cities.json' with { type: 'json' };
import ctraceCitiesRaw from './ctrace-cities.json' with { type: 'json' };
import awshCitiesRaw from './awsh-cities.json' with { type: 'json' };
import awigoCitiesRaw from './awigo-cities.json' with { type: 'json' };
import ahaCitiesRaw from './aha-cities.json' with { type: 'json' };

export * from './types.ts';
export * from './karlsruhe.ts';
export * from './freiburg.ts';
export * from './regioit.ts';
export * from './heidelberg.ts';
export * from './koeln.ts';
export * from './leipzig.ts';
export * from './muellmax.ts';
export * from './abfallplus.ts';
export * from './aachen.ts';
export * from './nuernberg.ts';
export * from './jumomind.ts';
export * from './darmstadt.ts';
export * from './awido.ts';
export * from './ctrace.ts';
export * from './awsh.ts';
export * from './awigo.ts';
export * from './aha.ts';

const jumoCities = jumoCitiesRaw as JumoMindConfig[];
const abfallPlusCities = abfallPlusCitiesRaw as AbfallPlusConfig[];
const muellmaxCities = muellmaxCitiesRaw as MuellmaxConfig[];
const regioItCities = regioItCitiesRaw as RegioItConfig[];
const awidoCities = awidoCitiesRaw as AwidoConfig[];
const ctraceCities = ctraceCitiesRaw as CTraceConfig[];
const awshCities = awshCitiesRaw as AwshConfig[];
const awigoCities = awigoCitiesRaw as AwigoConfig[];
const ahaCities = ahaCitiesRaw as AhaConfig[];

export const REGIOIT_FETCHERS: CityFetcher[] = regioItCities.map(
  (cfg) => new RegioItFetcher(cfg)
);
export const REGIOIT_EXTRA_FETCHERS: CityFetcher[] = REGIOIT_FETCHERS;

export const MUELLMAX_FETCHERS: CityFetcher[] = muellmaxCities.map(
  (cfg) => new MuellmaxFetcher(cfg)
);

export const ABFALLPLUS_FETCHERS: CityFetcher[] = abfallPlusCities.map(
  (cfg) => new AbfallPlusFetcher(cfg)
);

export const JUMOMIND_FETCHERS: CityFetcher[] = jumoCities.map(
  (cfg) => (cfg.id === 'darmstadt' ? new DarmstadtFetcher() : new JumoMindFetcher(cfg))
);

export const AWIDO_FETCHERS: CityFetcher[] = awidoCities.map(
  (cfg) => new AwidoFetcher(cfg)
);

export const CTRACE_FETCHERS: CityFetcher[] = ctraceCities.map(
  (cfg) => new CTraceFetcher(cfg)
);

export const AWSH_FETCHERS: CityFetcher[] = awshCities.map(
  (cfg) => new AwshFetcher(cfg)
);

export const AWIGO_FETCHERS: CityFetcher[] = awigoCities.map(
  (cfg) => new AwigoFetcher(cfg)
);

export const AHA_FETCHERS: CityFetcher[] = ahaCities.map(
  (cfg) => new AhaFetcher(cfg)
);

export const FETCHERS: CityFetcher[] = [
  new KarlsruheFetcher(),
  new FreiburgFetcher(),
  new AachenFetcher(),
  new NuernbergFetcher(),
  new HeidelbergFetcher(),
  new KoelnFetcher(),
  new LeipzigFetcher(),
  ...REGIOIT_FETCHERS,
  ...MUELLMAX_FETCHERS,
  ...ABFALLPLUS_FETCHERS,
  ...JUMOMIND_FETCHERS,
  ...AWIDO_FETCHERS,
  ...CTRACE_FETCHERS,
  ...AWSH_FETCHERS,
  ...AWIGO_FETCHERS,
  ...AHA_FETCHERS
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
