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

export interface JumoMindConfig {
  id: string;
  name: string;
  shortName: string;
  serviceId?: string; // Default: 'mymuell'
  cityId?: string; // Explicit numeric city ID if known, or auto-resolved by name
  center: [number, number]; // [lon, lat]
  defaultZoom: number;
  bbox: [number, number, number, number]; // [south, west, north, east]
  categories?: CategoryMeta[];
  defaultCategories?: string[];
  mapWasteTypeToCategory?: (title: string, trashName: string) => CategoryKey | null;
}

interface JumoMindCity {
  id: string;
  name: string;
  _name?: string;
  has_streets?: boolean;
}

interface JumoMindStreet {
  id: string;
  name: string;
  _name?: string;
  area_id: string;
  street_comment?: string;
}

interface JumoMindAppointment {
  id?: string;
  title: string;
  trash_name: string;
  day: string; // "YYYY-MM-DD"
  description?: string;
  color?: string;
}

/**
 * Normalizes JumoMind street names by stripping parenthetical suffixes
 * and trailing house number ranges (e.g. "Adelungstraße 1-41, 2-38" -> "Adelungstraße").
 */
export function cleanJumoMindStreetName(raw: string): string {
  let cleaned = raw.replace(/\s*\([^)]*(\)|$)/, '').trim();
  cleaned = cleaned.replace(/\s+\d+.*$/, '').trim();
  return cleaned || raw.trim();
}

export function defaultJumoMindMapWasteType(title: string, trashName: string): CategoryKey | null {
  const text = `${title} ${trashName}`.toLowerCase();
  if (text.includes('sperr')) return 'sperrmuell';
  if (text.includes('rest')) return 'restmuell';
  if (text.includes('bio')) return 'bioabfall';
  if (text.includes('papier') || text.includes('blau')) return 'papier';
  if (text.includes('gelb') || text.includes('wertstoff') || text.includes('dsd')) return 'wertstoff';
  return null;
}

