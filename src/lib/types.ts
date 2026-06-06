import type { Geometry } from 'geojson';

export type CalendarEntry = {
  date: string;
  isoDate: string;
  streets: string[];
};

export type CalendarFile = {
  year: number;
  generatedAt: string;
  entries: CalendarEntry[];
};

export type StreetGeometry = {
  street: string;
  geometry: Geometry;
};

export type StreetGeometryFile = {
  year: number;
  generatedAt: string;
  streets: StreetGeometry[];
};