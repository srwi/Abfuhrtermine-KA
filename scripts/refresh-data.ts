// `bun run data:refresh` — the cheap, Karlsruhe-only scrape. Runs on every CI
// build. It reads the committed Overpass caches produced by `data:cache`
// (data/osm-house-numbers.json, data/geometry-cache.json) and never talks to
// Overpass itself, so it stays fast and immune to Overpass flakiness.
//
// For each street it resolves all five waste categories and writes:
//   - static/data/calendar.json   (category metadata + the union of pickup days)
//   - static/data/street-data.json (per-street geometry + per-category day indices)
//
// Sperrmüll (Straßensperrmüll) is the annual date parsed from the HTML response
// (the placeholder-date logic below). The four recurring categories — Restmüll,
// Bioabfall, Wertstoff, Papier — come from the source's iCal export, which
// returns the full forward-year schedule (holiday shifts applied) in one request
// per street. Both are keyed off the same known house number found while probing.
//
// ## The placeholder-date quirk (and why we don't guess "magic" house numbers)
//
// The source has no real answer for addresses it doesn't know. For a small,
// shifting set of house numbers it returns a fixed PLACEHOLDER date instead of
// "Adresse ist unbekannt", even for streets that don't exist. We never try to
// enumerate that house-number set (a black-box behavior that could change);
// instead we measure only the placeholder *date* each run via canary probes,
// and lean on real OSM house numbers so the quirk can't bite:
//
//   - Primary path (street has OSM house numbers): we probe addresses OSM
//     confirms exist, so the source returns the street's real date. That date
//     is trustworthy even when it happens to equal the placeholder date (~24
//     real streets genuinely fall on it). We only defer the placeholder date in
//     favor of any non-placeholder date seen across the street's OSM numbers, so
//     a stray placeholder from an OSM/source disagreement can't win.
//   - Fallback path (no OSM addresses at all): we have no confirmed address to
//     anchor on, so we distrust the placeholder date outright. This is provably
//     safe here — no OSM-less street legitimately falls on the placeholder date
//     — and it drops phantom squares/Gewann while keeping real but un-mapped
//     streets (whose true dates are never the placeholder).

import {
  CATEGORIES,
  CATEGORY_KEYS,
  KARLSRUHE_SOURCE,
  QUICK,
  STREET_LIMIT,
  USER_AGENT,
  YEAR,
  type CalendarDay,
  type CalendarFile,
  type CategoryKey,
  type StreetData,
  type StreetDataFile,
  type StreetGeometry,
  type StreetGeometryFile,
  type StreetSchedule,
  dataFile,
  fetchSourceStreets,
  mapPool,
  normalizeStreet,
  readJson,
  staticDataFile,
  toDisplayDate,
  toIsoDate,
  writeJson,
  writeJsonCompact
} from './lib/shared.ts';

declare const Bun: { sleep(ms: number): Promise<void>; write(path: string | URL, data: string): Promise<void> };
declare const process: { env: Record<string, string | undefined> };

const KARLSRUHE_CONCURRENCY = QUICK ? 2 : 6;
const KARLSRUHE_MAX_RETRIES = 3;
// How many of a street's OSM house numbers we probe before giving up. The first
// non-placeholder date wins, so this only matters for streets whose early
// numbers are unknown to the source or that genuinely sit on the placeholder date.
const OSM_PROBE_LIMIT = 6;
// House numbers tried for streets with no OSM addresses at all.
const FALLBACK_PROBES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '19', '22', '25', '30', '50'];

const PROBE_UNKNOWN = '#unknown';
const PROBE_NODATE = '#nodate';

const placeholderDates = new Set<string>();

// --- Karlsruhe probing -------------------------------------------------------

/** Extracts a Sperrmüll pickup date from a Karlsruhe response, if present. */
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

  // Fallback: if the whole page contains exactly one date, trust it.
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

