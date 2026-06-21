import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { efficientSignal } from '../../examples/workflows/efficient-signal';
import * as escalationService from '../../services/escalation';
import { eventRegistry } from '../../lib/events';
import { InMemoryEventAdapter } from '../../lib/events/memory';
import { systemEventsConfig } from '../../lib/events/system-events';
import type { LTEvent } from '../../types';

const { Connection, Client, Worker } = Durable;
const TASK_QUEUE = 'test-efficient-signal';

// ─────────────────────────────────────────────────────────────────────────────
// Efficient escalation (durable) — the atomic `condition(signalId, config)` path.
//
// Showcases the win over the legacy two-step (ltCreateEscalation + conditionLT):
//   • the escalation row is written inside the workflow's Leg1 checkpoint
//     (one atomic commit — no separate create activity);
//   • `system.escalation.{id}.created` fires from the worker engine (0.22.5);
//   • `client.escalations.resolve()` resumes THIS job in place — no re-run.
// ─────────────────────────────────────────────────────────────────────────────

describe('efficient escalation (durable condition path)', () => {
  let client: InstanceType<typeof Client>;
  let worker: Awaited<ReturnType<typeof Worker.create>>;
  let adapter: InMemoryEventAdapter;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectTelemetry();
    adapter = new InMemoryEventAdapter();
    eventRegistry.register(adapter);
    await eventRegistry.connect();

    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();

    const connection = { class: Postgres, options: postgres_options };
    worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: efficientSignal,
      events: systemEventsConfig, // efficient-path escalation events flow through the eventManager
    });
    await worker.run();

    client = new Client({ connection });
  }, 30_000);

  afterAll(async () => {
    if (createdIds.length) {
      const { getPool } = await import('../../lib/db');
      await getPool().query('DELETE FROM lt_escalations WHERE id = ANY($1::uuid[])', [createdIds]);
    }
    eventRegistry.clear();
    await sleepFor(500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 15_000);

  it('writes the escalation atomically, fires created, and resumes in place on resolve', async () => {
    const workflowId = `eff-sig-${Durable.guid()}`;
    const handle = await client.workflow.start({
      args: [{ data: { message: 'Approve the efficient way', role: 'reviewer' } }],
      taskQueue: TASK_QUEUE,
      workflowName: 'efficientSignal',
      workflowId,
      expire: 120,
    });

    // 1. The atomic Leg1 write surfaces a pending escalation, and the worker
    //    engine fires system.escalation.{id}.created through the eventManager.
    let createdEvt: LTEvent | undefined;
    for (let i = 0; i < 40 && !createdEvt; i++) {
      createdEvt = adapter.events.find(
        (e) => e.type.startsWith('system.escalation.')
          && e.type.endsWith('.created')
          && (e.data as any)?.metadata?.efficient === true,
      );
      if (!createdEvt) await sleepFor(250);
    }
    expect(createdEvt, 'system.escalation.*.created should fire from the efficient path').toBeTruthy();

    const escalationId = createdEvt!.escalationId!;
    createdIds.push(escalationId);
    expect(createdEvt!.status).toBe('pending');

    // 2. The row is real and queryable immediately (atomic, no enrich step).
    const esc = await escalationService.getEscalation(escalationId);
    expect(esc).toBeTruthy();
    expect(esc!.status).toBe('pending');
    expect(esc!.role).toBe('reviewer');
    expect(esc!.subtype).toBe('efficient');

    // 3. Resolve delivers the signal and resumes the SAME job — no re-run.
    const result = await escalationService.resolveEscalation(escalationId, { approved: true, notes: 'lgtm' });
    expect(result).toBeTruthy();
    expect(result!.status).toBe('resolved');

    const final = await handle.result() as { type: string; data: { approved: boolean; notes: string } };
    expect(final.data.approved).toBe(true);
    expect(final.data.notes).toBe('lgtm');
  }, 45_000);
});
