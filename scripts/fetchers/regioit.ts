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

export const STANDARD_CATEGORIES: CategoryMeta[] = [
  { key: 'restmuell', label: 'Restmüll', color: '#4b5563' },
  { key: 'bioabfall', label: 'Bioabfall', color: '#92400e' },
  { key: 'wertstoff', label: 'Wertstoff / Gelb', color: '#eab308' },
  { key: 'papier', label: 'Papier', color: '#1d4ed8' }
];

export interface RegioItConfig {
  id: string;
  name: string;
  shortName: string;
  serviceDomain: string;
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
  categories?: CategoryMeta[];
  defaultCategories?: string[];
  mapWasteTypeToCategory?: (name: string) => CategoryKey | null;
}

interface RegioItOrt {
  id: number;
  name: string;
}

interface RegioItStrasse {
  id: number;
  name: string;
}

interface RegioItFraktion {
  id: number;
  name: string;
}

interface RegioItTermin {
  datum: string;
  jahr?: number;
  bezirk?: {
    fraktionId: number;
  };
}

export function defaultMapWasteType(name: string): CategoryKey | null {
  const lower = name.toLowerCase();
  if (lower.includes('rest')) return 'restmuell';
  if (lower.includes('bio')) return 'bioabfall';
  if (lower.includes('papier')) return 'papier';
  if (lower.includes('gelb') || lower.includes('wertstoff') || lower.includes('dsd')) return 'wertstoff';
  return null;
}

const SHARED_DOMAIN_SERVICES = new Set([
  'unna',
  'frankenthal',
  'awvlippe',
  'kranenburg'
]);

