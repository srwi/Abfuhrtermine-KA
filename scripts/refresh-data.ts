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

declare const Bun: {
  file(path: string | URL): { text(): Promise<string> };
  write(path: string | URL, data: string): Promise<void>;
  sleep(ms: number): Promise<void>;
};

declare const process: {
  env: Record<string, string | undefined>;
};

const PROJECT_ROOT = new URL('..', import.meta.url);
const STATIC_DATA_DIR = new URL('static/data/', PROJECT_ROOT);
const LEGACY_CALENDAR_FILE = new URL('code/sperrmuellkalender.json', PROJECT_ROOT);
const LEGACY_COORDS_FILE = new URL('code/street_coords.json', PROJECT_ROOT);
const YEAR = Number(process.env.SPERRMUELL_YEAR ?? new Date().getFullYear());
const ALLOW_FALLBACK = process.env.SPERRMUELL_ALLOW_FALLBACK !== '0';
const GEOMETRY_MODE = process.env.SPERRMUELL_GEOMETRY_MODE ?? 'osm';
const SOURCE_MODE = process.env.SPERRMUELL_SOURCE_MODE ?? 'live';

const NUMBER_PROBES = process.env.SPERRMUELL_QUICK ? [1] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 19, 22, 25, 30, 50];
const KARLSRUHE_SOURCE = `https://web4.karlsruhe.de/service/abfall/akal/akal_${YEAR}.php`;
const KARLSRUHE_CENTER: [number, number] = [8.4034195, 49.0068705];
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const STREET_BATCH_SIZE = Number(process.env.SPERRMUELL_GEOMETRY_BATCH_SIZE ?? (process.env.SPERRMUELL_QUICK ? 10 : 75));

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

  console.log(`Fetched main source: ${KARLSRUHE_SOURCE}`);

  if (!response.ok) {
    throw new Error(`Konnte Sperrmüllquelle nicht laden: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const match = html.match(/strassen_liste\s*=\s*(\[[\s\S]*?\]);/);

  if (!match) {
    throw new Error('Straßenliste in der Karlsruher Quelle nicht gefunden.');
  }
  
  // The source contains a JavaScript array literal which may use single quotes.
  // Use the Function constructor to evaluate the array literal instead of JSON.parse.
  const streets = (new Function('return ' + match[1].replace(/,\s*]/g, ']')))() as string[];

  console.log(`Gefundene Straßen in Quelle: ${streets.length}`);
  const result = new Map<string, string[]>();

  for (let i = 0; i < streets.length; i++) {
    const street = streets[i];
    const normalized = street.trim();
    console.log(`Prüfe Straße ${i + 1}/${streets.length}: ${normalized}`);
    let pickedDate = 'unbekannt';

    for (const number of NUMBER_PROBES) {
      console.log(`  Probe Hausnummer ${number} für ${normalized}`);
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

      console.log(`    Antwort: ${probeResponse.status} ${probeResponse.statusText}`);
      const probeHtml = await probeResponse.text();

      if (probeHtml.includes('Adresse ist unbekannt')) {
        console.log('    Adresse unbekannt, weiter');
        continue;
      }

      // Try to extract a Sperrmüll-specific date first (look for Straßensperrmüll / Sperrmüllabholung)
      function extractSperrmuellDate(html: string): string | null {
        const keyCandidates = ['Straßensperrmüll', 'Sperrmüllabholung', 'Sperrmüll', 'Sperrmuell'];
        const lower = html.toLowerCase();
        for (const key of keyCandidates) {
          const keyLower = key.toLowerCase();
          const idx = lower.indexOf(keyLower);
          if (idx !== -1) {
            // take a window after the key and look for the first dd.mm.yyyy
            const window = html.slice(idx, idx + 800);
            const m = window.match(/\b\d{2}\.\d{2}\.\d{4}\b/);
            if (m) return m[0];
          }
        }
        return null;
      }

      const sperrDate = extractSperrmuellDate(probeHtml);
      if (sperrDate) {
        pickedDate = sperrDate;
        console.log(`    Sperrmüll-Datum gefunden: ${pickedDate}`);
        break;
      }

      // fallback: if the page contains exactly one date overall, use it
      const dateMatch = probeHtml.match(/\b\d{2}\.\d{2}\.\d{4}\b/g);
      if (dateMatch?.length === 1) {
        pickedDate = dateMatch[0];
        console.log(`    Gefundenes Datum (fallback): ${pickedDate}`);
        break;
      } else if (dateMatch?.length) {
        console.log(`    Mehrere Datumsangaben gefunden (${dateMatch.length}), ignoriere`);
      }
    }

    if (pickedDate !== 'unbekannt') {
      const bucket = result.get(pickedDate) ?? [];
      bucket.push(normalized.replace(/ß/g, 'ss'));
      result.set(pickedDate, bucket);
    } else {
      console.log(`  Kein Datum für ${normalized}`);
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

  const batch = await fetchStreetGeometries([street], legacyCoords);
  return batch.get(normalizeStreet(street)) ?? {
    street,
    geometry: fallbackPointGeometry(street, legacyCoords)
  };
}

function escapeOverpassRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function streetAliases(street: string) {
  const aliases = new Set<string>([street]);

  if (street.includes('ss')) {
    aliases.add(street.replace(/ss/g, 'ß'));
  }

  if (street.includes('ß')) {
    aliases.add(street.replace(/ß/g, 'ss'));
  }

  return [...aliases];
}

function toStreetGeometryFromWays(
  street: string,
  ways: Array<{ geometry: Array<{ lon: number; lat: number }> }>
): StreetGeometry {
  const lines = ways
    .map((way) => way.geometry.map((point) => [point.lon, point.lat] as [number, number]))
    .filter((coordinates) => coordinates.length >= 2);

  if (lines.length === 0) {
    return {
      street,
      geometry: {
        type: 'Point',
        coordinates: KARLSRUHE_CENTER
      }
    };
  }

  if (lines.length === 1) {
    return {
      street,
      geometry: {
        type: 'LineString',
        coordinates: lines[0]
      }
    };
  }

  return {
    street,
    geometry: {
      type: 'MultiLineString',
      coordinates: lines
    }
  };
}

async function fetchStreetGeometries(
  streets: string[],
  legacyCoords: Record<string, [number, number]> | null
): Promise<Map<string, StreetGeometry>> {
  const geometries = new Map<string, StreetGeometry>();
  const names = [...new Set(streets.map((street) => street.replace(/ß/g, 'ss')))].sort((left, right) =>
    left.localeCompare(right, 'de')
  );

  for (let index = 0; index < names.length; index += STREET_BATCH_SIZE) {
    const batch = names.slice(index, index + STREET_BATCH_SIZE);
    const alternation = batch
      .flatMap((street) => streetAliases(street))
      .map(escapeOverpassRegex)
      .join('|');
    const query = `[out:json][timeout:180];
area["name"="Karlsruhe"]["boundary"="administrative"]->.searchArea;
(
  way(area.searchArea)["highway"]["name"~"^(${alternation})$",i];
);
out geom;`;

    console.log(`Sende Overpass-Anfrage für Batch ${index / STREET_BATCH_SIZE + 1} mit ${batch.length} Straßen`);
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'user-agent': 'Sperrmuell-KA/1.0 (+https://github.com/skjerns/Sperrmuell-KA)'
      },
      body: new URLSearchParams({ data: query })
    });

    console.log(`Overpass request for batch ${index / STREET_BATCH_SIZE + 1} -> ${response.status} ${response.statusText}`);

    if (!response.ok) {
      for (const street of batch) {
        geometries.set(normalizeStreet(street), {
          street,
          geometry: fallbackPointGeometry(street, legacyCoords)
        });
      }
      continue;
    }

    const payload = (await response.json()) as {
      elements: Array<{
        type: 'way';
        tags?: { name?: string };
        geometry: Array<{ lon: number; lat: number }>;
      }>;
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
      const ways = grouped.get(normalizeStreet(street)) ?? [];
      geometries.set(normalizeStreet(street), toStreetGeometryFromWays(street, ways));
    }

    await Bun.sleep(1000);
  }

  return geometries;
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

  console.log(`Sammle Geometrien für ${uniqueStreets.length} Straßen...`);

  const existingCache = await readExistingGeometryCache();
  const legacyCoords = await readLegacyStreetCoords();
  const cache = new Map<string, StreetGeometry>(
    existingCache?.streets
      .filter((entry) => GEOMETRY_MODE === 'point' || entry.geometry.type !== 'Point')
      .map((entry) => [normalizeStreet(entry.street), entry]) ?? []
  );

  const streets: StreetGeometry[] = [];

  const missingStreets: string[] = [];
  let cacheHits = 0;

  for (const street of uniqueStreets) {
    const cachedGeometry = cache.get(normalizeStreet(street));
    if (cachedGeometry) {
      streets.push(cachedGeometry);
      cacheHits++;
    } else {
      missingStreets.push(street);
    }
  }

  console.log(`  Cache-Treffer: ${cacheHits}, fehlend: ${missingStreets.length}`);

  if (missingStreets.length > 0) {
    console.log(`Fehlende Straßen: ${missingStreets.length}`);
    const fetched = await fetchStreetGeometries(missingStreets, legacyCoords);

    for (const street of missingStreets) {
      const geometry = fetched.get(normalizeStreet(street)) ?? {
        street,
        geometry: fallbackPointGeometry(street, legacyCoords)
      };

      streets.push(geometry);
      cache.set(normalizeStreet(street), geometry);
    }
  }

  return {
    year: YEAR,
    generatedAt: new Date().toISOString(),
    streets
  };
}

async function writeJson(fileName: string, value: unknown) {
  console.log(`Schreibe ${fileName}...`);
  await Bun.write(new URL(fileName, STATIC_DATA_DIR), `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  console.log(`Starte Datenerneuerung für ${YEAR}...`);
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

  console.log(`Kalender-Einträge: ${calendar.entries.length}`);
  console.log(`Geometrien: ${geometries.streets.length}`);

  await writeJson('calendar.json', calendar);
  await writeJson('street-geometries.json', geometries);

  console.log(`Schrieb ${calendar.entries.length} Termine und ${geometries.streets.length} Straßen.`);
}

await main();