/**
 * Test 01 — Echo Throughput
 *
 * Baseline: how fast can HotMesh pub + execute + complete a minimal
 * single-worker YAML flow? No signals, no hooks. Pure engine throughput.
 *
 * Usage:
 *   npx ts-node tests/throughput/01-echo.ts [count] [concurrency]
 */

import { Client } from 'pg';
import { HotMesh } from '@hotmeshio/hotmesh';
import { readFileSync } from 'fs';
import { join } from 'path';
import http from 'http';

import { postgres_options } from '../../modules/config';

const COUNT = parseInt(process.argv[2] || '500', 10);
const CONCURRENCY = parseInt(process.argv[3] || '10', 10);

function getConnection() {
  return { class: Client, options: postgres_options };
}

function fetchJson(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${process.env.PORT || 3000}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    }).on('error', reject);
  });
}

async function main() {
  const connection = getConnection();

  const hotMesh = await HotMesh.init({
    appId: 'echo01',
    engine: { connection },
    workers: [{
      topic: 'echo01.echo',
      connection,
      callback: async (data) => ({
        metadata: { ...data.metadata },
        data: {
          message: (data.data as Record<string, unknown>)?.message || '',
          echoedAt: new Date().toISOString(),
        },
      }),
    }],
  });

  const yaml = readFileSync(join(__dirname, 'yaml/01-echo.yaml'), 'utf-8');
  await hotMesh.deploy(yaml);
  await hotMesh.activate('3');

  console.log(`01-echo | ${COUNT} workflows | concurrency=${CONCURRENCY}\n`);

  const t0 = performance.now();
  for (let i = 0; i < COUNT; i += CONCURRENCY) {
    const batch = Math.min(CONCURRENCY, COUNT - i);
    await Promise.all(
      Array.from({ length: batch }, (_, j) =>
        hotMesh.pub('echo01.echo', { message: `msg-${i + j}` }),
      ),
    );
  }
  const submitElapsed = (performance.now() - t0) / 1000;
  console.log(`Submitted: ${COUNT} in ${submitElapsed.toFixed(2)}s (${(COUNT / submitElapsed).toFixed(0)}/sec)`);

  console.log('Polling for completion...');
  for (let tick = 0; tick < 240; tick++) {
    await new Promise((r) => setTimeout(r, 500));
    const result = await fetchJson('/api/mcp-runs?app_id=echo01&limit=1&offset=0&status=running');
    const running = result?.total ?? 0;
    const elapsed = (performance.now() - t0) / 1000;
    process.stdout.write(`  running=${running}  ${elapsed.toFixed(1)}s\r`);
    if (running === 0) break;
  }

  const totalElapsed = (performance.now() - t0) / 1000;
  console.log(`\n\nResults:`);
  console.log(`  Submitted:  ${COUNT} in ${submitElapsed.toFixed(2)}s (${(COUNT / submitElapsed).toFixed(0)}/sec)`);
  console.log(`  All done:   ${totalElapsed.toFixed(2)}s (${(COUNT / totalElapsed).toFixed(0)}/sec e2e)`);
  console.log(`  Avg e2e:    ${((totalElapsed / COUNT) * 1000).toFixed(1)}ms per workflow`);

  await hotMesh.stop();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
