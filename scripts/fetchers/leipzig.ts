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

const LEIPZIG_BASE = 'https://stadtreinigung-leipzig.de';

function unfoldIcal(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

export class LeipzigFetcher implements CityFetcher {
  readonly id = 'leipzig';
  readonly name = 'Leipzig';
  readonly shortName = 'L';
  readonly center: [number, number] = [12.3747, 51.3406];
  readonly defaultZoom = 12;
  readonly bbox: [number, number, number, number] = [51.2382, 12.2367, 51.4481, 12.5425];
  readonly categories: CategoryMeta[] = STANDARD_CATEGORIES;
  readonly defaultCategories = ['restmuell'];

  private streetCatalog = new Map<string, string>(); // streetName -> position_nos

  private async ensureCatalog(): Promise<void> {
    if (this.streetCatalog.size > 0) return;

    console.log('[Leipzig] Discovering street catalog from Stadtreinigung Leipzig API...');
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789äöü'.split('');
    const concurrency = 6;

    await mapPool(chars, concurrency, async (ch) => {
      try {
        const url = `${LEIPZIG_BASE}/rest/Navision/Streets?old_format=1&search=${encodeURIComponent(ch)}`;
        const res = await fetch(url, {
          headers: {
            'user-agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)'
          }
        });
        if (!res.ok) return;

        const json = (await res.json()) as { results?: Record<string, Record<string, string | string[]>> };
        for (const [street, hnrs] of Object.entries(json.results ?? {})) {
          if (!this.streetCatalog.has(street)) {
            const firstHnr = Object.keys(hnrs)[0];
            const posIds = hnrs[firstHnr];
            const posId = Array.isArray(posIds) ? posIds[0] : posIds;
            if (posId) {
              this.streetCatalog.set(street, posId);
            }
          }
        }
      } catch (err) {
        console.warn(`[Leipzig] Error searching for prefix ${ch}:`, err);
      }
    });

    console.log(`[Leipzig] Found ${this.streetCatalog.size} unique streets.`);
  }

  async fetchStreets(): Promise<string[]> {
    await this.ensureCatalog();
    return Array.from(this.streetCatalog.keys()).sort((a, b) => a.localeCompare(b, 'de'));
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    await this.ensureCatalog();
    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[Leipzig] Fetching schedules for ${targetStreets.length} streets...`);

    const results = new Map<string, StreetScheduleDates>();
    const concurrency = QUICK ? 4 : 10;
    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const normalized = normalizeStreet(street);
      const posId = this.streetCatalog.get(street);

      if (!posId) {
        results.set(normalized, {});
        completed++;
        return;
      }

      try {
        const url = `${LEIPZIG_BASE}/wir-kommen-zu-ihnen/abfallkalender/ical.ics?position_nos=${encodeURIComponent(posId)}&mode=download`;
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

        const icsText = await res.text();
        const schedule: StreetScheduleDates = {};
        let summary: string | null = null;
        let dtstart: string | null = null;

        for (const line of unfoldIcal(icsText)) {
          if (line.startsWith('BEGIN:VEVENT')) {
            summary = null;
            dtstart = null;
          } else if (line.startsWith('SUMMARY:')) {
            summary = line.slice('SUMMARY:'.length).trim();
          } else if (line.startsWith('DTSTART')) {
            dtstart = line.match(/:(\d{8})/)?.[1] ?? null;
          } else if (line.startsWith('END:VEVENT') && summary && dtstart) {
            const iso = `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}`;
            if (iso.startsWith(YEAR.toString())) {
              let cat: CategoryKey | null = null;
              const sLower = summary.toLowerCase();
              if (sLower.includes('rest')) cat = 'restmuell';
              else if (sLower.includes('bio')) cat = 'bioabfall';
              else if (sLower.includes('blau') || sLower.includes('papier')) cat = 'papier';
              else if (sLower.includes('gelb') || sLower.includes('wertstoff')) cat = 'wertstoff';

              if (cat) {
                const list = (schedule[cat] ??= []);
                if (!list.includes(iso)) list.push(iso);
              }
            }
          }
        }

        for (const cat of Object.keys(schedule) as CategoryKey[]) {
          schedule[cat]?.sort();
        }

        results.set(normalized, schedule);
      } catch (err) {
        console.warn(`[Leipzig] Failed to fetch schedule for ${street}:`, err);
        results.set(normalized, {});
      }

      completed++;
      if (completed % 250 === 0 || completed === targetStreets.length) {
        console.log(`[Leipzig] Progress: ${completed}/${targetStreets.length} streets fetched.`);
      }
    });

    return results;
  }
}
