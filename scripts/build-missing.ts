/**
 * Build all cities that don't have data yet.
 */
import fs from 'fs';
import { spawn } from 'child_process';
import { FETCHERS } from './fetchers/index.ts';

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

function runGit(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`git ${args.join(' ')} failed with code ${code}`));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  let limit = Infinity;
  let autoCommit = false;
  let commitBatchSize = 25;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--commit') {
      autoCommit = true;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      commitBatchSize = parseInt(args[i + 1], 10);
      i++;
    }
  }

  while (true) {
    const existingDirs = new Set(
      fs.readdirSync('static/data')
        .filter((f) => fs.statSync(`static/data/${f}`).isDirectory())
    );
    existingDirs.add('karlsruhe');

    let missingCities = FETCHERS
      .filter((f) => !existingDirs.has(f.id))
      .map((f) => f.id);

    if (missingCities.length === 0) {
      console.log('All cities in FETCHERS are built! Nothing missing.');
      break;
    }

    if (limit < missingCities.length) {
      missingCities = missingCities.slice(0, limit);
    }

    console.log(`======================================================`);
    console.log(`Building ${missingCities.length} missing cities (AutoCommit: ${autoCommit}, Batch: ${commitBatchSize}).`);
    console.log(`======================================================\n`);

    let successCount = 0;
    let failCount = 0;
    const failures: string[] = [];
    const recentBuilt: string[] = [];

    for (let i = 0; i < missingCities.length; i++) {
      const cityId = missingCities[i];
      console.log(`\n------------------------------------------------------`);
      console.log(`[${i + 1}/${missingCities.length}] Processing: ${cityId}`);
      console.log(`------------------------------------------------------`);

      try {
        await runCommand(['scripts/build-cache.ts', cityId]);
        await runCommand(['scripts/refresh-data.ts', cityId]);
        successCount++;
        recentBuilt.push(cityId);
      } catch (e: any) {
        console.warn(`⚠️ First attempt failed for ${cityId}: ${e.message}. Retrying after 3s...`);
        await new Promise((r) => setTimeout(r, 3000));
        try {
          await runCommand(['scripts/build-cache.ts', cityId]);
          await runCommand(['scripts/refresh-data.ts', cityId]);
          successCount++;
          recentBuilt.push(cityId);
        } catch (retryErr: any) {
          console.error(`❌ Failed: ${cityId} - ${retryErr.message}`);
          failCount++;
          failures.push(cityId);
        }
      }

      // Check if we should auto-commit
      if (autoCommit && recentBuilt.length >= commitBatchSize) {
        try {
          const names = recentBuilt.slice(0, 5).join(', ') + (recentBuilt.length > 5 ? ` and ${recentBuilt.length - 5} more` : '');
          console.log(`\n📦 Auto-committing batch of ${recentBuilt.length} cities...`);
          await runGit(['add', 'data/', 'static/data/']);
          await runGit(['commit', '-m', `feat: complete data build for ${names}`]);
          console.log(`✓ Committed batch successfully.`);
          recentBuilt.length = 0;
        } catch (commitErr: any) {
          console.warn(`⚠️ Commit failed: ${commitErr.message}`);
        }
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    // Flush any remaining uncommitted cities
    if (autoCommit && recentBuilt.length > 0) {
      try {
        const names = recentBuilt.slice(0, 5).join(', ') + (recentBuilt.length > 5 ? ` and ${recentBuilt.length - 5} more` : '');
        console.log(`\n📦 Auto-committing final batch of ${recentBuilt.length} cities...`);
        await runGit(['add', 'data/', 'static/data/']);
        await runGit(['commit', '-m', `feat: complete data build for ${names}`]);
        console.log(`✓ Committed final batch successfully.`);
        recentBuilt.length = 0;
      } catch (commitErr: any) {
        console.warn(`⚠️ Commit failed: ${commitErr.message}`);
      }
    }

    console.log(`\n======================================================`);
    console.log(`Done batch! Success: ${successCount}, Failed: ${failCount}`);
    if (failures.length > 0) {
      console.log(`Failed cities: ${failures.join(', ')}`);
    }
    console.log(`======================================================`);
    break; // Complete current batch
  }
}

main().catch(console.error);
