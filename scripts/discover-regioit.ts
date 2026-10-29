/**
 * Discovery script for RegioIT / Abfallnavi cities.
 * Scans all known service domains, geocodes uncataloged cities via Open-Meteo,
 * and adds them to scripts/fetchers/regioit-cities.json and src/lib/cities.json.
 */
import fs from 'fs';

interface RegioItConfig {
  id: string;
  name: string;
  shortName: string;
  serviceDomain: string;
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

const SERVICES = [
  { domain: 'aachen', region: 'Nordrhein-Westfalen' },
  { domain: 'nuernberg', region: 'Bayern' },
  { domain: 'solingen', region: 'Nordrhein-Westfalen' },
  { domain: 'oberhausen', region: 'Nordrhein-Westfalen' },
  { domain: 'muelheim', region: 'Nordrhein-Westfalen' },
  { domain: 'aw-bgl2', region: 'Nordrhein-Westfalen' },
  { domain: 'zew2', region: 'Städteregion Aachen, Düren' },
  { domain: 'krwaf', region: 'Kreis Warendorf / Gütersloh' },
  { domain: 'bav', region: 'Oberbergischer Kreis / Rheinisch-Bergischer Kreis' },
  { domain: 'coe', region: 'Kreis Coesfeld' },
  { domain: 'cottbus', region: 'Brandenburg' },
  { domain: 'din', region: 'Kreis Wesel' },
  { domain: 'dorsten', region: 'Kreis Recklinghausen' },
  { domain: 'wml2', region: 'Kreis Borken' },
  { domain: 'hlv', region: 'Märkischer Kreis' },
  { domain: 'krhs', region: 'Kreis Heinsberg' },
  { domain: 'kronberg', region: 'Hochtaunuskreis' },
  { domain: 'nds', region: 'Schleswig-Holstein' },
  { domain: 'pi', region: 'Kreis Pinneberg' },
  { domain: 'stl', region: 'Märkischer Kreis' },
  { domain: 'unna', region: 'Kreis Unna' },
  { domain: 'viersen', region: 'Kreis Viersen' },
  { domain: 'cux', region: 'Niedersachsen' },
  { domain: 'frankenthal', region: 'Rheinland-Pfalz' },
  { domain: 'awvlippe', region: 'Kreis Lippe' },
  { domain: 'kranenburg', region: 'Kreis Kleve' },
  { domain: 'portawestfalica', region: 'Kreis Minden-Lübbecke' }
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
  const cleanName = cityName.replace(/\s*\(.*?\)\s*$/, '').trim();
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
      // try next
    }
  }
  return null;
}

async function main() {
  const regioPath = 'scripts/fetchers/regioit-cities.json';
  const citiesPath = 'src/lib/cities.json';

  const existingRegio: RegioItConfig[] = JSON.parse(fs.readFileSync(regioPath, 'utf8'));
  const existingCities: CityInfo[] = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

  const knownIds = new Set(existingCities.map((c) => c.id));
  const knownNames = new Set(existingCities.map((c) => c.name.toLowerCase()));

  console.log(`Starting with ${existingCities.length} cities in cities.json.`);
  console.log(`Starting with ${existingRegio.length} cities in regioit-cities.json.\n`);

  let added = 0;

  for (const { domain, region } of SERVICES) {
    console.log(`Scanning RegioIT domain "${domain}"...`);
    const urls = [
      `https://${domain}-abfallapp.regioit.de/abfall-app-${domain}/rest/orte`,
      `https://abfallapp.regioit.de/abfall-app-${domain}/rest/orte`
    ];

    let orte: any[] | null = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          orte = await res.json();
          break;
        }
      } catch {}
    }

    if (!orte || !Array.isArray(orte)) {
      console.warn(`  Could not fetch orte for ${domain}`);
      continue;
    }

    for (const o of orte) {
      const name = o.name.trim();
      const cleanName = name.replace(/\s*\(.*?\)\s*$/, '').trim();
      const normName = name.toLowerCase();
      const normClean = cleanName.toLowerCase();

      if (knownNames.has(normName) || knownNames.has(normClean)) {
        continue;
      }

      let id = slugify(cleanName);
      if (knownIds.has(id)) {
        id = `${id}-${domain}`;
      }
      if (knownIds.has(id)) continue;

      console.log(`  Geocoding ${name} (${region})...`);
      const geo = await geocode(name, region);
      if (!geo) {
        console.warn(`    ⚠️ Failed to geocode ${name}`);
        continue;
      }

      const shortName = makeShortName(cleanName);

      const regioConfig: RegioItConfig = {
        id,
        name: cleanName,
        shortName,
        serviceDomain: domain,
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

      existingRegio.push(regioConfig);
      existingCities.push(cityInfo);
      knownIds.add(id);
      knownNames.add(normName);
      knownNames.add(normClean);
      added++;
      console.log(`    ✅ Added: ${cleanName} (${id})`);

      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\n===========================================`);
  console.log(`Added ${added} new RegioIT cities.`);
  console.log(`New total in cities.json: ${existingCities.length}`);
  console.log(`New total in regioit-cities.json: ${existingRegio.length}`);
  console.log(`===========================================`);

  if (added > 0) {
    existingCities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    existingRegio.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    fs.writeFileSync(citiesPath, JSON.stringify(existingCities, null, 2) + '\n');
    fs.writeFileSync(regioPath, JSON.stringify(existingRegio, null, 2) + '\n');
    console.log('Saved updated files.');
  }
}

main().catch(console.error);
