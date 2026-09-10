// `bun run data:refresh [city]` — the cheap scrape/probe for calendar and street data.
//
// Reads the committed Overpass caches produced by `data:cache` and queries the city's
// data provider (without talking to Overpass), producing:
//   - static/data/[city/]calendar.json   (category metadata + pickup days)
//   - static/data/[city/]street-data.json (per-street geometry + per-category day indices)
//
// For Karlsruhe: also writes to static/data/ directly for backwards compatibility.

import {
  DATA_DIR,
  QUICK,
  STREET_LIMIT,
  YEAR,
  type CalendarDay,
  type CalendarFile,
  type CategoryKey,
  type CategoryMeta,
  type StreetData,
  type StreetDataFile,
  type StreetGeometry,
  type StreetGeometryFile,
  type StreetSchedule,
  dataFile,
  normalizeStreet,
  readJson,
  staticDataFile,
  toDisplayDate,
  writeJson,
  writeJsonCompact
} from './lib/shared.ts';
import { FETCHERS, getCityFetcher, type CityFetcher, type StreetScheduleDates } from './fetchers/index.ts';

declare const Bun: { sleep(ms: number): Promise<void>; write(path: string | URL, data: string): Promise<void> };
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
};

// --- Geometry processing -----------------------------------------------------

const CLUSTER_GAP_METERS = 400;
type Line = [number, number][];

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

const COORD_DECIMALS = 5;

function roundCoord(c: number): number {
  return Number(c.toFixed(COORD_DECIMALS));
}

function roundGeometry(geometry: GeoJSON.Geometry): GeoJSON.Geometry {
  if (geometry.type === 'Point') {
    return { type: 'Point', coordinates: [roundCoord(geometry.coordinates[0]), roundCoord(geometry.coordinates[1])] };
  }
  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: geometry.coordinates.map((c) => [roundCoord(c[0]), roundCoord(c[1])]) };
  }
  if (geometry.type === 'MultiLineString') {
    return {
      type: 'MultiLineString',
      coordinates: geometry.coordinates.map((line) => line.map((c) => [roundCoord(c[0]), roundCoord(c[1])]))
    };
  }
  return geometry;
}

function lineDistanceMeters(a: Line, b: Line): number {
  let min = Infinity;
  for (const pa of a) {
    for (const pb of b) {
      const d = distanceMeters(pa, pb);
      if (d < min) min = d;
    }
  }
  return min;
}

function clusterLines(lines: Line[], maxGapMeters: number): Line[][] {
  const clusters: Line[][] = [];
  for (const line of lines) {
    const matching: number[] = [];
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].some((other) => lineDistanceMeters(line, other) <= maxGapMeters)) {
        matching.push(i);
      }
    }
    if (matching.length === 0) {
      clusters.push([line]);
    } else {
      const merged: Line[] = [line];
      for (let i = matching.length - 1; i >= 0; i--) {
        merged.push(...clusters.splice(matching[i], 1)[0]);
      }
      clusters.push(merged);
    }
  }
  return clusters;
}

function geometryCentroid(geometry: GeoJSON.Geometry): [number, number] | null {
  const lines = geometryLines(geometry);
  if (lines.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  let count = 0;
  for (const line of lines) {
    for (const [lng, lat] of line) {
      sumLng += lng;
      sumLat += lat;
      count++;
    }
  }
  return count > 0 ? [sumLng / count, sumLat / count] : null;
}

function disambiguateMultiCluster(
  resolvedGeometry: Map<string, StreetGeometry>,
  dateByStreet: Map<string, string>
) {
  const streetsByDate = new Map<string, string[]>();
  for (const [street, date] of dateByStreet) {
    let list = streetsByDate.get(date);
    if (!list) streetsByDate.set(date, (list = []));
    list.push(street);
  }

  const dateCentroid = new Map<string, [number, number]>();
  for (const [date, streets] of streetsByDate) {
    let sumLng = 0;
    let sumLat = 0;
    let count = 0;
    for (const street of streets) {
      const g = resolvedGeometry.get(street)?.geometry;
      if (!g) continue;
      const c = geometryCentroid(g);
      if (!c) continue;
      sumLng += c[0];
      sumLat += c[1];
      count++;
    }
    if (count > 0) dateCentroid.set(date, [sumLng / count, sumLat / count]);
  }

  for (const [street, entry] of resolvedGeometry) {
    const lines = geometryLines(entry.geometry);
    if (lines.length <= 1) continue;
    const clusters = clusterLines(lines, CLUSTER_GAP_METERS);
    if (clusters.length <= 1) continue;

    const date = dateByStreet.get(street);
    const target = date ? dateCentroid.get(date) : undefined;
    if (!target) continue;

    let bestCluster = clusters[0];
    let bestDist = Infinity;
    for (const cluster of clusters) {
      const c = geometryCentroid(geometryFromLines(cluster));
      if (!c) continue;
      const d = distanceMeters(c, target);
      if (d < bestDist) {
        bestDist = d;
        bestCluster = cluster;
      }
    }
    entry.geometry = geometryFromLines(bestCluster);
  }
}

// --- Output assembly ---------------------------------------------------------

function buildCalendar(
  scheduleByStreet: Map<string, StreetScheduleDates>,
  categories: CategoryMeta[]
): { calendar: CalendarFile; dayIndex: Map<string, number> } {
  const categoryKeys = categories.map((c) => c.key);
  const categoriesByIso = new Map<string, Set<CategoryKey>>();

  for (const schedule of scheduleByStreet.values()) {
    for (const key of categoryKeys) {
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
      categories: categoryKeys.filter((key) => cats.has(key))
    }));

  const dayIndex = new Map(days.map((day, index) => [day.isoDate, index]));
  return {
    calendar: { year: YEAR, generatedAt: new Date().toISOString(), categories, days },
    dayIndex
  };
}