/** Probes one street/house-number combination -> date | #unknown | #nodate. */
async function probe(street: string, houseNumber: string): Promise<string> {
  const html = await fetchKarlsruheProbe(street, houseNumber);
  if (html.includes('Adresse ist unbekannt')) return PROBE_UNKNOWN;
  return extractSperrmuellDate(html) ?? PROBE_NODATE;
}

function isDate(outcome: string): boolean {
  return outcome !== PROBE_UNKNOWN && outcome !== PROBE_NODATE;
}

type Resolution = {
  // The Sperrmüll (Straßensperrmüll) pickup date as "DD.MM.YYYY", or null.
  sperrmuellDate: string | null;
  // A house number the source recognized as a *known* address (returned a date
  // or #nodate, not #unknown), or null if none of the probes were known. Reused
  // to fetch the street's iCal (the recurring categories).
  houseNumber: string | null;
};

/**
 * Probes a street's house numbers to resolve its Sperrmüll date and find one
 * known address. `trustPlaceholder` distinguishes the two paths:
 *
 *   - Primary path (real OSM numbers, trustPlaceholder=true): take the first
 *     non-placeholder date; if the only dates seen are the placeholder date,
 *     trust it too (a real street legitimately on that date).
 *   - Fallback path (no OSM addresses, trustPlaceholder=false): distrust the
 *     placeholder date outright — no OSM-less street legitimately falls on it,
 *     so phantom squares/Gewann are dropped while real un-mapped streets survive.
 *
 * Either way we remember the first *known* house number so the caller can fetch
 * the street's iCal for the recurring categories.
 */
async function resolveStreet(street: string, numbers: string[], trustPlaceholder: boolean): Promise<Resolution> {
  let placeholderSeen: string | null = null;
  let houseNumber: string | null = null;

  for (const candidate of numbers) {
    const outcome = await probe(street, candidate);
    if (outcome === PROBE_UNKNOWN) continue; // address not known -> try next
    if (houseNumber === null) houseNumber = candidate; // known address (date or #nodate)
    if (!isDate(outcome)) continue; // #nodate -> known but no Sperrmüll date here
    if (placeholderDates.has(outcome)) {
      if (trustPlaceholder) placeholderSeen = outcome; // defer to a real date below
      continue;
    }
    return { sperrmuellDate: outcome, houseNumber };
  }
  return { sperrmuellDate: trustPlaceholder ? placeholderSeen : null, houseNumber };
}

// --- iCal (the recurring categories) -----------------------------------------
// The source's iCal export returns the full forward-year schedule for the four
// recurring categories in one request, with holiday shifts already applied. It
// does NOT include Sperrmüll. An unknown street silently falls back to the
// default first street, so we validate X-WR-CALNAME against the requested name.

// The source spells categories several ways across districts/cadences (e.g.
// "Bioabfall, wöchentlich" vs "Biomüll, 14-tägl."; "Restmüll, 2x"). We match on
// the leading category word and union the dates, so cadence variants collapse to
// one category. Order doesn't matter (prefixes are disjoint).
const ICAL_SUMMARY_PREFIXES: [string, CategoryKey][] = [
  ['Restmüll', 'restmuell'],
  ['Bioabfall', 'bioabfall'],
  ['Biomüll', 'bioabfall'],
  ['Wertstoff', 'wertstoff'],
  ['Papier', 'papier']
];

// How many house numbers to try for the iCal before giving up. The first known
// address with events wins; some real addresses (e.g. a corner plot) return a
// valid but empty calendar, so we fall through to the next number on the street.
const ICAL_TRY_LIMIT = 4;

function summaryToCategory(summary: string): CategoryKey | null {
  for (const [prefix, key] of ICAL_SUMMARY_PREFIXES) if (summary.startsWith(prefix)) return key;
  return null;
}

/** Unfolds RFC-5545 line folding (continuation lines start with a space/tab). */
function unfoldIcal(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out;
}

/** Parses an iCal body into recurring-category -> sorted unique ISO dates. */
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

