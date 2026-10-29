import fs from 'fs';
import type { AbfallIoConfig } from './fetchers/abfall-io.ts';
import type { CityInfo } from '../src/lib/cities.ts';

interface TargetDistrict {
  name: string;
  region: string;
  serviceKey: string;
}

const TARGET_DISTRICTS: TargetDistrict[] = [
  {
    name: 'Ostalbkreis',
    region: 'Ostalbkreis, Baden-Württemberg',
    serviceKey: '3ca331fb42d25e25f95014693ebcf855'
  },
  {
    name: 'Kreis Steinfurt',
    region: 'Kreis Steinfurt, Nordrhein-Westfalen',
    serviceKey: 'e21758b9c711463552fb9c70ac7d4273'
  },
  {
    name: 'Landkreis Rotenburg (Wümme)',
    region: 'Landkreis Rotenburg (Wümme), Niedersachsen',
    serviceKey: '645adb3c27370a61f7eabbb2039de4f1'
  },
  {
    name: 'Westerwaldkreis',
    region: 'Westerwaldkreis, Rheinland-Pfalz',
    serviceKey: '248deacbb49b06e868d29cb53c8ef034'
  }
];

const MODUS = 'd6c5855a62cf32a4dadbc2831f0f295f';
const BASE_URL = 'https://api.abfall.io/';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function makeShortName(name: string): string {
  const clean = name.replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
  return clean
    .slice(0, 3)
    .toUpperCase()
    .replace(/Ä/g, 'AE')
    .replace(/Ö/g, 'OE')
    .replace(/Ü/g, 'UE');
}

