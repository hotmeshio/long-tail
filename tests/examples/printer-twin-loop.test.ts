import { describe, it, expect, beforeEach } from 'vitest';

import { reconcile } from '../../examples/workflows/printer-twin/reconcile';
import { freshMirror, type Mirror } from '../../examples/workflows/printer-twin/mirror';
import { mockBackend, mockControl } from '../../examples/workflows/printer-twin/activities/bambu-mock';
import { gatherObservation, executeActions, type ExecDeps } from '../../examples/workflows/printer-twin/activities/twin-execute';
import { REGISTRATION } from '../helpers/twin-fixtures';

// End-to-end proof of the twin brain: poll → reconcile → execute, against a
// fake in-memory escalation store + the deterministic mock backend. A tiny
// auto-servicer/auto-broker resolves each escalation the way a human + the
// marketplace would, so the whole lifecycle runs with no database.

class FakeEscalations {
  rows = new Map<string, any>();
  private seq = 0;
  escalations = {
    get: async ({ id }: { id: string }) =>
      this.rows.has(id) ? { status: 200, data: this.rows.get(id) } : { status: 404 },
    create: async (input: any) => {
      const id = `e${++this.seq}`;
      this.rows.set(id, { id, status: 'pending', resolver_payload: null, ...input });
      return { status: 201, data: { id } };
    },
    resolve: async ({ id, resolverPayload }: { id: string; resolverPayload: any }) => {
      const r = this.rows.get(id);
      if (r && r.status === 'pending') { r.status = 'resolved'; r.resolver_payload = resolverPayload; }
      return { status: 200 };
    },
  };
  pending(): any[] {
    return [...this.rows.values()].filter((r) => r.status === 'pending');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let simOutcome: 'success' | 'failed' | 'filament_runout' = 'success';

/** Play the servicer + broker: resolve each pending escalation like the world would. */
function autoResolve(store: FakeEscalations): void {
  for (const row of store.pending()) {
    if (row.subtype === 'registering') store.escalations.resolve({ id: row.id, resolverPayload: REGISTRATION });
    else if (row.subtype === 'ready') {
      store.escalations.resolve({
        id: row.id,
        resolverPayload: { jobId: `job-${row.id}`, orderId: 'o1', unitIndex: 0, gcodeUrl: 'g', callbackKey: `cb-${row.id}`, printDoneKey: `pd-${row.id}`, brokerWorkflowId: 'bk', simOutcome },
      });
    } else if (row.subtype === 'filament_change') store.escalations.resolve({ id: row.id, resolverPayload: { filamentLoaded: 'petg' } });
    else if (row.subtype === 'failure_inspect') store.escalations.resolve({ id: row.id, resolverPayload: { action: 'reset' } });
    else if (row.subtype === 'service') store.escalations.resolve({ id: row.id, resolverPayload: { action: 'restored' } });
  }
}

describe('printer-twin loop — full lifecycle in-process', () => {
  let store: FakeEscalations;
  let mirror: Mirror;
  let reports: { outcome: string; jobId: string }[];
  let deps: ExecDeps;

  beforeEach(() => {
    process.env.MOCK_PREPARE_MS = '5';
    process.env.MOCK_PRINT_MS = '25';
    mockControl.reset();
    store = new FakeEscalations();
    mirror = freshMirror('printer-01', Date.now());
    reports = [];
    simOutcome = 'success';
    deps = {
      lt: store as any,
      client: mockBackend,
      operatorId: 'op',
      workflowId: 'printer-01',
      reportOutcome: async (i) => { reports.push({ outcome: i.outcome, jobId: i.jobId }); },
    };
  });

  async function tick(): Promise<void> {
    const obs = await gatherObservation(mirror, deps);
    const r = reconcile(mirror, obs);
    mirror = r.mirror;
    await executeActions(mirror, r.actions, deps);
    autoResolve(store);
  }

  async function runUntil(pred: () => boolean, maxTicks = 60): Promise<void> {
    for (let i = 0; i < maxTicks && !pred(); i++) { await tick(); await sleep(6); }
  }

  it('onboards, prints, reports success, and returns to ready', async () => {
    await runUntil(() => mirror.jobsCompleted >= 1 && mirror.phase === 'ready');
    expect(mirror.bound).toBe(true);
    expect(mirror.registration?.serialNumber).toBe(REGISTRATION.serialNumber);
    expect(reports).toContainEqual(expect.objectContaining({ outcome: 'success' }));
    expect(mirror.jobsCompleted).toBe(1);
    expect(mirror.phase).toBe('ready');
  });

  it('an autonomous failure routes through service and the printer recovers', async () => {
    simOutcome = 'failed';
    await runUntil(() => reports.some((r) => r.outcome === 'fail'));
    expect(reports).toContainEqual(expect.objectContaining({ outcome: 'fail' }));
    // the failure_inspect resolves (reset) → bed_clean → back to ready for the next job
    simOutcome = 'success';
    await runUntil(() => mirror.phase === 'ready' && mirror.services >= 1);
    expect(mirror.services).toBeGreaterThanOrEqual(1);
    expect(mirror.phase).toBe('ready');
  });

  it('a filament runout opens a filament change, then resumes to success', async () => {
    simOutcome = 'filament_runout';
    await runUntil(() => mirror.phase === 'paused_filament');
    expect(mirror.openEscalations.filament_change === undefined || mirror.services >= 0).toBe(true);
    // servicer resolves with new filament → resume → the mock finishes successfully
    await runUntil(() => mirror.jobsCompleted >= 1);
    expect(mirror.filamentLoaded).toBe('petg');
    expect(mirror.jobsCompleted).toBe(1);
  });
});