/** One iCal request -> raw body, or '' on repeated failure. */
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

/**
 * Resolves a street's recurring categories from its iCal. Tries house numbers in
 * order (up to ICAL_TRY_LIMIT), skipping the unknown-street -> default-street
 * fallback (X-WR-CALNAME doesn't contain the requested name) and valid-but-empty
 * calendars, and returns the first non-empty parse.
 */
async function fetchRecurring(street: string, numbers: string[]): Promise<Partial<Record<CategoryKey, string[]>>> {
  for (const houseNumber of numbers.slice(0, ICAL_TRY_LIMIT)) {
    const text = await fetchIcalText(street, houseNumber);
    const calName = text.match(/X-WR-CALNAME:(.*)/)?.[1] ?? '';
    if (!normalizeStreet(calName).includes(normalizeStreet(street))) continue; // fallback response
    const parsed = parseIcal(text);
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return {};
}

/**
 * Learns the source's placeholder date(s) by probing street names that cannot
 * exist. Whatever date a nonsense street returns is, by definition, not a real
 * per-address pickup date. We measure only the date — never which house numbers
 * trigger it — so the logic survives the source shuffling that set.
 */
async function detectPlaceholderDates(): Promise<void> {
  const canaries = ['Zzqxvz-Nichtexistent-Strasse', 'Qwerty-Phantasie-Weg', 'Blubb-Quatsch-Allee'];
  const testNumbers = Array.from({ length: 16 }, (_, i) => String(i + 1));

  // For each canary, the set of distinct dates it ever returned.
  const datesPerCanary = await Promise.all(
    canaries.map(async (name) => {
      const dates = new Set<string>();
      for (const houseNumber of testNumbers) {
        const outcome = await probe(name, houseNumber);
        if (isDate(outcome)) dates.add(outcome);
      }
      return dates;
    })
  );

  // Trust a date as a placeholder only if at least two independent nonsense
  // streets returned it, so a canary that accidentally matched something real
  // can't poison the set.
  const hits = new Map<string, number>();
  for (const dates of datesPerCanary) for (const date of dates) hits.set(date, (hits.get(date) ?? 0) + 1);
  for (const [date, count] of hits) if (count >= 2) placeholderDates.add(date);

  console.log(
    placeholderDates.size === 0
      ? 'No placeholder date detected.'
      : `Placeholder date detected: ${[...placeholderDates].join(', ')}`
  );
}

// --- Scrape ------------------------------------------------------------------
// Per street: resolve its Sperrmüll date (+ a known house number) via house-
// number probes, then fetch that address's iCal once for the four recurring
// categories. The result is one schedule per street with ISO dates per category.

type HouseNumberCache = { houseNumbers: Record<string, string[]> };
// Intermediate (pre-indexing) schedule: category -> ISO dates. Long streets can
// have different recurring days per section; we take one representative house
// number's schedule, consistent with the existing per-street simplification.
type IsoSchedule = Partial<Record<CategoryKey, string[]>>;

async function scrapeSchedules(streets: string[]): Promise<Map<string, IsoSchedule>> {
  const cache = await readJson<HouseNumberCache>(dataFile('osm-house-numbers.json'));
  if (!cache) {
    console.warn(
      'WARNING: data/osm-house-numbers.json is missing. Run `bun run data:cache`. ' +
        'Without OSM house numbers, all streets use the fallback path (lower hit rate).'
    );
  }
  const osmHouseNumbers = cache?.houseNumbers ?? {};

  // Keyed by display street name (ß -> ss), matching the geometry cache lookup.
  const scheduleByStreet = new Map<string, IsoSchedule>();
  const found: Record<CategoryKey, number> = { sperrmuell: 0, restmuell: 0, bioabfall: 0, wertstoff: 0, papier: 0 };
  let processed = 0;

  console.log(`Checking pickup dates for ${streets.length} streets (parallel: ${KARLSRUHE_CONCURRENCY})`);
  await mapPool(streets, KARLSRUHE_CONCURRENCY, async (rawStreet) => {
    const street = rawStreet.trim();
    const osmNumbers = osmHouseNumbers[normalizeStreet(street)] ?? [];
    // Same candidate numbers feed the Sperrmüll probe and the iCal fetch. OSM
    // numbers (real addresses) get the placeholder-trusting path; the fixed
    // fallback list distrusts the placeholder date.
    const hasOsm = osmNumbers.length > 0;
    const numbers = hasOsm ? osmNumbers.slice(0, OSM_PROBE_LIMIT) : FALLBACK_PROBES;

    const resolution = await resolveStreet(street, numbers, hasOsm);

    const schedule: IsoSchedule = {};
    if (resolution.sperrmuellDate) schedule.sperrmuell = [toIsoDate(resolution.sperrmuellDate)];
    // Only chase the iCal when at least one probed address was known (a real
    // street) — phantoms have no known address and get no recurring data.
    if (resolution.houseNumber) {
      const recurring = await fetchRecurring(street, numbers);
      for (const key of CATEGORY_KEYS) {
        if (key !== 'sperrmuell' && recurring[key]?.length) schedule[key] = recurring[key];
      }
    }

    if (Object.keys(schedule).length > 0) {
      scheduleByStreet.set(street.replace(/ß/g, 'ss'), schedule);
      for (const key of CATEGORY_KEYS) if (schedule[key]?.length) found[key]++;
    }

    processed++;
    if (processed % 100 === 0 || processed === streets.length) {
      console.log(`  ${processed}/${streets.length} (streets with data: ${scheduleByStreet.size})`);
    }
  });

  console.log(
    `Streets with data: ${scheduleByStreet.size} — ` +
      CATEGORIES.map((c) => `${c.label} ${found[c.key]}`).join(', ')
  );
  return scheduleByStreet;
}

// --- Output assembly ---------------------------------------------------------

/** Builds the small inlined calendar.json: category metadata + the sorted union
 *  of every pickup date, each annotated with the categories occurring citywide. */
function buildCalendar(scheduleByStreet: Map<string, IsoSchedule>): {
  calendar: CalendarFile;
  dayIndex: Map<string, number>;
} {
  const categoriesByIso = new Map<string, Set<CategoryKey>>();
  for (const schedule of scheduleByStreet.values()) {
    for (const key of CATEGORY_KEYS) {
      for (const iso of schedule[key] ?? []) {
        let cats = categoriesByIso.get(iso);
        if (!cats) categoriesByIso.set(iso, (cats = new Set()));
        cats.add(key);
      }
    }
  }

  const days: CalendarDay[] = [...categoriesByIso.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([isoDate, cats]) => ({
      isoDate,
      date: toDisplayDate(isoDate),
      categories: CATEGORY_KEYS.filter((key) => cats.has(key))
    }));

  const dayIndex = new Map(days.map((day, index) => [day.isoDate, index]));
  return { calendar: { year: YEAR, generatedAt: new Date().toISOString(), categories: CATEGORIES, days }, dayIndex };
}

// --- Geometry assembly + multi-cluster disambiguation ------------------------
// Several Karlsruhe districts reuse the same street name ("Heideweg" exists in
// the northwest *and* the southeast). The cached geometry merges all matching
// ways, which drags the centroid to a meaningless midpoint. We split the ways
// into spatial clusters and, because collection days are geographically
// contiguous routes, keep the cluster nearest to that day's other streets.

const CLUSTER_GAP_METERS = 400;

type Line = [number, number][];

/** Equirectangular distance in meters; accurate enough at city scale. */
function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const meanLat = ((a[1] + b[1]) / 2) * toRad;
  const dx = (b[0] - a[0]) * toRad * Math.cos(meanLat);
  const dy = (b[1] - a[1]) * toRad;
  return Math.sqrt(dx * dx + dy * dy) * R;
}

