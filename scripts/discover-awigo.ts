/**
 * Discovery script for Awigo (Landkreis Osnabrück).
 */
import fs from 'fs';
import type { AwigoConfig } from './fetchers/awigo.ts';

interface CityInfo {
  id: string;
  name: string;
  shortName: string;
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
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
    `${cleanName}, ${plz ? plz + ', ' : ''}Landkreis Osnabrück, Niedersachsen, Deutschland`,
    `${cleanName}, Niedersachsen, Deutschland`,
    `${cleanName}, Deutschland`
  ];

  // Try Photon first
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
    } catch {
      // ignore photon error and fallback
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

        return { center: [lon, lat], bbox: [south, west, north, east] };
      }
    } catch (err) {
      console.warn(`Geocode error for ${cleanName}:`, err);
    }
  }
  return null;
}

async function main() {
  const awigoPath = 'scripts/fetchers/awigo-cities.json';
  const citiesPath = 'src/lib/cities.json';

  const existingAwigo: AwigoConfig[] = fs.existsSync(awigoPath)
    ? JSON.parse(fs.readFileSync(awigoPath, 'utf8'))
    : [];
  const existingCities: CityInfo[] = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

  const knownIds = new Set(existingCities.map((c) => c.id));
  const knownNames = new Set(existingCities.map((c) => c.name.toLowerCase()));

  console.log(`Starting Awigo discovery...`);
  console.log(`Existing cities in cities.json: ${existingCities.length}`);
  console.log(`Existing cities in awigo-cities.json: ${existingAwigo.length}\n`);

  const url = 'https://www.awigo.de/index.php?legacy_eID=awigoCalendar&calendar[method]=getCities';
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Failed to fetch Awigo cities: ${res.status}`);
  }

  const html = await res.text();
  const rawCities = [...html.matchAll(/<option[^>]+value="([^"]+)"[^>]*>([^<]+)<\/option>/g)]
    .map((m) => ({ id: m[1].trim(), rawName: m[2].trim() }))
    .filter((c) => c.id && c.rawName);

  console.log(`Found ${rawCities.length} Orte in Awigo.\n`);

  let addedCount = 0;

  for (const c of rawCities) {
    const plzMatch = c.rawName.match(/\(([0-9]{5})\)/);
    const plz = plzMatch ? plzMatch[1] : undefined;
    const cleanName = c.rawName.replace(/\s*\([0-9]+\)/, '').trim();
    const normName = cleanName.toLowerCase();

    if (knownNames.has(normName)) {
      continue;
    }

    let id = slugify(cleanName);
    if (knownIds.has(id)) {
      id = `${id}-awigo`;
    }
    if (knownIds.has(id)) continue;

    console.log(`Geocoding: ${cleanName} (${plz ?? ''})...`);
    const geo = await geocode(cleanName, plz);
    if (!geo) {
      console.warn(`  ⚠️ Could not geocode "${cleanName}", skipping.`);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    const shortName = makeShortName(cleanName);

    const awigoEntry: AwigoConfig = {
      id,
      name: cleanName,
      shortName,
      cityId: c.id,
      center: geo.center,
      defaultZoom: 12,
      bbox: geo.bbox
    };
    if (plz) awigoEntry.plz = plz;

    const cityEntry: CityInfo = {
      id,
      name: cleanName,
      shortName,
      center: geo.center,
      defaultZoom: 12,
      bbox: geo.bbox
    };

    existingAwigo.push(awigoEntry);
    existingCities.push(cityEntry);
    knownIds.add(id);
    knownNames.add(normName);
    addedCount++;

    console.log(`  ✅ Added: ${cleanName} (${id}) [${geo.center.join(', ')}]`);

    // Respect Nominatim limit
    await new Promise((r) => setTimeout(r, 1100));
  }

  console.log(`\n======================================================`);
  console.log(`Finished Awigo discovery!`);
  console.log(`Added: ${addedCount} new cities.`);
  console.log(`Total cities in cities.json: ${existingCities.length}`);
  console.log(`Total in awigo-cities.json: ${existingAwigo.length}`);
  console.log(`======================================================`);

  if (addedCount > 0) {
    existingCities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    existingAwigo.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    fs.writeFileSync(awigoPath, JSON.stringify(existingAwigo, null, 2) + '\n');
    fs.writeFileSync(citiesPath, JSON.stringify(existingCities, null, 2) + '\n');
    console.log(`Wrote updated files successfully.`);
  }
}

main().catch(console.error);
