export interface CityInfo {
  id: string;
  name: string;
  shortName: string;
  center: [number, number]; // [lng, lat]
  defaultZoom: number;
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
    bbox: [48.9404, 8.2774, 49.0913, 8.5417],
    defaultCategories: ['sperrmuell']
  },
  {
    id: 'freiburg',
    name: 'Freiburg im Breisgau',
    shortName: 'FR',
    center: [7.8421043, 47.9990077],
    defaultZoom: 12,
    bbox: [47.9035, 7.6620, 48.0711, 7.9308],
    defaultCategories: ['restmuell']
  },
  {
    id: 'aachen',
    name: 'Aachen',
    shortName: 'AC',
    center: [6.083862, 50.776351],
    defaultZoom: 12,
    bbox: [50.6621, 5.9748, 50.8572, 6.2181],
    defaultCategories: ['restmuell']
  },
  {
    id: 'nuernberg',
    name: 'Nürnberg',
    shortName: 'N',
    center: [11.077298, 49.453872],
    defaultZoom: 12,
    bbox: [49.3314, 10.9887, 49.5408, 11.2826],
    defaultCategories: ['restmuell']
  }
];

export const CITY_MAP = new Map<string, CityInfo>(CITIES.map((c) => [c.id, c]));
export const DEFAULT_CITY = CITIES[0];

export function getCityCalendarUrl(base: string, cityId: string): string {
  return cityId === 'karlsruhe' ? `${base}/data/calendar.json` : `${base}/data/${cityId}/calendar.json`;
}

export function getCityStreetDataUrl(base: string, cityId: string): string {
  return cityId === 'karlsruhe' ? `${base}/data/street-data.json` : `${base}/data/${cityId}/street-data.json`;
}
