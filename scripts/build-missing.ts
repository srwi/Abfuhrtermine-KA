/**
 * Build all cities that don't have data yet.
 */
import fs from 'fs';
import { spawn } from 'child_process';
import { FETCHERS } from './fetchers/index.ts';

async function runCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', args, { stdio: 'inherit', shell: true });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

async function main() {
  const existingDirs = new Set(
    fs.readdirSync('static/data')
      .filter((f) => fs.statSync(`static/data/${f}`).isDirectory())
  );
  existingDirs.add('karlsruhe');

  const missingCities = FETCHERS
    .filter((f) => !existingDirs.has(f.id))
    .map((f) => f.id);

  console.log(`======================================================`);
  console.log(`Building ${missingCities.length} missing cities.`);
  console.log(`======================================================\n`);

  let successCount = 0;
  let failCount = 0;
  const failures: string[] = [];

  for (let i = 0; i < missingCities.length; i++) {
    const cityId = missingCities[i];
    console.log(`\n------------------------------------------------------`);
    console.log(`[${i + 1}/${missingCities.length}] Processing: ${cityId}`);
    console.log(`------------------------------------------------------`);

    try {
      await runCommand(['scripts/build-cache.ts', cityId]);
      await runCommand(['scripts/refresh-data.ts', cityId]);
      successCount++;
    } catch (e: any) {
      console.warn(`⚠️ First attempt failed for ${cityId}: ${e.message}. Retrying after 3s...`);
      await new Promise((r) => setTimeout(r, 3000));
      try {
        await runCommand(['scripts/build-cache.ts', cityId]);
        await runCommand(['scripts/refresh-data.ts', cityId]);
        successCount++;
      } catch (retryErr: any) {
        console.error(`❌ Failed: ${cityId} - ${retryErr.message}`);
        failCount++;
        failures.push(cityId);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n======================================================`);
  console.log(`Done! Success: ${successCount}, Failed: ${failCount}`);
  if (failures.length > 0) {
    console.log(`Failed cities: ${failures.join(', ')}`);
  }
  console.log(`======================================================`);
}

main().catch(console.error);