async function buildStreetData(
  cityId: string,
  scheduleByStreet: Map<string, StreetScheduleDates>,
  dayIndex: Map<string, number>,
  categoryKeys: CategoryKey[]
): Promise<StreetDataFile> {
  const streetNames = [...scheduleByStreet.keys()].sort((a, b) => a.localeCompare(b, 'de'));

  // Try city-specific geometry cache first, fall back to root
  const cacheFile = cityId === 'karlsruhe'
    ? dataFile('geometry-cache.json')
    : dataFile(`${cityId}/geometry-cache.json`);

  let cache = await readJson<StreetGeometryFile>(cacheFile);
  if (!cache && cityId === 'karlsruhe') {
    cache = await readJson<StreetGeometryFile>(dataFile('geometry-cache.json'));
  }

  if (!cache) {
    console.warn(`WARNING: geometry-cache.json for ${cityId} is missing. Run \`bun run data:cache ${cityId}\`. Streets will have no geometry.`);
  }

  const cachedByKey = new Map<string, StreetGeometry>(
    cache?.streets.map((entry) => [normalizeStreet(entry.street), entry]) ?? []
  );

  const resolvedGeometry = new Map<string, StreetGeometry>();
  let withGeometry = 0;
  for (const street of streetNames) {
    const hit = cachedByKey.get(normalizeStreet(street));
    if (hit && hit.geometry.type !== 'Point') {
      resolvedGeometry.set(normalizeStreet(street), { street, geometry: hit.geometry });
      withGeometry++;
    }
  }

  // Multi-cluster disambiguation (anchored on Sperrmüll dates for Karlsruhe)
  if (cityId === 'karlsruhe') {
    const sperrmuellDateByStreet = new Map<string, string>();
    for (const [street, schedule] of scheduleByStreet) {
      const iso = schedule.sperrmuell?.[0];
      if (iso) sperrmuellDateByStreet.set(normalizeStreet(street), iso);
    }
    disambiguateMultiCluster(resolvedGeometry, sperrmuellDateByStreet);
  }

  const streets: StreetData[] = streetNames.map((street) => {
    const isoSchedule = scheduleByStreet.get(street)!;
    const schedule: StreetSchedule = {};
    for (const key of categoryKeys) {
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

// --- Refresh single city -----------------------------------------------------

async function refreshCity(fetcher: CityFetcher) {
  console.log(`\n========================================`);
  console.log(`Starting data refresh for ${fetcher.name} (${fetcher.id}) for year ${YEAR}...`);
  console.log(`========================================`);

  const streets = await fetcher.fetchStreets();
  console.log(`Total streets found in source: ${streets.length}`);

  // Load house numbers cache if Karlsruhe
  let osmHouseNumbers: Record<string, string[]> = {};
  if (fetcher.id === 'karlsruhe') {
    const cache = await readJson<{ houseNumbers: Record<string, string[]> }>(dataFile('osm-house-numbers.json'));
    osmHouseNumbers = cache?.houseNumbers ?? {};
  }

  const scheduleByStreet = await fetcher.fetchSchedules(streets, osmHouseNumbers);
  const { calendar, dayIndex } = buildCalendar(scheduleByStreet, fetcher.categories);
  const categoryKeys = fetcher.categories.map((c) => c.key);
  const streetData = await buildStreetData(fetcher.id, scheduleByStreet, dayIndex, categoryKeys);

  // Write outputs
  const cityCalFile = staticDataFile(`${fetcher.id}/calendar.json`);
  const cityStreetFile = staticDataFile(`${fetcher.id}/street-data.json`);

  await writeJson(cityCalFile, calendar);
  await writeJsonCompact(cityStreetFile, streetData);
  console.log(`Wrote ${calendar.days.length} days and ${streetData.streets.length} streets to ${fetcher.id}/.`);

  // If Karlsruhe, also write to root static/data/ for backwards compatibility
  if (fetcher.id === 'karlsruhe') {
    await writeJson(staticDataFile('calendar.json'), calendar);
    await writeJsonCompact(staticDataFile('street-data.json'), streetData);
    console.log(`Also wrote root static/data/calendar.json and street-data.json.`);
  }
}

// --- Entry point -------------------------------------------------------------

async function main() {
  await Bun.write(staticDataFile('.gitkeep'), '');

  const arg = (process.argv[2] || process.env.CITY || 'karlsruhe').toLowerCase();

  if (arg === 'all') {
    for (const fetcher of FETCHERS) {
      await refreshCity(fetcher);
    }
  } else {
    const fetcher = getCityFetcher(arg);
    await refreshCity(fetcher);
  }

  console.log('\nData refresh complete!');
}

await main();
