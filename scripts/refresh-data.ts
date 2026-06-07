// `bun run data:refresh` — the cheap, Karlsruhe-only scrape. Runs on every CI
// build. It reads the committed Overpass caches produced by `data:cache`
// (data/osm-house-numbers.json, data/geometry-cache.json) and never talks to
// Overpass itself, so it stays fast and immune to Overpass flakiness.
//
// It probes the Karlsruhe source for each street's Sperrmüll date and writes:
//   - static/data/calendar.json          (pickup dates -> streets)
//   - static/data/street-geometries.json (disambiguated per-street geometry)
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
  KARLSRUHE_SOURCE,
  QUICK,
  STREET_LIMIT,
  USER_AGENT,
  YEAR,
  type CalendarFile,
  type StreetGeometry,
  type StreetGeometryFile,
  dataFile,
  fetchSourceStreets,
  mapPool,
  normalizeStreet,
  parseNumberList,
  readJson,
  staticDataFile,
  toIsoDate,
  writeJson
} from './lib/shared.ts';

declare const Bun: { sleep(ms: number): Promise<void>; write(path: string | URL, data: string): Promise<void> };
declare const process: { env: Record<string, string | undefined> };

const KARLSRUHE_CONCURRENCY = Number(process.env.SPERRMUELL_KARLSRUHE_CONCURRENCY ?? (QUICK ? 2 : 6));
const KARLSRUHE_MAX_RETRIES = Number(process.env.SPERRMUELL_KARLSRUHE_RETRIES ?? 3);
// How many of a street's OSM house numbers we probe before giving up. The first
// non-placeholder date wins, so this only matters for streets whose early
// numbers are unknown to the source or that genuinely sit on the placeholder date.
const OSM_PROBE_LIMIT = Number(process.env.SPERRMUELL_OSM_PROBE_LIMIT ?? 6);
// House numbers tried for streets with no OSM addresses at all.
const FALLBACK_PROBES = parseNumberList(
  process.env.SPERRMUELL_FALLBACK_PROBES,
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '19', '22', '25', '30', '50']
);

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

/**
 * Primary path: the street has real OSM house numbers. We probe them in order
 * and take the first non-placeholder date; if the only dates we see are the
 * placeholder date, we trust it too (a real street legitimately on that date).
 */
async function resolveFromOsm(street: string, osmNumbers: string[]): Promise<string | null> {
  let placeholderSeen: string | null = null;

  for (const houseNumber of osmNumbers.slice(0, OSM_PROBE_LIMIT)) {
    const outcome = await probe(street, houseNumber);
    if (!isDate(outcome)) continue; // #unknown / #nodate -> try next OSM number
    if (placeholderDates.has(outcome)) {
      placeholderSeen = outcome; // defer: prefer any non-placeholder date below
      continue;
    }
    return outcome;
  }
  return placeholderSeen;
}

/**
 * Fallback path: no OSM addresses. We probe a fixed list and distrust the
 * placeholder date outright (no OSM-less street legitimately falls on it), so
 * phantom squares/Gewann are dropped while real un-mapped streets survive.
 */
async function resolveFromFallback(street: string): Promise<string | null> {
  for (const houseNumber of FALLBACK_PROBES) {
    const outcome = await probe(street, houseNumber);
    if (!isDate(outcome)) continue;
    if (placeholderDates.has(outcome)) continue;
    return outcome;
  }
  return null;
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
      ? 'Kein Platzhalter-Datum erkannt.'
      : `Platzhalter-Datum erkannt: ${[...placeholderDates].join(', ')}`
  );
}

// --- Calendar ----------------------------------------------------------------

type HouseNumberCache = { houseNumbers: Record<string, string[]> };

async function scrapeCalendar(streets: string[]): Promise<CalendarFile> {
  const cache = await readJson<HouseNumberCache>(dataFile('osm-house-numbers.json'));
  if (!cache) {
    console.warn(
      'WARNUNG: data/osm-house-numbers.json fehlt. Führe `bun run data:cache` aus. ' +
        'Ohne OSM-Hausnummern nutzen alle Straßen den Fallback-Pfad (geringere Trefferquote).'
    );
  }
  const osmHouseNumbers = cache?.houseNumbers ?? {};

  const dateByStreet = new Map<string, string>();
  let viaOsm = 0;
  let viaFallback = 0;
  let processed = 0;

  console.log(`Prüfe Sperrmüll-Termine für ${streets.length} Straßen (parallel: ${KARLSRUHE_CONCURRENCY})`);
  await mapPool(streets, KARLSRUHE_CONCURRENCY, async (rawStreet) => {
    const street = rawStreet.trim();
    const osmNumbers = osmHouseNumbers[normalizeStreet(street)] ?? [];

    let date: string | null;
    if (osmNumbers.length > 0) {
      date = await resolveFromOsm(street, osmNumbers);
      if (date) viaOsm++;
    } else {
      date = await resolveFromFallback(street);
      if (date) viaFallback++;
    }
    if (date) dateByStreet.set(street, date);

    processed++;
    if (processed % 100 === 0 || processed === streets.length) {
      console.log(`  ${processed}/${streets.length} (Treffer: ${dateByStreet.size}; OSM ${viaOsm}, Fallback ${viaFallback})`);
    }
  });

  console.log(`Termine gefunden: ${dateByStreet.size} (über OSM-Hausnummern: ${viaOsm}, über Fallback: ${viaFallback}).`);

  const byDate = new Map<string, string[]>();
  for (const [street, date] of dateByStreet) {
    const bucket = byDate.get(date) ?? [];
    bucket.push(street.replace(/ß/g, 'ss'));
    byDate.set(date, bucket);
  }

  const entries = [...byDate.entries()]
    .map(([date, streetsForDate]) => ({
      date,
      isoDate: toIsoDate(date),
      streets: streetsForDate.sort((left, right) => left.localeCompare(right, 'de'))
    }))
    .sort((left, right) => left.isoDate.localeCompare(right.isoDate));

  return { year: YEAR, generatedAt: new Date().toISOString(), entries };
}

