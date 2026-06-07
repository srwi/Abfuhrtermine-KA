type CalendarEntry = {
  date: string;
  isoDate: string;
  streets: string[];
};

type CalendarFile = {
  year: number;
  generatedAt: string;
  entries: CalendarEntry[];
};

type StreetGeometry = {
  street: string;
  geometry: GeoJSON.Geometry;
};

type StreetGeometryFile = {
  year: number;
  generatedAt: string;
  streets: StreetGeometry[];
};

// Probe outcomes are stored as plain strings so the cache stays compact and
// human-readable. A `dd.mm.yyyy` value is a resolved pickup date; the two
// sentinels below distinguish "the address does not exist" from "the address
// exists but no Sperrmüll date could be extracted".
const PROBE_UNKNOWN = '#unknown';
const PROBE_NODATE = '#nodate';

type RetrievalCache = {
  year: number;
  generatedAt: string;
  // Normalized street name -> OSM house numbers (Overpass results).
  houseNumbers: Record<string, string[]>;
  // `${normalizedStreet}|${houseNumber}` -> probe outcome (date | sentinel).
  probes: Record<string, string>;
};

declare const Bun: {
  file(path: string | URL): { text(): Promise<string> };
  write(path: string | URL, data: string): Promise<void>;
  sleep(ms: number): Promise<void>;
};

declare const process: {
  env: Record<string, string | undefined>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  exit(code?: number): never;
};

const PROJECT_ROOT = new URL('..', import.meta.url);
const STATIC_DATA_DIR = new URL('static/data/', PROJECT_ROOT);
const RETRIEVAL_CACHE_FILE = new URL('data/refresh-cache.json', PROJECT_ROOT);

const QUICK = Boolean(process.env.SPERRMUELL_QUICK);
const YEAR = Number(process.env.SPERRMUELL_YEAR ?? new Date().getFullYear());
const GEOMETRY_MODE = process.env.SPERRMUELL_GEOMETRY_MODE ?? 'osm';
// Optional cap on the number of streets processed, handy for local testing.
const STREET_LIMIT = Number(process.env.SPERRMUELL_LIMIT ?? 0);

const USER_AGENT = 'Sperrmuell-KA/1.0 (+https://github.com/skjerns/Sperrmuell-KA)';
const KARLSRUHE_SOURCE = `https://web4.karlsruhe.de/service/abfall/akal/akal_${YEAR}.php`;
const KARLSRUHE_CENTER: [number, number] = [8.4034195, 49.0068705];
const OVERPASS_ENDPOINT = process.env.SPERRMUELL_OVERPASS_ENDPOINT ?? 'https://overpass-api.de/api/interpreter';

// Pass 1 only talks to the (effectively un-throttled) Karlsruhe site. We try a
// few low house numbers; whatever resolves here never needs an Overpass call.
const PASS1_PROBES = parseNumberList(process.env.SPERRMUELL_PASS1_PROBES, ['1', '2', '3']);
// Pass 2 fallback when Overpass returns no house numbers for a street.
const FALLBACK_PROBES = parseNumberList(
  process.env.SPERRMUELL_FALLBACK_PROBES,
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '19', '22', '25', '30', '50']
);

// Karlsruhe tolerates parallel requests, so we fan out pass-1/pass-2 probes.
const KARLSRUHE_CONCURRENCY = Number(process.env.SPERRMUELL_KARLSRUHE_CONCURRENCY ?? (QUICK ? 2 : 6));
const KARLSRUHE_MAX_RETRIES = Number(process.env.SPERRMUELL_KARLSRUHE_RETRIES ?? 3);

const STREET_BATCH_SIZE = Number(process.env.SPERRMUELL_GEOMETRY_BATCH_SIZE ?? (QUICK ? 10 : 75));
const HOUSE_NUMBER_BATCH_SIZE = Number(process.env.SPERRMUELL_HOUSENUMBER_BATCH_SIZE ?? (QUICK ? 10 : 20));
const OVERPASS_MAX_RETRIES = Number(process.env.SPERRMUELL_OVERPASS_RETRIES ?? 5);
const OVERPASS_BASE_BACKOFF_MS = Number(process.env.SPERRMUELL_OVERPASS_BACKOFF_MS ?? 2000);
const OVERPASS_COOLDOWN_MS = Number(process.env.SPERRMUELL_OVERPASS_COOLDOWN_MS ?? 1000);
// Overpass intermittently answers 200 OK with partial/empty data, which would
// silently leave streets without geometry. We re-query the still-missing ones a
// few times (in shrinking batches) before falling back to a point.
const GEOMETRY_ROUNDS = Number(process.env.SPERRMUELL_GEOMETRY_ROUNDS ?? 3);

