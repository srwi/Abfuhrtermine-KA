import { FETCHERS, getCityFetcher } from './fetchers/index.ts';
import { spawn } from 'child_process';

const TARGET_CITIES = [
  'recklinghausen',
  'minden',
  'paderborn',
  'ratingen',
  'salzgitter',
  'flensburg',
  'neumuenster',
  'wilhelmshaven',
  'bad-homburg',
  'neustadt'
];

async function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n>>> Running: bun ${args.join(' ')}`);
    const proc = spawn('bun', args, { stdio: 'inherit', shell: true });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

async function main() {
  const cities = process.argv.slice(2).length > 0 ? process.argv.slice(2) : TARGET_CITIES;
  console.log(`Starting automated build for ${cities.length} cities: ${cities.join(', ')}`);

  for (let i = 0; i < cities.length; i++) {
    const cityId = cities[i];
    console.log(`\n======================================================`);
    console.log(`[${i + 1}/${cities.length}] Processing city: ${cityId.toUpperCase()}`);
    console.log(`======================================================`);

    try {
      await runCommand('bun', ['scripts/build-cache.ts', cityId]);
      await runCommand('bun', ['scripts/refresh-data.ts', cityId]);
      console.log(`Successfully built data for ${cityId}`);
    } catch (err) {
      console.error(`Error building city ${cityId}:`, err);
    }
  }

  console.log('\nAll targeted cities processed!');
}

main();
