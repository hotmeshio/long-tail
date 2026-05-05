/**
 * Test 03 — Signal Chain (3 Stations)
 *
 * Proves sequential human stations: each station is escalate → wait → resolve.
 * Uses raw HotMesh signals (not real escalations). Builds confidence that
 * chained hooks resume correctly before adding real MCP tools.
 *
 * Usage:
 *   npx ts-node tests/throughput/03-chain.ts [count]
 */

import { Client } from 'pg';
import { HotMesh } from '@hotmeshio/hotmesh';
import { readFileSync } from 'fs';
import { join } from 'path';

import { postgres_options } from '../../modules/config';

const COUNT = parseInt(process.argv[2] || '1', 10);
const SIGNAL_TOPICS = ['chain03.chain.ack1', 'chain03.chain.ack2', 'chain03.chain.ack3'];

function getConnection() {
  return { class: Client, options: postgres_options };
}

function sleepFor(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const connection = getConnection();

  const hotMesh = await HotMesh.init({
    appId: 'chain03',
    engine: { connection },
    workers: [{
      topic: 'chain03.chain.test',
      connection,
      callback: async (data) => {
        const input = data.data as Record<string, unknown>;
        return {
          metadata: { ...data.metadata },
          data: {
            step: input.step,
            station: input.station || null,
            orderId: input.orderId,
            ack: input.ack || null,
            completedAt: new Date().toISOString(),
          },
        };
      },
    }],
  });

  const yaml = readFileSync(join(__dirname, 'yaml/03-chain.yaml'), 'utf-8');
  await hotMesh.deploy(yaml);
  await hotMesh.activate('21');

  console.log(`03-chain | ${COUNT} workflow(s) × 3 stations\n`);
  const t0 = performance.now();
  let passed = 0;

  for (let n = 0; n < COUNT; n++) {
    const orderId = `chain-${n}-${Date.now()}`;
    const jobId = await hotMesh.pub('chain03.chain.test', { orderId });

    for (let s = 0; s < SIGNAL_TOPICS.length; s++) {
      await sleepFor(500);
      await hotMesh.signal(SIGNAL_TOPICS[s], {
        id: jobId,
        ack: `${jobId}-station${s + 1}`,
      });
    }

    await sleepFor(1000);
    const status = await hotMesh.getStatus(jobId);
    const ok = status === 0;
    console.log(`  [${n}] ${ok ? '✓' : '✗'} status=${status}`);
    if (ok) passed++;
  }

  const elapsed = (performance.now() - t0) / 1000;
  console.log(`\n${passed}/${COUNT} passed in ${elapsed.toFixed(1)}s`);
  await hotMesh.stop();
  process.exit(passed === COUNT ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
