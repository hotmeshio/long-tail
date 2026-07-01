import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { orthoPipeline } from '../../examples/workflows/ortho-pipeline';
import { ORTHO_STAGES } from '../../examples/workflows/ortho-pipeline/types';
import * as escalationService from '../../services/escalation';
import * as escalationApi from '../../api/escalations';
import * as userService from '../../services/user';
import { eventRegistry } from '../../lib/events';
import { InMemoryEventAdapter } from '../../lib/events/memory';
import { systemEventsConfig } from '../../lib/events/system-events';
import type { LTEscalationRecord } from '../../types';

const { Connection, Client, Worker } = Durable;
const TASK_QUEUE = 'test-ortho-pipeline';

// ─────────────────────────────────────────────────────────────────────────────
// Ortho pipeline — 8-stage manufacturing workflow integration test.
//
// Simulates the boilerplate's `ortho:run` bash script loop in TypeScript:
//   1. Start the workflow
//   2. For each stage: poll for escalation by signal_key, resolve with stage data
//   3. Assert the workflow completes with all 8 stage results
//
// Each stage uses Durable.workflow.condition() — atomic Leg1 write + suspend.
// Resolving via escalationApi fires the signal and resumes in place.
// ─────────────────────────────────────────────────────────────────────────────

describe('ortho pipeline (8-stage Leg1 condition loop)', () => {
  let client: InstanceType<typeof Client>;
  let worker: Awaited<ReturnType<typeof Worker.create>>;
  let operatorId: string;
  const createdIds: string[] = [];

  /** Poll until the Leg1 escalation row surfaces for this signal_key. */
  async function waitForEscalation(signalKey: string, ms = 15_000): Promise<LTEscalationRecord> {
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
    const adapter = new InMemoryEventAdapter();
    eventRegistry.register(adapter);
    await eventRegistry.connect();

    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();

    // type:'superadmin' on any role grants global escalation access via isSuperAdmin().
    const user = await userService.createUser({
      external_id: `ortho-test-${Date.now()}`,
      email: 'ortho-test@example.com',
      roles: [{ role: 'superadmin', type: 'superadmin' }],
    });
    operatorId = user.id;

    const connection = { class: Postgres, options: postgres_options };
    worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: orthoPipeline,
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

  it('drives all 8 stages: each condition() creates an escalation, resolve resumes workflow, result has 8 entries', async () => {
    const workflowId = `ortho-test-${Durable.guid()}`;
    const orderId = 'TEST-ORDER-001';
    const itemType = 'insole-standard';

    const handle = await client.workflow.start({
      args: [{
        data: { order_id: orderId, item_type: itemType },
        metadata: { source: 'test' },
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'orthoPipeline',
      workflowId,
      expire: 300,
    });

    // Drive through all 8 stages in order — same loop the boilerplate bash script runs.
    for (const stage of ORTHO_STAGES) {
      const signalKey = `ortho-${stage}-${workflowId}`;

      const esc = await waitForEscalation(signalKey);
      createdIds.push(esc.id);

      expect(esc.signal_key).toBe(signalKey);
      expect(esc.status).toBe('pending');
      expect(esc.role).toBe(stage);
      expect(esc.type).toBe('ortho-stage');
      expect(esc.subtype).toBe(stage);

      const resolution = buildStageResolution(stage, orderId);
      const result = await escalationApi.resolveEscalation(
        { id: esc.id, resolverPayload: resolution },
        { userId: operatorId },
      );
      expect(result.status).toBe(200);
      expect((result.data as any)?.signaled).toBe(true);
    }

    // All 8 stages resolved — workflow should complete.
    const final = await handle.result() as {
      data: { order_id: string; item_type: string; results: Array<{ stage: string; completed_at: string; resolution: Record<string, unknown> }> };
    };

    expect(final.data.order_id).toBe(orderId);
    expect(final.data.item_type).toBe(itemType);
    expect(final.data.results).toHaveLength(8);

    const stageNames = final.data.results.map((r) => r.stage);
    expect(stageNames).toEqual([...ORTHO_STAGES]);

    for (const r of final.data.results) {
      expect(r.completed_at).toBeTruthy();
      expect(typeof r.resolution).toBe('object');
    }
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Minimal valid resolution payloads for each stage (matching form_schema required fields).
// ─────────────────────────────────────────────────────────────────────────────

function buildStageResolution(stage: string, orderId: string): Record<string, unknown> {
  const base = { order_id: orderId };
  switch (stage) {
    case 'design':  return { ...base, spec_version: 'v1', arch_type: 'standard' };
    case 'review':  return { ...base, approved: true };
    case 'print':   return { ...base, filament_type: 'pla' };
    case 'grind':   return { ...base, alignment_ok: true };
    case 'glue':    return { ...base, adhesive_type: 'contact', bond_verified: true };
    case 'finish':  return { ...base, surface_quality: 'good', edge_condition: 'smooth' };
    case 'qa':      return { ...base, passed: true };
    case 'ship':    return { ...base, carrier: 'fedex', tracking_number: 'TEST-TRACK-001' };
    default:        return base;
  }
}
