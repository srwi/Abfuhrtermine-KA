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

export interface MuellmaxConfig {
  id: string;
  name: string;
  shortName: string;
  service: string; // e.g. 'Usb', 'Awm', 'Ebm', 'Hal'
  ort?: string;
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
  categories?: CategoryMeta[];
  defaultCategories?: string[];
  mapWasteTypeToCategory?: (summary: string) => CategoryKey | null;
}

export function defaultMuellmaxMapWasteType(summary: string): CategoryKey | null {
  const lower = summary.toLowerCase();
  if (lower.includes('sperr')) return 'sperrmuell';
  if (lower.includes('rest') || lower.includes('grau')) return 'restmuell';
  if (lower.includes('bio') || lower.includes('braun') || lower.includes('grün') || lower.includes('gruen')) return 'bioabfall';
  if (lower.includes('papier') || lower.includes('blau') || lower.includes('ppk')) return 'papier';
  if (lower.includes('gelb') || lower.includes('wertstoff') || lower.includes('dsd')) return 'wertstoff';
  return null;
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

export class MuellmaxFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly service: string;
  readonly ort?: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];
  readonly mapWasteType: (summary: string) => CategoryKey | null;

  private startUrl: string;
  private headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  constructor(config: MuellmaxConfig) {
    this.id = config.id;
    this.name = config.name;
    this.shortName = config.shortName;
    this.service = config.service;
    this.ort = config.ort;
    this.center = config.center;
    this.defaultZoom = config.defaultZoom;
    this.bbox = config.bbox;
    this.categories = config.categories ?? STANDARD_CATEGORIES;
    this.defaultCategories = config.defaultCategories ?? ['restmuell'];
    this.mapWasteType = config.mapWasteTypeToCategory ?? defaultMuellmaxMapWasteType;
    this.startUrl = `https://www.muellmax.de/abfallkalender/${this.service.toLowerCase()}/res/${this.service}Start.php`;
  }

  private extractSession(html: string): string | null {
    const match = html.match(/name="mm_ses"\s+value="([^"]+)"/);
    return match ? match[1] : null;
  }

  async fetchStreets(): Promise<string[]> {
    console.log(`[${this.name}] Fetching start page from MüllMAX (${this.service})...`);
    const r1 = await fetch(this.startUrl, { headers: this.headers });
    const t1 = await r1.text();
    const ses = this.extractSession(t1);
    if (!ses) {
      throw new Error(`[${this.name}] Failed to extract initial session token`);
    }

    // Step 2: Request location/search
    const r2 = await fetch(this.startUrl, {
      method: 'POST',
      headers: this.headers,
      body: new URLSearchParams({ mm_ses: ses, 'mm_aus_ort.x': '0', 'mm_aus_ort.y': '0' })
    });
    const t2 = await r2.text();
    let sesNext = this.extractSession(t2) ?? ses;

    // Optional: Select municipality if service covers multiple
    if (this.ort) {
      const rOrt = await fetch(this.startUrl, {
        method: 'POST',
        headers: this.headers,
        body: new URLSearchParams({
          mm_ses: sesNext,
          xxx: '1',
          mm_frm_ort_sel: this.ort,
          mm_aus_ort_submit: 'weiter'
        })
      });
      const tOrt = await rOrt.text();
      sesNext = this.extractSession(tOrt) ?? sesNext;
    }

    // Step 3: Trigger search for all streets
    console.log(`[${this.name}] Fetching street catalog...`);
    const r3 = await fetch(this.startUrl, {
      method: 'POST',
      headers: this.headers,
      body: new URLSearchParams({
        mm_ses: sesNext,
        xxx: '1',
        mm_frm_str_name: '',
        mm_aus_str_txt_submit: 'suchen'
      })
    });
    const t3 = await r3.text();

    const streetMatches = Array.from(t3.matchAll(/<option\s+value="([^"]+)">([^<]+)<\/option>/g));
    const streets = streetMatches
      .map((m) => m[1].trim())
      .filter((s) => Boolean(s) && !s.startsWith('--'))
      .sort((a, b) => a.localeCompare(b, 'de'));

    console.log(`[${this.name}] Found ${streets.length} streets.`);
    return streets;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[${this.name}] Fetching schedules for ${targetStreets.length} streets via MüllMAX...`);

    const results = new Map<string, StreetScheduleDates>();
    const concurrency = QUICK ? 2 : 6;
    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const normalized = normalizeStreet(street);
      try {
        // Step 1: Start fresh session
        const r1 = await fetch(this.startUrl, { headers: this.headers });
        const ses1 = this.extractSession(await r1.text());
        if (!ses1) throw new Error('No session');

        const r2 = await fetch(this.startUrl, {
          method: 'POST',
          headers: this.headers,
          body: new URLSearchParams({ mm_ses: ses1, 'mm_aus_ort.x': '0', 'mm_aus_ort.y': '0' })
        });
        let sesNext = this.extractSession(await r2.text()) ?? ses1;

        if (this.ort) {
          const rOrt = await fetch(this.startUrl, {
            method: 'POST',
            headers: this.headers,
            body: new URLSearchParams({
              mm_ses: sesNext,
              xxx: '1',
              mm_frm_ort_sel: this.ort,
              mm_aus_ort_submit: 'weiter'
            })
          });
          sesNext = this.extractSession(await rOrt.text()) ?? sesNext;
        }

        // Select street
        const rSel = await fetch(this.startUrl, {
          method: 'POST',
          headers: this.headers,
          body: new URLSearchParams({
            mm_ses: sesNext,
            xxx: '1',
            mm_frm_str_sel: street,
            mm_aus_str_sel_submit: 'weiter'
          })
        });
        const tSel = await rSel.text();
        sesNext = this.extractSession(tSel) ?? sesNext;

        // Auto-select first house number if required
        if (tSel.includes('name="mm_frm_hnr_sel"')) {
          const hnrMatch = tSel.match(/<option\s+value="([^"]+)">/);
          if (hnrMatch) {
            const rHnr = await fetch(this.startUrl, {
              method: 'POST',
              headers: this.headers,
              body: new URLSearchParams({
                mm_ses: sesNext,
                xxx: '1',
                mm_frm_hnr_sel: hnrMatch[1],
                mm_aus_hnr_sel_submit: 'weiter'
              })
            });
            sesNext = this.extractSession(await rHnr.text()) ?? sesNext;
          }
        }

        // Navigate to iCal selection
        const rIcaNav = await fetch(this.startUrl, {
          method: 'POST',
          headers: this.headers,
          body: new URLSearchParams({
            mm_ses: sesNext,
            xxx: '1',
            mm_ica_auswahl: 'iCalendar-Datei'
          })
        });
        const tIcaNav = await rIcaNav.text();
        sesNext = this.extractSession(tIcaNav) ?? sesNext;

        // Extract fraction checkboxes
        const fraChecks: Record<string, string> = {};
        for (const m of tIcaNav.matchAll(/<input[^>]+name="(mm_frm_fra_[^"]+)"[^>]+value="([^"]+)"/g)) {
          fraChecks[m[1]] = m[2];
        }

        // Download iCal
        const rIcs = await fetch(this.startUrl, {
          method: 'POST',
          headers: this.headers,
          body: new URLSearchParams({
            mm_ses: sesNext,
            xxx: '1',
            mm_frm_type: 'termine',
            mm_ica_gen: 'iCalendar-Datei laden',
            ...fraChecks
          })
        });
        const icsText = await rIcs.text();

        // Parse VEVENTs
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
              const cat = this.mapWasteType(summary);
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
        console.warn(`[${this.name}] Failed to fetch schedule for ${street}:`, err);
        results.set(normalized, {});
      }

      completed++;
      if (completed % 100 === 0 || completed === targetStreets.length) {
        console.log(`[${this.name}] Progress: ${completed}/${targetStreets.length} streets fetched.`);
      }
    });

    return results;
  }
}
