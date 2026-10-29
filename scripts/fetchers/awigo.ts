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

export interface AwigoConfig {
  id: string;
  name: string;
  shortName: string;
  cityId: string;
  plz?: string;
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
  categories?: CategoryMeta[];
  defaultCategories?: string[];
}

export function defaultAwigoMapWasteType(summary: string): CategoryKey[] {
  const lower = summary.toLowerCase();
  const cats: CategoryKey[] = [];
  if (lower.includes('sperr')) cats.push('sperrmuell');
  if (lower.includes('rest')) cats.push('restmuell');
  if (lower.includes('bio') || lower.includes('braun')) cats.push('bioabfall');
  if (lower.includes('papier') || lower.includes('pappe')) cats.push('papier');
  if (lower.includes('gelb') || lower.includes('wertstoff') || lower.includes('verpackung')) cats.push('wertstoff');
  return cats;
}

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

export class AwigoFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly cityId: string;
  readonly plz?: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];

  private streetMap = new Map<string, string>(); // streetName -> streetID

  constructor(cfg: AwigoConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.shortName = cfg.shortName;
    this.cityId = cfg.cityId;
    this.plz = cfg.plz;
    this.center = cfg.center;
    this.defaultZoom = cfg.defaultZoom;
    this.bbox = cfg.bbox;
    this.categories = cfg.categories ?? STANDARD_CATEGORIES;
    this.defaultCategories = cfg.defaultCategories ?? ['restmuell', 'bioabfall', 'papier', 'wertstoff'];
  }

  async fetchStreets(): Promise<string[]> {
    console.log(`[${this.name}] Fetching streets from Awigo (cityID: ${this.cityId})...`);
    const strUrl = `https://www.awigo.de/index.php?legacy_eID=awigoCalendar&calendar[method]=getStreets&calendar[cityID]=${this.cityId}`;
    const res = await fetch(strUrl, { method: 'POST' });
    if (!res.ok) {
      throw new Error(`[${this.name}] Failed to fetch streets from Awigo: ${res.status}`);
    }

    const html = await res.text();
    const matches = [...html.matchAll(/<option[^>]+value="([^"]+)"[^>]*>([^<]+)<\/option>/g)];

    this.streetMap.clear();
    for (const m of matches) {
      const id = m[1].trim();
      const sName = m[2].trim();
      if (id && sName) {
        this.streetMap.set(sName, id);
      }
    }

    const unique = Array.from(this.streetMap.keys()).sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[${this.name}] Found ${unique.length} streets in Awigo.`);
    return unique;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    if (this.streetMap.size === 0) {
      await this.fetchStreets();
    }

    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[${this.name}] Fetching schedules for ${targetStreets.length} streets via Awigo...`);

    const results = new Map<string, StreetScheduleDates>();
    const concurrency = QUICK ? 4 : 8;
    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const normalized = normalizeStreet(street);
      const streetId = this.streetMap.get(street);

      if (!streetId) {
        results.set(normalized, {});
        return;
      }

      try {
        // Step 1: get numbers
        const numUrl = `https://www.awigo.de/index.php?legacy_eID=awigoCalendar&calendar[method]=getNumbers&calendar[cityID]=${this.cityId}&calendar[streetID]=${streetId}`;
        const nRes = await fetch(numUrl, { method: 'POST' });
        if (!nRes.ok) {
          results.set(normalized, {});
          return;
        }

        const nHtml = await nRes.text();
        const numMatches = [...nHtml.matchAll(/<option[^>]+value="([^"]+)"[^>]*>/g)];
        const locId = numMatches.find((m) => m[1].trim().length > 0)?.[1]?.trim();

        if (!locId) {
          results.set(normalized, {});
          return;
        }

        // Step 2: get ICS file URL
        const icsReqUrl = `https://www.awigo.de/index.php?legacy_eID=awigoCalendar&calendar[method]=getICSfile&calendar[cityID]=${this.cityId}&calendar[streetID]=${streetId}&calendar[locationID]=${locId}&calendar[rest]=1&calendar[paper]=1&calendar[yellow]=1&calendar[brown]=1&calendar[mobile]=1`;
        const icsRes = await fetch(icsReqUrl, { method: 'POST' });
        if (!icsRes.ok) {
          results.set(normalized, {});
          return;
        }

        const icsLink = (await icsRes.text()).trim();
        if (!icsLink.startsWith('http')) {
          results.set(normalized, {});
          return;
        }

        // Step 3: download ICS
        const calRes = await fetch(icsLink);
        if (!calRes.ok) {
          results.set(normalized, {});
          return;
        }

        const icsText = await calRes.text();
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
              const cats = defaultAwigoMapWasteType(summary);
              for (const cat of cats) {
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
        console.warn(`[${this.name}] Failed to fetch schedule for ${street}:`, err);
        results.set(normalized, {});
      } finally {
        completed++;
        if (completed % 50 === 0 || completed === targetStreets.length) {
          console.log(`[${this.name}] Progress: ${completed}/${targetStreets.length} streets fetched.`);
        }
      }
    });

    return results;
  }
}