function geometryLines(geometry: GeoJSON.Geometry): Line[] {
  if (geometry.type === 'LineString') return [geometry.coordinates as Line];
  if (geometry.type === 'MultiLineString') return geometry.coordinates as Line[];
  return [];
}

function geometryFromLines(lines: Line[]): GeoJSON.Geometry {
  return lines.length === 1
    ? { type: 'LineString', coordinates: lines[0] }
    : { type: 'MultiLineString', coordinates: lines };
}

// OSM coordinates carry ~15 digits; 5 decimals is ~1 m precision, ample for
// rendering streets on a city map and roughly halves the output file size.
const COORD_DECIMALS = 5;

function roundCoordinates(value: unknown): unknown {
  if (typeof value === 'number') return Number(value.toFixed(COORD_DECIMALS));
  if (Array.isArray(value)) return value.map(roundCoordinates);
  return value;
}

function roundGeometry(geometry: GeoJSON.Geometry): GeoJSON.Geometry {
  if (!('coordinates' in geometry)) return geometry;
  return { ...geometry, coordinates: roundCoordinates(geometry.coordinates) } as GeoJSON.Geometry;
}

function linesAreClose(a: Line, b: Line): boolean {
  for (const p of a) for (const q of b) if (distanceMeters(p, q) < CLUSTER_GAP_METERS) return true;
  return false;
}

