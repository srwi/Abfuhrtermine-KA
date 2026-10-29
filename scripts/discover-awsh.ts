/**
 * Discovery script for AWSH (Abfallwirtschaft Südholstein).
 * Covers Kreis Stormarn and Kreis Herzogtum Lauenburg.
 */
import fs from 'fs';
import type { AwshConfig } from './fetchers/awsh.ts';

interface CityInfo {
  id: string;
  name: string;
  shortName: string;
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
}

interface AwshRawOrt {
  ortsnummer: number;
  ortsbezeichnung: string;
  plz?: string;
}

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

async function geocode(cityName: string, plz?: string): Promise<{ center: [number, number]; bbox: [number, number, number, number] } | null> {
  const cleanName = cityName.replace(/\s*\([^)]*\)/g, '').trim();
  const queries = [
    `${cleanName}, ${plz ? plz + ', ' : ''}Schleswig-Holstein, Deutschland`,
    `${cleanName}, Schleswig-Holstein, Deutschland`,
    `${cleanName}, Deutschland`
  ];

  // Try Photon
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
    } catch {}
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

        return { center: [lon, lat], bbox: [south, west, north, east] };
      }
    } catch (err) {
      console.warn(`Geocode error for ${cleanName}:`, err);
    }
  }
  return null;
}

async function main() {
  const awshPath = 'scripts/fetchers/awsh-cities.json';
  const citiesPath = 'src/lib/cities.json';

  const existingAwsh: AwshConfig[] = fs.existsSync(awshPath)
    ? JSON.parse(fs.readFileSync(awshPath, 'utf8'))
    : [];
  const existingCities: CityInfo[] = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

  const knownIds = new Set(existingCities.map((c) => c.id));
  const knownNames = new Set(existingCities.map((c) => c.name.toLowerCase()));

  console.log(`Starting AWSH discovery...`);
  console.log(`Existing cities in cities.json: ${existingCities.length}`);
  console.log(`Existing cities in awsh-cities.json: ${existingAwsh.length}\n`);

  const res = await fetch('https://www.awsh.de/api_v2/collection_dates/1/orte');
  if (!res.ok) {
    throw new Error(`Failed to fetch AWSH orte: ${res.status}`);
  }

  const data = (await res.json()) as { orte?: AwshRawOrt[] };
  const orte = data.orte ?? [];
  console.log(`Found ${orte.length} Orte in AWSH API.\n`);

  let addedCount = 0;

  for (const ort of orte) {
    if (!ort.ortsbezeichnung) continue;
    const name = ort.ortsbezeichnung.trim();
    const normName = name.toLowerCase();

    if (knownNames.has(normName)) {
      continue;
    }

    let id = slugify(name);
    if (knownIds.has(id)) {
      id = `${id}-awsh`;
    }
    if (knownIds.has(id)) continue;

    console.log(`Geocoding: ${name} (${ort.plz ?? ''})...`);
    const geo = await geocode(name, ort.plz);
    if (!geo) {
      console.warn(`  ⚠️ Could not geocode "${name}", skipping.`);
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    const shortName = makeShortName(name);

    const awshEntry: AwshConfig = {
      id,
      name,
      shortName,
      cityId: ort.ortsnummer,
      center: geo.center,
      defaultZoom: 12,
      bbox: geo.bbox
    };
    if (ort.plz) awshEntry.plz = ort.plz;

    const cityEntry: CityInfo = {
      id,
      name,
      shortName,
      center: geo.center,
      defaultZoom: 12,
      bbox: geo.bbox
    };

    existingAwsh.push(awshEntry);
    existingCities.push(cityEntry);
    knownIds.add(id);
    knownNames.add(normName);
    addedCount++;

    console.log(`  ✅ Added: ${name} (${id}) [${geo.center.join(', ')}]`);

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n======================================================`);
  console.log(`Finished AWSH discovery!`);
  console.log(`Added: ${addedCount} new cities.`);
  console.log(`Total cities in cities.json: ${existingCities.length}`);
  console.log(`Total in awsh-cities.json: ${existingAwsh.length}`);
  console.log(`======================================================`);

  if (addedCount > 0) {
    existingCities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    existingAwsh.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    fs.writeFileSync(awshPath, JSON.stringify(existingAwsh, null, 2) + '\n');
    fs.writeFileSync(citiesPath, JSON.stringify(existingCities, null, 2) + '\n');
    console.log(`Wrote updated files successfully.`);
  }
}

main().catch(console.error);
