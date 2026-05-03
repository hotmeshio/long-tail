/**
 * Test 02 — Single Signal Round-Trip
 *
 * Proves the hook/signal pattern: trigger → worker → hook(pause) → done.
 * Uses raw HotMesh signal() to resume the hook. No escalations yet —
 * just proving the signal mechanism works.
 *
 * Usage:
 *   npx ts-node tests/throughput/02-signal.ts [count]
 */

import { Client } from 'pg';
import { HotMesh } from '@hotmeshio/hotmesh';
import { readFileSync } from 'fs';
import { join } from 'path';

import { postgres_options } from '../../modules/config';

const COUNT = parseInt(process.argv[2] || '1', 10);

function getConnection() {
  return { class: Client, options: postgres_options };
}

function sleepFor(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const connection = getConnection();

  const hotMesh = await HotMesh.init({
    appId: 'signal02',
    engine: { connection },
    workers: [{
      topic: 'signal02.signal.test',
      connection,
      callback: async (data) => ({
        metadata: { ...data.metadata },
        data: { orderId: (data.data as any)?.orderId, worked: true },
      }),
    }],
  });

  const yaml = readFileSync(join(__dirname, 'yaml/02-signal.yaml'), 'utf-8');
  await hotMesh.deploy(yaml);
  await hotMesh.activate('20');

  console.log(`02-signal | ${COUNT} workflow(s)\n`);

  let passed = 0;
  for (let n = 0; n < COUNT; n++) {
    const orderId = `signal-${n}-${Date.now()}`;
    const jobId = await hotMesh.pub('signal02.signal.test', { orderId });

    await sleepFor(1000);
    const before = await hotMesh.getStatus(jobId);

    await hotMesh.signal('signal02.signal.ack', { id: jobId, result: 'approved' });

    await sleepFor(1000);
    const after = await hotMesh.getStatus(jobId);

    const ok = before === 1 && after === 0;
    console.log(`  [${n}] ${ok ? '✓' : '✗'} before=${before} after=${after} jobId=${jobId}`);
    if (ok) passed++;
  }

  console.log(`\n${passed}/${COUNT} passed`);
  await hotMesh.stop();
  process.exit(passed === COUNT ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
