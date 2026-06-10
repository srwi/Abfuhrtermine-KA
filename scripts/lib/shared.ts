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

export type CalendarEntry = { date: string; isoDate: string; streets: string[] };
export type CalendarFile = { year: number; generatedAt: string; entries: CalendarEntry[] };
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

export const USER_AGENT = 'Sperrmuell-KA/1.0 (+https://github.com/skjerns/Sperrmuell-KA)';
export const KARLSRUHE_SOURCE = `https://web4.karlsruhe.de/service/abfall/akal/akal_${YEAR}.php`;
export const KARLSRUHE_CENTER: [number, number] = [8.4034195, 49.0068705];
export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

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

export function streetAliases(street: string) {
  // OSM spells the street suffix "straße" while our source uses "strasse".
  // Only the suffix is transformed: a naive global ss<->ß swap corrupts names
  // like "Brahmsstrasse" (-> "Brahmßtraße") or "Esslinger Strasse", which then
  // match nothing in OSM. The capitalization of the leading S is preserved.
  const aliases = new Set<string>([street]);
  aliases.add(street.replace(/strasse/gi, (match) => (match[0] === 'S' ? 'Straße' : 'straße')));
  aliases.add(street.replace(/straße/gi, (match) => (match[0] === 'S' ? 'Strasse' : 'strasse')));
  return [...aliases];
}

/**
 * Resolves the Karlsruhe boundary to a concrete Overpass area id once, so every
 * subsequent query references a stable, unambiguous area instead of re-matching
 * the name (which also picks up an empty admin_level-8 area). Returns the area
 * statement to splice into queries.
 */
export async function resolveSearchArea(): Promise<string> {
  const fallback = 'area["name"="Karlsruhe"]["admin_level"="6"]';
  try {
    const response = await fetchWithOverpassRetry(
      '[out:json];rel["name"="Karlsruhe"]["boundary"="administrative"]["admin_level"="6"];out ids 1;',
      'search-area id'
    );
    if (response.ok) {
      const payload = (await response.json()) as { elements?: Array<{ id?: number }> };
      const relationId = payload.elements?.[0]?.id;
      if (relationId) {
        const statement = `area(${3600000000 + relationId})`;
        console.log(`Karlsruhe search area: ${statement} (relation ${relationId})`);
        return statement;
      }
    }
  } catch (error) {
    console.warn('Search area resolution failed, falling back to name lookup:', error);
  }
  console.log(`Karlsruhe search area (fallback): ${fallback}`);
  return fallback;
}

export async function fetchWithOverpassRetry(query: string, label: string): Promise<Response> {
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
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delayMs + Math.random() * 500;
      console.log(`  Overpass responded ${response.status}, waiting ${Math.round(wait)} ms (${attempt}/${OVERPASS_MAX_RETRIES})`);
      await Bun.sleep(wait);
      delayMs *= 2;
    } catch (error) {
      lastError = error;
      if (attempt >= OVERPASS_MAX_RETRIES) break;
      console.log(`  Overpass error (${String(error)}), waiting ${delayMs} ms (${attempt}/${OVERPASS_MAX_RETRIES})`);
      await Bun.sleep(delayMs);
      delayMs *= 2;
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error(`Overpass request failed (${label}): ${String(lastError)}`);
}
