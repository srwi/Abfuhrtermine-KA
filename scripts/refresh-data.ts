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
  cityDataFile,
  normalizeStreet,
  readJson,
  staticDataFile,
  toDisplayDate,
  writeJson,
  writeJsonCompact
} from './lib/shared.ts';
import { roundGeometry, disambiguateMultiCluster } from './lib/geometry.ts';
import { FETCHERS, getCityFetcher, type CityFetcher, type StreetScheduleDates } from './fetchers/index.ts';

declare const Bun: { sleep(ms: number): Promise<void>; write(path: string | URL, data: string): Promise<void> };
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
};

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

  // Try city-specific geometry cache
  const cacheFile = cityDataFile(cityId, 'geometry-cache.json');
  const cache = await readJson<StreetGeometryFile>(cacheFile);

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

  // Load house numbers cache if city requires it
  let osmHouseNumbers: Record<string, string[]> = {};
  if (fetcher.requiresOsmHouseNumbers) {
    const cache = await readJson<{ houseNumbers: Record<string, string[]> }>(
      cityDataFile(fetcher.id, 'osm-house-numbers.json')
    );
    osmHouseNumbers = cache?.houseNumbers ?? {};
  }

  const scheduleByStreet = await fetcher.fetchSchedules(streets, osmHouseNumbers);
  const { calendar, dayIndex } = buildCalendar(scheduleByStreet, fetcher.categories);
  const categoryKeys = fetcher.categories.map((c) => c.key);
  const streetData = await buildStreetData(fetcher.id, scheduleByStreet, dayIndex, categoryKeys);

  // Write city-specific outputs
  await writeJson(staticDataFile(`${fetcher.id}/calendar.json`), calendar);
  await writeJsonCompact(staticDataFile(`${fetcher.id}/street-data.json`), streetData);
  console.log(`Wrote ${calendar.days.length} days and ${streetData.streets.length} streets to ${fetcher.id}/.`);

  // If Karlsruhe, also mirror to root static/data/ for backwards compatibility
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
