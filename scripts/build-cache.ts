// `bun run data:cache [city]` — the Overpass-heavy half of the pipeline.
//
// This command does ALL the slow, rate-limited Overpass work and writes its
// results into `data/` as committed caches:
//   - data/[city/]osm-house-numbers.json : street -> real OSM house numbers
//   - data/[city/]geometry-cache.json    : street -> raw GeoJSON line/point
//
// It is meant to be run on demand (not on every CI build) and is resumable:
// progress is written after every Overpass batch, so an interrupted run keeps
// everything fetched so far. The cheap `data:refresh` scrape then consumes these
// caches without touching Overpass.

import {
  DATA_DIR,
  OVERPASS_COOLDOWN_MS,
  QUICK,
  STREET_LIMIT,
  YEAR,
  type StreetGeometry,
  cityDataFile,
  escapeOverpassRegex,
  fetchWithOverpassRetry,
  normalizeStreet,
  streetAliases,
  writeJson
} from './lib/shared.ts';
import { getCityFetcher } from './fetchers/index.ts';

declare const Bun: { write(path: string | URL, data: string): Promise<void>; sleep(ms: number): Promise<void> };
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  exit(code?: number): never;
};

const cityId = (process.argv[2] || process.env.CITY || 'karlsruhe').toLowerCase();
const fetcher = getCityFetcher(cityId);

const HOUSE_NUMBER_BATCH_SIZE = QUICK ? 10 : 20;
const STREET_BATCH_SIZE = QUICK ? 10 : 75;
const GEOMETRY_ROUNDS = 3;

const HOUSE_NUMBERS_FILE = cityDataFile(cityId, 'osm-house-numbers.json');
const GEOMETRY_CACHE_FILE = cityDataFile(cityId, 'geometry-cache.json');

// --- House numbers -----------------------------------------------------------

type HouseNumberCache = {
  generatedAt: string;
  houseNumbers: Record<string, string[]>;
};

async function buildHouseNumberCache(streets: string[]): Promise<void> {
  const cache =
    (await readHouseNumberCache()) ?? { generatedAt: new Date().toISOString(), houseNumbers: {} };

  const names = [...new Set(streets.map((street) => street.replace(/ß/g, 'ss')))].sort((left, right) =>
    left.localeCompare(right, 'de')
  );
  const missing = names.filter((street) => !(normalizeStreet(street) in cache.houseNumbers));
  console.log(`OSM house numbers: ${names.length - missing.length} cached, ${missing.length} missing.`);

  for (let index = 0; index < missing.length; index += HOUSE_NUMBER_BATCH_SIZE) {
    const batchNumber = index / HOUSE_NUMBER_BATCH_SIZE + 1;
    const bboxHeader = `[bbox:${fetcher.bbox.join(',')}]`;
    const query = `[out:json][timeout:180]${bboxHeader};
(
  nwr["addr:street"~"^(${alternation})$",i]["addr:housenumber"];
);
out tags;`;

    console.log(`Overpass house-numbers batch ${batchNumber} with ${batch.length} streets`);
    const response = await fetchWithOverpassRetry(query, `house-number batch ${batchNumber}`);

    if (response.ok) {
      const payload = (await response.json()) as {
        elements: Array<{ tags?: { 'addr:street'?: string; 'addr:housenumber'?: string } }>;
      };
      console.log(`  ${payload.elements?.length ?? 0} addressed elements`);

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

      await persistHouseNumbers(cache);
    }

    await Bun.sleep(OVERPASS_COOLDOWN_MS);
  }

  const withAddresses = Object.values(cache.houseNumbers).filter((numbers) => numbers.length > 0).length;
  console.log(`OSM house numbers done: ${withAddresses} streets with addresses, ${Object.keys(cache.houseNumbers).length} total.`);
}

async function readHouseNumberCache(): Promise<HouseNumberCache | null> {
  try {
    return JSON.parse(await Bun.file(HOUSE_NUMBERS_FILE).text()) as HouseNumberCache;
  } catch {
    return null;
  }
}

async function persistHouseNumbers(cache: HouseNumberCache): Promise<void> {
  await writeJson(HOUSE_NUMBERS_FILE, cache);
}

// --- Geometries --------------------------------------------------------------

type GeometryCache = {
  generatedAt: string;
  streets: StreetGeometry[];
};