// --- Geometry assembly + multi-cluster disambiguation ------------------------
// Several Karlsruhe districts reuse the same street name ("Heideweg" exists in
// the northwest *and* the southeast). The cached geometry merges all matching
// ways, which drags the centroid to a meaningless midpoint. We split the ways
// into spatial clusters and, because collection days are geographically
// contiguous routes, keep the cluster nearest to that day's other streets.

const CLUSTER_GAP_METERS = Number(process.env.SPERRMUELL_CLUSTER_GAP_METERS ?? 400);

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
 * its collection day. Operates in place on `resolved`; no network calls.
 */
function disambiguateMultiCluster(resolved: Map<string, StreetGeometry>, calendar: CalendarFile) {
  const dateByStreet = new Map<string, string>();
  for (const entry of calendar.entries) {
    for (const street of entry.streets) dateByStreet.set(normalizeStreet(street), entry.isoDate);
  }

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

  if (fixed > 0) console.log(`  Mehrdeutige Straßennamen disambiguiert: ${fixed}`);
}

function fallbackPointGeometry(street: string): StreetGeometry {
  return { street, geometry: { type: 'Point', coordinates: [8.4034195, 49.0068705] } };
}

async function buildStreetGeometries(calendar: CalendarFile): Promise<StreetGeometryFile> {
  const uniqueStreets = [...new Set(calendar.entries.flatMap((entry) => entry.streets))]
    .map((street) => street.replace(/ß/g, 'ss'))
    .sort((left, right) => left.localeCompare(right, 'de'));

  const cache = await readJson<StreetGeometryFile>(dataFile('geometry-cache.json'));
  if (!cache) {
    console.warn('WARNUNG: data/geometry-cache.json fehlt. Führe `bun run data:cache` aus. Nutze Punkt-Geometrien.');
  }
  const cachedByKey = new Map<string, StreetGeometry>(
    cache?.streets.map((entry) => [normalizeStreet(entry.street), entry]) ?? []
  );

  const resolved = new Map<string, StreetGeometry>();
  let pointFallbacks = 0;
  for (const street of uniqueStreets) {
    const key = normalizeStreet(street);
    const hit = cachedByKey.get(key);
    if (hit) {
      resolved.set(key, { street, geometry: hit.geometry });
    } else {
      resolved.set(key, fallbackPointGeometry(street));
      pointFallbacks++;
    }
  }
  console.log(`Geometrien aus Cache: ${uniqueStreets.length - pointFallbacks}, Punkt-Fallback: ${pointFallbacks}`);

  // Same street name in several districts -> keep the cluster matching the day.
  disambiguateMultiCluster(resolved, calendar);

  const streets = uniqueStreets
    .map((street) => resolved.get(normalizeStreet(street)))
    .filter((entry): entry is StreetGeometry => Boolean(entry));

  return { year: YEAR, generatedAt: new Date().toISOString(), streets };
}

// --- Entry point -------------------------------------------------------------

async function main() {
  console.log(`Starte Datenerneuerung für ${YEAR}...`);
  await Bun.write(staticDataFile('.gitkeep'), '');

  let streets = await fetchSourceStreets();
  if (STREET_LIMIT > 0) streets = streets.slice(0, STREET_LIMIT);
  console.log(`Gefundene Straßen in Quelle: ${streets.length}`);

  await detectPlaceholderDates();

  const calendar = await scrapeCalendar(streets);
  const geometries = await buildStreetGeometries(calendar);

  console.log(`Kalender-Einträge: ${calendar.entries.length}`);
  console.log(`Geometrien: ${geometries.streets.length}`);

  await writeJson(staticDataFile('calendar.json'), calendar);
  await writeJson(staticDataFile('street-geometries.json'), geometries);

  console.log(`Schrieb ${calendar.entries.length} Termine und ${geometries.streets.length} Straßen.`);
}

await main();
