import existingCities from '../src/lib/cities.json';

interface Candidate {
  name: string;
  service: string;
  ort: string;
  kreis: string;
  state: string;
  id?: string;
  shortName?: string;
}

const LKG_CITIES = [
  'Allendorf (Lumda)', 'Biebertal', 'Buseck', 'Fernwald', 'Grünberg',
  'Heuchelheim', 'Hungen', 'Langgöns', 'Laubach', 'Lich',
  'Linden', 'Lollar', 'Pohlheim', 'Rabenau', 'Reiskirchen',
  'Staufenberg', 'Wettenberg'
];

const RSA_CITIES = [
  'Alfter', 'Bad Honnef', 'Bornheim', 'Eitorf', 'Hennef',
  'Königswinter', 'Lohmar', 'Meckenheim', 'Much', 'Neunkirchen-Seelscheid',
  'Niederkassel', 'Rheinbach', 'Ruppichteroth', 'Sankt Augustin', 'Siegburg',
  'Swisttal', 'Troisdorf', 'Wachtberg', 'Windeck'
];

const EVS_CITIES = [
  'Beckingen', 'Bexbach', 'Blieskastel', 'Bous', 'Dillingen',
  'Ensdorf', 'Freisen', 'Friedrichsthal', 'Gersheim', 'Großrosseln',
  'Heusweiler', 'Illingen', 'Kirkel', 'Kleinblittersdorf', 'Losheim am See',
  'Mandelbachtal', 'Marpingen', 'Merchweiler', 'Mettlach', 'Nalbach',
  'Namborn', 'Nohfelden', 'Nonnweiler', 'Oberthal', 'Ottweiler',
  'Perl', 'Püttlingen', 'Quierschied', 'Rehlingen-Siersburg', 'Riegelsberg',
  'Saarwellingen', 'Schiffweiler', 'Schmelz', 'Schwalbach', 'Spiesen-Elversberg',
  'Sulzbach', 'Tholey', 'Überherrn', 'Wadern', 'Wadgassen',
  'Wallerfangen', 'Weiskirchen'
];

const TBR_CITIES = ['Remscheid'];

const candidates: Candidate[] = [
  ...LKG_CITIES.map(name => ({ name, service: 'Lkg', ort: name, kreis: 'Landkreis Gießen', state: 'Hessen' })),
  ...RSA_CITIES.map(name => ({ name, service: 'Rsa', ort: name, kreis: 'Rhein-Sieg-Kreis', state: 'Nordrhein-Westfalen' })),
  ...EVS_CITIES.map(name => ({ name, service: 'Evs', ort: name, kreis: 'Saarland', state: 'Saarland' })),
  ...TBR_CITIES.map(name => ({ name, service: 'Tbr', ort: name, kreis: 'Remscheid', state: 'Nordrhein-Westfalen' })),
];

const existingIds = new Set(existingCities.map(c => c.id));

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function makeShortName(name: string): string {
  const clean = name.replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
  return clean.slice(0, 3).toUpperCase();
}

async function geo(q: string) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=de&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'abfuhrkalender-ka-bot/1.0' } });
  const data = await res.json();
  if (!data.length) return null;
  const d = data[0];
  const bb = d.boundingbox.map(Number);
  return {
    osm_name: d.name,
    display_name: d.display_name,
    center: [Number(Number(d.lon).toFixed(4)), Number(Number(d.lat).toFixed(4))] as [number, number],
    bbox: [Number(bb[0].toFixed(4)), Number(bb[2].toFixed(4)), Number(bb[1].toFixed(4)), Number(bb[3].toFixed(4))] as [number, number, number, number]
  };
}

async function run() {
  const results = [];
  const failures = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let baseSlug = slugify(c.name);
    let displayName = c.name;
    if (existingIds.has(baseSlug)) {
      if (c.state === 'Hessen') {
        baseSlug = `${baseSlug}-hessen`;
        displayName = `${c.name} (Hessen)`;
      } else {
        baseSlug = `${baseSlug}-${slugify(c.kreis)}`;
      }
    }
    const shortName = makeShortName(c.name);

    const query = `${c.name}, ${c.kreis}, Deutschland`;
    console.log(`[${i + 1}/${candidates.length}] Geocoding: ${query}...`);
    let g = await geo(query);
    if (!g) {
      // fallback without kreis
      console.log(`  Retry with "${c.name}, Deutschland"...`);
      g = await geo(`${c.name}, Deutschland`);
    }

    if (g) {
      results.push({
        id: baseSlug,
        name: displayName,
        shortName,
        service: c.service,
        ort: c.ort,
        center: g.center,
        defaultZoom: 12,
        bbox: g.bbox
      });
      existingIds.add(baseSlug);
      console.log(`  ✓ ${displayName} (${baseSlug}) -> [${g.center}]`);
    } else {
      console.warn(`  ✗ Failed: ${c.name}`);
      failures.push(c);
    }

    await new Promise(r => setTimeout(r, 1050));
  }

  console.log(`\nFinished geocoding: ${results.length} succeeded, ${failures.length} failed.`);
  await Bun.write('scripts/fetchers/muellmax-cities.json', JSON.stringify(results, null, 2) + '\n');
  console.log('Saved to scripts/fetchers/muellmax-cities.json');
}

run();
