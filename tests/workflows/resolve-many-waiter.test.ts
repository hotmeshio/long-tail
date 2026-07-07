import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { efficientSignal } from '../../examples/workflows/efficient-signal';
import * as escalationService from '../../services/escalation';

const { Connection, Client, Worker } = Durable;
const TASK_QUEUE = 'test-resolve-many-waiter';

// ─────────────────────────────────────────────────────────────────────────────
// Bulk sweeps × a LIVE `condition()` waiter (hotmesh 0.25.6).
//
// A workflow parked on `condition(signalId, config)` is backed by an
// escalation row with `signal_key` set. Bulk resolution is UPDATE-only — it
// cannot deliver the waiter's wake — so the store excludes waiter rows from
// `resolveMany`: they stay `pending`, drop out of the return set, and the
// parked workflow keeps sleeping until a targeted `resolve()` carries the
// wake. This pins the full lifecycle through the public service surface:
// sweep skips the waiter → row still pending, job still running → targeted
// resolve settles the row AND resumes the job in place.
// ─────────────────────────────────────────────────────────────────────────────

describe('bulk sweeps skip a live condition() waiter (durable)', () => {
  let client: InstanceType<typeof Client>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();

    const connection = { class: Postgres, options: postgres_options };
    const worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: efficientSignal,
    });
    await worker.run();

    client = new Client({ connection });
  }, 30_000);

  afterAll(async () => {
    if (createdIds.length) {
      const { getPool } = await import('../../lib/db');
      await getPool().query('DELETE FROM lt_escalations WHERE id = ANY($1::uuid[])', [createdIds]);
    }
    await sleepFor(500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 15_000);

  it('a bulk resolve over the waiter leaves the job parked; the targeted resolve wakes it', async () => {
    const workflowId = `rm-waiter-${Durable.guid()}`;
    const handle = await client.workflow.start({
      args: [{ data: { message: 'Sweep must not settle me', role: 'reviewer' } }],
      taskQueue: TASK_QUEUE,
      workflowName: 'efficientSignal',
      workflowId,
      expire: 120,
    });

    // 1. The atomic Leg1 write surfaces the waiter row (signal_key = signalId).
    const signalKey = `approval-${workflowId}`;
    let waiter: Awaited<ReturnType<typeof escalationService.getEscalationBySignalKey>> = null;
    for (let i = 0; i < 40 && !waiter; i++) {
      waiter = await escalationService.getEscalationBySignalKey(signalKey);
      if (!waiter) await sleepFor(250);
    }
    expect(waiter, 'the condition() escalation row should appear').toBeTruthy();
    createdIds.push(waiter!.id);
    expect(waiter!.status).toBe('pending');

    // 2. Bulk paths exclude the waiter: nothing settles, nothing enters triage.
    const swept = await escalationService.resolveEscalationsByIds(
      [waiter!.id],
      { swept: true },
    );
    expect(swept).toEqual([]);

    const triaged = await escalationService.bulkResolveForTriage([waiter!.id]);
    expect(triaged).toEqual([]);

    const afterSweep = await escalationService.getEscalation(waiter!.id);
    expect(afterSweep!.status).toBe('pending');

    // 3. The job is still parked — the sweep neither woke nor orphaned it.
    //    The targeted resolve settles the row and resumes the SAME job.
    const resolved = await escalationService.resolveEscalation(
      waiter!.id,
      { approved: true, notes: 'targeted' },
    );
    expect(resolved).toBeTruthy();
    expect(resolved!.status).toBe('resolved');

    const final = await handle.result() as { data: { approved: boolean; notes: string } };
    expect(final.data.approved).toBe(true);
    expect(final.data.notes).toBe('targeted');
  }, 60_000);
});