export class RegioItFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly serviceDomain: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];
  readonly mapWasteType: (name: string) => CategoryKey | null;

  private primaryBaseUrl: string;
  private fallbackBaseUrl: string;
  private activeBaseUrl: string;
  private streetIdMap = new Map<string, number>();

  constructor(config: RegioItConfig) {
    this.id = config.id;
    this.name = config.name;
    this.shortName = config.shortName;
    this.serviceDomain = config.serviceDomain;
    this.center = config.center;
    this.defaultZoom = config.defaultZoom;
    this.bbox = config.bbox;
    this.categories = config.categories ?? STANDARD_CATEGORIES;
    this.defaultCategories = config.defaultCategories ?? ['restmuell'];
    this.mapWasteType = config.mapWasteTypeToCategory ?? defaultMapWasteType;

    this.primaryBaseUrl = `https://${this.serviceDomain}-abfallapp.regioit.de/abfall-app-${this.serviceDomain}/rest`;
    this.fallbackBaseUrl = `https://abfallapp.regioit.de/abfall-app-${this.serviceDomain}/rest`;
    this.activeBaseUrl = SHARED_DOMAIN_SERVICES.has(this.serviceDomain)
      ? this.fallbackBaseUrl
      : this.primaryBaseUrl;
  }

  private async fetchJson<T>(path: string, maxRetries = 3): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const url = `${this.activeBaseUrl}/${path}`;
        const res = await fetch(url, {
          headers: {
            'user-agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)'
          },
          signal: AbortSignal.timeout(15000)
        });

        if (res.ok) {
          return (await res.json()) as T;
        }

        if (res.status === 404) {
          this.activeBaseUrl =
            this.activeBaseUrl === this.primaryBaseUrl
              ? this.fallbackBaseUrl
              : this.primaryBaseUrl;
        }
      } catch (err) {
        lastError = err;
        this.activeBaseUrl =
          this.activeBaseUrl === this.primaryBaseUrl
            ? this.fallbackBaseUrl
            : this.primaryBaseUrl;
        await Bun.sleep(500 * attempt);
      }
    }

    throw new Error(`[${this.name}] Request failed for ${path}: ${String(lastError)}`);
  }

  async fetchStreets(): Promise<string[]> {
    console.log(`[${this.name}] Fetching cities from RegioIT (${this.serviceDomain})...`);
    let orte: RegioItOrt[] | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        orte = await this.fetchJson<RegioItOrt[]>('orte');
        if (orte && orte.length > 0) break;
      } catch (err) {
        if (attempt === 3) throw err;
      }
      await Bun.sleep(1500 * attempt);
    }
    if (!orte || orte.length === 0) {
      throw new Error(`[${this.name}] No city entries found for service domain ${this.serviceDomain}`);
    }

    // Match city by name with fallback strategies:
    // 1. Exact match
    // 2. Strip parentheticals from both sides (e.g. "Senden (Westfalen)" matches "Senden")
    // 3. Prefix match (e.g. "Halle (Westf)" matches "Halle (Westfalen)")
    // 4. Fall back to first entry for single-city domains
    const nameLower = this.name.toLowerCase();
    const nameBase = nameLower.replace(/\s*\(.*?\)\s*$/, '').trim();
    const city =
      orte.find((o) => o.name.toLowerCase() === nameLower) ??
      orte.find((o) => o.name.toLowerCase() === nameBase) ??
      orte.find((o) => o.name.toLowerCase().replace(/\s*\(.*?\)\s*$/, '').trim() === nameBase) ??
      orte[0];
    console.log(`[${this.name}] Using city ID ${city.id} (${city.name})`);

    const strassen = await this.fetchJson<RegioItStrasse[]>(`orte/${city.id}/strassen`);
    this.streetIdMap.clear();

    const uniqueNames: string[] = [];
    for (const s of strassen) {
      if (s.name && !this.streetIdMap.has(s.name)) {
        this.streetIdMap.set(s.name, s.id);
        uniqueNames.push(s.name);
      }
    }

    uniqueNames.sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[${this.name}] Found ${uniqueNames.length} streets.`);
    return uniqueNames;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    if (this.streetIdMap.size === 0) {
      await this.fetchStreets();
    }

    console.log(`[${this.name}] Fetching fraktionen...`);
    const fraktionen = await this.fetchJson<RegioItFraktion[]>('fraktionen');

    const fraktionToCategory = new Map<number, CategoryKey>();
    for (const f of fraktionen) {
      const cat = this.mapWasteType(f.name);
      if (cat) {
        fraktionToCategory.set(f.id, cat);
      }
    }

    const fraktionQuery = fraktionen.map((f) => `fraktion=${f.id}`).join('&');
    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[${this.name}] Fetching schedules for ${targetStreets.length} streets...`);

    const results = new Map<string, StreetScheduleDates>();
    const concurrency = QUICK ? 4 : 12;
    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const streetId = this.streetIdMap.get(street);
      const normalized = normalizeStreet(street);

      if (!streetId) {
        results.set(normalized, {});
        return;
      }

      try {
        const termine = await this.fetchJson<RegioItTermin[]>(
          `strassen/${streetId}/termine?${fraktionQuery}`
        );

        const schedule: StreetScheduleDates = {};

        for (const t of termine ?? []) {
          if (!t.datum) continue;
          if (t.jahr && t.jahr !== YEAR) continue;
          if (!t.datum.startsWith(YEAR.toString())) continue;

          const cat = t.bezirk?.fraktionId !== undefined
            ? fraktionToCategory.get(t.bezirk.fraktionId)
            : undefined;

          if (!cat) continue;

          const list = (schedule[cat] ??= []);
          if (!list.includes(t.datum)) {
            list.push(t.datum);
          }
        }

        // Sort dates chronologically
        for (const cat of Object.keys(schedule) as CategoryKey[]) {
          schedule[cat]?.sort();
        }

        results.set(normalized, schedule);
      } catch (err) {
        console.warn(`[${this.name}] Failed to fetch schedule for ${street} (ID ${streetId}):`, err);
        results.set(normalized, {});
      }

      completed++;
      if (completed % 250 === 0 || completed === targetStreets.length) {
        console.log(`[${this.name}] Progress: ${completed}/${targetStreets.length} streets fetched.`);
      }
    });

    return results;
  }
}
