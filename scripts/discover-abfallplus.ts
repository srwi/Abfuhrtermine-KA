/**
 * Discovery script for AbfallPlus (widgets.abfall.io/graphql).
 * Discovers cities for configured services, geocodes them via Nominatim,
 * and adds them to scripts/fetchers/abfallplus-cities.json and src/lib/cities.json.
 */
import fs from 'fs';

interface AbfallPlusConfig {
  id: string;
  name: string;
  shortName: string;
  serviceKey?: string;
  apiKey?: string;
  origin?: string;
  cityId?: string;
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
}

interface CityInfo {
  id: string;
  name: string;
  shortName: string;
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
}

interface TargetService {
  name: string;
  region: string;
  serviceKey?: string;
  apiKey?: string;
  origin?: string;
}

const TARGET_SERVICES: TargetService[] = [
  {
    name: 'Landkreis Göppingen',
    region: 'Landkreis Göppingen, Baden-Württemberg',
    serviceKey: 'f35bd08b1d18d9c81fcdee75dbcce5d3'
  },
  {
    name: 'Schwarzwald-Baar-Kreis',
    region: 'Schwarzwald-Baar-Kreis, Baden-Württemberg',
    serviceKey: '30628292bdd8b43db86a48f7e0d85f85'
  },
  {
    name: 'Landkreis Heilbronn',
    region: 'Landkreis Heilbronn, Baden-Württemberg',
    apiKey: '18adb00cb5135f6aa16b5fdea6dae2c63a507ae0f836540e'
  },
  {
    name: 'Duisburg',
    region: 'Duisburg, Nordrhein-Westfalen',
    serviceKey: '80acad6c77fe9342ebafad29a8c58bf6'
  },
  {
    name: 'Essen',
    region: 'Essen, Nordrhein-Westfalen',
    serviceKey: '51be67f3758f1fb57b420efe065c0663'
  },
  {
    name: 'Landkreis Reutlingen',
    region: 'Landkreis Reutlingen, Baden-Württemberg',
    serviceKey: '15f69fab91c4cae50d9dbb5bcfd383f0'
  },
  {
    name: 'Landkreis Böblingen',
    region: 'Landkreis Böblingen, Baden-Württemberg',
    serviceKey: '76bdaac8568082d77e7a90cb41129f9b',
    origin: 'https://www.awb-bb.de'
  },
  {
    name: 'Landkreis Leipzig',
    region: 'Landkreis Leipzig, Sachsen',
    serviceKey: '0d7a92192ba3ae914c028ac37d73e222',
    origin: 'https://kell-gmbh.de'
  },
  {
    name: 'Landkreis Göttingen',
    region: 'Landkreis Göttingen, Niedersachsen',
    serviceKey: '4b5702d771c82b611c386ebbc7629026'
  },
  {
    name: 'Landkreis Nordsachsen',
    region: 'Landkreis Nordsachsen, Sachsen',
    serviceKey: '2085afd95285e645e15ee9623d0c5172'
  },
  {
    name: 'Landkreis Osterholz',
    region: 'Landkreis Osterholz, Niedersachsen',
    serviceKey: '8b016df0116d1d5094fa339bebea0c65'
  },
  {
    name: 'Landkreis Neuwied',
    region: 'Landkreis Neuwied, Rheinland-Pfalz',
    serviceKey: 'de4957b006c53e47f8b9c21bc2c768f0'
  },
  {
    name: 'Landkreis Märkisch-Oderland',
    region: 'Landkreis Märkisch-Oderland, Brandenburg',
    serviceKey: 'efb75cbd1f08fae1d4e47ae72a85c655'
  }
];

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
  return clean.slice(0, 3).toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE');
}

async function geocode(cityName: string, region: string): Promise<{ center: [number, number]; bbox: [number, number, number, number] } | null> {
  const cleanName = cityName.replace(/\s*\([^)]*\)/g, '').trim();
  const queries = [
    `${cleanName}, ${region}, Deutschland`,
    `${cleanName}, Deutschland`
  ];

  // Try Photon (fast OSM geocoder by Komoot)
  for (const q of queries) {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Abfuhrtermine-Bot/1.0' } });
      if (res.ok) {
        const data = await res.json();
        const f = data.features?.[0];
        if (f && f.geometry?.coordinates) {
          const lon = Math.round(f.geometry.coordinates[0] * 10000) / 10000;
          const lat = Math.round(f.geometry.coordinates[1] * 10000) / 10000;
          let bbox: [number, number, number, number];
          if (f.properties?.extent && f.properties.extent.length === 4) {
            // [west, north, east, south]
            const [w, n, e, s] = f.properties.extent;
            bbox = [
              Math.round(s * 10000) / 10000,
              Math.round(w * 10000) / 10000,
              Math.round(n * 10000) / 10000,
              Math.round(e * 10000) / 10000
            ];
          } else {
            bbox = [
              Math.round((lat - 0.05) * 10000) / 10000,
              Math.round((lon - 0.05) * 10000) / 10000,
              Math.round((lat + 0.05) * 10000) / 10000,
              Math.round((lon + 0.05) * 10000) / 10000
            ];
          }
          return { center: [lon, lat], bbox };
        }
      }
    } catch {
      // Fallback to nominatim
    }
  }

  // Fallback to Nominatim
  for (const q of queries) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=de&limit=1&q=${encodeURIComponent(q)}`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Abfuhrtermine-Bot/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)'
        }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data[0]) {
        const d = data[0];
        const south = Math.round(parseFloat(d.boundingbox[0]) * 10000) / 10000;
        const north = Math.round(parseFloat(d.boundingbox[1]) * 10000) / 10000;
        const west = Math.round(parseFloat(d.boundingbox[2]) * 10000) / 10000;
        const east = Math.round(parseFloat(d.boundingbox[3]) * 10000) / 10000;
        const lon = Math.round(parseFloat(d.lon) * 10000) / 10000;
        const lat = Math.round(parseFloat(d.lat) * 10000) / 10000;

        return {
          center: [lon, lat],
          bbox: [south, west, north, east]
        };
      }
    } catch (err) {
      console.warn(`Geocode error for ${cleanName}:`, err);
    }
  }
  return null;
}

async function resolveApiKey(target: TargetService): Promise<string | null> {
  if (target.apiKey) return target.apiKey;
  if (!target.serviceKey) return null;

  try {
    const res = await fetch(`https://api.abfall.io?key=${encodeURIComponent(target.serviceKey)}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.apiKey ?? null;
  } catch (err) {
    console.error(`Error resolving API key for ${target.name}:`, err);
    return null;
  }
}

