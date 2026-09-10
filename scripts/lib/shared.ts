// Shared helpers for the offline data pipeline. Two standalone Bun scripts use
// this module: `build-cache.ts` (the Overpass-heavy, on-demand cache build) and
// `refresh-data.ts` (the cheap Karlsruhe-only scrape that runs in CI). These
// scripts live outside the SvelteKit type world on purpose, hence the local
// `declare const Bun`/`process` blocks.

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

// --- Shared types (mirror src/lib/types.ts; kept local so the scripts don't
// depend on the SvelteKit module graph) -------------------------------------

// The five waste types the Karlsruhe source exposes per address. The keys are
// stable identifiers used across the data files and the frontend; labels/colors
// are the single source of truth (the frontend reads them from calendar.json).
// Colors are picked saturated so MapView's dark-mode invert+hue-rotate keeps
// them roughly stable (see MapView.svelte). Order is the display order; the
// first (Sperrmüll) is the one enabled by default in the UI.
export type CategoryKey = 'sperrmuell' | 'restmuell' | 'bioabfall' | 'wertstoff' | 'papier';
export type CategoryMeta = { key: CategoryKey; label: string; color: string };
export const CATEGORIES: CategoryMeta[] = [
  { key: 'sperrmuell', label: 'Sperrmüll', color: '#b91c1c' },
  { key: 'restmuell', label: 'Restmüll', color: '#4b5563' },
  { key: 'bioabfall', label: 'Bioabfall', color: '#92400e' },
  { key: 'wertstoff', label: 'Wertstoff', color: '#eab308' },
  { key: 'papier', label: 'Papier', color: '#1d4ed8' }
];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

// calendar.json — small, inlined into index.html at build time. `days` is the
// sorted union of every pickup date across all streets and categories; each day
// records which category keys occur citywide on it (drives the picker highlight).
export type CalendarDay = { isoDate: string; date: string; categories: CategoryKey[] };
export type CalendarFile = {
  year: number;
  generatedAt: string;
  categories: CategoryMeta[];
  days: CalendarDay[];
};

// street-data.json — large, fetched client-side. Per street: its geometry (null
// when OSM has no real line/point — still listed, just not drawn) and, per
// category, the day indices (into calendar.days) on which it is collected.
export type StreetSchedule = Partial<Record<CategoryKey, number[]>>;
export type StreetData = { street: string; geometry: GeoJSON.Geometry | null; schedule: StreetSchedule };
export type StreetDataFile = { year: number; generatedAt: string; streets: StreetData[] };

// Geometry cache (data/geometry-cache.json) format — produced by build-cache.ts,
// year- and category-independent. Distinct from the StreetData output above.
export type StreetGeometry = { street: string; geometry: GeoJSON.Geometry };
export type StreetGeometryFile = { year: number; generatedAt: string; streets: StreetGeometry[] };

// --- Paths -------------------------------------------------------------------

export const PROJECT_ROOT = new URL('../../', import.meta.url);
export const STATIC_DATA_DIR = new URL('static/data/', PROJECT_ROOT);
export const DATA_DIR = new URL('data/', PROJECT_ROOT);

// --- Common configuration ----------------------------------------------------

export const QUICK = Boolean(process.env.SPERRMUELL_QUICK);
export const YEAR = Number(process.env.SPERRMUELL_YEAR ?? new Date().getFullYear());
// Optional cap on the number of streets processed, handy for local testing.
export const STREET_LIMIT = Number(process.env.SPERRMUELL_LIMIT ?? 0);

export const USER_AGENT = 'Abfuhrtermine-KA/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)';
export const KARLSRUHE_SOURCE = `https://web4.karlsruhe.de/service/abfall/akal/akal_${YEAR}.php`;
export const KARLSRUHE_CENTER: [number, number] = [8.4034195, 49.0068705];
export const OVERPASS_ENDPOINTS = [
  process.env.OVERPASS_ENDPOINT,
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
].filter((ep): ep is string => Boolean(ep));
export const OVERPASS_ENDPOINT = OVERPASS_ENDPOINTS[0];

export const OVERPASS_MAX_RETRIES = 5;
export const OVERPASS_BASE_BACKOFF_MS = 2000;
export const OVERPASS_COOLDOWN_MS = 1000;

// --- Small utilities ---------------------------------------------------------

// Street-name normalization is the recurring footgun: the Karlsruhe source uses
// "strasse", OSM uses "straße". We normalize ß->ss and uppercase for matching;
// suffix aliasing (below) handles the spelling difference at query time.
export function normalizeStreet(street: string) {
  return street.trim().replace(/ß/g, 'ss').replace(/\s+/g, ' ').toUpperCase();
}

export function toIsoDate(date: string) {
  const [day, month, year] = date.split('.');
  return `${year}-${month}-${day}`;
}

