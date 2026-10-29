import {
  type CategoryKey,
  type CategoryMeta,
  YEAR,
  mapPool,
  normalizeStreet
} from '../lib/shared.ts';
import type { CityFetcher, StreetScheduleDates } from './types.ts';
import { STANDARD_CATEGORIES } from './regioit.ts';

const MODUS = 'd6c5855a62cf32a4dadbc2831f0f295f';
const BASE_URL = 'https://api.abfall.io/';

export interface AbfallIoConfig {
  id: string;
  name: string;
  shortName: string;
  serviceKey: string; // 32-char service key
  kommuneId?: string; // e.g. '1316' for Aalen; omitted for single-municipality services
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
  categories?: CategoryMeta[];
  defaultCategories?: string[];
  mapWasteTypeToCategory?: (summary: string) => CategoryKey | null;
}

export function defaultAbfallIoMapWasteType(summary: string): CategoryKey | null {
  const text = summary.toLowerCase();
  if (text.includes('sperr')) return 'sperrmuell';
  if (text.includes('rest') || text.includes('grau')) return 'restmuell';
  if (
    text.includes('bio') ||
    text.includes('garten') ||
    text.includes('grün') ||
    text.includes('gruen') ||
    text.includes('braun')
  ) {
    return 'bioabfall';
  }
  if (text.includes('papier') || text.includes('blau') || text.includes('pappe')) return 'papier';
  if (
    text.includes('gelb') ||
    text.includes('wertstoff') ||
    text.includes('lvp') ||
    text.includes('sack')
  ) {
    return 'wertstoff';
  }
  return null;
}

