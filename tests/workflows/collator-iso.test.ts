import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import * as escalationService from '../../services/escalation';
import { conditionLT } from '../../services/orchestrator/condition';

const { Connection, Client, Worker } = Durable;

// A dedicated queue — the docker app container serves `long-tail-examples`, NOT this,
// so there are no competing workers and the engine version is purely the test's.
const QUEUE = 'collator-iso';

// ── a trivial activity ───────────────────────────────────────────────────────
async function noop(): Promise<string> {
  return 'ok';
}
const { noop: noopProxy } = Durable.workflow.proxyActivities<{ noop: typeof noop }>({
  activities: { noop },
});

// ── isolated workflows: vary ONE thing at a time ─────────────────────────────

/** A: Promise.all of two direct conditions, no preceding activity (Feature 19 shape). */
export async function isoParallel(): Promise<{ a: any; b: any }> {
  const [a, b] = await Promise.all([
    Durable.workflow.condition<any>('iso-a'),
    Durable.workflow.condition<any>('iso-b'),
  ]);
  return { a, b };
}

/** B: an activity FIRST, then the same Promise.all of two conditions (the broker's shape). */
export async function isoActThenParallel(): Promise<{ a: any; b: any }> {
  await noopProxy();
  const [a, b] = await Promise.all([
    Durable.workflow.condition<any>('iso-a'),
    Durable.workflow.condition<any>('iso-b'),
  ]);
  return { a, b };
}

/** C: serial baseline — two conditions one at a time, with a preceding activity. */
export async function isoActThenSerial(): Promise<{ a: any; b: any }> {
  await noopProxy();
  const a = await Durable.workflow.condition<any>('iso-a');
  const b = await Durable.workflow.condition<any>('iso-b');
  return { a, b };
}

/** D: activity, then Promise.all of N ESCALATION-bearing conditions, resolved via the
 *  escalation interface (the broker's actual harvest). Feature 22 proves ONE such
 *  collated condition; this proves N + the long-tail conditionLT wrapper. */
export async function isoActThenParallelEsc(role: string, sigA: string, sigB: string): Promise<{ a: any; b: any }> {
  await noopProxy();
  const [a, b] = await Promise.all([
    conditionLT<any>(sigA, { role, type: 'iso-esc', priority: 2, description: 'iso a', metadata: { k: sigA } }),
    conditionLT<any>(sigB, { role, type: 'iso-esc', priority: 2, description: 'iso b', metadata: { k: sigB } }),
  ]);
  return { a, b };
}

/** E: continueAsNew FIRST, then (in the continued execution) the Promise.all of conditions —
 *  the broker loops, so its waits live in a continued tick, not the first execution. */
export async function isoCanThenParallel(round: number, sigA: string, sigB: string): Promise<{ a: any; b: any }> {
  if (!round) {
    await Durable.workflow.sleep('1 second');
    await Durable.workflow.continueAsNew(1, sigA, sigB);
  }
  const [a, b] = await Promise.all([
    Durable.workflow.condition<any>(sigA),
    Durable.workflow.condition<any>(sigB),
  ]);
  return { a, b };
}

describe('collator isolation — what shape of Promise.all(condition) actually resumes', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    const connection = { class: Postgres, options: postgres_options };
    for (const workflow of [isoParallel, isoActThenParallel, isoActThenSerial, isoActThenParallelEsc, isoCanThenParallel]) {
      const worker = await Worker.create({ connection, taskQueue: QUEUE, workflow });
      await worker.run();
    }
    client = new Client({ connection });
  }, 45_000);

  afterAll(async () => {
    await sleepFor(300);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 20_000);

  async function run(workflowName: string, earlySignal: boolean) {
    const handle = await client.workflow.start({
      args: [],
      taskQueue: QUEUE,
      workflowName,
      workflowId: `${workflowName}-${earlySignal ? 'early' : 'late'}-${Durable.guid()}`,
      expire: 60,
    });
    if (!earlySignal) await sleepFor(2_000); // signal AFTER the waits register (Feature-19 timing)
    await handle.signal('iso-a', { v: 'a' });
    await handle.signal('iso-b', { v: 'b' });
    const result = (await handle.result()) as { a: any; b: any };
    expect(result.a).toEqual({ v: 'a' });
    expect(result.b).toEqual({ v: 'b' });
  }

  it('A — parallel conditions, signal LATE (baseline, no activity)', () => run('isoParallel', false), 20_000);
  it('A2 — parallel conditions, signal EARLY (no activity)', () => run('isoParallel', true), 20_000);
  it('B — activity THEN parallel conditions, signal LATE (broker shape)', () => run('isoActThenParallel', false), 20_000);
  it('B2 — activity THEN parallel conditions, signal EARLY (broker shape)', () => run('isoActThenParallel', true), 20_000);
  it('C — activity THEN serial conditions, signal EARLY (proven control)', () => run('isoActThenSerial', true), 20_000);

  it('D — activity THEN parallel ESCALATION conditions, resolved via escalations', async () => {
    const role = 'iso-role-' + Durable.guid();
    const sigA = 'iso-esc-a-' + Durable.guid();
    const sigB = 'iso-esc-b-' + Durable.guid();
    const handle = await client.workflow.start({
      args: [role, sigA, sigB], taskQueue: QUEUE, workflowName: 'isoActThenParallelEsc',
      workflowId: 'isoEsc-' + Durable.guid(), expire: 60,
    });
    await sleepFor(2_000);
    await escalationService.resolveEscalationBySignalKey(sigA, { v: 'a' });
    await escalationService.resolveEscalationBySignalKey(sigB, { v: 'b' });
    const result = (await handle.result()) as { a: any; b: any };
    expect(result.a).toEqual({ v: 'a' });
    expect(result.b).toEqual({ v: 'b' });
  }, 20_000);

  // Regression guard for the HotMesh 0.24.1 fix: the collator re-engages after continueAsNew,
  // so a Promise.all of conditions in a CONTINUED execution now resumes (it deadlocked on
  // 0.23.0 — the collator was tagged with the wrong replay dimension). This is what unblocks
  // the print-routing broker's parallel harvest.
  it('E — continueAsNew THEN parallel conditions (broker loops)', async () => {
    const sigA = 'iso-can-a-' + Durable.guid();
    const sigB = 'iso-can-b-' + Durable.guid();
    const handle = await client.workflow.start({
      args: [0, sigA, sigB], taskQueue: QUEUE, workflowName: 'isoCanThenParallel',
      workflowId: 'isoCan-' + Durable.guid(), expire: 60,
    });
    await sleepFor(3_000); // past the continueAsNew, into the continued tick's waits
    await handle.signal(sigA, { v: 'a' });
    await handle.signal(sigB, { v: 'b' });
    const result = (await handle.result()) as { a: any; b: any };
    expect(result.a).toEqual({ v: 'a' });
    expect(result.b).toEqual({ v: 'b' });
  }, 20_000);
});