// Statement that selects the Karlsruhe search area in Overpass queries. The
// name `Karlsruhe` matches two administrative areas (admin_level 6 and 8) and
// the level-8 one resolves empty, which destabilizes queries, so we resolve the
// level-6 relation to a stable area id once at startup (see resolveSearchArea).
let SEARCH_AREA_STATEMENT = 'area["name"="Karlsruhe"]["admin_level"="6"]';

// Cache writes are coalesced to at most one per this interval while probing.
const CACHE_WRITE_MS = Number(process.env.SPERRMUELL_CACHE_WRITE_MS ?? 1000);

function parseNumberList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const parsed = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

function normalizeStreet(street: string) {
  return street.trim().replace(/ß/g, 'ss').replace(/\s+/g, ' ').toUpperCase();
}

function toIsoDate(date: string) {
  const [day, month, year] = date.split('.');
  return `${year}-${month}-${day}`;
}

function getProbeCacheKey(street: string, houseNumber: string) {
  return `${normalizeStreet(street)}|${houseNumber}`;
}

function isResolvedDate(outcome: string | undefined): outcome is string {
  return Boolean(outcome) && outcome !== PROBE_UNKNOWN && outcome !== PROBE_NODATE;
}

/** Runs `task` over `items` with a bounded number of concurrent workers. */
async function mapPool<T>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await task(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker);
  await Promise.all(workers);
}

// --- Cache I/O ---------------------------------------------------------------

async function readRetrievalCache(): Promise<RetrievalCache> {
  try {
    const raw = await Bun.file(RETRIEVAL_CACHE_FILE).text();
    const parsed = JSON.parse(raw) as Partial<RetrievalCache> & { dates?: Record<string, string> };

    // House numbers come from OSM and are year-independent, but probe outcomes
    // hold Sperrmüll dates for a specific year, so we drop them when the year
    // changes to avoid serving stale dates.
    const sameYear = parsed.year === YEAR;

    return {
      year: YEAR,
      generatedAt: parsed.generatedAt ?? new Date().toISOString(),
      houseNumbers: parsed.houseNumbers ?? {},
      // Migrate the legacy `dates` field (positive hits only) into `probes`.
      probes: sameYear ? parsed.probes ?? parsed.dates ?? {} : {}
    };
  } catch {
    return {
      year: YEAR,
      generatedAt: new Date().toISOString(),
      houseNumbers: {},
      probes: {}
    };
  }
}

/**
 * Persists the retrieval cache incrementally. `touch()` schedules a debounced
 * background write so progress reaches disk continuously without blocking the
 * probe loop; `flush()` forces a final write and is also wired to SIGINT so an
 * interrupted run keeps everything fetched so far.
 */
