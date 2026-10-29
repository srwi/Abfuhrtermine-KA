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

export interface CTraceConfig {
  id: string;
  name: string;
  shortName: string;
  service: string; // e.g. 'bremenabfallkalender', 'augsburglandkreis', 'segebergwzv-abfallkalender'
  subdomain?: string; // 'web' (default) or 'apps'
  serviceType: 'odata' | 'json' | 'direct';
  ort?: string;
  gemeinde?: string;
  ortsteil?: string;
  defaultHnr?: string;
  calPath?: string; // 'cal', 'cal/2026', or 'downloadcal'
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
  categories?: CategoryMeta[];
  defaultCategories?: string[];
}

export function defaultCTraceMapWasteType(summary: string): CategoryKey[] {
  const lower = summary.toLowerCase().replace(/^abfuhr:\s*/, '');
  const cats: CategoryKey[] = [];
  if (lower.includes('sperr')) cats.push('sperrmuell');
  if (lower.includes('rest') || lower.includes('grau') || lower.includes('hausmüll')) cats.push('restmuell');
  if (lower.includes('bio') || lower.includes('braun') || lower.includes('grün') || lower.includes('garten')) cats.push('bioabfall');
  if (lower.includes('papier') || lower.includes('blau') || lower.includes('altpapier') || lower.includes('pappe')) cats.push('papier');
  if (lower.includes('gelb') || lower.includes('wertstoff') || lower.includes('verpackung') || lower.includes('leichtverpackung') || lower.includes('dsd')) cats.push('wertstoff');
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

export class CTraceFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly service: string;
  readonly subdomain: string;
  readonly serviceType: 'odata' | 'json' | 'direct';
  readonly ort?: string;
  readonly gemeinde?: string;
  readonly ortsteil?: string;
  readonly defaultHnr?: string;
  readonly calPath: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];

  private sessionBaseUrl: string | null = null;
  private cookie: string | null = null;
  private streetHnrMap = new Map<string, string>();

  constructor(cfg: CTraceConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.shortName = cfg.shortName;
    this.service = cfg.service;
    this.subdomain = cfg.subdomain ?? 'web';
    this.serviceType = cfg.serviceType;
    this.ort = cfg.ort ?? cfg.name;
    this.gemeinde = cfg.gemeinde ?? this.ort;
    this.ortsteil = cfg.ortsteil;
    this.defaultHnr = cfg.defaultHnr;
    this.calPath = cfg.calPath ?? 'cal';
    this.center = cfg.center;
    this.defaultZoom = cfg.defaultZoom;
    this.bbox = cfg.bbox;
    this.categories = cfg.categories ?? STANDARD_CATEGORIES;
    this.defaultCategories = cfg.defaultCategories ?? ['restmuell', 'bioabfall', 'papier', 'wertstoff'];
  }

  private async ensureSession(): Promise<{ baseUrl: string; cookie: string }> {
    if (this.sessionBaseUrl && this.cookie !== null) {
      return { baseUrl: this.sessionBaseUrl, cookie: this.cookie };
    }

    const host = `${this.subdomain}.c-trace.de`;
    const initUrl = `https://${host}/${this.service}/Abfallkalender`;
    const res = await fetch(initUrl, { redirect: 'manual' });
    const loc = res.headers.get('location');
    if (!loc) {
      throw new Error(`[${this.name}] Failed to get c-trace session: no redirect from ${initUrl}`);
    }

    this.cookie = res.headers.get('set-cookie')?.split(';')[0] || '';
    this.sessionBaseUrl = `https://${host}${loc.substring(0, loc.lastIndexOf('/'))}`;
    return { baseUrl: this.sessionBaseUrl, cookie: this.cookie };
  }

  async fetchStreets(): Promise<string[]> {
    const { baseUrl } = await this.ensureSession();
    console.log(`[${this.name}] Fetching streets from c-trace (${this.service}, type=${this.serviceType})...`);

    let streets: string[] = [];

    if (this.serviceType === 'direct') {
      let res = await fetch(`${baseUrl}/Data/Strassen?ort=${encodeURIComponent(this.ort || '')}`);
      if (!res.ok) {
        res = await fetch(`${baseUrl}/Strassen?ort=${encodeURIComponent(this.ort || '')}`);
      }
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) {
          streets = json.filter((s: string) => typeof s === 'string' && s.trim().length > 0);
        }
      }
    } else if (this.serviceType === 'odata') {
      const odataUrl = `${baseUrl}/OData.svc/Strassen?$filter=Ort/Name%20eq%20%27${encodeURIComponent(this.ort || '')}%27&$format=json`;
      let res = await fetch(odataUrl, { headers: { Accept: 'application/json' } });
      let json = res.ok ? await res.json() : null;
      let results = json?.d?.results || json?.d || [];
      if (results.length === 0) {
        // Fallback: query without Ort filter (for single-city systems like Landau)
        const allUrl = `${baseUrl}/OData.svc/Strassen?$format=json`;
        res = await fetch(allUrl, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          json = await res.json();
          results = json?.d?.results || json?.d || [];
        }
      }
      streets = results
        .map((r: { Name?: string }) => r.Name)
        .filter((s?: string): s is string => Boolean(s && s.trim().length > 0));
    } else {
      // json
      const params = new URLSearchParams({ ort: this.ort || '' });
      if (this.ortsteil) params.set('ortsteil', this.ortsteil);
      const res = await fetch(`${baseUrl}/Strassen?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) {
          streets = json.filter((s: string) => typeof s === 'string' && s.trim().length > 0);
        }
      }
    }

    const unique = Array.from(new Set(streets)).sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[${this.name}] Found ${unique.length} streets in c-trace.`);
    return unique;
  }

  private async getSampleHouseNumber(street: string): Promise<string | null> {
    if (this.streetHnrMap.has(street)) {
      return this.streetHnrMap.get(street)!;
    }
    if (this.defaultHnr !== undefined) {
      return this.defaultHnr;
    }
    if (this.serviceType === 'odata') {
      // Many OData services like Augsburg don't require house number
      return '';
    }

    const { baseUrl } = await this.ensureSession();

    try {
      let hnrs: string[] = [];
      const params = new URLSearchParams({ ort: this.ort || '', strasse: street });
      if (this.ortsteil) params.set('ortsteil', this.ortsteil);

      let res = await fetch(`${baseUrl}/Hausnummern?${params.toString()}`);
      if (!res.ok) {
        res = await fetch(`${baseUrl}/Data/Hausnummern?${params.toString()}`);
      }
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) hnrs = json.filter((h: string) => Boolean(h && h.trim()));
      }

      const hnr = hnrs.length > 0 ? hnrs[0] : '1';
      this.streetHnrMap.set(street, hnr);
      return hnr;
    } catch {
      return '1';
    }
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    const { baseUrl, cookie } = await this.ensureSession();
    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[${this.name}] Fetching schedules for ${targetStreets.length} streets via c-trace...`);

    const results = new Map<string, StreetScheduleDates>();
    const abfallParam = Array.from({ length: 30 }, (_, i) => i).join('|');
    const concurrency = QUICK ? 4 : 12;

    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const normalized = normalizeStreet(street);
      try {
        const hnr = await this.getSampleHouseNumber(street);

        const params = new URLSearchParams({
          Ort: this.ort || '',
          Gemeinde: this.gemeinde || this.ort || '',
          Strasse: street,
          abfall: abfallParam,
          Abfall: abfallParam
        });
        if (this.ortsteil) params.set('Ortsteil', this.ortsteil);
        if (hnr) {
          params.set('Hausnr', hnr);
          params.set('hausnr', hnr);
        }

        const calUrl = `${baseUrl}/abfallkalender/${this.calPath}?${params.toString()}`;
        const res = await fetch(calUrl, {
          headers: {
            Cookie: cookie,
            'User-Agent': 'Mozilla/5.0'
          }
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
              const cats = defaultCTraceMapWasteType(summary);
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
