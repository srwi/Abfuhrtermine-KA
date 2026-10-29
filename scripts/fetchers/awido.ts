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

export interface AwidoConfig {
  id: string;
  name: string;
  shortName: string;
  customer: string;
  placeKey?: string;
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
  categories?: CategoryMeta[];
  defaultCategories?: string[];
  mapWasteTypeToCategory?: (name: string) => CategoryKey | null;
}

interface AwidoPlace {
  key: string;
  value: string;
}

interface AwidoStreet {
  key: string;
  value: string;
}

interface AwidoCalItem {
  dt: string; // "YYYYMMDD"
  fr: string[] | null;
  ad: string[] | null;
}

interface AwidoData {
  fracts?: Array<{ nm: string; snm: string }>;
  calendar?: AwidoCalItem[];
}

export function defaultAwidoMapWasteType(name: string): CategoryKey | null {
  const lower = name.toLowerCase();
  if (lower.includes('sperr')) return 'sperrmuell';
  if (lower.includes('rest') || lower.includes('hausmüll') || lower.includes('hausmuell')) return 'restmuell';
  if (lower.includes('bio') || lower.includes('grün') || lower.includes('gruen') || lower.includes('garten')) return 'bioabfall';
  if (lower.includes('papier') || lower.includes('altpapier') || lower.includes('karton') || lower.includes('blau')) return 'papier';
  if (lower.includes('gelb') || lower.includes('wertstoff') || lower.includes('dsd') || lower.includes('verpackung')) return 'wertstoff';
  return null;
}

export class AwidoFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly customer: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];
  readonly mapWasteType: (name: string) => CategoryKey | null;

  private placeKey?: string;
  private streetKeyMap = new Map<string, string>();

  constructor(config: AwidoConfig) {
    this.id = config.id;
    this.name = config.name;
    this.shortName = config.shortName;
    this.customer = config.customer;
    this.placeKey = config.placeKey;
    this.center = config.center;
    this.defaultZoom = config.defaultZoom;
    this.bbox = config.bbox;
    this.categories = config.categories ?? STANDARD_CATEGORIES;
    this.defaultCategories = config.defaultCategories ?? ['restmuell'];
    this.mapWasteType = config.mapWasteTypeToCategory ?? defaultAwidoMapWasteType;
  }

  private async fetchJson<T>(url: string, maxRetries = 3): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            'user-agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)'
          },
          signal: AbortSignal.timeout(15000)
        });

        if (res.ok) {
          const text = await res.text();
          if (!text || text.trim() === '') return [] as unknown as T;
          return JSON.parse(text) as T;
        }
      } catch (err) {
        lastError = err;
        await Bun.sleep(500 * attempt);
      }
    }

    throw new Error(`[${this.name}] Request failed for ${url}: ${String(lastError)}`);
  }

  async fetchStreets(): Promise<string[]> {
    if (!this.placeKey) {
      console.log(`[${this.name}] Looking up place in Awido (${this.customer})...`);
      const placesUrl = `https://awido.cubefour.de/WebServices/Awido.Service.svc/secure/getPlaces/client=${this.customer}`;
      const places = await this.fetchJson<AwidoPlace[]>(placesUrl);

      const nameLower = this.name.toLowerCase();
      const nameBase = nameLower.replace(/\s*\(.*?\)\s*$/, '').trim();

      const place =
        places.find((p) => p.value.toLowerCase() === nameLower) ??
        places.find((p) => p.value.toLowerCase() === nameBase) ??
        places.find((p) => p.value.toLowerCase().replace(/\s*\(.*?\)\s*$/, '').trim() === nameBase) ??
        places[0];

      if (!place) {
        throw new Error(`[${this.name}] No place found in Awido for ${this.name} (${this.customer})`);
      }

      this.placeKey = place.key;
      console.log(`[${this.name}] Resolved place: ${place.value} (${this.placeKey})`);
    }

    console.log(`[${this.name}] Fetching streets from Awido (${this.customer})...`);
    const streetsUrl = `https://awido.cubefour.de/WebServices/Awido.Service.svc/secure/getGroupedStreets/${this.placeKey}?client=${this.customer}`;
    const rawStreets = await this.fetchJson<AwidoStreet[]>(streetsUrl);

    this.streetKeyMap.clear();
    const uniqueNames: string[] = [];

    for (const s of rawStreets ?? []) {
      if (!s.value) continue;
      const clean = s.value.trim();
      if (!clean || this.streetKeyMap.has(clean)) continue;
      this.streetKeyMap.set(clean, s.key);
      uniqueNames.push(clean);
    }

    uniqueNames.sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[${this.name}] Found ${uniqueNames.length} streets.`);
    return uniqueNames;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    if (this.streetKeyMap.size === 0) {
      await this.fetchStreets();
    }

    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[${this.name}] Fetching schedules for ${targetStreets.length} streets via Awido...`);

    const results = new Map<string, StreetScheduleDates>();
    const concurrency = QUICK ? 4 : 10;
    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const streetKey = this.streetKeyMap.get(street);
      if (!streetKey) return;

      const schedule: StreetScheduleDates = {};
      try {
        const dataUrl = `https://awido.cubefour.de/WebServices/Awido.Service.svc/secure/getData/${streetKey}?fractions=&client=${this.customer}`;
        const data = await this.fetchJson<AwidoData>(dataUrl);

        const fractionMap = new Map<string, CategoryKey>();
        for (const fract of data.fracts ?? []) {
          const cat = this.mapWasteType(fract.nm);
          if (cat) {
            fractionMap.set(fract.snm, cat);
          }
        }

        const currentYearStr = String(YEAR);

        for (const item of data.calendar ?? []) {
          if (!item.dt || !item.fr) continue;
          if (!item.dt.startsWith(currentYearStr)) continue;

          // Convert "20260105" -> "2026-01-05"
          const dateStr = `${item.dt.slice(0, 4)}-${item.dt.slice(4, 6)}-${item.dt.slice(6, 8)}`;

          for (const snm of item.fr) {
            const cat = fractionMap.get(snm);
            if (!cat) continue;
            if (!schedule[cat]) {
              schedule[cat] = [];
            }
            if (!schedule[cat]!.includes(dateStr)) {
              schedule[cat]!.push(dateStr);
            }
          }
        }

        // Sort dates ascending
        for (const cat of Object.keys(schedule) as CategoryKey[]) {
          schedule[cat]?.sort();
        }

        results.set(street, schedule);
      } catch (err) {
        console.warn(`[${this.name}] Failed to fetch schedule for "${street}":`, err);
      }

      completed++;
      if (completed % 100 === 0 || completed === targetStreets.length) {
        console.log(`[${this.name}] Progress: ${completed}/${targetStreets.length} streets fetched.`);
      }
    });

    return results;
  }
}
