// `bun run data:cache` — the Overpass-heavy half of the pipeline.
//
// This command does ALL the slow, rate-limited Overpass work and writes its
// results into `data/` as committed caches:
//   - data/osm-house-numbers.json : street -> real OSM house numbers
//   - data/geometry-cache.json    : street -> raw GeoJSON line/point
//
// It is meant to be run on demand (not on every CI build) and is resumable:
// progress is written after every Overpass batch, so an interrupted run keeps
// everything fetched so far. The cheap, Karlsruhe-only `data:refresh` scrape
// then consumes these caches without touching Overpass.

import {
  DATA_DIR,
  KARLSRUHE_CENTER,
  OVERPASS_COOLDOWN_MS,
  QUICK,
  STREET_LIMIT,
  YEAR,
  type StreetGeometry,
  dataFile,
  escapeOverpassRegex,
  fetchSourceStreets,
  fetchWithOverpassRetry,
  normalizeStreet,
  resolveSearchArea,
  streetAliases,
  writeJson
} from './lib/shared.ts';

declare const Bun: { write(path: string | URL, data: string): Promise<void>; sleep(ms: number): Promise<void> };
declare const process: {
  env: Record<string, string | undefined>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  exit(code?: number): never;
};

const GEOMETRY_MODE = process.env.SPERRMUELL_GEOMETRY_MODE ?? 'osm';
const HOUSE_NUMBER_BATCH_SIZE = Number(process.env.SPERRMUELL_HOUSENUMBER_BATCH_SIZE ?? (QUICK ? 10 : 20));
const STREET_BATCH_SIZE = Number(process.env.SPERRMUELL_GEOMETRY_BATCH_SIZE ?? (QUICK ? 10 : 75));
// Overpass intermittently answers 200 OK with partial/empty data, which would
// silently leave streets without geometry. We re-query the still-missing ones a
// few times (in shrinking batches) before falling back to a point.
const GEOMETRY_ROUNDS = Number(process.env.SPERRMUELL_GEOMETRY_ROUNDS ?? 3);

const HOUSE_NUMBERS_FILE = dataFile('osm-house-numbers.json');
const GEOMETRY_CACHE_FILE = dataFile('geometry-cache.json');

let SEARCH_AREA_STATEMENT = 'area["name"="Karlsruhe"]["admin_level"="6"]';

// --- House numbers -----------------------------------------------------------

type HouseNumberCache = {
  generatedAt: string;
  // Normalized street name -> OSM house numbers. An empty array means "asked
  // Overpass, found none" so the street is not re-queried on resume.
  houseNumbers: Record<string, string[]>;
};

async function buildHouseNumberCache(streets: string[]): Promise<void> {
  const cache =
    (await readHouseNumberCache()) ?? { generatedAt: new Date().toISOString(), houseNumbers: {} };

  // De-duplicate and present the source spelling (ß -> ss) to Overpass aliasing.
  const names = [...new Set(streets.map((street) => street.replace(/ß/g, 'ss')))].sort((left, right) =>
    left.localeCompare(right, 'de')
  );
  const missing = names.filter((street) => !(normalizeStreet(street) in cache.houseNumbers));
  console.log(`OSM-Hausnummern: ${names.length - missing.length} im Cache, ${missing.length} fehlend.`);

  for (let index = 0; index < missing.length; index += HOUSE_NUMBER_BATCH_SIZE) {
    const batch = missing.slice(index, index + HOUSE_NUMBER_BATCH_SIZE);
    const alternation = batch.flatMap(streetAliases).map(escapeOverpassRegex).join('|');
    const query = `[out:json][timeout:180];
${SEARCH_AREA_STATEMENT}->.searchArea;
(
  nwr(area.searchArea)["addr:street"~"^(${alternation})$",i]["addr:housenumber"];
);
out tags;`;

    const batchNumber = index / HOUSE_NUMBER_BATCH_SIZE + 1;
    console.log(`Overpass-Hausnummern Batch ${batchNumber} mit ${batch.length} Straßen`);
    const response = await fetchWithOverpassRetry(query, `house-number batch ${batchNumber}`);

    if (response.ok) {
      const payload = (await response.json()) as {
        elements: Array<{ tags?: { 'addr:street'?: string; 'addr:housenumber'?: string } }>;
      };
      console.log(`  ${payload.elements?.length ?? 0} adressierte Elemente`);

      // Record every street in the batch (defaulting to empty) so genuine "no
      // OSM addresses" results are cached and not re-queried next run.
      for (const street of batch) {
        const key = normalizeStreet(street);
        if (!(key in cache.houseNumbers)) cache.houseNumbers[key] = [];
      }

      for (const element of payload.elements ?? []) {
        const streetName = element.tags?.['addr:street']?.trim();
        const houseNumber = element.tags?.['addr:housenumber']?.trim();
        if (!streetName || !houseNumber) continue;

        const key = normalizeStreet(streetName);
        const bucket = (cache.houseNumbers[key] ??= []);
        if (!bucket.includes(houseNumber)) bucket.push(houseNumber);
      }

      // Persist after every batch so an interrupted run resumes with a warm cache.
      await persistHouseNumbers(cache);
    }

    await Bun.sleep(OVERPASS_COOLDOWN_MS);
  }

  const withAddresses = Object.values(cache.houseNumbers).filter((numbers) => numbers.length > 0).length;
  console.log(`OSM-Hausnummern fertig: ${withAddresses} Straßen mit Adressen, ${Object.keys(cache.houseNumbers).length} gesamt.`);
}

