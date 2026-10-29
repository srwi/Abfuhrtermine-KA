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

export interface AhaConfig {
  id: string;
  name: string;
  shortName: string;
  gemeinde: string;
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
  categories?: CategoryMeta[];
  defaultCategories?: string[];
}

export function defaultAhaMapWasteType(summary: string): CategoryKey[] {
  const lower = summary.toLowerCase();
  const cats: CategoryKey[] = [];
  if (lower.includes('sperr')) cats.push('sperrmuell');
  if (lower.includes('restabfall') || lower.includes('restmüll')) cats.push('restmuell');
  if (lower.includes('bioabfall') || lower.includes('biomüll')) cats.push('bioabfall');
  if (lower.includes('papier') || lower.includes('altpapier')) cats.push('papier');
  if (lower.includes('leichtverpackung') || lower.includes('wertstoff') || lower.includes('gelb')) cats.push('wertstoff');
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

export class AhaFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly gemeinde: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];

  private streetMap = new Map<string, string>(); // streetName -> optionValue
  private readonly baseUrl = 'https://www.aha-region.de/abholtermine/abfuhrkalender';

  constructor(cfg: AhaConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.shortName = cfg.shortName;
    this.gemeinde = cfg.gemeinde;
    this.center = cfg.center;
    this.defaultZoom = cfg.defaultZoom;
    this.bbox = cfg.bbox;
    this.categories = cfg.categories ?? STANDARD_CATEGORIES;
    this.defaultCategories = cfg.defaultCategories ?? ['restmuell', 'bioabfall', 'papier', 'wertstoff'];
  }

  async fetchStreets(): Promise<string[]> {
    console.log(`[${this.name}] Fetching streets from aha (gemeinde: ${this.gemeinde})...`);
    this.streetMap.clear();

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    await mapPool(letters, 6, async (char) => {
      try {
        const url = `${this.baseUrl}?gemeinde=${encodeURIComponent(this.gemeinde)}&von=${char}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) return;

        const text = await res.text();
        const re = /<option[^>]+value=['"]([^'"]+)['"][^>]*>([^<]+)<\/option>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const val = m[1].trim();
          const label = m[2].trim();
          if (val.includes('@') && label) {
            this.streetMap.set(label, val);
          }
        }
      } catch (err) {
        console.warn(`[${this.name}] Error fetching letter ${char}:`, err);
      }
    });

    const unique = Array.from(this.streetMap.keys()).sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[${this.name}] Found ${unique.length} streets in aha.`);
    return unique;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    if (this.streetMap.size === 0) {
      await this.fetchStreets();
    }

    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[${this.name}] Fetching schedules for ${targetStreets.length} streets via aha...`);

    const results = new Map<string, StreetScheduleDates>();
    const concurrency = QUICK ? 4 : 8;
    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const normalized = normalizeStreet(street);
      const strVal = this.streetMap.get(street);

      if (!strVal) {
        results.set(normalized, {});
        return;
      }

      const von = street.trim().charAt(0).toUpperCase();

      try {
        // Step 1: get ladeort
        const body1 = new URLSearchParams({
          gemeinde: this.gemeinde,
          jsaus: '',
          von,
          strasse: strVal,
          hausnr: '1',
          hausnraddon: '',
          anzeigen: 'Suchen'
        });

        const r1 = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0'
          },
          body: body1.toString()
        });

        if (!r1.ok) {
          results.set(normalized, {});
          return;
        }

        const html1 = await r1.text();
        const ladeortMatch = html1.match(/name=['"]ladeort['"][^>]*value=['"]([^'"]+)['"]/i);
        const selectLadeort = html1.match(/<select[^>]+name=['"]ladeort['"][^>]*>[\s\S]*?<option[^>]+value=['"]([^'"]+)['"]/i);
        const ladeort = ladeortMatch?.[1] || selectLadeort?.[1] || '';

        // Step 2: request ICAL
        const body2 = new URLSearchParams({
          gemeinde: this.gemeinde,
          jsaus: '',
          von,
          strasse: strVal,
          hausnr: '1',
          hausnraddon: '',
          ladeort,
          ical: 'ICAL Jahresübersicht'
        });

        const r2 = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0'
          },
          body: body2.toString()
        });

        if (!r2.ok) {
          results.set(normalized, {});
          return;
        }

        const icsText = await r2.text();
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
              const cats = defaultAhaMapWasteType(summary);
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
