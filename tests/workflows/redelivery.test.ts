import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { getPool } from '../../lib/db';

const { Connection, Client, Worker } = Durable;
const QUEUE = 'test-redelivery';

// ─────────────────────────────────────────────────────────────────────────────
// At-least-once redelivery of orphaned reservations (hotmesh 0.25.6).
//
// A stream message reserved by a holder that dies is redelivered once its
// reservation lapses — previously it orphaned permanently. The flip side is
// that an activity mid-flight at process death RE-EXECUTES after restart, so
// activity side effects must tolerate duplicate execution.
//
// The lapse is simulated the way the SDK's own zombie suite does: backdate
// `reserved_at` past the claim window and wake the stream consumers. The
// assertions pin the contract long-tail relies on:
//   • the in-flight activity re-executes (side-effect counter reaches 2);
//   • the workflow still settles exactly once, with a coherent result.
// ─────────────────────────────────────────────────────────────────────────────

// ── side-effect counter + a deliberately slow activity ──────────────────────
let sideEffectCount = 0;

async function slowSideEffect(runId: string): Promise<string> {
  sideEffectCount++;
  // Hold the reservation long enough for the test to backdate it mid-flight
  // and for the stale-reservation discovery to redeliver while the original
  // execution is still running.
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  return `ok-${runId}`;
}

const { slowSideEffect: slowProxy } = Durable.workflow.proxyActivities<{
  slowSideEffect: typeof slowSideEffect;
}>({ activities: { slowSideEffect } });

export async function redeliveryExample(runId: string): Promise<{ data: string }> {
  const result = await slowProxy(runId);
  return { data: result };
}

// ── polling helper ───────────────────────────────────────────────────────────
async function until(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${label}`);
    await sleepFor(200);
  }
}

describe('orphaned reservation redelivery (durable)', () => {
  const connection = { class: Postgres, options: postgres_options };
  const workflowId = `redelivery-${Date.now()}`;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect(connection);
    await migrate();

    const worker = await Worker.create({
      connection,
      taskQueue: QUEUE,
      workflow: redeliveryExample,
    });
    await worker.run();
  }, 30_000);

  afterAll(async () => {
    await sleepFor(1_000);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 15_000);

  it('re-executes the in-flight activity after its reservation lapses, and the workflow settles once', async () => {
    sideEffectCount = 0;
    const client = new Client({ connection });
    const handle = await client.workflow.start({
      args: ['run-1'],
      taskQueue: QUEUE,
      workflowName: 'redeliveryExample',
      workflowId,
      expire: 300,
    });

    // 1. Wait for the activity to be mid-flight — its message is reserved.
    await until(() => sideEffectCount === 1, 15_000, 'activity to start executing');

    // 2. Simulate a dead holder: backdate the live reservation past any claim
    //    window and wake every worker-stream consumer holding rows for the jid.
    const pool = getPool();
    await pool.query(
      `UPDATE durable.worker_streams
       SET reserved_at = NOW() - INTERVAL '600 seconds', visible_at = NOW()
       WHERE jid = $1 AND expired_at IS NULL AND dead_lettered_at IS NULL`,
      [workflowId],
    );
    const topics = await pool.query(
      `SELECT DISTINCT stream_name FROM durable.worker_streams WHERE jid = $1`,
      [workflowId],
    );
    for (const row of topics.rows) {
      const channel = `wrk_${row.stream_name}`.substring(0, 63);
      await pool.query(`SELECT pg_notify($1, $2)`, [
        channel,
        JSON.stringify({ stream_name: row.stream_name, table_type: 'worker' }),
      ]);
    }

    // 3. At-least-once: the stale reservation redelivers and the activity
    //    re-executes. This is the behavior long-tail activities must tolerate.
    await until(() => sideEffectCount >= 2, 60_000, 'redelivery to re-execute the activity');

    // 4. Despite duplicate execution, the workflow settles exactly once with a
    //    coherent result (Leg2 collation dedupes the duplicate report).
    const final = await handle.result() as { data: string };
    expect(final.data).toBe('ok-run-1');
    expect(sideEffectCount).toBe(2);

    // 5. The backlog drains — no deliverable message remains for the jid.
    await sleepFor(2_000);
    const live = await pool.query(
      `SELECT COUNT(*)::int AS count FROM durable.worker_streams
       WHERE jid = $1 AND expired_at IS NULL AND dead_lettered_at IS NULL`,
      [workflowId],
    );
    expect(live.rows[0].count).toBe(0);
  }, 120_000);
});