async function main() {
  const abfallPlusPath = 'scripts/fetchers/abfallplus-cities.json';
  const citiesPath = 'src/lib/cities.json';

  const existingAbfallPlus: AbfallPlusConfig[] = JSON.parse(fs.readFileSync(abfallPlusPath, 'utf8'));
  const existingCities: CityInfo[] = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

  const knownIds = new Set(existingCities.map((c) => c.id));
  const knownNames = new Set(existingCities.map((c) => c.name.toLowerCase()));

  console.log(`Starting AbfallPlus discovery...`);
  console.log(`Existing cities in cities.json: ${existingCities.length}`);
  console.log(`Existing cities in abfallplus-cities.json: ${existingAbfallPlus.length}\n`);

  let addedCount = 0;

  for (const target of TARGET_SERVICES) {
    console.log(`\n======================================================`);
    console.log(`Target: ${target.name} (${target.region})`);
    console.log(`======================================================`);

    const apiKey = await resolveApiKey(target);
    if (!apiKey) {
      console.warn(`Could not resolve API key for ${target.name}, skipping.`);
      continue;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-abfallplus-api-key': apiKey
      };
      if (target.origin) headers['Origin'] = target.origin;

      const res = await fetch('https://widgets.abfall.io/graphql', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: `
            query {
              cities {
                id
                name
                districtsCount
                appointmentsSupported
              }
            }
          `
        })
      });

      if (!res.ok) {
        console.warn(`GraphQL query failed: ${res.status} ${res.statusText}`);
        continue;
      }

      const json = await res.json();
      const cities: Array<{ id: string; name: string; districtsCount: number }> = json.data?.cities ?? [];
      console.log(`Found ${cities.length} cities in ${target.name}.`);

      for (const city of cities) {
        if (!city.name) continue;
        const normName = city.name.toLowerCase().trim();

        if (knownNames.has(normName)) {
          // Already in catalog
          continue;
        }

        let id = slugify(city.name);
        if (knownIds.has(id)) {
          id = `${id}-${slugify(target.name)}`;
        }
        if (knownIds.has(id)) continue;

        console.log(`Geocoding: ${city.name} (${target.region})...`);
        const geo = await geocode(city.name, target.region);
        if (!geo) {
          console.warn(`  ⚠️ Could not geocode "${city.name}", skipping.`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        const shortName = makeShortName(city.name);

        const apEntry: AbfallPlusConfig = {
          id,
          name: city.name,
          shortName,
          apiKey,
          cityId: city.id,
          center: geo.center,
          defaultZoom: 12,
          bbox: geo.bbox
        };
        if (target.serviceKey) apEntry.serviceKey = target.serviceKey;
        if (target.origin) apEntry.origin = target.origin;

        const cityEntry: CityInfo = {
          id,
          name: city.name,
          shortName,
          center: geo.center,
          defaultZoom: 12,
          bbox: geo.bbox
        };

        existingAbfallPlus.push(apEntry);
        existingCities.push(cityEntry);
        knownIds.add(id);
        knownNames.add(normName);
        addedCount++;

        console.log(`  ✅ Added: ${city.name} (${id}) [${geo.center.join(', ')}]`);

        // Small polite delay
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.error(`Error querying GraphQL for ${target.name}:`, err);
    }
  }

  console.log(`\n======================================================`);
  console.log(`Finished AbfallPlus discovery!`);
  console.log(`Added: ${addedCount} new cities.`);
  console.log(`Total cities in cities.json: ${existingCities.length}`);
  console.log(`Total in abfallplus-cities.json: ${existingAbfallPlus.length}`);
  console.log(`======================================================`);

  if (addedCount > 0) {
    existingCities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    existingAbfallPlus.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    fs.writeFileSync(abfallPlusPath, JSON.stringify(existingAbfallPlus, null, 2) + '\n');
    fs.writeFileSync(citiesPath, JSON.stringify(existingCities, null, 2) + '\n');
    console.log(`Wrote updated files successfully.`);
  }
}

main().catch(console.error);
