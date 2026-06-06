type LegacyCalendar = Record<string, string[]>;

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

const PROJECT_ROOT = new URL('..', import.meta.url);
const STATIC_DATA_DIR = new URL('static/data/', PROJECT_ROOT);
const LEGACY_CALENDAR_FILE = new URL('code/sperrmuellkalender.json', PROJECT_ROOT);
const LEGACY_COORDS_FILE = new URL('code/street_coords.json', PROJECT_ROOT);
const YEAR = Number(process.env.SPERRMUELL_YEAR ?? new Date().getFullYear());
const ALLOW_FALLBACK = process.env.SPERRMUELL_ALLOW_FALLBACK !== '0';
const GEOMETRY_MODE = process.env.SPERRMUELL_GEOMETRY_MODE ?? 'osm';
const SOURCE_MODE = process.env.SPERRMUELL_SOURCE_MODE ?? 'live';

const NUMBER_PROBES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 19, 22, 25, 30, 50];
const KARLSRUHE_SOURCE = `https://web4.karlsruhe.de/service/abfall/akal/akal_${YEAR}.php`;
const KARLSRUHE_CENTER: [number, number] = [8.4034195, 49.0068705];

function normalizeStreet(street: string) {
  return street.trim().replace(/ß/g, 'ss').replace(/\s+/g, ' ').toUpperCase();
}

function toIsoDate(date: string) {
  const [day, month, year] = date.split('.');
  return `${year}-${month}-${day}`;
}

async function readLegacyCalendar(): Promise<CalendarFile | null> {
  try {
    const raw = await Bun.file(LEGACY_CALENDAR_FILE).text();
    const legacy = JSON.parse(raw) as LegacyCalendar;
    const entries = Object.entries(legacy)
      .filter(([date]) => /\d{2}\.\d{2}\.\d{4}/.test(date))
      .map(([date, streets]) => ({
        date,
        isoDate: toIsoDate(date),
        streets: streets.map((street) => street.replace(/ß/g, 'ss'))
      }))
      .sort((left, right) => left.isoDate.localeCompare(right.isoDate));

    return {
      year: YEAR,
      generatedAt: new Date().toISOString(),
      entries
    };
  } catch {
    return null;
  }
}

async function readLegacyStreetCoords(): Promise<Record<string, [number, number]> | null> {
  try {
    const raw = await Bun.file(LEGACY_COORDS_FILE).text();
    return JSON.parse(raw) as Record<string, [number, number]>;
  } catch {
    return null;
  }
}

