import type { Geometry } from 'geojson';

// The five waste types. Keys are stable; labels/colors come from calendar.json
// (the scraper in scripts/lib/shared.ts is the single source of truth).
export type CategoryKey = 'sperrmuell' | 'restmuell' | 'bioabfall' | 'wertstoff' | 'papier';

export type CategoryMeta = {
  key: CategoryKey;
  label: string;
  color: string;
};

// One day on which at least one category is collected somewhere in the city.
// `categories` lists which keys occur citywide that day (drives the picker).
export type CalendarDay = {
  isoDate: string;
  date: string;
  categories: CategoryKey[];
};

// calendar.json — small, inlined into the prerendered HTML.
export type CalendarFile = {
  year: number;
  generatedAt: string;
  categories: CategoryMeta[];
  days: CalendarDay[];
};

// Per category, the indices (into CalendarFile.days) on which this street is collected.
export type StreetSchedule = Partial<Record<CategoryKey, number[]>>;

export type StreetData = {
  street: string;
  geometry: Geometry | null;
  schedule: StreetSchedule;
};

// street-data.json — large, fetched client-side after first paint.
export type StreetDataFile = {
  year: number;
  generatedAt: string;
  streets: StreetData[];
};