function createCacheWriter(cache: RetrievalCache) {
  let lastWriteAt = 0;
  let chain: Promise<void> = Promise.resolve();
  let queued = false;

  const write = async () => {
    cache.generatedAt = new Date().toISOString();
    await Bun.write(RETRIEVAL_CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
    lastWriteAt = Date.now();
  };

  const touch = () => {
    if (queued || Date.now() - lastWriteAt < CACHE_WRITE_MS) return;
    queued = true;
    chain = chain
      .then(() => {
        queued = false;
        return write();
      })
      .catch((error) => console.error('Cache-Schreibfehler:', error));
  };

  const flush = async () => {
    chain = chain.then(write).catch((error) => console.error('Cache-Schreibfehler:', error));
    await chain;
  };

  return { touch, flush };
}

// --- Karlsruhe Sperrmüll source ---------------------------------------------

async function fetchSourceStreets(): Promise<string[]> {
  const response = await fetch(KARLSRUHE_SOURCE, { headers: { 'user-agent': USER_AGENT } });
  console.log(`Fetched main source: ${KARLSRUHE_SOURCE}`);

  if (!response.ok) {
    throw new Error(`Konnte Sperrmüllquelle nicht laden: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const match = html.match(/strassen_liste\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    throw new Error('Straßenliste in der Karlsruher Quelle nicht gefunden.');
  }

  // The source is a JavaScript array literal which may use single quotes, so we
  // evaluate it instead of JSON.parse.
  return (new Function(`return ${match[1].replace(/,\s*]/g, ']')}`))() as string[];
}

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
  const body = new URLSearchParams({
    strasse_n: street,
    hausnr: houseNumber,
    anzeigen: 'anzeigen',
    ladeort: '1'
  });

  let delayMs = 500;
  for (let attempt = 1; attempt <= KARLSRUHE_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(KARLSRUHE_SOURCE, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'user-agent': USER_AGENT
        },
        body
      });

      if (response.ok || attempt >= KARLSRUHE_MAX_RETRIES) {
        return await response.text();
      }
    } catch (error) {
      if (attempt >= KARLSRUHE_MAX_RETRIES) throw error;
    }

    await Bun.sleep(delayMs);
    delayMs *= 2;
  }

  return '';
}

/** Probes one street/house-number combination, using and updating the cache. */
async function probeHouseNumber(
  street: string,
  houseNumber: string,
  cache: RetrievalCache,
  writer: ReturnType<typeof createCacheWriter>
): Promise<string> {
  const key = getProbeCacheKey(street, houseNumber);
  const cached = cache.probes[key];
  if (cached !== undefined) return cached;

  const html = await fetchKarlsruheProbe(street, houseNumber);
  let outcome: string;
  if (html.includes('Adresse ist unbekannt')) {
    outcome = PROBE_UNKNOWN;
  } else {
    outcome = extractSperrmuellDate(html) ?? PROBE_NODATE;
  }

  cache.probes[key] = outcome;
  writer.touch();
  return outcome;
}

type StreetResult = { date: string | null; addressKnown: boolean };

/** Probes the given house numbers in order, stopping at the first date found. */
async function resolveStreetDate(
  street: string,
  houseNumbers: string[],
  cache: RetrievalCache,
  writer: ReturnType<typeof createCacheWriter>
): Promise<StreetResult> {
  let addressKnown = false;

  for (const houseNumber of houseNumbers) {
    const outcome = await probeHouseNumber(street, houseNumber, cache, writer);
    if (outcome !== PROBE_UNKNOWN) addressKnown = true;
    if (isResolvedDate(outcome)) return { date: outcome, addressKnown: true };
  }

  return { date: null, addressKnown };
}

async function scrapeCalendar(cache: RetrievalCache, writer: ReturnType<typeof createCacheWriter>): Promise<CalendarFile> {
  let streets = await fetchSourceStreets();
  if (STREET_LIMIT > 0) streets = streets.slice(0, STREET_LIMIT);
  console.log(`Gefundene Straßen in Quelle: ${streets.length}`);

  const dateByStreet = new Map<string, string>();

  // --- Pass 1: Karlsruhe only -----------------------------------------------
  // Probe a handful of low house numbers per street. Streets whose addresses
  // are entirely unknown here are the only ones that need Overpass in pass 2.
  console.log(`Pass 1: Prüfe Hausnummern ${PASS1_PROBES.join(', ')} für ${streets.length} Straßen (parallel: ${KARLSRUHE_CONCURRENCY})`);
  const overpassCandidates: string[] = [];
  let processed = 0;

  await mapPool(streets, KARLSRUHE_CONCURRENCY, async (street) => {
    const name = street.trim();
    const { date, addressKnown } = await resolveStreetDate(name, PASS1_PROBES, cache, writer);

    if (date) {
      dateByStreet.set(name, date);
    } else if (!addressKnown) {
      // House number 1/2/3 don't exist -> we need real house numbers.
      overpassCandidates.push(name);
    }

    processed++;
    if (processed % 100 === 0 || processed === streets.length) {
      console.log(`  Pass 1: ${processed}/${streets.length} (Treffer: ${dateByStreet.size}, für Overpass: ${overpassCandidates.length})`);
    }
  });

  await writer.flush();
  console.log(`Pass 1 fertig: ${dateByStreet.size} Treffer, ${overpassCandidates.length} Straßen brauchen Overpass.`);

  // --- Pass 2: Overpass house numbers for the leftovers ---------------------
  if (overpassCandidates.length > 0) {
    const houseNumbers = await fetchStreetHouseNumbers(overpassCandidates, cache, writer);

    console.log(`Pass 2: Prüfe ${overpassCandidates.length} Straßen mit OSM-Hausnummern.`);
    let resolved2 = 0;
    let done2 = 0;

    await mapPool(overpassCandidates, KARLSRUHE_CONCURRENCY, async (street) => {
      const osmNumbers = houseNumbers.get(normalizeStreet(street)) ?? [];
      const probeNumbers = osmNumbers.length > 0 ? osmNumbers : FALLBACK_PROBES;

      const { date } = await resolveStreetDate(street, probeNumbers, cache, writer);
      if (date) {
        dateByStreet.set(street, date);
        resolved2++;
      }

      done2++;
      if (done2 % 50 === 0 || done2 === overpassCandidates.length) {
        console.log(`  Pass 2: ${done2}/${overpassCandidates.length} (zusätzliche Treffer: ${resolved2})`);
      }
    });

    await writer.flush();
    console.log(`Pass 2 fertig: ${resolved2} zusätzliche Treffer.`);
  }

  // --- Build calendar -------------------------------------------------------
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

// --- Overpass: house numbers -------------------------------------------------

function escapeOverpassRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function streetAliases(street: string) {
  // OSM spells the street suffix "straße" while our source uses "strasse".
  // Only the suffix is transformed: a naive global ss<->ß swap corrupts names
  // like "Brahmsstrasse" (-> "Brahmßtraße") or "Esslinger Strasse", which then
  // match nothing in OSM. The capitalization of the leading S is preserved.
  const aliases = new Set<string>([street]);
  aliases.add(street.replace(/strasse/gi, (match) => (match[0] === 'S' ? 'Straße' : 'straße')));
  aliases.add(street.replace(/straße/gi, (match) => (match[0] === 'S' ? 'Strasse' : 'strasse')));
  return [...aliases];
}

async function fetchStreetHouseNumbers(
  streets: string[],
  cache: RetrievalCache,
  writer: ReturnType<typeof createCacheWriter>
): Promise<Map<string, string[]>> {
  const houseNumbers = new Map<string, string[]>();
  const names = [...new Set(streets.map((street) => street.replace(/ß/g, 'ss')))].sort((left, right) =>
    left.localeCompare(right, 'de')
  );

  // Presence of the key (even with an empty array) means we already asked
  // Overpass, so empties are not re-queried on resume.
  for (const street of names) {
    const key = normalizeStreet(street);
    if (key in cache.houseNumbers) houseNumbers.set(key, cache.houseNumbers[key]);
  }

  const missingNames = names.filter((street) => !(normalizeStreet(street) in cache.houseNumbers));
  console.log(`  OSM-Hausnummern im Cache: ${houseNumbers.size}, fehlend: ${missingNames.length}`);

  for (let index = 0; index < missingNames.length; index += HOUSE_NUMBER_BATCH_SIZE) {
    const batch = missingNames.slice(index, index + HOUSE_NUMBER_BATCH_SIZE);
    const alternation = batch.flatMap(streetAliases).map(escapeOverpassRegex).join('|');
    const query = `[out:json][timeout:180];
${SEARCH_AREA_STATEMENT}->.searchArea;
(
  nwr(area.searchArea)["addr:street"~"^(${alternation})$",i]["addr:housenumber"];
);
out tags;`;

    const batchNumber = index / HOUSE_NUMBER_BATCH_SIZE + 1;
    console.log(`Sende Overpass-Hausnummern-Anfrage für Batch ${batchNumber} mit ${batch.length} Straßen`);
    const response = await fetchWithOverpassRetry(query, `house-number batch ${batchNumber}`);

    if (response.ok) {
      const payload = (await response.json()) as {
        elements: Array<{ tags?: { 'addr:street'?: string; 'addr:housenumber'?: string } }>;
      };
      console.log(`  House-number elements: ${payload.elements?.length ?? 0}`);

      // Record every street in the batch (defaulting to empty) so genuine
      // "no OSM addresses" results are cached and not re-queried next run.
      for (const street of batch) {
        const key = normalizeStreet(street);
        if (!(key in cache.houseNumbers)) {
          cache.houseNumbers[key] = [];
          houseNumbers.set(key, []);
        }
      }

      for (const element of payload.elements ?? []) {
        const streetName = element.tags?.['addr:street']?.trim();
        const houseNumber = element.tags?.['addr:housenumber']?.trim();
        if (!streetName || !houseNumber) continue;

        const key = normalizeStreet(streetName);
        const bucket = houseNumbers.get(key) ?? [];
        if (!bucket.includes(houseNumber)) {
          bucket.push(houseNumber);
          houseNumbers.set(key, bucket);
          cache.houseNumbers[key] = bucket;
        }
      }

      // Persist partial progress so interrupted runs resume with a warm cache.
      await writer.flush();
    }

    await Bun.sleep(OVERPASS_COOLDOWN_MS);
  }

  return houseNumbers;
}

/**
 * Resolves the Karlsruhe boundary to a concrete Overpass area id once, so every
 * subsequent query references a stable, unambiguous area instead of re-matching
 * the name (which also picks up an empty admin_level-8 area).
 */
async function resolveSearchArea(): Promise<void> {
  try {
    const response = await fetchWithOverpassRetry(
      '[out:json];rel["name"="Karlsruhe"]["boundary"="administrative"]["admin_level"="6"];out ids 1;',
      'search-area id'
    );
    if (response.ok) {
      const payload = (await response.json()) as { elements?: Array<{ id?: number }> };
      const relationId = payload.elements?.[0]?.id;
      if (relationId) {
        SEARCH_AREA_STATEMENT = `area(${3600000000 + relationId})`;
        console.log(`Karlsruhe-Suchgebiet: ${SEARCH_AREA_STATEMENT} (Relation ${relationId})`);
        return;
      }
    }
  } catch (error) {
    console.warn('Suchgebiet-Auflösung fehlgeschlagen, nutze Namensabfrage:', error);
  }
  console.log(`Karlsruhe-Suchgebiet (Fallback): ${SEARCH_AREA_STATEMENT}`);
}

async function fetchWithOverpassRetry(query: string, label: string): Promise<Response> {
  let delayMs = OVERPASS_BASE_BACKOFF_MS;
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= OVERPASS_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OVERPASS_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'user-agent': USER_AGENT
        },
        body: new URLSearchParams({ data: query })
      });

      lastResponse = response;
      console.log(`Overpass ${label} -> ${response.status} ${response.statusText}`);

      const shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry || attempt >= OVERPASS_MAX_RETRIES) return response;

      // Honor Retry-After when the gateway provides it, otherwise back off
      // exponentially with a little jitter to avoid lock-step retries.
      const retryAfter = Number(response.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delayMs + Math.random() * 500;
      console.log(`  Overpass antwortete ${response.status}, warte ${Math.round(wait)} ms (${attempt}/${OVERPASS_MAX_RETRIES})`);
      await Bun.sleep(wait);
      delayMs *= 2;
    } catch (error) {
      lastError = error;
      if (attempt >= OVERPASS_MAX_RETRIES) break;
      console.log(`  Overpass Fehler (${String(error)}), warte ${delayMs} ms (${attempt}/${OVERPASS_MAX_RETRIES})`);
      await Bun.sleep(delayMs);
      delayMs *= 2;
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error(`Overpass Anfrage fehlgeschlagen (${label}): ${String(lastError)}`);
}

// --- Overpass: geometries ----------------------------------------------------

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

  if (lines.length === 0) {
    return { street, geometry: { type: 'Point', coordinates: KARLSRUHE_CENTER } };
  }
  if (lines.length === 1) {
    return { street, geometry: { type: 'LineString', coordinates: lines[0] } };
  }
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

  console.log(`Sende Overpass-Geometrie-Anfrage (${label}) mit ${batch.length} Straßen`);
  const response = await fetchWithOverpassRetry(query, label);
  if (!response.ok) return result;

  const payload = (await response.json()) as {
    elements: Array<{ type: 'way'; tags?: { name?: string }; geometry: Array<{ lon: number; lat: number }> }>;
  };
  console.log(`  Overpass lieferte ${payload.elements?.length ?? 0} Elemente`);

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

async function readExistingGeometryCache(): Promise<StreetGeometryFile | null> {
  try {
    const raw = await Bun.file(new URL('street-geometries.json', STATIC_DATA_DIR)).text();
    return JSON.parse(raw) as StreetGeometryFile;
  } catch {
    return null;
  }
}

async function buildStreetGeometries(calendar: CalendarFile): Promise<StreetGeometryFile> {
  const uniqueStreets = [...new Set(calendar.entries.flatMap((entry) => entry.streets))]
    .map((street) => street.replace(/ß/g, 'ss'))
    .sort((left, right) => left.localeCompare(right, 'de'));

  console.log(`Sammle Geometrien für ${uniqueStreets.length} Straßen...`);

  const existingCache = await readExistingGeometryCache();

  // Real geometries seed the run; cached Points are treated as misses so they
  // get another chance at a real shape (unless we're in point-only mode).
  const cached = new Map<string, StreetGeometry>(
    existingCache?.streets
      .filter((entry) => GEOMETRY_MODE === 'point' || entry.geometry.type !== 'Point')
      .map((entry) => [normalizeStreet(entry.street), entry]) ?? []
  );

  const resolved = new Map<string, StreetGeometry>();
  const missing: string[] = [];

  for (const street of uniqueStreets) {
    const hit = cached.get(normalizeStreet(street));
    if (hit) {
      resolved.set(normalizeStreet(street), hit);
    } else {
      missing.push(street);
    }
  }

  console.log(`  Geometrie-Cache-Treffer: ${resolved.size}, fehlend: ${missing.length}`);

  const orderedStreets = () =>
    uniqueStreets
      .map((street) => resolved.get(normalizeStreet(street)))
      .filter((entry): entry is StreetGeometry => Boolean(entry));

  const persist = () =>
    writeJson('street-geometries.json', {
      year: YEAR,
      generatedAt: new Date().toISOString(),
      streets: orderedStreets()
    } satisfies StreetGeometryFile);

  if (GEOMETRY_MODE === 'point') {
    for (const street of missing) {
      resolved.set(normalizeStreet(street), { street, geometry: fallbackPointGeometry() });
    }
    await persist();
    return { year: YEAR, generatedAt: new Date().toISOString(), streets: orderedStreets() };
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

      // Persist after every batch so an interrupted geometry pass is resumable.
      await persist();
      await Bun.sleep(OVERPASS_COOLDOWN_MS);
    }

    pending = stillMissing;
  }

  // Whatever is still missing is genuinely unmapped in OSM (e.g. Gewann field
  // names, squares without a highway way) -> fall back to a point.
  if (pending.length > 0) {
    console.log(`  ${pending.length} Straßen ohne OSM-Geometrie, nutze Punkt-Fallback: ${pending.slice(0, 10).join(', ')}${pending.length > 10 ? ' ...' : ''}`);
    for (const street of pending) {
      resolved.set(normalizeStreet(street), { street, geometry: fallbackPointGeometry() });
    }
    await persist();
  }

  return { year: YEAR, generatedAt: new Date().toISOString(), streets: orderedStreets() };
}

// --- Output ------------------------------------------------------------------

async function writeJson(fileName: string, value: unknown) {
  await Bun.write(new URL(fileName, STATIC_DATA_DIR), `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  console.log(`Starte Datenerneuerung für ${YEAR}...`);
  await Bun.write(new URL('.gitkeep', STATIC_DATA_DIR), '');

  const cache = await readRetrievalCache();
  const writer = createCacheWriter(cache);

  // Make sure progress is flushed if the run is interrupted (Ctrl+C).
  let shuttingDown = false;
  process.on('SIGINT', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nAbbruch erkannt, sichere Cache...');
    writer.flush().finally(() => process.exit(130));
  });

  // Resolve the Overpass search area once; both the pass-2 house-number lookup
  // and the geometry queries reference it.
  await resolveSearchArea();

  const calendar = await scrapeCalendar(cache, writer);
  const geometries = await buildStreetGeometries(calendar);

  console.log(`Kalender-Einträge: ${calendar.entries.length}`);
  console.log(`Geometrien: ${geometries.streets.length}`);

  await writeJson('calendar.json', calendar);
  await writeJson('street-geometries.json', geometries);
  await writer.flush();

  console.log(`Schrieb ${calendar.entries.length} Termine und ${geometries.streets.length} Straßen.`);
}

await main();
