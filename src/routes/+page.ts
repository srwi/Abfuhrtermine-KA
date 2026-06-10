import type { CalendarFile } from '../lib/types';

export const prerender = true;

// Only the small calendar is loaded here. SvelteKit inlines whatever `load`
// fetches into the prerendered HTML, so pulling the multi-MB geometry file in
// would bloat index.html and block first paint — it is fetched client-side
// after mount instead (see +page.svelte).
export async function load({ fetch }: { fetch: typeof globalThis.fetch }) {
  const calendarResponse = await fetch('data/calendar.json');

  const calendar: CalendarFile =
    calendarResponse.ok
      ? ((await calendarResponse.json()) as CalendarFile)
      : { year: new Date().getFullYear(), generatedAt: new Date().toISOString(), categories: [], days: [] };

  return { calendar };
}