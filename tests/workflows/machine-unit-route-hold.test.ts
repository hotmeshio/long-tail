import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Durable } from '@hotmeshio/hotmesh';

import * as escalationApi from '../../api/escalations';
import { lineSteps } from '../../examples/workflows/machine-line/workflows/route';
import { DECISION, HANDOFF_ERROR, ROW_TYPE, signalKeys } from '../../services/machines/contracts';
import { eventually, startWorkflowRig, type WorkflowRig } from '../helpers/machine-line-workflow-rig';

// Units a machine finishes on hold wait for the quality role. Release runs the
// hop again from the holding machine; rework runs the route again from the
// station named; scrap ends the route.

let rig: WorkflowRig;
beforeAll(async () => {
  rig = await startWorkflowRig({ taskQueue: 'test-machine-route-hold' });
}, 60_000);
afterAll(async () => rig?.stop(), 20_000);

async function receiveAtExit(routeKey: string, step: number, units: string[]): Promise<void> {
  const exit = await rig.rowBySignal(signalKeys.handoff(routeKey, step, 1), 30_000);
  for (const unitId of units) await eventually(() => rig.harness.line.unload('inspect-01', { unitId }));
  expect((await escalationApi.resolveEscalation({ id: exit.id, resolverPayload: { received: true, receiver: 'person' } }, { userId: rig.personId })).status).toBe(200);
}

async function holdRow(routeKey: string, step: number, attempt: number) {
  const row = await rig.rowBySignal(signalKeys.hold(routeKey, step, attempt), 30_000);
  expect(row).toMatchObject({ type: ROW_TYPE.QUALITY_HOLD, role: 'line-quality' });
  expect(row.metadata).toMatchObject({ errorCode: HANDOFF_ERROR.SENDER_REJECTED, result: 'hold', decisions: ['release', 'rework', 'scrap'] });
  return row;
}

describe('machine unit route: units finished on hold', () => {
  it('released units continue from the holding machine', async () => {
    rig.harness.line.arm('press-01', { result: 'hold', reason: 'edge out of range' });
    const routeKey = `H${Durable.guid().slice(0, 8)}`;
    const handle = await rig.start(routeKey, ['H1'], { steps: lineSteps(rig.line) });
    const row = await holdRow(routeKey, 1, 1);
    expect((await escalationApi.resolveEscalation({ id: row.id, resolverPayload: { decision: DECISION.RELEASE, note: 'within tolerance' } }, { userId: rig.personId })).status).toBe(200);
    await eventually(() => rig.harness.line.dispose('press-01', { unitId: 'H1', decision: 'release' }));
    await receiveAtExit(routeKey, 3, ['H1']);
    const result = (await handle.result() as { data: Record<string, any> }).data;
    expect(result.status).toBe('complete');
    expect(result.history.filter((h: any) => h.held)).toEqual([{ hop: 1, held: true, decision: 'release', station: null }]);
  }, 90_000);

  it('scrapped units end the route at the holding machine', async () => {
    rig.harness.line.arm('press-01', { result: 'hold', reason: 'delaminated' });
    const routeKey = `S${Durable.guid().slice(0, 8)}`;
    const handle = await rig.start(routeKey, ['S1'], { steps: lineSteps(rig.line) });
    const row = await holdRow(routeKey, 1, 1);
    expect((await escalationApi.resolveEscalation({ id: row.id, resolverPayload: { decision: DECISION.SCRAP, note: 'delaminated' } }, { userId: rig.personId })).status).toBe(200);
    expect((await handle.result() as { data: Record<string, any> }).data).toMatchObject({ status: 'scrapped', at: 'press-01', note: 'delaminated' });
    await eventually(() => rig.harness.line.dispose('press-01', { unitId: 'S1', decision: 'scrap' }));
  }, 90_000);
});