export class JumoMindFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly serviceId: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];
  readonly mapWasteType: (title: string, trashName: string) => CategoryKey | null;

  private cityId?: string;
  private apiUrl: string;
  private streetAreaMap = new Map<string, string[]>();

  constructor(config: JumoMindConfig) {
    this.id = config.id;
    this.name = config.name;
    this.shortName = config.shortName;
    this.serviceId = config.serviceId ?? 'mymuell';
    this.cityId = config.cityId;
    this.center = config.center;
    this.defaultZoom = config.defaultZoom;
    this.bbox = config.bbox;
    this.categories = config.categories ?? STANDARD_CATEGORIES;
    this.defaultCategories = config.defaultCategories ?? ['restmuell'];
    this.mapWasteType = config.mapWasteTypeToCategory ?? defaultJumoMindMapWasteType;
    this.apiUrl = `https://${this.serviceId}.jumomind.com/mmapp/api.php`;
  }

  private async fetchJson<T>(params: Record<string, string>, maxRetries = 3): Promise<T> {
    const url = new URL(this.apiUrl);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url.toString(), {
          headers: {
            'user-agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)'
          },
          signal: AbortSignal.timeout(15000)
        });

        if (res.ok) {
          return (await res.json()) as T;
        }

        if (attempt < maxRetries && (res.status >= 500 || res.status === 429)) {
          await Bun.sleep(500 * attempt);
          continue;
        }

        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await Bun.sleep(500 * attempt);
        }
      }
    }

    throw new Error(`[${this.name}] Request failed for ${url.search}: ${String(lastError)}`);
  }

  async fetchStreets(): Promise<string[]> {
    if (!this.cityId) {
      console.log(`[${this.name}] Looking up city ID in JumoMind (${this.serviceId})...`);
      const cities = await this.fetchJson<JumoMindCity[]>({ r: 'cities' });
      const found = cities.find(
        (c) => c.name.toLowerCase() === this.name.toLowerCase() || c.id === this.id
      );
      if (!found) {
        throw new Error(`[${this.name}] City "${this.name}" not found in JumoMind service "${this.serviceId}".`);
      }
      this.cityId = found.id;
      console.log(`[${this.name}] Resolved city ID: ${this.cityId} (${found.name})`);
    }

    console.log(`[${this.name}] Fetching streets from JumoMind (${this.serviceId}, city ${this.cityId})...`);
    const rawStreets = await this.fetchJson<JumoMindStreet[]>({
      r: 'streets',
      city_id: this.cityId
    });

    this.streetAreaMap.clear();
    const uniqueBaseStreets = new Set<string>();

    for (const entry of rawStreets ?? []) {
      if (!entry.name) continue;
      const base = cleanJumoMindStreetName(entry.name);
      if (!base) continue;

      uniqueBaseStreets.add(base);

      if (entry.area_id && entry.area_id !== '0') {
        const rawList = this.streetAreaMap.get(base) ?? [];
        if (!rawList.includes(entry.area_id)) {
          rawList.push(entry.area_id);
        }
        this.streetAreaMap.set(base, rawList);
        this.streetAreaMap.set(normalizeStreet(base), rawList);
      }
    }

    const sorted = Array.from(uniqueBaseStreets).sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[${this.name}] Found ${sorted.length} unique streets (${rawStreets.length} raw entries).`);
    return sorted;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    if (this.streetAreaMap.size === 0) {
      await this.fetchStreets();
    }

    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[${this.name}] Fetching schedules for ${targetStreets.length} streets...`);

    // Collect all unique area_ids needed for target streets
    const neededAreaIds = new Set<string>();
    for (const street of targetStreets) {
      const areas = this.streetAreaMap.get(street) ?? this.streetAreaMap.get(normalizeStreet(street)) ?? [];
      for (const areaId of areas) {
        neededAreaIds.add(areaId);
      }
    }

    console.log(`[${this.name}] Fetching appointments for ${neededAreaIds.size} unique areas...`);
    const areaDatesCache = new Map<string, JumoMindAppointment[]>();
    const areaIdList = Array.from(neededAreaIds);
    const concurrency = QUICK ? 4 : 12;
    let completedAreas = 0;

    await mapPool(areaIdList, concurrency, async (areaId) => {
      try {
        const dates = await this.fetchJson<JumoMindAppointment[]>({
          r: 'dates',
          city_id: this.cityId!,
          area_id: areaId
        });
        areaDatesCache.set(areaId, dates ?? []);
      } catch (err) {
        console.warn(`[${this.name}] Failed to fetch dates for area ${areaId}:`, err);
        areaDatesCache.set(areaId, []);
      }
      completedAreas++;
      if (completedAreas % 250 === 0 || completedAreas === areaIdList.length) {
        console.log(`[${this.name}] Areas progress: ${completedAreas}/${areaIdList.length} fetched.`);
      }
    });

    const results = new Map<string, StreetScheduleDates>();

    for (const street of targetStreets) {
      const normalized = normalizeStreet(street);
      const schedule: StreetScheduleDates = {};
      const areas = this.streetAreaMap.get(street) ?? this.streetAreaMap.get(normalized) ?? [];

      for (const areaId of areas) {
        const dates = areaDatesCache.get(areaId) ?? [];
        for (const app of dates) {
          if (!app.day || !app.day.startsWith(YEAR.toString())) continue;
          const cat = this.mapWasteType(app.title ?? '', app.trash_name ?? '');
          if (!cat) continue;

          const list = (schedule[cat] ??= []);
          if (!list.includes(app.day)) {
            list.push(app.day);
          }
        }
      }

      // Sort dates chronologically
      for (const cat of Object.keys(schedule) as CategoryKey[]) {
        schedule[cat]?.sort();
      }

      results.set(normalized, schedule);
    }

    return results;
  }
}