/** Single-linkage clustering of ways by proximity (transitive via union-find). */
function clusterLines(lines: Line[]): Line[][] {
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (find(i) !== find(j) && linesAreClose(lines[i], lines[j])) parent[find(i)] = find(j);
    }
  }

  const groups = new Map<number, Line[]>();
  lines.forEach((line, i) => {
    const root = find(i);
    const bucket = groups.get(root) ?? [];
    bucket.push(line);
    groups.set(root, bucket);
  });
  return [...groups.values()];
}

function clusterCentroid(cluster: Line[]): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const line of cluster) for (const [x, y] of line) { sx += x; sy += y; n++; }
  return [sx / n, sy / n];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Where a street name resolves to several spatially-separated clusters of ways,
 * replace its merged geometry with the single cluster that best fits the rest of
 * its collection day. Anchored on the Sperrmüll day (`dateByStreet`: normalized
 * street -> ISO Sperrmüll date), whose geographically-contiguous routes make the
 * "nearest same-day street" heuristic meaningful — the recurring categories are
 * citywide, so they carry no such locality. Operates in place on `resolved`.
 */
function disambiguateMultiCluster(resolved: Map<string, StreetGeometry>, dateByStreet: Map<string, string>) {
  const clustersByKey = new Map<string, Line[][]>();
  for (const [key, entry] of resolved) {
    if (entry.geometry.type === 'Point') continue;
    clustersByKey.set(key, clusterLines(geometryLines(entry.geometry)));
  }

  // Reference points per day come only from unambiguous (single-cluster) streets.
  const refsByDate = new Map<string, [number, number][]>();
  for (const [key, clusters] of clustersByKey) {
    if (clusters.length !== 1) continue;
    const date = dateByStreet.get(key);
    if (!date) continue;
    const bucket = refsByDate.get(date) ?? [];
    bucket.push(clusterCentroid(clusters[0]));
    refsByDate.set(date, bucket);
  }

  let fixed = 0;
  for (const [key, clusters] of clustersByKey) {
    if (clusters.length < 2) continue;
    const street = resolved.get(key)!.street;
    const date = dateByStreet.get(key);
    const refs = (date && refsByDate.get(date)) ?? [];

    let chosen: Line[];
    if (refs.length > 0) {
      const ref: [number, number] = [median(refs.map((r) => r[0])), median(refs.map((r) => r[1]))];
      chosen = clusters.reduce((best, c) =>
        distanceMeters(clusterCentroid(c), ref) < distanceMeters(clusterCentroid(best), ref) ? c : best
      );
    } else {
      // No same-day context: keep the cluster with the most points as a stable,
      // deterministic guess.
      const size = (c: Line[]) => c.reduce((sum, line) => sum + line.length, 0);
      chosen = clusters.reduce((best, c) => (size(c) > size(best) ? c : best));
    }

    resolved.set(key, { street, geometry: geometryFromLines(chosen) });
    fixed++;
  }

  if (fixed > 0) console.log(`  Ambiguous street names disambiguated: ${fixed}`);
}