async function readHouseNumberCache(): Promise<HouseNumberCache | null> {
  try {
    return JSON.parse(await Bun.file(HOUSE_NUMBERS_FILE).text()) as HouseNumberCache;
  } catch {
    return null;
  }
}

async function persistHouseNumbers(cache: HouseNumberCache) {
  cache.generatedAt = new Date().toISOString();
  await writeJson(HOUSE_NUMBERS_FILE, cache);
}

// --- Geometries --------------------------------------------------------------

type GeometryCache = { generatedAt: string; streets: StreetGeometry[] };

function fallbackPointGeometry(): GeoJSON.Geometry {
  return { type: 'Point', coordinates: KARLSRUHE_CENTER };
}

function toStreetGeometryFromWays(
  street: string,
  ways: Array<{ geometry: Array<{ lon: number; lat: number }> }>
): StreetGeometry {
  const lines = ways
    .map((way) => way.geometry.map((point) => [point.lon, point.lat] as [number, number]))
    .filter((coordinates) => coordinates.length >= 2);

  if (lines.length === 0) return { street, geometry: fallbackPointGeometry() };
  if (lines.length === 1) return { street, geometry: { type: 'LineString', coordinates: lines[0] } };
  return { street, geometry: { type: 'MultiLineString', coordinates: lines } };
}

/**
 * Fetches geometry for a batch. Returns only streets that resolved to a real
 * line; streets with no matching way are omitted so the caller can retry them
 * (Overpass partial/empty 200 responses leave streets out intermittently) and,
 * after the retry rounds, fall back to a point.
 */
async function fetchGeometryBatch(batch: string[], label: string): Promise<Map<string, StreetGeometry>> {
  const result = new Map<string, StreetGeometry>();
  const alternation = batch.flatMap(streetAliases).map(escapeOverpassRegex).join('|');
  const query = `[out:json][timeout:180];
${SEARCH_AREA_STATEMENT}->.searchArea;
(
  way(area.searchArea)["highway"]["name"~"^(${alternation})$",i];
);
out geom;`;

  console.log(`Overpass-Geometrie (${label}) mit ${batch.length} Straßen`);
  const response = await fetchWithOverpassRetry(query, label);
  if (!response.ok) return result;

  const payload = (await response.json()) as {
    elements: Array<{ type: 'way'; tags?: { name?: string }; geometry: Array<{ lon: number; lat: number }> }>;
  };
  console.log(`  ${payload.elements?.length ?? 0} Elemente`);

  const grouped = new Map<string, Array<{ geometry: Array<{ lon: number; lat: number }> }>>();
  for (const element of payload.elements ?? []) {
    const name = element.tags?.name?.trim();
    if (!name) continue;
    const key = normalizeStreet(name);
    const bucket = grouped.get(key) ?? [];
    bucket.push({ geometry: element.geometry });
    grouped.set(key, bucket);
  }

  for (const street of batch) {
    const ways = grouped.get(normalizeStreet(street));
    if (!ways?.length) continue;
    const geometry = toStreetGeometryFromWays(street, ways);
    // A Point here means the ways had no usable line; leave it pending.
    if (geometry.geometry.type !== 'Point') result.set(normalizeStreet(street), geometry);
  }

  return result;
}

