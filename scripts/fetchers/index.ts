import type { CityFetcher } from './types.ts';
import { KarlsruheFetcher } from './karlsruhe.ts';
import { FreiburgFetcher } from './freiburg.ts';
import { AachenFetcher } from './aachen.ts';
import { NuernbergFetcher } from './nuernberg.ts';
import { DarmstadtFetcher } from './darmstadt.ts';
import { RegioItFetcher } from './regioit.ts';
import { HeidelbergFetcher } from './heidelberg.ts';
import { KoelnFetcher } from './koeln.ts';
import { MuellmaxFetcher } from './muellmax.ts';
import { JumoMindFetcher, type JumoMindConfig } from './jumomind.ts';
import jumoCitiesRaw from './jumomind-cities.json';

export * from './types.ts';
export * from './karlsruhe.ts';
export * from './freiburg.ts';
export * from './regioit.ts';
export * from './heidelberg.ts';
export * from './koeln.ts';
export * from './muellmax.ts';
export * from './aachen.ts';
export * from './nuernberg.ts';
export * from './jumomind.ts';
export * from './darmstadt.ts';

const jumoCities = jumoCitiesRaw as JumoMindConfig[];

export const REGIOIT_EXTRA_FETCHERS: CityFetcher[] = [
  new RegioItFetcher({
    id: 'oberhausen',
    name: 'Oberhausen',
    shortName: 'OB',
    serviceDomain: 'oberhausen',
    center: [6.8514, 51.4696],
    defaultZoom: 12,
    bbox: [51.4487, 6.7773, 51.58, 6.9305]
  }),
  new RegioItFetcher({
    id: 'muelheim',
    name: 'Mülheim an der Ruhr',
    shortName: 'MH',
    serviceDomain: 'muelheim',
    center: [6.8829, 51.4273],
    defaultZoom: 12,
    bbox: [51.3507, 6.8067, 51.4714, 6.9595]
  }),
  new RegioItFetcher({
    id: 'solingen',
    name: 'Solingen',
    shortName: 'SG',
    serviceDomain: 'solingen',
    center: [7.0846, 51.1722],
    defaultZoom: 12,
    bbox: [51.1142, 6.9511, 51.2204, 7.1741]
  }),
  new RegioItFetcher({
    id: 'bergisch-gladbach',
    name: 'Bergisch Gladbach',
    shortName: 'GL',
    serviceDomain: 'aw-bgl2',
    center: [7.1277, 50.9929],
    defaultZoom: 12,
    bbox: [50.9199, 7.0618, 51.0269, 7.2546]
  }),
  new RegioItFetcher({
    id: 'cottbus',
    name: 'Cottbus',
    shortName: 'CB',
    serviceDomain: 'cottbus',
    center: [14.3357, 51.7567],
    defaultZoom: 12,
    bbox: [51.6925, 14.2733, 51.8642, 14.5013]
  }),
  new RegioItFetcher({
    id: 'norderstedt',
    name: 'Norderstedt',
    shortName: 'NIZ',
    serviceDomain: 'nds',
    center: [9.9892, 53.709],
    defaultZoom: 12,
    bbox: [53.6481, 9.9348, 53.7598, 10.0729]
  }),
  new RegioItFetcher({
    id: 'luedenscheid',
    name: 'Lüdenscheid',
    shortName: 'MK',
    serviceDomain: 'stl',
    center: [7.6397, 51.2181],
    defaultZoom: 12,
    bbox: [51.1551, 7.5522, 51.2708, 7.7233]
  }),
  new RegioItFetcher({
    id: 'dorsten',
    name: 'Dorsten',
    shortName: 'DOR',
    serviceDomain: 'dorsten',
    center: [6.9647, 51.6604],
    defaultZoom: 12,
    bbox: [51.6228, 6.8939, 51.801, 7.0882]
  }),
  new RegioItFetcher({
    id: 'dinslaken',
    name: 'Dinslaken',
    shortName: 'DIN',
    serviceDomain: 'din',
    center: [6.7345, 51.5624],
    defaultZoom: 12,
    bbox: [51.5325, 6.6865, 51.6082, 6.866]
  }),
  new RegioItFetcher({
    id: 'frankenthal',
    name: 'Frankenthal',
    shortName: 'FT',
    serviceDomain: 'frankenthal',
    center: [8.3541, 49.5353],
    defaultZoom: 12,
    bbox: [49.4847, 8.3093, 49.5826, 8.4229]
  }),
  new RegioItFetcher({
    id: 'bocholt',
    name: 'Bocholt',
    shortName: 'BOH',
    serviceDomain: 'wml2',
    center: [6.6149, 51.8383],
    defaultZoom: 12,
    bbox: [51.7898, 6.4725, 51.9176, 6.7212]
  }),
  new RegioItFetcher({
    id: 'coesfeld',
    name: 'Coesfeld',
    shortName: 'COE',
    serviceDomain: 'coe',
    center: [7.1691, 51.9459],
    defaultZoom: 12,
    bbox: [51.8462, 7.0557, 51.9879, 7.2612]
  })
];

export const MUELLMAX_FETCHERS: CityFetcher[] = [
  new MuellmaxFetcher({
    id: 'bochum',
    name: 'Bochum',
    shortName: 'BO',
    service: 'Usb',
    center: [7.2197, 51.4818],
    defaultZoom: 12,
    bbox: [51.4105, 7.1021, 51.5314, 7.3493]
  }),
  new MuellmaxFetcher({
    id: 'muenster',
    name: 'Münster',
    shortName: 'MS',
    service: 'Awm',
    center: [7.6252, 51.9625],
    defaultZoom: 12,
    bbox: [51.8401, 7.4738, 52.06, 7.7744]
  }),
  new MuellmaxFetcher({
    id: 'mainz',
    name: 'Mainz',
    shortName: 'MZ',
    service: 'Ebm',
    center: [8.2736, 49.9995],
    defaultZoom: 12,
    bbox: [49.8955, 8.1431, 50.0353, 8.3431]
  })
];

export const JUMOMIND_FETCHERS: CityFetcher[] = jumoCities.map(
  (cfg) => (cfg.id === 'darmstadt' ? new DarmstadtFetcher() : new JumoMindFetcher(cfg))
);

export const FETCHERS: CityFetcher[] = [
  new KarlsruheFetcher(),
  new FreiburgFetcher(),
  new AachenFetcher(),
  new NuernbergFetcher(),
  new HeidelbergFetcher(),
  new KoelnFetcher(),
  ...REGIOIT_EXTRA_FETCHERS,
  ...MUELLMAX_FETCHERS,
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