export class AbfallIoFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly serviceKey: string;
  readonly kommuneId?: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];
  readonly mapWasteType: (summary: string) => CategoryKey | null;

  // Cached street names to ID map
  private streetNameToId: Map<string, string> = new Map();

  constructor(cfg: AbfallIoConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.shortName = cfg.shortName;
    this.serviceKey = cfg.serviceKey;
    this.kommuneId = cfg.kommuneId;
    this.center = cfg.center;
    this.defaultZoom = cfg.defaultZoom;
    this.bbox = cfg.bbox;
    this.categories = cfg.categories ?? STANDARD_CATEGORIES;
    this.defaultCategories = cfg.defaultCategories ?? ['restmuell', 'bioabfall', 'papier', 'wertstoff'];
    this.mapWasteType = cfg.mapWasteTypeToCategory ?? defaultAbfallIoMapWasteType;
  }

  private getWurl(): string {
    return `${BASE_URL}?key=${encodeURIComponent(this.serviceKey)}&modus=${MODUS}`;
  }

  async fetchStreets(): Promise<string[]> {
    console.log(`[${this.name}] Fetching streets from abfall.io (kommuneId=${this.kommuneId ?? 'none'})...`);
    const wurl = this.getWurl();

    // 1. Init request to get session cookies and hidden token
    const initRes = await fetch(`${wurl}&waction=init`, {
      method: 'POST',
      headers: { 'User-Agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)' }
    });
    if (!initRes.ok) {
      throw new Error(`[${this.name}] Init request failed: HTTP ${initRes.status}`);
    }
    const cookie = initRes.headers.get('set-cookie')?.split(';')[0] || '';
    const initHtml = await initRes.text();

    let targetHtml = initHtml;

    if (this.kommuneId) {
      const hiddenMatches = [...initHtml.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)];
      const formKommune = new URLSearchParams();
      for (const m of hiddenMatches) {
        formKommune.append(m[1], m[2]);
      }
      formKommune.append('f_id_kommune', this.kommuneId);

      // Select kommune to get street list
      const kRes = await fetch(`${wurl}&waction=auswahl_kommune_set`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)',
          ...(cookie ? { Cookie: cookie } : {})
        },
        body: formKommune.toString()
      });

      if (!kRes.ok) {
        throw new Error(`[${this.name}] auswahl_kommune_set failed: HTTP ${kRes.status}`);
      }

      targetHtml = await kRes.text();
    }

    const streetOptions = [...targetHtml.matchAll(/<option value="([0-9]+)">([^<]+)<\/option>/g)].filter(
      (m) => m[1] !== '0'
    );

    this.streetNameToId.clear();
    const streetList: string[] = [];

    for (const opt of streetOptions) {
      const id = opt[1];
      const name = opt[2].trim();
      if (!name) continue;
      this.streetNameToId.set(name, id);
      this.streetNameToId.set(name.toLowerCase(), id);
      this.streetNameToId.set(normalizeStreet(name), id);
      streetList.push(name);
    }

    streetList.sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[${this.name}] Found ${streetList.length} streets.`);
    return streetList;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    console.log(`[${this.name}] Fetching schedules for ${streets.length} streets via abfall.io...`);
    const results = new Map<string, StreetScheduleDates>();

    // Pre-populate empty entries
    for (const street of streets) {
      results.set(normalizeStreet(street), {});
    }

    if (this.streetNameToId.size === 0) {
      await this.fetchStreets();
    }

    const wurl = this.getWurl();

    // 1. Init request to get session cookies and hidden token
    const initRes = await fetch(`${wurl}&waction=init`, {
      method: 'POST',
      headers: { 'User-Agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)' }
    });
    if (!initRes.ok) {
      throw new Error(`[${this.name}] Init request failed: HTTP ${initRes.status}`);
    }
    const cookie = initRes.headers.get('set-cookie')?.split(';')[0] || '';
    const initHtml = await initRes.text();

    const hiddenMatches = [...initHtml.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)];
    const baseHidden = Object.fromEntries(hiddenMatches.map((m) => [m[1], m[2]]));

    // Find first valid street ID to initialize auswahl_hnr_set form state
    let firstStreetId = '';
    for (const street of streets) {
      const id =
        this.streetNameToId.get(street) ??
        this.streetNameToId.get(street.toLowerCase()) ??
        this.streetNameToId.get(normalizeStreet(street));
      if (id) {
        firstStreetId = id;
        break;
      }
    }

    if (!firstStreetId && this.streetNameToId.size > 0) {
      firstStreetId = this.streetNameToId.values().next().value!;
    }

    if (!firstStreetId) {
      console.warn(`[${this.name}] No street IDs found to initialize form state.`);
      return results;
    }

    // Call auswahl_hnr_set to retrieve tokens and active checkboxes
    const formHnr = new URLSearchParams({
      ...baseHidden,
      ...(this.kommuneId ? { f_id_kommune: this.kommuneId } : {}),
      f_id_strasse: firstStreetId,
      f_id_strasse_hnr: firstStreetId
    });

    const hnrRes = await fetch(`${wurl}&waction=auswahl_hnr_set`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)',
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: formHnr.toString()
    });

    if (!hnrRes.ok) {
      throw new Error(`[${this.name}] auswahl_hnr_set failed: HTTP ${hnrRes.status}`);
    }

    const hnrHtml = await hnrRes.text();
    const cbMatches = [
      ...hnrHtml.matchAll(/<input type="checkbox"[^>]*name="([^"]+)" value="([^"]+)"[^>]*checked/g)
    ];
    const hiddenMatchesHnr = [
      ...hnrHtml.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)
    ];

    // Helper to fetch ICS for a single street
    const fetchIcsForStreet = async (street: string): Promise<void> => {
      const streetId =
        this.streetNameToId.get(street) ??
        this.streetNameToId.get(street.toLowerCase()) ??
        this.streetNameToId.get(normalizeStreet(street));

      if (!streetId) return;

      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(baseHidden)) form.append(k, v);
      for (const m of hiddenMatchesHnr) form.append(m[1], m[2]);
      if (this.kommuneId) form.append('f_id_kommune', this.kommuneId);
      form.append('f_id_strasse', streetId);
      form.append('f_id_strasse_hnr', streetId);
      for (const m of cbMatches) form.append(m[1], m[2]);
      form.append('f_zeitraum', `${YEAR}0101-${YEAR}1231`);

      try {
        const res = await fetch(`${wurl}&waction=export_ics`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)',
            ...(cookie ? { Cookie: cookie } : {})
          },
          body: form.toString()
        });

        if (!res.ok) return;

        const icsText = await res.text();
        if (!icsText || !icsText.includes('BEGIN:VEVENT')) return;

        const normStreet = normalizeStreet(street);
        const streetSchedule = results.get(normStreet) ?? {};
        results.set(normStreet, streetSchedule);

        // Parse VEVENTs
        const events = icsText.split('BEGIN:VEVENT');
        for (let i = 1; i < events.length; i++) {
          const ev = events[i];
          const dtMatch = ev.match(/DTSTART(?:;VALUE=DATE)?:([0-9]{8})/);
          const sumMatch = ev.match(/SUMMARY:([^\r\n]+)/);

          if (!dtMatch || !sumMatch) continue;

          const rawDate = dtMatch[1]; // YYYYMMDD
          if (!rawDate.startsWith(YEAR.toString())) continue;

          const isoDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
          const summary = sumMatch[1].trim();

          const cat = this.mapWasteType(summary);
          if (!cat) continue;

          const list = (streetSchedule[cat] ??= []);
          if (!list.includes(isoDate)) {
            list.push(isoDate);
          }
        }
      } catch (err) {
        console.warn(`[${this.name}] Error fetching ICS for "${street}":`, err);
      }
    };

    // Run with mapPool (concurrency 6)
    await mapPool(streets, 6, fetchIcsForStreet);

    // Sort dates chronologically
    for (const schedule of results.values()) {
      for (const cat of Object.keys(schedule) as CategoryKey[]) {
        schedule[cat]?.sort();
      }
    }

    const filledCount = Array.from(results.values()).filter(
      (s) => Object.keys(s).length > 0
    ).length;

    console.log(
      `[${this.name}] Successfully fetched schedules for ${filledCount}/${streets.length} streets.`
    );

    return results;
  }
}