async function buildGeometryCache(streets: string[]): Promise<void> {
  const uniqueStreets = [...new Set(streets.map((street) => street.replace(/ß/g, 'ss')))].sort(
    (left, right) => left.localeCompare(right, 'de')
  );
  console.log(`Geometrien für ${uniqueStreets.length} Straßen...`);

  const existing = await readGeometryCache();
  // Real geometries seed the run; cached Points are treated as misses so they
  // get another chance at a real shape (unless we're in point-only mode).
  const cached = new Map<string, StreetGeometry>(
    existing?.streets
      .filter((entry) => GEOMETRY_MODE === 'point' || entry.geometry.type !== 'Point')
      .map((entry) => [normalizeStreet(entry.street), entry]) ?? []
  );

  const resolved = new Map<string, StreetGeometry>();
  const missing: string[] = [];
  for (const street of uniqueStreets) {
    const hit = cached.get(normalizeStreet(street));
    if (hit) resolved.set(normalizeStreet(street), hit);
    else missing.push(street);
  }
  console.log(`  Geometrie-Cache-Treffer: ${resolved.size}, fehlend: ${missing.length}`);

  const orderedStreets = () =>
    uniqueStreets
      .map((street) => resolved.get(normalizeStreet(street)))
      .filter((entry): entry is StreetGeometry => Boolean(entry));
  const persist = () =>
    writeJson(GEOMETRY_CACHE_FILE, { generatedAt: new Date().toISOString(), streets: orderedStreets() } satisfies GeometryCache);

  if (GEOMETRY_MODE === 'point') {
    for (const street of missing) resolved.set(normalizeStreet(street), { street, geometry: fallbackPointGeometry() });
    await persist();
    return;
  }

  // Retry still-missing streets in shrinking batches. Transient Overpass gaps
  // resolve on a later round; only genuinely unmapped streets survive all rounds.
  let pending = missing;
  for (let round = 1; round <= GEOMETRY_ROUNDS && pending.length > 0; round++) {
    const batchSize = Math.max(10, Math.floor(STREET_BATCH_SIZE / round));
    console.log(`Geometrie-Runde ${round}/${GEOMETRY_ROUNDS}: ${pending.length} Straßen (Batchgröße ${batchSize})`);
    const stillMissing: string[] = [];

    for (let index = 0; index < pending.length; index += batchSize) {
      const batch = pending.slice(index, index + batchSize);
      const fetched = await fetchGeometryBatch(batch, `geometry round ${round} batch ${index / batchSize + 1}`);
      for (const street of batch) {
        const geometry = fetched.get(normalizeStreet(street));
        if (geometry) resolved.set(normalizeStreet(street), geometry);
        else stillMissing.push(street);
      }
      await persist();
      await Bun.sleep(OVERPASS_COOLDOWN_MS);
    }
    pending = stillMissing;
  }

  // Whatever is still missing is genuinely unmapped in OSM (e.g. Gewann field
  // names, squares without a highway way) -> fall back to a point.
  if (pending.length > 0) {
    console.log(`  ${pending.length} Straßen ohne OSM-Geometrie, nutze Punkt-Fallback: ${pending.slice(0, 10).join(', ')}${pending.length > 10 ? ' ...' : ''}`);
    for (const street of pending) resolved.set(normalizeStreet(street), { street, geometry: fallbackPointGeometry() });
    await persist();
  }
}

async function readGeometryCache(): Promise<GeometryCache | null> {
  try {
    return JSON.parse(await Bun.file(GEOMETRY_CACHE_FILE).text()) as GeometryCache;
  } catch {
    return null;
  }
}

// --- Entry point -------------------------------------------------------------

async function main() {
  console.log(`Baue Overpass-Cache für ${YEAR}... (Zielordner ${DATA_DIR.pathname})`);

  let streets = await fetchSourceStreets();
  if (STREET_LIMIT > 0) streets = streets.slice(0, STREET_LIMIT);
  console.log(`Straßen in Quelle: ${streets.length}`);

  SEARCH_AREA_STATEMENT = await resolveSearchArea();

  await buildHouseNumberCache(streets);
  await buildGeometryCache(streets);

  console.log('Cache-Aufbau abgeschlossen.');
}

await main();
