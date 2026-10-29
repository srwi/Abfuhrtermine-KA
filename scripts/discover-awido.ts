/**
 * Discovery script for Awido waste management regions.
 * Discovers municipalities across Bavaria, Baden-Württemberg, Hessen, and Thüringen,
 * geocodes them via Open-Meteo, and registers them in awido-cities.json and cities.json.
 */
import fs from 'fs';

interface AwidoPlace {
  key: string;
  value: string;
}

interface AwidoConfig {
  id: string;
  name: string;
  shortName: string;
  customer: string;
  placeKey: string;
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

interface AwidoTarget {
  customer: string;
  region: string;
}

const TARGETS: AwidoTarget[] = [
  { customer: 'rmk', region: 'Rems-Murr-Kreis, Baden-Württemberg' },
  { customer: 'tuebingen', region: 'Landkreis Tübingen, Baden-Württemberg' },
  { customer: 'ffb', region: 'Landkreis Fürstenfeldbruck, Bayern' },
  { customer: 'rosenheim', region: 'Landkreis Rosenheim, Bayern' },
  { customer: 'erding', region: 'Landkreis Erding, Bayern' },
  { customer: 'bgl', region: 'Landkreis Berchtesgadener Land, Bayern' },
  { customer: 'aic-fdb', region: 'Landkreis Aichach-Friedberg, Bayern' },
  { customer: 'lra-dah', region: 'Landkreis Dachau, Bayern' },
  { customer: 'lra-ab', region: 'Landkreis Aschaffenburg, Bayern' },
  { customer: 'lra-mue', region: 'Landkreis Mühldorf, Bayern' },
  { customer: 'roth', region: 'Landkreis Roth, Bayern' },
  { customer: 'lkgi', region: 'Landkreis Gießen, Hessen' },
  { customer: 'awld', region: 'Lahn-Dill-Kreis, Hessen' },
  { customer: 'gotha', region: 'Landkreis Gotha, Thüringen' },
  { customer: 'coburg', region: 'Landkreis Coburg, Bayern' },
  { customer: 'ansbach', region: 'Landkreis Ansbach, Bayern' },
  { customer: 'awb-duerkheim', region: 'Landkreis Bad Dürkheim, Rheinland-Pfalz' },
  { customer: 'kelheim', region: 'Landkreis Kelheim, Bayern' },
  { customer: 'kaw-guenzburg', region: 'Landkreis Günzburg, Bayern' },
  { customer: 'memmingen', region: 'Memmingen, Bayern' },
  { customer: 'kaufbeuren', region: 'Kaufbeuren, Bayern' },
  { customer: 'regensburg', region: 'Regensburg, Bayern' },
  { customer: 'lra-regensburg', region: 'Landkreis Regensburg, Bayern' },
  { customer: 'landkreisbetriebe', region: 'Landkreis Neuburg-Schrobenhausen, Bayern' },
  { customer: 'awb-ak', region: 'Landkreis Altenkirchen, Rheinland-Pfalz' },
  { customer: 'awv-nordschwaben', region: 'Nordschwaben, Bayern' },
  { customer: 'ebe', region: 'Landkreis Ebersberg, Bayern' },
  { customer: 'zv-muc-so', region: 'München-Südost, Bayern' },
  { customer: 'kronach', region: 'Landkreis Kronach, Bayern' },
  { customer: 'kulmbach', region: 'Landkreis Kulmbach, Bayern' },
  { customer: 'lichtenfels', region: 'Landkreis Lichtenfels, Bayern' },
  { customer: 'kreis-tir', region: 'Landkreis Tirschenreuth, Bayern' },
  { customer: 'lra-schweinfurt', region: 'Landkreis Schweinfurt, Bayern' },
  { customer: 'gifhorn', region: 'Landkreis Gifhorn, Niedersachsen' }
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
  const parts = name.split(/[\s-]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 3).toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE');
}

async function geocode(cityName: string, region: string): Promise<{ center: [number, number]; bbox: [number, number, number, number] } | null> {
  const cleanName = cityName
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(/^Gemeinde\s+/i, '')
    .replace(/^Stadt\s+/i, '')
    .replace(/^VG\s+/i, '')
    .trim();

  const searchTerms = [cleanName, `${cleanName} ${region}`];

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
      // try next search term
    }
  }
  return null;
}

