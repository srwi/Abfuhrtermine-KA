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

export interface AwshConfig {
  id: string;
  name: string;
  shortName: string;
  cityId: number;
  plz?: string;
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
  categories?: CategoryMeta[];
  defaultCategories?: string[];
}

export function defaultAwshMapWasteType(summary: string): CategoryKey[] {
  const lower = summary.toLowerCase();
  const cats: CategoryKey[] = [];
  if (lower.includes('sperr')) cats.push('sperrmuell');
  if (lower.includes('rest')) cats.push('restmuell');
  if (lower.includes('bio') || lower.includes('grün')) cats.push('bioabfall');
  if (lower.includes('papier') || lower.includes('pappe')) cats.push('papier');
  if (lower.includes('gelb') || lower.includes('wertstoff') || lower.includes('verpackung') || lower.includes('dsd')) cats.push('wertstoff');
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

export class AwshFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly cityId: number;
  readonly plz?: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];

  private streetMap = new Map<string, number>(); // streetName -> strassennummer
  private wasteTypesParam: string | null = null;

  constructor(cfg: AwshConfig) {
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
    console.log(`[${this.name}] Fetching streets from AWSH (cityId: ${this.cityId})...`);
    const res = await fetch(`https://www.awsh.de/api_v2/collection_dates/1/ort/${this.cityId}/strassen`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) {
      throw new Error(`[${this.name}] Failed to fetch streets from AWSH: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { strassen?: Array<{ strassennummer: number; strassenbezeichnung: string }> };
    const rawStreets = data.strassen ?? [];

    this.streetMap.clear();
    for (const s of rawStreets) {
      if (s.strassenbezeichnung && typeof s.strassennummer === 'number') {
        this.streetMap.set(s.strassenbezeichnung.trim(), s.strassennummer);
      }
    }

    const unique = Array.from(this.streetMap.keys()).sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[${this.name}] Found ${unique.length} streets in AWSH.`);
    return unique;
  }

  private async ensureWasteTypes(): Promise<string> {
    if (this.wasteTypesParam) return this.wasteTypesParam;

    try {
      const res = await fetch(`https://www.awsh.de/api_v2/collection_dates/1/ort/${this.cityId}/abfallarten`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.ok) {
        const data = (await res.json()) as { abfallarten?: Array<{ id: string }> };
        const ids = data.abfallarten?.map((a) => a.id).filter(Boolean) ?? [];
        if (ids.length > 0) {
          this.wasteTypesParam = ids.join('-');
          return this.wasteTypesParam;
        }
      }
    } catch {}

    this.wasteTypesParam = 'R02-R88-R04-B02-D02-P04-P11-P12-R11-R12-W0-R14';
    return this.wasteTypesParam;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    if (this.streetMap.size === 0) {
      await this.fetchStreets();
    }

    const wtParam = await this.ensureWasteTypes();
    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[${this.name}] Fetching schedules for ${targetStreets.length} streets via AWSH...`);

    const results = new Map<string, StreetScheduleDates>();
    const concurrency = QUICK ? 4 : 12;
    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const normalized = normalizeStreet(street);
      const streetId = this.streetMap.get(street);

      if (!streetId) {
        results.set(normalized, {});
        return;
      }

      try {
        const calUrl = `https://www.awsh.de/api_v2/collection_dates/1/ort/${this.cityId}/strasse/${streetId}/hausnummern/0/abfallarten/${wtParam}/kalender.ics`;
        const res = await fetch(calUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (!res.ok) {
          results.set(normalized, {});
          return;
        }

        const icsText = await res.text();
        if (!icsText.includes('BEGIN:VCALENDAR')) {
          results.set(normalized, {});
          return;
        }

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
              const cats = defaultAwshMapWasteType(summary);
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
