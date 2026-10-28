/**
 * Script to discover new cities from verified JumoMind services,
 * geocode them via Nominatim, and register them in jumomind-cities.json and cities.json.
 */
import fs from 'fs';

interface JumoMindApiCity {
  id: string;
  name: string;
  _name?: string;
  has_streets?: boolean;
}

interface JumoMindEntry {
  id: string;
  name: string;
  shortName: string;
  serviceId: string;
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
  const parts = name.split(/[\s-]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 3).toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE');
}

async function geocode(cityName: string, region: string): Promise<{ center: [number, number]; bbox: [number, number, number, number] } | null> {
  const cleanName = cityName.replace(/\s*\([^)]*\)/g, '').trim();
  const searchTerms: string[] = [];

  if (cleanName.includes(' - ')) {
    const parts = cleanName.split(' - ').map((p) => p.trim());
    searchTerms.push(parts[1]);
    searchTerms.push(parts[0]);
  } else if (cleanName.includes('-')) {
    const parts = cleanName.split('-').map((p) => p.trim());
    searchTerms.push(parts[1]);
    searchTerms.push(parts[0]);
  }
  searchTerms.push(cleanName);

  for (const term of searchTerms) {
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=1&language=de&country_code=DE`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const data = await res.json();
      const r = data.results?.[0];
      if (r && r.latitude && r.longitude) {
        const center: [number, number] = [
          Math.round(r.longitude * 10000) / 10000,
          Math.round(r.latitude * 10000) / 10000
        ];
        const bbox: [number, number, number, number] = [
          Math.round((center[1] - 0.04) * 10000) / 10000,
          Math.round((center[0] - 0.05) * 10000) / 10000,
          Math.round((center[1] + 0.04) * 10000) / 10000,
          Math.round((center[0] + 0.05) * 10000) / 10000
        ];
        return { center, bbox };
      }
    } catch {
      // Try next search term
    }
  }
  return null;
}

const SERVICES_TO_SCAN: { service: string; region: string }[] = [
  { service: 'udg', region: 'Uckermark, Brandenburg' },
  { service: 'bdg', region: 'Landkreis Barnim, Brandenburg' },
  { service: 'zvo', region: 'Ostholstein, Schleswig-Holstein' }
];

async function main() {
  const jumomindPath = 'scripts/fetchers/jumomind-cities.json';
  const citiesPath = 'src/lib/cities.json';

  const existingJumo: JumoMindEntry[] = JSON.parse(fs.readFileSync(jumomindPath, 'utf8'));
  const existingCities: CityInfo[] = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

  const knownIds = new Set(existingCities.map((c) => c.id));
  const knownNames = new Set(existingCities.map((c) => c.name.toLowerCase()));

  console.log(`Starting with ${existingCities.length} existing cities in cities.json.`);
  console.log(`Starting with ${existingJumo.length} existing cities in jumomind-cities.json.\n`);

  let addedCount = 0;

  for (const { service, region } of SERVICES_TO_SCAN) {
    console.log(`\n--- Scanning service "${service}" (${region}) ---`);
    try {
      const res = await fetch(`https://${service}.jumomind.com/mmapp/api.php?r=cities`);
      if (!res.ok) {
        console.warn(`Failed to fetch cities for ${service}: ${res.status}`);
        continue;
      }
      const cities: JumoMindApiCity[] = await res.json();
      const streetCities = cities.filter((c) => c.has_streets);
      console.log(`Found ${streetCities.length} cities with streets.`);

      for (const city of streetCities) {
        // Skip dummy entries
        if (city.name.includes('Muster') || city.name.includes('Entenhausen') || city.name.includes('Test')) {
          continue;
        }

        const normName = city.name.toLowerCase().trim();
        if (knownNames.has(normName)) {
          continue;
        }

        let id = slugify(city.name);
        if (knownIds.has(id)) {
          id = `${id}-${service}`;
        }
        if (knownIds.has(id)) continue;

        console.log(`Geocoding: ${city.name} (${region})...`);
        const geo = await geocode(city.name, region);
        if (!geo) {
          console.warn(`  ⚠️ Could not geocode ${city.name}, skipping.`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        const shortName = makeShortName(city.name);

        const jumoEntry: JumoMindEntry = {
          id,
          name: city.name,
          shortName,
          serviceId: service,
          cityId: city.id,
          center: geo.center,
          defaultZoom: 12,
          bbox: geo.bbox
        };

        const cityInfo: CityInfo = {
          id,
          name: city.name,
          shortName,
          center: geo.center,
          defaultZoom: 12,
          bbox: geo.bbox
        };

        existingJumo.push(jumoEntry);
        existingCities.push(cityInfo);
        knownIds.add(id);
        knownNames.add(normName);
        addedCount++;
        console.log(`  ✅ Added: ${city.name} (${id}, ${shortName}) [${geo.center.join(', ')}]`);

        // Brief pause between requests
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (err) {
      console.error(`Error scanning ${service}:`, err);
    }
  }

  console.log(`\n==============================================`);
  console.log(`Total new cities added: ${addedCount}`);
  console.log(`New total cities in cities.json: ${existingCities.length}`);
  console.log(`New total in jumomind-cities.json: ${existingJumo.length}`);
  console.log(`==============================================`);

  if (addedCount > 0) {
    // Sort cities by name in cities.json
    existingCities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    fs.writeFileSync(jumomindPath, JSON.stringify(existingJumo, null, 2) + '\n');
    fs.writeFileSync(citiesPath, JSON.stringify(existingCities, null, 2) + '\n');
    console.log(`Wrote updated files successfully.`);
  }
}

main().catch(console.error);
