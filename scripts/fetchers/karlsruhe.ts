import {
  CATEGORIES,
  type CategoryKey,
  type CategoryMeta,
  KARLSRUHE_CENTER,
  KARLSRUHE_SOURCE,
  QUICK,
  STREET_LIMIT,
  USER_AGENT,
  YEAR,
  fetchSourceStreets,
  mapPool,
  normalizeStreet,
  toIsoDate
} from '../lib/shared.ts';
import type { CityFetcher, StreetScheduleDates } from './types.ts';

declare const Bun: { sleep(ms: number): Promise<void> };

const KARLSRUHE_CONCURRENCY = QUICK ? 2 : 6;
const KARLSRUHE_MAX_RETRIES = 3;
const OSM_PROBE_LIMIT = 6;
const FALLBACK_PROBES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '19', '22', '25', '30', '50'];

const PROBE_UNKNOWN = '#unknown';
const PROBE_NODATE = '#nodate';

const placeholderDates = new Set<string>();

function extractSperrmuellDate(html: string): string | null {
  const keyCandidates = ['Straßensperrmüll', 'Sperrmüllabholung', 'Sperrmüll', 'Sperrmuell'];
  const lower = html.toLowerCase();

  for (const key of keyCandidates) {
    const idx = lower.indexOf(key.toLowerCase());
    if (idx !== -1) {
      const window = html.slice(idx, idx + 800);
      const match = window.match(/\b\d{2}\.\d{2}\.\d{4}\b/);
      if (match) return match[0];
    }
  }

  const allDates = html.match(/\b\d{2}\.\d{2}\.\d{4}\b/g);
  return allDates?.length === 1 ? allDates[0] : null;
}

async function fetchKarlsruheProbe(street: string, houseNumber: string): Promise<string> {
  const body = new URLSearchParams({ strasse_n: street, hausnr: houseNumber, anzeigen: 'anzeigen', ladeort: '1' });

  let delayMs = 500;
  for (let attempt = 1; attempt <= KARLSRUHE_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(KARLSRUHE_SOURCE, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'user-agent': USER_AGENT },
        body
      });
      if (response.ok || attempt >= KARLSRUHE_MAX_RETRIES) return await response.text();
    } catch (error) {
      if (attempt >= KARLSRUHE_MAX_RETRIES) throw error;
    }
    await Bun.sleep(delayMs);
    delayMs *= 2;
  }
  return '';
}

async function probe(street: string, houseNumber: string): Promise<string> {
  const html = await fetchKarlsruheProbe(street, houseNumber);
  if (html.includes('Adresse ist unbekannt')) return PROBE_UNKNOWN;
  return extractSperrmuellDate(html) ?? PROBE_NODATE;
}

function isDate(outcome: string): boolean {
  return outcome !== PROBE_UNKNOWN && outcome !== PROBE_NODATE;
}

type Resolution = {
  sperrmuellDate: string | null;
  houseNumber: string | null;
};

async function resolveStreet(street: string, numbers: string[], trustPlaceholder: boolean): Promise<Resolution> {
  let placeholderSeen: string | null = null;
  let houseNumber: string | null = null;

  for (const candidate of numbers) {
    const outcome = await probe(street, candidate);
    if (outcome === PROBE_UNKNOWN) continue;
    if (houseNumber === null) houseNumber = candidate;
    if (!isDate(outcome)) continue;
    if (placeholderDates.has(outcome)) {
      if (trustPlaceholder) placeholderSeen = outcome;
      continue;
    }
    return { sperrmuellDate: outcome, houseNumber };
  }
  return { sperrmuellDate: trustPlaceholder ? placeholderSeen : null, houseNumber };
}

const ICAL_SUMMARY_PREFIXES: [string, CategoryKey][] = [
  ['Restmüll', 'restmuell'],
  ['Bioabfall', 'bioabfall'],
  ['Biomüll', 'bioabfall'],
  ['Wertstoff', 'wertstoff'],
  ['Papier', 'papier']
];

const ICAL_TRY_LIMIT = 4;

function summaryToCategory(summary: string): CategoryKey | null {
  for (const [prefix, key] of ICAL_SUMMARY_PREFIXES) if (summary.startsWith(prefix)) return key;
  return null;
}

function unfoldIcal(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out;
}

function parseIcal(text: string): Partial<Record<CategoryKey, string[]>> {
  const result: Partial<Record<CategoryKey, string[]>> = {};
  let summary: string | null = null;
  let dtstart: string | null = null;

  for (const line of unfoldIcal(text)) {
    if (line.startsWith('BEGIN:VEVENT')) {
      summary = null;
      dtstart = null;
    } else if (line.startsWith('SUMMARY:')) {
      summary = line.slice('SUMMARY:'.length);
    } else if (line.startsWith('DTSTART')) {
      dtstart = line.match(/:(\d{8})/)?.[1] ?? null;
    } else if (line.startsWith('END:VEVENT') && summary && dtstart) {
      const category = summaryToCategory(summary);
      const iso = `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}`;
      if (category && iso.startsWith(`${YEAR}-`)) (result[category] ??= []).push(iso);
    }
  }

  for (const key of Object.keys(result) as CategoryKey[]) {
    result[key] = [...new Set(result[key])].sort();
  }
  return result;
}

