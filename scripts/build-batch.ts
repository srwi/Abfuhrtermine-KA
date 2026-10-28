import fs from 'fs';
import { spawn } from 'child_process';
import jumoCities from './fetchers/jumomind-cities.json' with { type: 'json' };

async function runCommand(args: string[]): Promise<void> {
  const isBun = Boolean((process.versions as any).bun);
  const runtime = isBun ? 'bun' : process.execPath;
  const runtimeArgs = isBun ? [] : ['--experimental-strip-types'];
  return new Promise((resolve, reject) => {
    const proc = spawn(runtime, [...runtimeArgs, ...args], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

async function main() {
  const customArgs = process.argv.slice(2);
  let targetCities: string[] = [];

  if (customArgs.length > 0 && customArgs[0] !== 'all' && customArgs[0] !== 'remaining') {
    targetCities = customArgs;
  } else {
    // Automatically find all JumoMind cities that don't have static/data/<id>/street-data.json yet
    const existingDirs = new Set(
      fs
        .readdirSync('static/data')
        .filter((f) => fs.statSync(`static/data/${f}`).isDirectory())
    );
    existingDirs.add('karlsruhe');

    targetCities = jumoCities
      .filter((c) => !existingDirs.has(c.id))
      .map((c) => c.id);
  }

  console.log(`======================================================`);
  console.log(`Starting automated batch processing for ${targetCities.length} cities.`);
  console.log(`======================================================\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < targetCities.length; i++) {
    const cityId = targetCities[i];
    console.log(`\n------------------------------------------------------`);
    console.log(`[${i + 1}/${targetCities.length}] Processing city: ${cityId}`);
    console.log(`------------------------------------------------------`);

    try {
      await runCommand(['scripts/build-cache.ts', cityId]);
      await runCommand(['scripts/refresh-data.ts', cityId]);
      successCount++;
      console.log(`✓ Completed ${cityId} (${successCount} succeeded, ${failCount} failed)`);
    } catch (err) {
      failCount++;
      console.error(`✗ Error processing ${cityId}:`, err);
    }
  }

  console.log(`\n======================================================`);
  console.log(`Batch build complete! Succeeded: ${successCount}, Failed: ${failCount}`);
  console.log(`======================================================`);
}

main();