async function geocode(
  cityName: string,
  region: string
): Promise<{ center: [number, number]; bbox: [number, number, number, number] } | null> {
  const cleanName = cityName.replace(/\s*\([^)]*\)/g, '').trim();

  // Try Open-Meteo first
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      cleanName
    )}&count=5&language=de&country_code=DE`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const data = await res.json();
      const results = (data.results ?? []) as Array<{
        latitude: number;
        longitude: number;
        admin1?: string;
        admin2?: string;
      }>;

      // Filter by region admin if possible
      let match = results[0];
      if (region.includes('Baden-Württemberg')) {
        match = results.find((r) => r.admin1?.includes('Baden-Württemberg')) ?? match;
      } else if (region.includes('Nordrhein-Westfalen')) {
        match = results.find((r) => r.admin1?.includes('Nordrhein-Westfalen')) ?? match;
      } else if (region.includes('Niedersachsen')) {
        match = results.find((r) => r.admin1?.includes('Niedersachsen')) ?? match;
      } else if (region.includes('Rheinland-Pfalz')) {
        match = results.find((r) => r.admin1?.includes('Rheinland-Pfalz')) ?? match;
      }

      if (match && match.latitude && match.longitude) {
        const center: [number, number] = [
          Math.round(match.longitude * 10000) / 10000,
          Math.round(match.latitude * 10000) / 10000
        ];
        const bbox: [number, number, number, number] = [
          Math.round((center[1] - 0.05) * 10000) / 10000,
          Math.round((center[0] - 0.06) * 10000) / 10000,
          Math.round((center[1] + 0.05) * 10000) / 10000,
          Math.round((center[0] + 0.06) * 10000) / 10000
        ];
        return { center, bbox };
      }
    }
  } catch {}

  // Fallback to Photon
  const queries = [
    `${cleanName}, ${region}, Deutschland`,
    `${cleanName}, Deutschland`
  ];

  for (const q of queries) {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)' },
        signal: AbortSignal.timeout(3500)
      });
      if (res.ok) {
        const data = await res.json();
        const f = data.features?.[0];
        if (f && f.geometry?.coordinates) {
          const lon = Math.round(f.geometry.coordinates[0] * 10000) / 10000;
          const lat = Math.round(f.geometry.coordinates[1] * 10000) / 10000;
          const bbox: [number, number, number, number] = [
            Math.round((lat - 0.05) * 10000) / 10000,
            Math.round((lon - 0.06) * 10000) / 10000,
            Math.round((lat + 0.05) * 10000) / 10000,
            Math.round((lon + 0.06) * 10000) / 10000
          ];
          return { center: [lon, lat], bbox };
        }
      }
    } catch {}
  }

  return null;
}

async function main() {
  const abfallIoPath = 'scripts/fetchers/abfall-io-cities.json';
  const citiesPath = 'src/lib/cities.json';

  const existingAbfallIo: AbfallIoConfig[] = JSON.parse(
    fs.readFileSync(abfallIoPath, 'utf8')
  );
  const existingCities: CityInfo[] = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

  const knownIds = new Set(existingCities.map((c) => c.id));
  const knownNames = new Set(existingCities.map((c) => c.name.toLowerCase()));

  console.log(`Starting abfall.io discovery...`);
  console.log(`Current cities.json total: ${existingCities.length}`);
  console.log(`Current abfall-io-cities.json total: ${existingAbfallIo.length}\n`);

  let addedTotal = 0;

  for (const target of TARGET_DISTRICTS) {
    console.log(`\n======================================================`);
    console.log(`Target: ${target.name} (${target.region})`);
    console.log(`======================================================`);

    const wurl = `${BASE_URL}?key=${encodeURIComponent(target.serviceKey)}&modus=${MODUS}`;

    try {
      const initRes = await fetch(`${wurl}&waction=init`, {
        method: 'POST',
        headers: { 'User-Agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)' }
      });
      if (!initRes.ok) {
        console.warn(`Init failed for ${target.name}: HTTP ${initRes.status}`);
        continue;
      }
      const cookie = initRes.headers.get('set-cookie')?.split(';')[0] || '';
      const initHtml = await initRes.text();

      const hiddenMatches = [
        ...initHtml.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)
      ];
      const baseHidden = Object.fromEntries(hiddenMatches.map((m) => [m[1], m[2]]));

      const kommunen = [
        ...initHtml.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)
      ]
        .filter((m) => m[1] !== '0' && !m[2].includes('Bitte auswählen'))
        .map((m) => ({ id: m[1], name: m[2].trim() }));

      console.log(`Found ${kommunen.length} municipalities in ${target.name}.`);

      for (const kommune of kommunen) {
        // Quick verification of street count
        const formKommune = new URLSearchParams({
          ...baseHidden,
          f_id_kommune: kommune.id
        });

        const kRes = await fetch(`${wurl}&waction=auswahl_kommune_set`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Abfuhrtermine/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)',
            ...(cookie ? { Cookie: cookie } : {})
          },
          body: formKommune.toString()
        });

        if (!kRes.ok) continue;
        const kHtml = await kRes.text();
        const streetCount = [
          ...kHtml.matchAll(/<option value="([0-9]+)">([^<]+)<\/option>/g)
        ].filter((m) => m[1] !== '0').length;

        if (streetCount === 0) {
          console.log(`  Skipping ${kommune.name} (0 streets)`);
          continue;
        }

        const normName = kommune.name.toLowerCase().trim();
        let displayName = kommune.name;

        // Disambiguation if name already exists
        if (knownNames.has(normName)) {
          displayName = `${kommune.name} (${target.name.replace('Landkreis ', 'LK ')})`;
          if (knownNames.has(displayName.toLowerCase().trim())) {
            continue;
          }
        }

        let id = slugify(displayName);
        if (knownIds.has(id)) {
          id = `${id}-${slugify(target.name)}`;
        }
        if (knownIds.has(id)) continue;

        console.log(`Geocoding: ${displayName} (${streetCount} streets)...`);
        const geo = await geocode(kommune.name, target.region);
        if (!geo) {
          console.warn(`  ⚠️ Could not geocode "${kommune.name}", skipping.`);
          continue;
        }

        const shortName = makeShortName(displayName);

        const configEntry: AbfallIoConfig = {
          id,
          name: displayName,
          shortName,
          serviceKey: target.serviceKey,
          kommuneId: kommune.id,
          center: geo.center,
          defaultZoom: 12,
          bbox: geo.bbox
        };

        const cityEntry: CityInfo = {
          id,
          name: displayName,
          shortName,
          center: geo.center,
          defaultZoom: 12,
          bbox: geo.bbox
        };

        existingAbfallIo.push(configEntry);
        existingCities.push(cityEntry);
        knownIds.add(id);
        knownNames.add(displayName.toLowerCase().trim());
        knownNames.add(normName);
        addedTotal++;

        console.log(
          `  ✅ Added: ${displayName} (${id}) [${geo.center.join(', ')}] with ${streetCount} streets`
        );

        // Small polite rate limit
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (err) {
      console.error(`Error processing ${target.name}:`, err);
    }
  }

  console.log(`\n======================================================`);
  console.log(`Finished abfall.io discovery!`);
  console.log(`Added: ${addedTotal} new cities.`);
  console.log(`Total cities in cities.json: ${existingCities.length}`);
  console.log(`Total in abfall-io-cities.json: ${existingAbfallIo.length}`);
  console.log(`======================================================`);

  if (addedTotal > 0) {
    existingCities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    existingAbfallIo.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    fs.writeFileSync(abfallIoPath, JSON.stringify(existingAbfallIo, null, 2) + '\n');
    fs.writeFileSync(citiesPath, JSON.stringify(existingCities, null, 2) + '\n');
    console.log(`Wrote updated files successfully.`);
  }
}

main().catch(console.error);
