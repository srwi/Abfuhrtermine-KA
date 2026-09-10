import {
  type CategoryKey,
  type CategoryMeta,
  QUICK,
  STREET_LIMIT,
  YEAR,
  mapPool,
  normalizeStreet
} from '../lib/shared.ts';
import type { CityFetcher, StreetScheduleDates } from './types.ts';
import { STANDARD_CATEGORIES } from './regioit.ts';

const HEIDELBERG_BASE = 'https://garbage.datenplattform.heidelberg.de';

const DAY_MAP: Record<string, number> = {
  Mo: 1,
  Di: 2,
  Mi: 3,
  Do: 4,
  Fr: 5,
  Sa: 6,
  So: 7
};

function getIsoDateForWeek(year: number, week: number, dayOfWeek: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const startOfWeek1 = new Date(jan4.getTime() - (day - 1) * 86400000);
  const target = new Date(startOfWeek1.getTime() + ((week - 1) * 7 + (dayOfWeek - 1)) * 86400000);
  return target.toISOString().slice(0, 10);
}

interface HeidelbergCollection {
  calendar_week_bio?: string;
  day_of_week_bio?: string;
  calendar_week_rest?: string;
  day_of_week_rest?: string;
  calendar_week_paper?: string;
  day_of_week_paper?: string;
  calendar_week_dsd?: string;
  day_of_week_dsd?: string;
}

interface HeidelbergException {
  shift_from_date: string;
  shift_to_date: string;
}

interface HeidelbergResponse {
  collections?: HeidelbergCollection[];
  exceptions?: HeidelbergException[];
}

export class HeidelbergFetcher implements CityFetcher {
  readonly id = 'heidelberg';
  readonly name = 'Heidelberg';
  readonly shortName = 'HD';
  readonly center: [number, number] = [8.6724, 49.3988];
  readonly defaultZoom = 12;
  readonly bbox: [number, number, number, number] = [49.3512, 8.5812, 49.4524, 8.7812];
  readonly categories: CategoryMeta[] = STANDARD_CATEGORIES;
  readonly defaultCategories = ['restmuell'];

  private shiftMap = new Map<string, string>(); // from "YYYY-MM-DD" -> "YYYY-MM-DD"
  private streetToRaw = new Map<string, string[]>();

  private async ensureStreetCatalog(): Promise<void> {
    if (this.streetToRaw.size > 0) return;
    console.log('[Heidelberg] Fetching street catalog from Open Data API...');
    const res = await fetch(`${HEIDELBERG_BASE}/streetnames`);
    if (!res.ok) {
      throw new Error(`Failed to fetch Heidelberg streets: ${res.status} ${res.statusText}`);
    }
    const raw = (await res.json()) as Array<[string, boolean]>;
    for (const item of raw ?? []) {
      const rawName = item[0]?.trim();
      if (!rawName) continue;
      const base = rawName.replace(/\s+Nr\..*$/i, '').trim();
      if (!base) continue;
      const list = this.streetToRaw.get(base) ?? [];
      if (!list.includes(rawName)) list.push(rawName);
      this.streetToRaw.set(base, list);
    }
  }

  async fetchStreets(): Promise<string[]> {
    await this.ensureStreetCatalog();
    const sorted = Array.from(this.streetToRaw.keys()).sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[Heidelberg] Found ${sorted.length} unique streets.`);
    return sorted;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    await this.ensureStreetCatalog();
    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[Heidelberg] Fetching schedules for ${targetStreets.length} streets...`);

    const results = new Map<string, StreetScheduleDates>();
    const concurrency = QUICK ? 4 : 12;
    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const normalized = normalizeStreet(street);
      try {
        const rawQueries = this.streetToRaw.get(street) ?? [street];
        const schedule: StreetScheduleDates = {};

        for (const query of rawQueries) {
          const url = `${HEIDELBERG_BASE}/collections?street=${encodeURIComponent(query)}`;
          const res = await fetch(url);
          if (!res.ok) continue;

          const data = (await res.json()) as HeidelbergResponse;

          // Populate holiday shifts once if not already cached
          if (this.shiftMap.size === 0 && data.exceptions) {
            for (const ex of data.exceptions) {
              if (ex.shift_from_date && ex.shift_to_date) {
                this.shiftMap.set(ex.shift_from_date.slice(0, 10), ex.shift_to_date.slice(0, 10));
              }
            }
          }

          for (const col of data.collections ?? []) {
            const checkCategory = (
              cat: CategoryKey,
              rhythm?: string,
              dayStr?: string
            ) => {
              if (!rhythm || !dayStr) return;
              const dayNum = DAY_MAP[dayStr];
              if (!dayNum) return;

              const list = (schedule[cat] ??= []);

              for (let week = 1; week <= 53; week++) {
                let applies = false;
                if (rhythm === 'A') applies = true;
                else if (rhythm === 'G' && week % 2 === 0) applies = true;
                else if (rhythm === 'U' && week % 2 === 1) applies = true;

                if (applies) {
                  let dateStr = getIsoDateForWeek(YEAR, week, dayNum);
                  // Apply shift if date falls on holiday
                  if (this.shiftMap.has(dateStr)) {
                    dateStr = this.shiftMap.get(dateStr)!;
                  }
                  if (dateStr.startsWith(YEAR.toString()) && !list.includes(dateStr)) {
                    list.push(dateStr);
                  }
                }
              }
            };

            checkCategory('restmuell', col.calendar_week_rest, col.day_of_week_rest);
            checkCategory('bioabfall', col.calendar_week_bio, col.day_of_week_bio);
            checkCategory('papier', col.calendar_week_paper, col.day_of_week_paper);
            checkCategory('wertstoff', col.calendar_week_dsd, col.day_of_week_dsd);
          }
        }

        for (const cat of Object.keys(schedule) as CategoryKey[]) {
          schedule[cat]?.sort();
        }

        results.set(normalized, schedule);
      } catch (err) {
        console.warn(`[Heidelberg] Failed to fetch schedule for ${street}:`, err);
        results.set(normalized, {});
      }

      completed++;
      if (completed % 250 === 0 || completed === targetStreets.length) {
        console.log(`[Heidelberg] Progress: ${completed}/${targetStreets.length} streets fetched.`);
      }
    });

    return results;
  }
}
