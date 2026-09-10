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

const AWB_BASE = 'https://www.awbkoeln.de/api';

interface AwbStreetItem {
  street_name: string;
  street_code: string;
  building_number: string;
}

interface AwbCalendarItem {
  day: number;
  month: number;
  year: number;
  type: string;
}

export class KoelnFetcher implements CityFetcher {
  readonly id = 'koeln';
  readonly name = 'Köln';
  readonly shortName = 'K';
  readonly center: [number, number] = [6.9599, 50.9383];
  readonly defaultZoom = 12;
  readonly bbox: [number, number, number, number] = [50.8304, 6.7725, 51.0849, 7.1620];
  readonly categories: CategoryMeta[] = STANDARD_CATEGORIES;
  readonly defaultCategories = ['restmuell'];

  private streetCatalog = new Map<string, { code: string; bldg: string }>();

  private async ensureCatalog(): Promise<void> {
    if (this.streetCatalog.size > 0) return;

    console.log('[Köln] Discovering street catalog from AWB Köln API...');
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789äöü'.split('');
    const concurrency = 6;

    await mapPool(chars, concurrency, async (ch) => {
      try {
        const url = `${AWB_BASE}/streets?form=json&street_name=${encodeURIComponent(ch)}&building_number=1`;
        const res = await fetch(url, {
          headers: {
            'user-agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)'
          }
        });
        if (!res.ok) return;

        const json = (await res.json()) as { data?: AwbStreetItem[] };
        for (const item of json.data ?? []) {
          const name = item.street_name?.trim();
          if (name && !this.streetCatalog.has(name)) {
            this.streetCatalog.set(name, {
              code: item.street_code,
              bldg: item.building_number || '1'
            });
          }
        }
      } catch (err) {
        console.warn(`[Köln] Error searching for prefix ${ch}:`, err);
      }
    });

    console.log(`[Köln] Found ${this.streetCatalog.size} unique streets.`);
  }

  async fetchStreets(): Promise<string[]> {
    await this.ensureCatalog();
    return Array.from(this.streetCatalog.keys()).sort((a, b) => a.localeCompare(b, 'de'));
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    await this.ensureCatalog();
    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[Köln] Fetching schedules for ${targetStreets.length} streets...`);

    const results = new Map<string, StreetScheduleDates>();
    const concurrency = QUICK ? 4 : 12;
    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const normalized = normalizeStreet(street);
      const meta = this.streetCatalog.get(street);

      if (!meta) {
        results.set(normalized, {});
        completed++;
        return;
      }

      try {
        const url = `${AWB_BASE}/calendar?street_code=${meta.code}&building_number=${meta.bldg}&start_year=${YEAR}&start_month=1&end_year=${YEAR}&end_month=12`;
        const res = await fetch(url, {
          headers: {
            'user-agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)'
          }
        });

        if (!res.ok) {
          results.set(normalized, {});
          completed++;
          return;
        }

        const json = (await res.json()) as { data?: AwbCalendarItem[] };
        const schedule: StreetScheduleDates = {};

        for (const item of json.data ?? []) {
          let cat: CategoryKey | null = null;
          if (item.type === 'grey') cat = 'restmuell';
          else if (item.type === 'brown') cat = 'bioabfall';
          else if (item.type === 'blue') cat = 'papier';
          else if (item.type === 'wertstoff') cat = 'wertstoff';

          if (!cat) continue;

          const iso = `${item.year}-${String(item.month).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`;
          if (iso.startsWith(YEAR.toString())) {
            const list = (schedule[cat] ??= []);
            if (!list.includes(iso)) list.push(iso);
          }
        }

        for (const cat of Object.keys(schedule) as CategoryKey[]) {
          schedule[cat]?.sort();
        }

        results.set(normalized, schedule);
      } catch (err) {
        console.warn(`[Köln] Failed to fetch schedule for ${street}:`, err);
        results.set(normalized, {});
      }

      completed++;
      if (completed % 500 === 0 || completed === targetStreets.length) {
        console.log(`[Köln] Progress: ${completed}/${targetStreets.length} streets fetched.`);
      }
    });

    return results;
  }
}