async function main() {
  const awidoPath = 'scripts/fetchers/awido-cities.json';
  const citiesPath = 'src/lib/cities.json';

  const existingAwido: AwidoConfig[] = fs.existsSync(awidoPath)
    ? JSON.parse(fs.readFileSync(awidoPath, 'utf8'))
    : [];
  const existingCities: CityInfo[] = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

  const knownIds = new Set(existingCities.map((c) => c.id));
  const knownNames = new Set(existingCities.map((c) => c.name.toLowerCase()));

  console.log(`Starting with ${existingCities.length} cities in cities.json.`);
  console.log(`Starting with ${existingAwido.length} cities in awido-cities.json.\n`);

  let added = 0;

  for (const { customer, region } of TARGETS) {
    console.log(`\n--- Scanning Awido customer "${customer}" (${region}) ---`);
    let places: AwidoPlace[] = [];
    try {
      const res = await fetch(`https://awido.cubefour.de/WebServices/Awido.Service.svc/secure/getPlaces/client=${customer}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) {
        console.warn(`Failed to fetch places for ${customer}: ${res.status}`);
        continue;
      }
      places = await res.json();
    } catch (e: any) {
      console.warn(`Error fetching ${customer}:`, e.message);
      continue;
    }

    console.log(`Found ${places.length} places in ${customer}.`);

    for (const place of places) {
      const name = place.value.trim();
      const cleanName = name
        .replace(/\s*\(.*?\)\s*$/, '')
        .replace(/^Gemeinde\s+/i, '')
        .replace(/^Stadt\s+/i, '')
        .replace(/^VG\s+/i, '')
        .trim();

      const normName = name.toLowerCase();
      const normClean = cleanName.toLowerCase();

      if (knownNames.has(normName) || knownNames.has(normClean)) {
        continue;
      }

      let id = slugify(cleanName);
      if (knownIds.has(id)) {
        id = `${id}-${customer}`;
      }
      if (knownIds.has(id)) continue;

      console.log(`  Geocoding: ${cleanName} (${region})...`);
      const geo = await geocode(cleanName, region);
      if (!geo) {
        console.warn(`    ⚠️ Could not geocode ${cleanName}, skipping.`);
        continue;
      }

      const shortName = makeShortName(cleanName);

      const awidoEntry: AwidoConfig = {
        id,
        name: cleanName,
        shortName,
        customer,
        placeKey: place.key,
        center: geo.center,
        defaultZoom: 12,
        bbox: geo.bbox
      };

      const cityInfo: CityInfo = {
        id,
        name: cleanName,
        shortName,
        center: geo.center,
        defaultZoom: 12,
        bbox: geo.bbox
      };

      existingAwido.push(awidoEntry);
      existingCities.push(cityInfo);
      knownIds.add(id);
      knownNames.add(normName);
      knownNames.add(normClean);
      added++;
      console.log(`    ✅ Added: ${cleanName} (${id})`);

      await new Promise((r) => setTimeout(r, 150));
    }
  }

  console.log(`\n===========================================`);
  console.log(`Added ${added} new Awido cities!`);
  console.log(`New total in cities.json: ${existingCities.length}`);
  console.log(`New total in awido-cities.json: ${existingAwido.length}`);
  console.log(`===========================================`);

  if (added > 0) {
    existingCities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    existingAwido.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    fs.writeFileSync(citiesPath, JSON.stringify(existingCities, null, 2) + '\n');
    fs.writeFileSync(awidoPath, JSON.stringify(existingAwido, null, 2) + '\n');
    console.log('Saved updated files successfully.');
  }
}

main().catch(console.error);
