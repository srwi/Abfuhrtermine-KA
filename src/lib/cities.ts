import citiesData from './cities.json';

export interface CityInfo {
  id: string;
  name: string;
  shortName: string;
  center: [number, number]; // [lng, lat]
  defaultZoom: number;
  bbox: [number, number, number, number]; // [south, west, north, east]
  defaultCategories: string[];
}

export const CITIES: CityInfo[] = citiesData as CityInfo[];

export const CITY_MAP = new Map<string, CityInfo>(CITIES.map((c) => [c.id, c]));
export const DEFAULT_CITY = CITIES.find((c) => c.id === 'karlsruhe') ?? CITIES[0];

export function getCityCalendarUrl(base: string, cityId: string): string {
  return cityId === 'karlsruhe' ? `${base}/data/calendar.json` : `${base}/data/${cityId}/calendar.json`;
}

export function getCityStreetDataUrl(base: string, cityId: string): string {
  return cityId === 'karlsruhe' ? `${base}/data/street-data.json` : `${base}/data/${cityId}/street-data.json`;
}