async function fetchIcalText(street: string, houseNumber: string): Promise<string> {
  const body = new URLSearchParams({ strasse_n: street, hausnr: houseNumber, ical: ' iCalendar', ladeort: '1' });

  let delayMs = 500;
  for (let attempt = 1; attempt <= KARLSRUHE_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(KARLSRUHE_SOURCE, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'user-agent': USER_AGENT },
        body
      });
      if (response.ok || attempt >= KARLSRUHE_MAX_RETRIES) return await response.text();
    } catch (error) {
      if (attempt >= KARLSRUHE_MAX_RETRIES) throw error;
    }
    await Bun.sleep(delayMs);
    delayMs *= 2;
  }
  return '';
}

function validateIcalForStreet(ical: string, street: string): boolean {
  const calname = ical.match(/^X-WR-CALNAME:(.*)$/m)?.[1]?.trim();
  if (!calname) return false;
  const normalizedRequested = normalizeStreet(street);
  const normalizedCalname = normalizeStreet(calname);
  return normalizedCalname.includes(normalizedRequested);
}

async function resolveIcal(
  street: string,
  preferredHouseNumber: string | null,
  allCandidates: string[]
): Promise<Partial<Record<CategoryKey, string[]>>> {
  const seen = new Set<string>();
  const candidates: string[] = [];
  if (preferredHouseNumber) {
    candidates.push(preferredHouseNumber);
    seen.add(preferredHouseNumber);
  }
  for (const n of allCandidates) {
    if (!seen.has(n)) {
      candidates.push(n);
      seen.add(n);
    }
  }

  const capped = candidates.slice(0, ICAL_TRY_LIMIT);
  for (const number of capped) {
    const text = await fetchIcalText(street, number);
    if (!text || !validateIcalForStreet(text, street)) continue;
    const schedule = parseIcal(text);
    if (Object.keys(schedule).length > 0) return schedule;
  }
  return {};
}

async function detectPlaceholderDates(): Promise<void> {
  const canaries = [
    '__nonexistent_street_abc_123__',
    '__definitely_not_a_karlsruhe_street_456__',
    'XYZ_PHANTOM_PROBE_789'
  ];
  const houseNumbers = ['1', '2', '3', '4', '5'];

  for (const street of canaries) {
    for (const hnr of houseNumbers) {
      try {
        const outcome = await probe(street, hnr);
        if (isDate(outcome)) placeholderDates.add(outcome);
      } catch {
        // network flakes on canary probes are non-fatal
      }
    }
  }
  console.log(`[Karlsruhe] Detected placeholder dates: ${placeholderDates.size ? [...placeholderDates].join(', ') : 'none'}`);
}

export class KarlsruheFetcher implements CityFetcher {
  readonly id = 'karlsruhe';
  readonly name = 'Karlsruhe';
  readonly shortName = 'KA';
  readonly center = KARLSRUHE_CENTER;
  readonly defaultZoom = 12;
  readonly bbox: [number, number, number, number] = [48.9404, 8.2774, 49.0913, 8.5417];
  readonly categories = CATEGORIES;
  readonly defaultCategories = ['sperrmuell'];
  readonly requiresOsmHouseNumbers = true;

  async fetchStreets(): Promise<string[]> {
    return await fetchSourceStreets();
  }

  async fetchSchedules(
    streets: string[],
    osmHouseNumbers: Record<string, string[]> = {}
  ): Promise<Map<string, StreetScheduleDates>> {
    await detectPlaceholderDates();

    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[Karlsruhe] Fetching schedules for ${targetStreets.length} streets...`);

    const results = new Map<string, StreetScheduleDates>();
    let completed = 0;

    await mapPool(targetStreets, KARLSRUHE_CONCURRENCY, async (street) => {
      const normalized = normalizeStreet(street);
      const realNumbers = osmHouseNumbers[normalized] ?? [];
      const hasRealAddresses = realNumbers.length > 0;

      const probes = hasRealAddresses ? realNumbers.slice(0, OSM_PROBE_LIMIT) : FALLBACK_PROBES;
      const { sperrmuellDate, houseNumber } = await resolveStreet(street, probes, hasRealAddresses);

      const icalSchedule = await resolveIcal(street, houseNumber, realNumbers);

      const schedule: StreetScheduleDates = { ...icalSchedule };
      if (sperrmuellDate) {
        schedule.sperrmuell = [toIsoDate(sperrmuellDate)];
      }

      results.set(normalized, schedule);

      completed++;
      if (completed % 100 === 0 || completed === targetStreets.length) {
        console.log(`[Karlsruhe] Progress: ${completed}/${targetStreets.length} streets fetched.`);
      }
    });

    return results;
  }
}
