import type { CalendarFile, StreetGeometryFile } from '../lib/types';

export const prerender = true;

export async function load({ fetch }: { fetch: typeof globalThis.fetch }) {
  const [calendarResponse, geometryResponse] = await Promise.all([
    fetch('data/calendar.json'),
    fetch('data/street-geometries.json')
  ]);

  const calendar =
    calendarResponse.ok
      ? ((await calendarResponse.json()) as CalendarFile)
      : { year: new Date().getFullYear(), generatedAt: new Date().toISOString(), entries: [] };

  const geometries =
    geometryResponse.ok
      ? ((await geometryResponse.json()) as StreetGeometryFile)
      : { year: new Date().getFullYear(), generatedAt: new Date().toISOString(), streets: [] };

  return {
    calendar,
    geometries
  };
}