import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { join } from 'path';
import { Durable, HotMesh } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { getEngine } from '../../services/yaml-workflow/deployer';
import * as escalationService from '../../services/escalation';
import { eventRegistry } from '../../lib/events';
import { InMemoryEventAdapter } from '../../lib/events/memory';
import type { LTEvent } from '../../types';

const { Connection } = Durable;
const APP_ID = 'longtail-eff-factory';

// ─────────────────────────────────────────────────────────────────────────────
// Efficient escalation (YAML/DAG) — a factory station as ONE hook with an
// `escalation:` block, the atomic-Leg1 variant of a 04-factory station.
//
// Legacy station = 3 activities (escalate worker + hook + resolve worker).
// Efficient station = 1 hook: its Leg1 transaction writes the escalation row
// atomically with the job checkpoint, `system.escalation.{id}.created` fires
// from the engine through the eventManager, and a signal to the hook topic
// resumes the workflow. Never replaces 04-factory — sits beside it.
// ─────────────────────────────────────────────────────────────────────────────

describe('efficient escalation (YAML hook escalation: block)', () => {
  let engine: Awaited<ReturnType<typeof getEngine>>;
  let adapter: InMemoryEventAdapter;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectTelemetry();
    adapter = new InMemoryEventAdapter();
    eventRegistry.register(adapter);
    await eventRegistry.connect();

    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();

    // HotMesh deploy resolves a YAML file path (the comments break content-detection).
    engine = await getEngine(APP_ID);
    await engine.deploy(join(__dirname, 'yaml/factory-efficient.yaml') as any);
    await engine.activate('1');
  }, 30_000);

  afterAll(async () => {
    if (createdIds.length) {
      const { getPool } = await import('../../lib/db');
      await getPool().query('DELETE FROM lt_escalations WHERE id = ANY($1::uuid[])', [createdIds]);
    }
    eventRegistry.clear();
    try { engine.stop(); } catch { /* already stopped */ }
    await sleepFor(500);
    await Durable.shutdown();
    await HotMesh.stop();
    await disconnectTelemetry();
  }, 15_000);

  it('one hook writes the escalation atomically, fires created, and resumes on signal', async () => {
    const orderId = `EFF-${Durable.guid()}`;
    let completion: any = null;

    const jobId = await engine.pub('eff_factory', { orderId });
    expect(jobId).toBeTruthy();
    await engine.sub(`eff_factory.done.${jobId}`, (_t: string, msg: any) => { completion = msg; });

    // 1. The hook's Leg1 wrote the escalation atomically — queryable immediately,
    //    no escalate worker, no resolve worker.
    let esc: any = null;
    for (let i = 0; i < 40 && !esc; i++) {
      const found = await escalationService.getEscalationsByWorkflowId(jobId);
      esc = found.find((e) => e.subtype === 'qc');
      if (!esc) await sleepFor(250);
    }
    expect(esc, 'hook escalation: block should create a pending escalation').toBeTruthy();
    createdIds.push(esc.id);
    expect(esc.status).toBe('pending');
    expect(esc.role).toBe('qc_inspector');
    expect(esc.type).toBe('factory-station');
    expect(esc.metadata).toMatchObject({ orderId, station: 'qc' });

    // 2. created fired from the YAML engine through the eventManager.
    const createdEvt = adapter.events.find(
      (e: LTEvent) => e.type === `system.escalation.${esc.id}.created`,
    );
    expect(createdEvt, 'system.escalation.*.created should fire from the YAML engine').toBeTruthy();

    // 3. Claim, then signal the hook topic → workflow resumes and completes.
    await escalationService.claimEscalation(esc.id, 'qc-bot', 5);
    await engine.signal('eff_factory.qc.resolved', { id: jobId, approved: true });

    for (let i = 0; i < 30 && !completion; i++) await sleepFor(300);
    await engine.unsub(`eff_factory.done.${jobId}`);
    expect(completion, 'workflow should resume and complete after the signal').toBeTruthy();
    expect(completion.data?.approved).toBe(true);
  }, 45_000);
});
