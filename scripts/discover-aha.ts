/**
 * Discovery script for aha (Region Hannover: 21 cities).
 */
import fs from 'fs';
import type { AhaConfig } from './fetchers/aha.ts';

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

async function geocode(cityName: string): Promise<{ center: [number, number]; bbox: [number, number, number, number] } | null> {
  const cleanName = cityName.replace(/\s*\([^)]*\)/g, '').trim();
  const queries = [
    `${cleanName}, Region Hannover, Niedersachsen, Deutschland`,
    `${cleanName}, Niedersachsen, Deutschland`,
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
    } catch {
      // Fallback
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
  const ahaPath = 'scripts/fetchers/aha-cities.json';
  const citiesPath = 'src/lib/cities.json';

  const existingAha: AhaConfig[] = fs.existsSync(ahaPath)
    ? JSON.parse(fs.readFileSync(ahaPath, 'utf8'))
    : [];
  const existingCities: CityInfo[] = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

  const knownIds = new Set(existingCities.map((c) => c.id));
  const knownNames = new Set(existingCities.map((c) => c.name.toLowerCase()));

  console.log(`Starting aha (Region Hannover) discovery...`);
  console.log(`Existing cities in cities.json: ${existingCities.length}`);
  console.log(`Existing cities in aha-cities.json: ${existingAha.length}\n`);

  const url = 'https://www.aha-region.de/abholtermine/abfuhrkalender';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    throw new Error(`Failed to fetch aha website: ${res.status}`);
  }

  const html = await res.text();
  const selectMatch = html.match(/<select[^>]*name="gemeinde"[^>]*>([\s\S]*?)<\/select>/i);
  if (!selectMatch) {
    throw new Error(`Could not find gemeinde select on aha website.`);
  }

  const rawOptions = [...selectMatch[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]+)<\/option>/g)]
    .map((m) => ({ val: m[1].trim(), rawName: m[2].trim() }))
    .filter((o) => o.val && o.rawName);

  console.log(`Found ${rawOptions.length} Gemeinden on aha website.\n`);

  let addedCount = 0;

  for (const opt of rawOptions) {
    let displayName = opt.rawName;
    if (opt.val === 'Neustadt a. Rbge.') {
      displayName = 'Neustadt am Rübenberge';
    } else if (opt.val === 'Burgdorf') {
      displayName = 'Burgdorf (Region Hannover)';
    } else if (opt.val === 'Langenhagen') {
      displayName = 'Langenhagen (Region Hannover)';
    }

    const normName = displayName.toLowerCase();
    if (knownNames.has(normName)) {
      console.log(`Skipping already known name: ${displayName}`);
      continue;
    }

    let id = slugify(displayName);
    if (knownIds.has(id)) {
      id = `${id}-region-hannover`;
    }
    if (knownIds.has(id)) continue;

    console.log(`Geocoding: ${displayName} (${opt.val})...`);
    const geo = await geocode(displayName);
    if (!geo) {
      console.warn(`  ⚠️ Could not geocode "${displayName}", skipping.`);
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    const shortName = makeShortName(displayName);

    const ahaEntry: AhaConfig = {
      id,
      name: displayName,
      shortName,
      gemeinde: opt.val,
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

    existingAha.push(ahaEntry);
    existingCities.push(cityEntry);
    knownIds.add(id);
    knownNames.add(normName);
    addedCount++;

    console.log(`  ✅ Added: ${displayName} (${id}) [${geo.center.join(', ')}]`);
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\n======================================================`);
  console.log(`Finished aha discovery!`);
  console.log(`Added: ${addedCount} new cities.`);
  console.log(`Total cities in cities.json: ${existingCities.length}`);
  console.log(`Total in aha-cities.json: ${existingAha.length}`);
  console.log(`======================================================`);

  if (addedCount > 0) {
    existingCities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    existingAha.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    fs.writeFileSync(ahaPath, JSON.stringify(existingAha, null, 2) + '\n');
    fs.writeFileSync(citiesPath, JSON.stringify(existingCities, null, 2) + '\n');
    console.log(`Wrote updated files successfully.`);
  }
}

main().catch(console.error);