/** Inverse of toIsoDate: "2026-06-15" -> "15.06.2026" for German display. */
export function toDisplayDate(iso: string) {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

/** Runs `task` over `items` with a bounded number of concurrent workers. */
export async function mapPool<T>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>
) {
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

// --- JSON I/O ----------------------------------------------------------------

export async function readJson<T>(url: URL): Promise<T | null> {
  try {
    return JSON.parse(await Bun.file(url).text()) as T;
  } catch {
    return null;
  }
}

export async function writeJson(url: URL, value: unknown) {
  await Bun.write(url, `${JSON.stringify(value, null, 2)}\n`);
}

// Minified variant for large machine-generated artifacts (the geometry file),
// where pretty-print whitespace dominates the byte count and nobody reads the
// diff anyway. Roughly quarters the on-disk size and shrinks the gzip transfer.
export async function writeJsonCompact(url: URL, value: unknown) {
  await Bun.write(url, `${JSON.stringify(value)}\n`);
}

export const staticDataFile = (name: string) => new URL(name, STATIC_DATA_DIR);
export const dataFile = (name: string) => new URL(name, DATA_DIR);

export const cityDataFile = (cityId: string, name: string) =>
  cityId === 'karlsruhe' ? dataFile(name) : dataFile(`${cityId}/${name}`);

export const cityStaticDataFile = (cityId: string, name: string) =>
  cityId === 'karlsruhe' ? staticDataFile(name) : staticDataFile(`${cityId}/${name}`);

// --- Karlsruhe source --------------------------------------------------------

export async function fetchSourceStreets(): Promise<string[]> {
  const response = await fetch(KARLSRUHE_SOURCE, { headers: { 'user-agent': USER_AGENT } });
  console.log(`Fetched main source: ${KARLSRUHE_SOURCE}`);

  if (!response.ok) {
    throw new Error(`Could not load the Sperrmüll source: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const match = html.match(/strassen_liste\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    throw new Error('Could not find the street list in the Karlsruhe source.');
  }

  // The source is a JavaScript array literal which may use single quotes, so we
  // evaluate it instead of JSON.parse.
  return (new Function(`return ${match[1].replace(/,\s*]/g, ']')}`))() as string[];
}

// --- Overpass ----------------------------------------------------------------

export function escapeOverpassRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function streetAliases(street: string): string[] {
  const set = new Set<string>();
  const baseNames = [street];
  // Strip parenthesized district/disambiguation: "Bruggastrasse (Ebnet)" -> "Bruggastrasse"
  const cleaned = street.replace(/\s*\(.*?\)$/, '').trim();
  if (cleaned !== street) baseNames.push(cleaned);

  // Expand abbreviations common in Bavarian/municipal waste lists
  for (const base of [...baseNames]) {
    if (/str\.$/i.test(base)) {
      baseNames.push(base.replace(/Str\.$/, 'Straße').replace(/str\.$/, 'straße'));
    }
    if (/pl\.$/i.test(base)) {
      baseNames.push(base.replace(/Pl\.$/, 'Platz').replace(/pl\.$/, 'platz'));
    }
    if (/wg\.$/i.test(base)) {
      baseNames.push(base.replace(/Wg\.$/, 'Weg').replace(/wg\.$/, 'weg'));
    }
  }

  for (const base of baseNames) {
    set.add(base);
    // Suffix alias: strasse <-> straße
    set.add(base.replace(/strasse/gi, (match) => (match[0] === 'S' ? 'Straße' : 'straße')));
    set.add(base.replace(/straße/gi, (match) => (match[0] === 'S' ? 'Strasse' : 'strasse')));
    // General ss <-> ß (e.g. Gaußstraße / Floßgraben / Gießerei)
    set.add(base.replace(/ß/g, 'ss'));
    set.add(base.replace(/ss/g, 'ß'));
    // Combined
    set.add(base.replace(/strasse/gi, 'Straße').replace(/ss/g, 'ß'));
    set.add(base.replace(/straße/gi, 'Strasse').replace(/ß/g, 'ss'));
  }
  return [...set];
}

let currentEndpointIndex = 0;

export async function fetchWithOverpassRetry(query: string, label: string): Promise<Response> {
  let delayMs = OVERPASS_BASE_BACKOFF_MS;
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= OVERPASS_MAX_RETRIES; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[currentEndpointIndex % OVERPASS_ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'user-agent': USER_AGENT
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(30000)
      });

      lastResponse = response;
      console.log(`Overpass (${new URL(endpoint).host}) ${label} -> ${response.status} ${response.statusText}`);

      const shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry || attempt >= OVERPASS_MAX_RETRIES) return response;

      // On 429 or 5xx, try switching to a different mirror
      currentEndpointIndex++;
      const nextHost = new URL(OVERPASS_ENDPOINTS[currentEndpointIndex % OVERPASS_ENDPOINTS.length]).host;

      const retryAfter = Number(response.headers.get('retry-after'));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delayMs + Math.random() * 500;
      console.log(`  Overpass responded ${response.status}, rotating to ${nextHost} after ${Math.round(wait)} ms (${attempt}/${OVERPASS_MAX_RETRIES})`);
      await Bun.sleep(wait);
      delayMs *= 2;
    } catch (error) {
      lastError = error;
      currentEndpointIndex++;
      const nextHost = new URL(OVERPASS_ENDPOINTS[currentEndpointIndex % OVERPASS_ENDPOINTS.length]).host;

      if (attempt >= OVERPASS_MAX_RETRIES) break;
      console.log(`  Overpass error on ${new URL(endpoint).host} (${String(error)}), trying ${nextHost} after ${delayMs} ms (${attempt}/${OVERPASS_MAX_RETRIES})`);
      await Bun.sleep(delayMs);
      delayMs *= 2;
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error(`Overpass request failed (${label}): ${String(lastError)}`);
}