function fallbackPointGeometry(): GeoJSON.Geometry {
  return { type: 'Point', coordinates: fetcher.center };
}

function waysToGeoJson(ways: Array<{ geometry?: Array<{ lat: number; lon: number }> }>): GeoJSON.Geometry | null {
  const lines: number[][][] = [];
  for (const way of ways) {
    if (!way.geometry || way.geometry.length < 2) continue;
    lines.push(way.geometry.map((node) => [node.lon, node.lat]));
  }
  if (lines.length === 0) return null;
  if (lines.length === 1) return { type: 'LineString', coordinates: lines[0] };
  return { type: 'MultiLineString', coordinates: lines };
}

async function queryGeometries(streets: string[]): Promise<Map<string, StreetGeometry>> {
  const alternation = streets.flatMap(streetAliases).map(escapeOverpassRegex).join('|');
  const bboxHeader = `[bbox:${fetcher.bbox.join(',')}]`;
  const query = `[out:json][timeout:180]${bboxHeader};
(
  way["name"~"^(${alternation})$",i];
);
out geom;`;

  const response = await fetchWithOverpassRetry(query, `geometry batch (${streets.length} streets)`);
  const result = new Map<string, StreetGeometry>();
  if (!response.ok) return result;

  const payload = (await response.json()) as {
    elements: Array<{ tags?: { name?: string }; geometry?: Array<{ lat: number; lon: number }> }>;
  };

  const waysByName = new Map<string, typeof payload.elements>();
  for (const element of payload.elements ?? []) {
    const name = element.tags?.name?.trim();
    if (!name) continue;
    const key = normalizeStreet(name);
    const bucket = waysByName.get(key) ?? [];
    bucket.push(element);
    waysByName.set(key, bucket);
  }

  for (const street of streets) {
    const key = normalizeStreet(street);
    const keyCleaned = normalizeStreet(street.replace(/\s*\(.*?\)$/, ''));
    const ways = waysByName.get(key) ?? waysByName.get(keyCleaned);
    if (!ways) continue;
    const geometry = waysToGeoJson(ways);
    if (geometry) result.set(key, { street, geometry });
  }

  return result;
}

async function buildGeometryCache(streets: string[]): Promise<void> {
  const existing = await readGeometryCache();
  const resolved = new Map<string, StreetGeometry>();
  if (existing) {
    for (const entry of existing.streets) {
      if (entry.geometry && entry.geometry.type !== 'Point') {
        resolved.set(normalizeStreet(entry.street), entry);
      }
    }
  }

  const persist = async () => {
    const list = [...resolved.values()].sort((a, b) => a.street.localeCompare(b.street, 'de'));
    await writeJson(GEOMETRY_CACHE_FILE, { generatedAt: new Date().toISOString(), streets: list });
  };

  let pending = [...new Set(streets.map((s) => s.replace(/ß/g, 'ss')))]
    .filter((s) => !resolved.has(normalizeStreet(s)))
    .sort((a, b) => a.localeCompare(b, 'de'));

  console.log(`OSM geometry: ${resolved.size} cached, ${pending.length} missing.`);

  for (let round = 1; round <= GEOMETRY_ROUNDS && pending.length > 0; round++) {
    const batchSize = Math.max(5, Math.floor(STREET_BATCH_SIZE / round));
    console.log(`Geometry round ${round}/${GEOMETRY_ROUNDS}: ${pending.length} streets pending (batch size ${batchSize})`);

    const stillMissing: string[] = [];
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      console.log(`  Overpass geometry batch ${Math.floor(i / batchSize) + 1} (${batch.length} streets)...`);
      const fetched = await queryGeometries(batch);

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

  if (pending.length > 0) {
    console.log(`  ${pending.length} streets without OSM geometry, using point fallback: ${pending.slice(0, 10).join(', ')}${pending.length > 10 ? ' ...' : ''}`);
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
  console.log(`Building Overpass cache for ${fetcher.name} (${YEAR})... (target directory ${DATA_DIR.pathname})`);

  let streets = await fetcher.fetchStreets();
  if (STREET_LIMIT > 0) streets = streets.slice(0, STREET_LIMIT);
  console.log(`Streets in source: ${streets.length}`);

  if (fetcher.requiresOsmHouseNumbers) {
    await buildHouseNumberCache(streets);
  }
  await buildGeometryCache(streets);

  console.log(`Cache build complete for ${fetcher.name}.`);
}

await main();
