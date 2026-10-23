import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Durable } from '@hotmeshio/hotmesh';

import * as escalationApi from '../../api/escalations';
import { lineSteps } from '../../examples/workflows/machine-line/workflows/route';
import { DECISION, HANDOFF_ERROR, signalKeys } from '../../services/machines/contracts';
import { OP } from '../../lib/machines/protocol';
import { eventually, startWorkflowRig, type WorkflowRig } from '../helpers/machine-line-workflow-rig';

// A move that times out after only some of its units arrived leaves them split
// between two stations. The platform reports which units arrived and leaves the
// receiver's started job alone; this workflow's policy stops that job and has a
// person collect each group where it stopped.

let rig: WorkflowRig;
beforeAll(async () => {
  rig = await startWorkflowRig({ taskQueue: 'test-machine-route-partial' });
}, 60_000);
afterAll(async () => rig?.stop(), 20_000);

describe('machine unit route: a partial arrival', () => {
  /** Two units leave the press; one stalls on the way, so the handoff into cut-01 times out with one arrival. */
  async function split(routeKey: string) {
    rig.harness.line.armTransfer('press-01', { fault: 'stall' });
    const handle = await rig.start(routeKey, ['Q1', 'Q2'], { steps: lineSteps(rig.line), handoffTimeout: '8s' });
    const decide = await rig.rowBySignal(signalKeys.handoffError(routeKey, 1, 1), 30_000);
    return { handle, decide };
  }

  const decideAs = (id: string, decision: string, note: string) =>
    escalationApi.resolveEscalation({ id, resolverPayload: { decision, note } }, { userId: rig.personId });

  it('the operator row names the arrival as data and offers no retry; scrap stops the receiver\'s job and ends the route', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    const { handle, decide } = await split(routeKey);
    expect(decide).toMatchObject({ role: 'line-operator', subtype: HANDOFF_ERROR.PARTIAL_ARRIVAL });
    expect((decide.metadata as any).decisions).toEqual([DECISION.MANUAL, DECISION.SCRAP]);
    expect((decide.metadata as any).detail).toMatch(/^Q[12] arrived; the rest did not before the timeout$/);

    expect((await decideAs(decide.id, DECISION.SCRAP, 'split')).status).toBe(200);
    const final = await handle.result() as { data: Record<string, any> };
    expect(final.data).toMatchObject({ status: 'scrapped', at: 'press-01', note: 'split' });
    const [hop] = final.data.history.filter((h: any) => h.to === 'cut-01');
    expect(hop).toMatchObject({ attempt: 1, received: false, errorCode: HANDOFF_ERROR.PARTIAL_ARRIVAL });
    expect([...hop.arrived, ...hop.missing].sort()).toEqual(['Q1', 'Q2']);

    const stop = await rig.rowBySignal(signalKeys.jobStop(routeKey, 1, 1));
    expect(stop).toMatchObject({ type: 'machine-command', subtype: OP.CANCEL, status: 'resolved' });
    expect((stop.metadata as any).args).toEqual({ jobId: `${routeKey}-cut-01` });

    // Scrapped units still leave the line by hand, which frees both stations.
    for (const unitId of hop.arrived) await eventually(() => rig.harness.line.unload('cut-01', { unitId }));
    for (const unitId of hop.missing) await eventually(() => rig.harness.line.unload('press-01', { unitId }));
  }, 90_000);

  it('manual: the receiver\'s job stops, and a person collects each unit where it stopped', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    const { handle, decide } = await split(routeKey);
    expect((await decideAs(decide.id, DECISION.MANUAL, 'by hand')).status).toBe(200);

    const hops = lineSteps(rig.line).length + 1;
    const pickups = await Promise.all([hops, hops + 1].map((i) => rig.rowBySignal(signalKeys.handoff(routeKey, i, 1))));
    const at = pickups.map((p) => [(p.metadata as any).pickupAt, (p.metadata as any).units.map((u: any) => u.unitId)]);
    expect(at.map(([station]) => station)).toEqual(['cut-01', 'press-01']);
    for (const [i, [station, units]] of at.entries()) {
      for (const unitId of units) await eventually(() => rig.harness.line.unload(station, { unitId }));
      expect((await escalationApi.resolveEscalation({ id: pickups[i].id, resolverPayload: { received: true, receiver: 'person' } }, { userId: rig.personId })).status).toBe(200);
    }
    const final = await handle.result() as { data: Record<string, any> };
    expect(final.data).toMatchObject({ status: 'manual', received: true, note: 'by hand' });
    expect(final.data.pickups.map((p: any) => [p.at, p.received])).toEqual([['cut-01', true], ['press-01', true]]);
  }, 90_000);
});