async function scrapeCalendar(): Promise<CalendarFile> {
  const response = await fetch(KARLSRUHE_SOURCE, {
    headers: {
      'user-agent': 'Sperrmuell-KA/1.0 (+https://github.com/skjerns/Sperrmuell-KA)'
    }
  });

  if (!response.ok) {
    throw new Error(`Konnte Sperrmüllquelle nicht laden: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const match = html.match(/strassen_liste\s*=\s*(\[[\s\S]*?\]);/);

  if (!match) {
    throw new Error('Straßenliste in der Karlsruher Quelle nicht gefunden.');
  }

  const streets = JSON.parse(match[1].replace(/,\s*]/g, ']')) as string[];
  const result = new Map<string, string[]>();

  for (const street of streets) {
    const normalized = street.trim();
    let pickedDate = 'unbekannt';

    for (const number of NUMBER_PROBES) {
      const data = new URLSearchParams({
        strasse_n: normalized,
        hausnr: String(number),
        anzeigen: 'anzeigen',
        ladeort: '1'
      });

      const probeResponse = await fetch(KARLSRUHE_SOURCE, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'user-agent': 'Sperrmuell-KA/1.0 (+https://github.com/skjerns/Sperrmuell-KA)'
        },
        body: data
      });

      const probeHtml = await probeResponse.text();

      if (probeHtml.includes('Adresse ist unbekannt')) {
        continue;
      }

      const dateMatch = probeHtml.match(/\b\d{2}\.\d{2}\.\d{4}\b/g);
      if (dateMatch?.length === 1) {
        pickedDate = dateMatch[0];
        break;
      }
    }

    if (pickedDate !== 'unbekannt') {
      const bucket = result.get(pickedDate) ?? [];
      bucket.push(normalized.replace(/ß/g, 'ss'));
      result.set(pickedDate, bucket);
    }
  }

  const entries = [...result.entries()]
    .map(([date, streetsForDate]) => ({
      date,
      isoDate: toIsoDate(date),
      streets: streetsForDate.sort((left, right) => left.localeCompare(right, 'de'))
    }))
    .sort((left, right) => left.isoDate.localeCompare(right.isoDate));

  return {
    year: YEAR,
    generatedAt: new Date().toISOString(),
    entries
  };
}

async function fetchStreetGeometry(
  street: string,
  legacyCoords: Record<string, [number, number]> | null
): Promise<StreetGeometry> {
  if (GEOMETRY_MODE === 'point') {
    return {
      street,
      geometry: fallbackPointGeometry(street, legacyCoords)
    };
  }

  const query = new URL('https://nominatim.openstreetmap.org/search');
  query.searchParams.set('street', street);
  query.searchParams.set('city', 'Karlsruhe');
  query.searchParams.set('country', 'Germany');
  query.searchParams.set('format', 'geojson');
  query.searchParams.set('polygon_geojson', '1');
  query.searchParams.set('addressdetails', '1');
  query.searchParams.set('limit', '1');

  const response = await fetch(query, {
    headers: {
      'user-agent': 'Sperrmuell-KA/1.0 (+https://github.com/skjerns/Sperrmuell-KA)'
    }
  });

  if (!response.ok) {
    return {
      street,
      geometry: fallbackPointGeometry(street, legacyCoords)
    };
  }

  const payload = (await response.json()) as GeoJSON.FeatureCollection;
  const feature = payload.features[0];

  return {
    street,
    geometry: feature?.geometry ?? fallbackPointGeometry(street, legacyCoords)
  };
}

function fallbackPointGeometry(
  street: string,
  legacyCoords: Record<string, [number, number]> | null
): GeoJSON.Geometry {
  const cachedCoordinates = legacyCoords?.[street.toUpperCase()] ?? legacyCoords?.[normalizeStreet(street)];

  return {
    type: 'Point',
    coordinates: cachedCoordinates ?? KARLSRUHE_CENTER
  };
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

  const existingCache = await readExistingGeometryCache();
  const legacyCoords = await readLegacyStreetCoords();
  const cache = new Map(
    existingCache?.streets.map((entry) => [entry.street.toUpperCase(), entry.geometry]) ?? []
  );

  const streets: StreetGeometry[] = [];

  for (const street of uniqueStreets) {
    const cachedGeometry = cache.get(normalizeStreet(street));
    if (cachedGeometry) {
      streets.push({ street, geometry: cachedGeometry });
      continue;
    }

    const geometry = await fetchStreetGeometry(street, legacyCoords);
    streets.push(geometry);
    cache.set(normalizeStreet(street), geometry.geometry);
    if (GEOMETRY_MODE !== 'point') {
      await Bun.sleep(250);
    }
  }

  return {
    year: YEAR,
    generatedAt: new Date().toISOString(),
    streets
  };
}

async function writeJson(fileName: string, value: unknown) {
  await Bun.write(new URL(fileName, STATIC_DATA_DIR), `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  await Bun.write(new URL('.gitkeep', STATIC_DATA_DIR), '');

  let calendar: CalendarFile;

  if (SOURCE_MODE === 'legacy') {
    const legacyCalendar = await readLegacyCalendar();
    if (!legacyCalendar) {
      throw new Error('Legacy-Kalender konnte nicht gelesen werden.');
    }

    calendar = legacyCalendar;
  } else {
    try {
      calendar = await scrapeCalendar();
    } catch (error) {
      if (!ALLOW_FALLBACK) {
        throw error;
      }

      const legacyCalendar = await readLegacyCalendar();
      if (!legacyCalendar) {
        throw error;
      }

      calendar = legacyCalendar;
    }
  }

  const geometries = await buildStreetGeometries(calendar);

  await writeJson('calendar.json', calendar);
  await writeJson('street-geometries.json', geometries);

  console.log(`Schrieb ${calendar.entries.length} Termine und ${geometries.streets.length} Straßen.`);
}

await main();