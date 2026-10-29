/**
 * Discovery script for C-Trace.de services.
 * Discovers cities for configured C-Trace services, geocodes them via Photon/Nominatim,
 * and adds them to scripts/fetchers/ctrace-cities.json and src/lib/cities.json.
 */
import fs from 'fs';
import type { CTraceConfig } from './fetchers/ctrace.ts';

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
  service: string;
  subdomain?: string;
  serviceType: 'odata' | 'json' | 'direct';
  region: string;
  calPath?: string;
  defaultHnr?: string;
  ort?: string;
  gemeinde?: string;
  directName?: string;
}

const TARGET_SERVICES: TargetService[] = [
  {
    name: 'Bremer Stadtreinigung',
    service: 'bremenabfallkalender',
    serviceType: 'direct',
    directName: 'Bremen',
    region: 'Bremen, Deutschland'
  },
  {
    name: 'Stadt Bayreuth',
    service: 'bayreuthstadt-abfallkalender',
    serviceType: 'direct',
    directName: 'Bayreuth',
    region: 'Bayreuth, Bayern, Deutschland'
  },
  {
    name: 'Stadt Arnsberg',
    service: 'arnsberg-abfallkalender',
    serviceType: 'direct',
    directName: 'Arnsberg',
    region: 'Arnsberg, Nordrhein-Westfalen, Deutschland'
  },
  {
    name: 'Landau in der Pfalz',
    service: 'web.landau',
    subdomain: 'apps',
    serviceType: 'direct',
    directName: 'Landau in der Pfalz',
    calPath: 'downloadcal',
    defaultHnr: '1',
    region: 'Landau in der Pfalz, Rheinland-Pfalz, Deutschland'
  },
  {
    name: 'Oberursel (Taunus)',
    service: 'web.oberursel',
    subdomain: 'apps',
    serviceType: 'direct',
    directName: 'Oberursel (Taunus)',
    calPath: 'cal',
    defaultHnr: '1',
    region: 'Oberursel (Taunus), Hessen, Deutschland'
  },
  {
    name: 'Landkreis Augsburg',
    service: 'augsburglandkreis',
    serviceType: 'odata',
    region: 'Landkreis Augsburg, Bayern, Deutschland'
  },
  {
    name: 'Kreis Groß-Gerau',
    service: 'grossgeraulandkreis-abfallkalender',
    serviceType: 'json',
    region: 'Kreis Groß-Gerau, Hessen, Deutschland'
  },
  {
    name: 'Main-Tauber-Kreis',
    service: 'maintauberkreis-abfallkalender',
    serviceType: 'json',
    region: 'Main-Tauber-Kreis, Baden-Württemberg, Deutschland'
  },
  {
    name: 'Kreis Segeberg (WZV)',
    service: 'segebergwzv-abfallkalender',
    serviceType: 'json',
    calPath: 'cal/2026',
    region: 'Kreis Segeberg, Schleswig-Holstein, Deutschland'
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
  const cleanName = cityName
    .replace(/\s*OT\s+[A-Za-z0-9_-]+/gi, '')
    .replace(/\s*\([^)]*\)/g, '')
    .trim();

  const queries = [
    `${cleanName}, ${region}`,
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

async function getOrteForService(target: TargetService): Promise<string[]> {
  if (target.serviceType === 'direct' && target.directName) {
    return [target.directName];
  }

  const host = target.subdomain ? `${target.subdomain}.c-trace.de` : 'web.c-trace.de';
  const initUrl = `https://${host}/${target.service}/Abfallkalender`;
  const res = await fetch(initUrl, { redirect: 'manual' });
  const loc = res.headers.get('location');
  if (!loc) {
    console.warn(`Could not get redirect for ${target.name}`);
    return [];
  }
  const baseUrl = `https://${host}${loc.substring(0, loc.lastIndexOf('/'))}`;

  if (target.serviceType === 'odata') {
    const odataUrl = `${baseUrl}/OData.svc/Orte?$format=json`;
    const oRes = await fetch(odataUrl, { headers: { Accept: 'application/json' } });
    if (oRes.ok) {
      const json = await oRes.json();
      const results = json.d?.results || json.d || [];
      return results
        .map((r: { Name?: string }) => r.Name)
        .filter((n?: string): n is string => Boolean(n && n.trim().length > 0));
    }
  } else {
    // json
    const jRes = await fetch(`${baseUrl}/Orte`);
    if (jRes.ok) {
      const json = await jRes.json();
      if (Array.isArray(json)) {
        return json.filter((n: string) => typeof n === 'string' && n.trim().length > 0);
      }
    }
  }
  return [];
}

async function main() {
  const ctracePath = 'scripts/fetchers/ctrace-cities.json';
  const citiesPath = 'src/lib/cities.json';

  const existingCTrace: CTraceConfig[] = fs.existsSync(ctracePath)
    ? JSON.parse(fs.readFileSync(ctracePath, 'utf8'))
    : [];
  const existingCities: CityInfo[] = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

  const knownIds = new Set(existingCities.map((c) => c.id));
  const knownNames = new Set(existingCities.map((c) => c.name.toLowerCase()));

  console.log(`Starting C-Trace discovery...`);
  console.log(`Existing cities in cities.json: ${existingCities.length}`);
  console.log(`Existing cities in ctrace-cities.json: ${existingCTrace.length}\n`);

  let addedCount = 0;

  for (const target of TARGET_SERVICES) {
    console.log(`\n======================================================`);
    console.log(`Target: ${target.name} (${target.service})`);
    console.log(`======================================================`);

    const orte = await getOrteForService(target);
    console.log(`Found ${orte.length} Orte in ${target.name}.`);

    for (const ort of orte) {
      const normName = ort.toLowerCase().trim();
      if (knownNames.has(normName)) {
        // already in catalog
        continue;
      }

      let id = slugify(ort);
      if (knownIds.has(id)) {
        id = `${id}-${slugify(target.name)}`;
      }
      if (knownIds.has(id)) continue;

      console.log(`Geocoding: ${ort} (${target.region})...`);
      const geo = await geocode(ort, target.region);
      if (!geo) {
        console.warn(`  ⚠️ Could not geocode "${ort}", skipping.`);
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      const shortName = makeShortName(ort);

      const ctEntry: CTraceConfig = {
        id,
        name: ort,
        shortName,
        service: target.service,
        serviceType: target.serviceType,
        ort,
        gemeinde: target.gemeinde || ort,
        center: geo.center,
        defaultZoom: 12,
        bbox: geo.bbox
      };
      if (target.subdomain) ctEntry.subdomain = target.subdomain;
      if (target.calPath) ctEntry.calPath = target.calPath;
      if (target.defaultHnr) ctEntry.defaultHnr = target.defaultHnr;

      const cityEntry: CityInfo = {
        id,
        name: ort,
        shortName,
        center: geo.center,
        defaultZoom: 12,
        bbox: geo.bbox
      };

      existingCTrace.push(ctEntry);
      existingCities.push(cityEntry);
      knownIds.add(id);
      knownNames.add(normName);
      addedCount++;

      console.log(`  ✅ Added: ${ort} (${id}) [${geo.center.join(', ')}]`);

      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\n======================================================`);
  console.log(`Finished C-Trace discovery!`);
  console.log(`Added: ${addedCount} new cities.`);
  console.log(`Total cities in cities.json: ${existingCities.length}`);
  console.log(`Total in ctrace-cities.json: ${existingCTrace.length}`);
  console.log(`======================================================`);

  if (addedCount > 0) {
    existingCities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    existingCTrace.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    fs.writeFileSync(ctracePath, JSON.stringify(existingCTrace, null, 2) + '\n');
    fs.writeFileSync(citiesPath, JSON.stringify(existingCities, null, 2) + '\n');
    console.log(`Wrote updated files successfully.`);
  }
}

main().catch(console.error);
