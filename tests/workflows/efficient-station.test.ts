import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { efficientStation } from '../../examples/workflows/efficient-station';
import * as escalationService from '../../services/escalation';
import * as escalationApi from '../../api/escalations';
import * as userService from '../../services/user';
import { eventRegistry } from '../../lib/events';
import { InMemoryEventAdapter } from '../../lib/events/memory';
import { systemEventsConfig } from '../../lib/events/system-events';
import type { LTEscalationRecord } from '../../types';

const { Connection, Client, Worker } = Durable;
const TASK_QUEUE = 'test-efficient-station';

// ─────────────────────────────────────────────────────────────────────────────
// Efficient station (conditionLT atomic path) — the migration target for the
// two-step station workers in the reference app and the boilerplate ortho pipeline.
//
// Proves the long-tail surface that makes the one-line opt-in work end-to-end:
//   • conditionLT(signalId, config) writes the escalation in Leg1 (signal_key set);
//   • the dashboard path (api.resolveEscalation by id → Path 0) resumes in place;
//   • the webhook path (api.resolveBySignalKey) resumes in place;
//   • created/resolved system events fire through the eventManager.
// Resolution is exercised through the REAL orchestrator — not a test double —
// because that is exactly what the dashboard "Resolve" button calls.
// ─────────────────────────────────────────────────────────────────────────────

describe('efficient station (conditionLT atomic path)', () => {
  let client: InstanceType<typeof Client>;
  let worker: Awaited<ReturnType<typeof Worker.create>>;
  let adapter: InMemoryEventAdapter;
  let operatorId: string;
  const createdIds: string[] = [];

  /** Poll until the atomic Leg1 escalation row surfaces, keyed by signal_key. */
  async function waitForEscalation(signalKey: string, ms = 12_000): Promise<LTEscalationRecord> {
    const deadline = Date.now() + ms;
    for (;;) {
      const esc = await escalationService.getEscalationBySignalKey(signalKey);
      if (esc) return esc;
      if (Date.now() >= deadline) throw new Error(`escalation for ${signalKey} never appeared`);
      await sleepFor(250);
    }
  }

  beforeAll(async () => {
    await connectTelemetry();
    adapter = new InMemoryEventAdapter();
    eventRegistry.register(adapter);
    await eventRegistry.connect();

    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();

    const user = await userService.createUser({
      external_id: `eff-station-${Date.now()}`,
      email: 'eff-station@example.com',
      roles: [{ role: 'operator', type: 'member' }],
    });
    operatorId = user.id;

    const connection = { class: Postgres, options: postgres_options };
    worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: efficientStation,
      events: systemEventsConfig,
    });
    await worker.run();

    client = new Client({ connection });
  }, 30_000);

  afterAll(async () => {
    if (createdIds.length) {
      const { getPool } = await import('../../lib/db');
      await getPool().query('DELETE FROM lt_escalations WHERE id = ANY($1::uuid[])', [createdIds]);
    }
    await userService.deleteUser(operatorId);
    eventRegistry.clear();
    await sleepFor(500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 15_000);

  it('dashboard path: resolve by id (Path 0) resumes the same job in place', async () => {
    const workflowId = `eff-station-dash-${Durable.guid()}`;
    const signalKey = `station-done-${workflowId}`;
    const handle = await client.workflow.start({
      args: [{ data: { stationName: 'qc', role: 'operator', instructions: 'Inspect', orderId: 'order-1' } }],
      taskQueue: TASK_QUEUE,
      workflowName: 'efficientStation',
      workflowId,
      expire: 120,
    });

    // 1. Atomic Leg1 write — the row is real, keyed by signal_key, no enrich step.
    const esc = await waitForEscalation(signalKey);
    createdIds.push(esc.id);
    expect(esc.signal_key).toBe(signalKey);
    expect(esc.status).toBe('pending');
    expect(esc.role).toBe('operator');
    expect(esc.subtype).toBe('qc');
    expect(esc.workflow_type).toBe('efficientStation');

    // 2. created fired from the engine through the eventManager.
    let created = false;
    for (let i = 0; i < 20 && !created; i++) {
      created = adapter.events.some(
        (e) => e.escalationId === esc.id && e.type.endsWith('.created'),
      );
      if (!created) await sleepFor(200);
    }
    expect(created, 'system.escalation.*.created should fire').toBe(true);

    // 3. Resolve through the REAL orchestrator by id — the dashboard's path.
    const result = await escalationApi.resolveEscalation(
      { id: esc.id, resolverPayload: { approved: true, notes: 'ok' } },
      { userId: operatorId },
    );
    expect(result.status).toBe(200);
    expect((result.data as any)?.signaled).toBe(true);

    // 4. The SAME job resumes in place (no re-run) and returns the resolver payload.
    const final = await handle.result() as { data: { resolution: { approved: boolean; notes: string } } };
    expect(final.data.resolution.approved).toBe(true);
    expect(final.data.resolution.notes).toBe('ok');

    // 5. resolved fired.
    const resolved = await escalationService.getEscalation(esc.id);
    expect(resolved!.status).toBe('resolved');
  }, 45_000);

  it('webhook path: resolveBySignalKey resumes the same job in place', async () => {
    const workflowId = `eff-station-hook-${Durable.guid()}`;
    const signalKey = `station-done-${workflowId}`;
    const handle = await client.workflow.start({
      args: [{ data: { stationName: 'print', role: 'operator', instructions: 'Print', orderId: 'order-2' } }],
      taskQueue: TASK_QUEUE,
      workflowName: 'efficientStation',
      workflowId,
      expire: 120,
    });

    const esc = await waitForEscalation(signalKey);
    createdIds.push(esc.id);
    expect(esc.signal_key).toBe(signalKey);

    // Webhook knows the deterministic signal_key — resolve without an id lookup.
    const result = await escalationApi.resolveBySignalKey(
      { signalKey, resolverPayload: { approved: true, printerId: 'bambu-3' } },
      { userId: operatorId },
    );
    expect(result.status).toBe(200);
    expect((result.data as any)?.signaled).toBe(true);

    const final = await handle.result() as { data: { resolution: { approved: boolean; printerId: string } } };
    expect(final.data.resolution.approved).toBe(true);
    expect(final.data.resolution.printerId).toBe('bambu-3');

    const resolved = await escalationService.getEscalation(esc.id);
    expect(resolved!.status).toBe('resolved');
  }, 45_000);

  it('webhook path: unknown signal_key returns 404 (fail-loud, no silent success)', async () => {
    const result = await escalationApi.resolveBySignalKey(
      { signalKey: `station-done-does-not-exist-${Durable.guid()}`, resolverPayload: { approved: true } },
      { userId: operatorId },
    );
    expect(result.status).toBe(404);
  }, 15_000);
});