/**
 * Joins each scraped street to its geometry and rewrites its per-category ISO
 * dates as indices into calendar.days. Streets without a real OSM geometry keep
 * `geometry: null` (still listed, just not drawn). Pure computation, no network.
 */
async function buildStreetData(
  scheduleByStreet: Map<string, IsoSchedule>,
  dayIndex: Map<string, number>
): Promise<StreetDataFile> {
  const streetNames = [...scheduleByStreet.keys()].sort((left, right) => left.localeCompare(right, 'de'));

  const cache = await readJson<StreetGeometryFile>(dataFile('geometry-cache.json'));
  if (!cache) {
    console.warn('WARNING: data/geometry-cache.json is missing. Run `bun run data:cache`. Streets will have no geometry.');
  }
  const cachedByKey = new Map<string, StreetGeometry>(
    cache?.streets.map((entry) => [normalizeStreet(entry.street), entry]) ?? []
  );

  // Resolve geometries first (a real, non-Point line/point or nothing), then
  // disambiguate same-named streets using the Sperrmüll-day context.
  const resolvedGeometry = new Map<string, StreetGeometry>();
  let withGeometry = 0;
  for (const street of streetNames) {
    const hit = cachedByKey.get(normalizeStreet(street));
    if (hit && hit.geometry.type !== 'Point') {
      resolvedGeometry.set(normalizeStreet(street), { street, geometry: hit.geometry });
      withGeometry++;
    }
  }

  const sperrmuellDateByStreet = new Map<string, string>();
  for (const [street, schedule] of scheduleByStreet) {
    const iso = schedule.sperrmuell?.[0];
    if (iso) sperrmuellDateByStreet.set(normalizeStreet(street), iso);
  }
  disambiguateMultiCluster(resolvedGeometry, sperrmuellDateByStreet);

  const streets: StreetData[] = streetNames.map((street) => {
    const isoSchedule = scheduleByStreet.get(street)!;
    const schedule: StreetSchedule = {};
    for (const key of CATEGORY_KEYS) {
      const indices = (isoSchedule[key] ?? [])
        .map((iso) => dayIndex.get(iso))
        .filter((index): index is number => index !== undefined);
      if (indices.length > 0) schedule[key] = indices;
    }
    const geometry = resolvedGeometry.get(normalizeStreet(street))?.geometry ?? null;
    return { street, geometry: geometry ? roundGeometry(geometry) : null, schedule };
  });

  console.log(`Streets total: ${streets.length}, with geometry: ${withGeometry}, list-only: ${streets.length - withGeometry}`);
  return { year: YEAR, generatedAt: new Date().toISOString(), streets };
}

// --- Entry point -------------------------------------------------------------

async function main() {
  console.log(`Starting data refresh for ${YEAR}...`);
  await Bun.write(staticDataFile('.gitkeep'), '');

  let streets = await fetchSourceStreets();
  if (STREET_LIMIT > 0) streets = streets.slice(0, STREET_LIMIT);
  console.log(`Streets found in source: ${streets.length}`);

  await detectPlaceholderDates();

  const scheduleByStreet = await scrapeSchedules(streets);
  const { calendar, dayIndex } = buildCalendar(scheduleByStreet);
  const streetData = await buildStreetData(scheduleByStreet, dayIndex);

  console.log(`Calendar days: ${calendar.days.length}`);

  await writeJson(staticDataFile('calendar.json'), calendar);
  await writeJsonCompact(staticDataFile('street-data.json'), streetData);

  console.log(`Wrote ${calendar.days.length} days and ${streetData.streets.length} streets.`);
}

await main();
