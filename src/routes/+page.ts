import type { CalendarFile, StreetGeometryFile } from '$lib/types';

export const prerender = true;

export async function load({ fetch }) {
  const [calendarResponse, geometryResponse] = await Promise.all([
    fetch('data/calendar.json'),
    fetch('data/street-geometries.json')
  ]);

  const calendar = (await calendarResponse.json()) as CalendarFile;
  const geometries = (await geometryResponse.json()) as StreetGeometryFile;

  return {
    calendar,
    geometries
  };
}