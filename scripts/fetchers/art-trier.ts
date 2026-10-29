import {
  type CategoryKey,
  type CategoryMeta,
  YEAR,
  normalizeStreet
} from '../lib/shared.ts';
import type { CityFetcher, StreetScheduleDates } from './types.ts';
import { STANDARD_CATEGORIES } from './regioit.ts';

export interface ArtTrierConfig {
  id: string;
  name: string;
  shortName: string;
  ort: string; // Query name in Strapi backend, e.g. 'Trier', 'Wittlich', 'Bitburg-Stadt', 'Speicher'
  center: [number, number]; // [lon, lat]
  defaultZoom: number;
  bbox: [number, number, number, number]; // [south, west, north, east]
  categories?: CategoryMeta[];
  defaultCategories?: string[];
  mapWasteTypeToCategory?: (titel: string, abfallart: string) => CategoryKey | null;
}

interface StrapiSearchItem {
  plz: string;
  ort: string;
  strasse: string | null;
  ortsteil: string | null;
  verbandsgemeinde: string | null;
  key: string;
}

interface StrapiAppointmentItem {
  id: number;
  attributes: {
    plz?: string;
    ort?: string;
    strasse?: string | null;
    ortsteil?: string | null;
    datum: string;
    importYear: string;
    key: string;
    abfallarten?: {
      data?: Array<{
        id: number;
        attributes?: {
          titel?: string;
          abfallart?: string;
        };
      }>;
    };
  };
}

export function defaultArtTrierMapWasteType(titel: string, abfallart: string): CategoryKey | null {
  const text = `${titel} ${abfallart}`.toLowerCase();
  if (text.includes('sperr')) return 'sperrmuell';
  if (text.includes('rest')) return 'restmuell';
  if (text.includes('bio')) return 'bioabfall';
  if (text.includes('papier') || text.includes('altpapier') || text.includes('pappe')) return 'papier';
  if (text.includes('gelb') || text.includes('wertstoff') || text.includes('sack')) return 'wertstoff';
  return null;
}

export class ArtTrierFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly ort: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];
  readonly mapWasteType: (titel: string, abfallart: string) => CategoryKey | null;

  constructor(cfg: ArtTrierConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.shortName = cfg.shortName;
    this.ort = cfg.ort;
    this.center = cfg.center;
    this.defaultZoom = cfg.defaultZoom;
    this.bbox = cfg.bbox;
    this.categories = cfg.categories ?? STANDARD_CATEGORIES;
    this.defaultCategories = cfg.defaultCategories ?? ['restmuell', 'papier', 'wertstoff'];
    this.mapWasteType = cfg.mapWasteTypeToCategory ?? defaultArtTrierMapWasteType;
  }

  async fetchStreets(): Promise<string[]> {
    console.log(`[${this.name}] Querying streets from ART Trier (ort="${this.ort}")...`);
    const searchUrl = `https://redaktion.art-trier.de/api/abfuhrtermine/search?query=${encodeURIComponent(
      this.ort
    )}&pagination[pageSize]=3000`;

    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)' }
    });

    if (!res.ok) {
      throw new Error(`[${this.name}] Failed to search streets in ART Trier: HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data?: StrapiSearchItem[] };
    const items = (json.data ?? []).filter(
      (item) => item.ort?.toLowerCase().trim() === this.ort.toLowerCase().trim()
    );

    const streets = new Set<string>();
    for (const item of items) {
      if (item.strasse && item.strasse.trim()) {
        streets.add(item.strasse.trim());
      }
    }

    if (streets.size === 0) {
      // Single-zone place where entire village shares one schedule
      streets.add(this.name);
    }

    const sorted = Array.from(streets).sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[${this.name}] Found ${sorted.length} streets in ART Trier.`);
    return sorted;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    console.log(`[${this.name}] Bulk fetching 2026 schedules from ART Trier for ort="${this.ort}"...`);

    const results = new Map<string, StreetScheduleDates>();
    const isSingleZone = streets.length === 1 && streets[0] === this.name;

    // Pre-populate empty schedules
    for (const street of streets) {
      results.set(normalizeStreet(street), {});
    }

    let page = 1;
    let totalItems = 0;

    while (true) {
      const url = `https://redaktion.art-trier.de/api/abfuhrtermine?filters[ort][$eq]=${encodeURIComponent(
        this.ort
      )}&filters[importYear][$eq]=${YEAR}&pagination[page]=${page}&pagination[pageSize]=1000&populate=*`;

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)' }
      });

      if (!res.ok) {
        throw new Error(`[${this.name}] Failed to fetch page ${page} from ART Trier: HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        data?: StrapiAppointmentItem[];
        meta?: { pagination?: { pageCount?: number; total?: number } };
      };

      const items = json.data ?? [];
      if (items.length === 0) break;
      totalItems += items.length;

      for (const item of items) {
        const datum = item.attributes?.datum;
        if (!datum || !datum.startsWith(YEAR.toString())) continue;

        const streetName = isSingleZone ? this.name : item.attributes?.strasse?.trim();
        if (!streetName) continue;

        const norm = normalizeStreet(streetName);
        let schedule = results.get(norm);
        if (!schedule) {
          schedule = {};
          results.set(norm, schedule);
        }

        for (const art of item.attributes?.abfallarten?.data ?? []) {
          const titel = art.attributes?.titel ?? '';
          const abfallart = art.attributes?.abfallart ?? '';
          const cat = this.mapWasteType(titel, abfallart);
          if (!cat) continue;

          const list = (schedule[cat] ??= []);
          if (!list.includes(datum)) {
            list.push(datum);
          }
        }
      }

      const pageCount = json.meta?.pagination?.pageCount ?? 1;
      if (page >= pageCount) break;
      page++;
    }

    // Sort dates chronologically
    for (const schedule of results.values()) {
      for (const cat of Object.keys(schedule) as CategoryKey[]) {
        schedule[cat]?.sort();
      }
    }

    console.log(
      `[${this.name}] Successfully processed ${totalItems} appointments across ${results.size} streets.`
    );
    return results;
  }
}
