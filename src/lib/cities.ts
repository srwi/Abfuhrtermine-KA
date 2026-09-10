export interface CityInfo {
  id: string;
  name: string;
  shortName: string;
  center: [number, number]; // [lng, lat]
  defaultZoom: number;
  adminLevel: number;
  searchAreaName: string;
  bbox: [number, number, number, number]; // [south, west, north, east]
  defaultCategories: string[];
}

export const CITIES: CityInfo[] = [
  {
    id: 'karlsruhe',
    name: 'Karlsruhe',
    shortName: 'KA',
    center: [8.4034195, 49.0068705],
    defaultZoom: 12,
    adminLevel: 6,
    searchAreaName: 'Karlsruhe',
    bbox: [48.9404, 8.2774, 49.0913, 8.5417],
    defaultCategories: ['sperrmuell']
  },
  {
    id: 'freiburg',
    name: 'Freiburg im Breisgau',
    shortName: 'FR',
    center: [7.8421043, 47.9990077],
    defaultZoom: 12,
    adminLevel: 6,
    searchAreaName: 'Freiburg im Breisgau',
    bbox: [47.9035, 7.6620, 48.0711, 7.9308],
    defaultCategories: ['restmuell']
  }
];

export const CITY_MAP = new Map<string, CityInfo>(CITIES.map((c) => [c.id, c]));
export const DEFAULT_CITY = CITIES[0];
