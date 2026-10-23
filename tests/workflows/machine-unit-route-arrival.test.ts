import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Durable } from '@hotmeshio/hotmesh';

import { sleepFor } from '../setup';
import * as escalationApi from '../../api/escalations';
import { CHANNEL, DISPATCH_ON, OP } from '../../lib/machines/protocol';
import { identOf } from '../../lib/machines/line';
import { jobIdFor, lineSteps } from '../../examples/workflows/machine-line/workflows/route';
import { itemKeys, signalKeys } from '../../services/machines/contracts';
import { CONTROLLER } from '../../services/machines/gateway/actions';
import { until } from '../helpers/machine-line-fixtures';
import { sendAsMachine } from '../helpers/machine-line-directional';
import { eventually, startWorkflowRig, type WorkflowRig } from '../helpers/machine-line-workflow-rig';

// Machines that take work only for units they have scanned in: the gateway
// sends the job once the scan arrives, through the real workflow and rows.

let rig: WorkflowRig;
beforeAll(async () => {
  rig = await startWorkflowRig({ taskQueue: 'test-machine-route-arrival', dispatchOn: DISPATCH_ON.ARRIVAL, mock: { autoArriveAtEntry: false } });
}, 60_000);
afterAll(async () => rig?.stop(), 20_000);

const step = () => lineSteps(rig.line)[0];
const pressAddress = () => identOf(rig.line, 'press-01').address!;
const dispatchesFor = (routeKey: string) =>
  rig.harness.recorder.commands(pressAddress(), OP.DISPATCH).filter((c) => c.args.jobId.startsWith(routeKey));
const itemsOf = async (id: string) =>
  ((await escalationApi.getEscalationItems({ id }, { userId: rig.users.get(CONTROLLER)! })).data as any).items as { itemKey: string; payload: any }[];

/** The unit reaches the press, which runs the job; a person takes it off at line exit. */
async function finishRoute(routeKey: string, unitId: string, handle: { result(): Promise<unknown> }) {
  await eventually(() => rig.harness.line.arrive('press-01', { unitId, carrierId: `CR-${unitId}` }));
  const exit = await rig.rowBySignal(signalKeys.handoff(routeKey, 1, 1));
  await eventually(() => rig.harness.line.unload('press-01', { unitId }));
  expect((await escalationApi.resolveEscalation({ id: exit.id, resolverPayload: { received: true, receiver: 'person' } }, { userId: rig.personId })).status).toBe(200);
  const final = await handle.result() as { data: { status: string; history: any[] } };
  expect(final.data.status).toBe('complete');
  expect(final.data.history.map((h) => [h.to, h.received])).toEqual([['press-01', true], ['exit', true]]);
}

describe('machine unit route, dispatching on arrival', () => {
  it('the job goes out only after the scan; the machine bot records the arrival, then takes the row', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    const handle = await rig.start(routeKey, ['G1'], { steps: [step()] });
    const row = await rig.rowBySignal(signalKeys.handoff(routeKey, 0, 1));
    await sleepFor(300);
    expect(dispatchesFor(routeKey)).toEqual([]);

    const scan = sendAsMachine(rig.harness.broker, rig.line, 'press-01', CHANNEL.JOB, {
      event: 'arrived', jobId: jobIdFor(routeKey, step()), unitId: 'G1', orderRef: `ORD-${routeKey}`, recipe: null, carrierId: 'CR-G1', visitId: 'visit-1',
    });
    const ended = await eventually(async () => {
      const r = await rig.rowBySignal(signalKeys.handoff(routeKey, 0, 1));
      return r.status === 'resolved' ? r : null;
    });
    expect(ended.id).toBe(row.id);
    expect(ended.assigned_to).toBe(rig.users.get('press-01'));
    expect((ended.metadata as any).resolved_by).toBe(rig.users.get('press-01'));
    const [arrived] = await itemsOf(row.id);
    expect(arrived).toMatchObject({ itemKey: itemKeys.arrived('G1'), payload: { unitId: 'G1', arrival: { visitId: 'visit-1' } } });
    expect(dispatchesFor(routeKey)).toHaveLength(1);
    expect(dispatchesFor(routeKey)[0].args.units[0]).toMatchObject({ unitId: 'G1', arrival: { visitId: 'visit-1' } });
    await until(() => rig.receipts.some((r) => r.ids.includes(scan.id)), 5_000);

    await finishRoute(routeKey, 'G1', handle);
  }, 90_000);

  it('after a restart, a gateway reads the recorded arrival back from the row and sends the job', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    await rig.gateway.stop();
    const handle = await rig.start(routeKey, ['H1'], { steps: [step()] });
    const row = await rig.rowBySignal(signalKeys.handoff(routeKey, 0, 1));
    const recorded = await escalationApi.accumulateItem({
      id: row.id, itemKey: itemKeys.arrived('H1'),
      payload: { unitId: 'H1', carrierId: 'CR-H1', arrival: { event: 'arrived', unitId: 'H1', carrierId: 'CR-H1', visitId: 'visit-9' } },
    }, { userId: rig.users.get('press-01')! });
    expect(recorded.status).toBeLessThan(300);

    rig.gateway = await rig.startGateway();
    const ended = await eventually(async () => {
      const r = await rig.rowBySignal(signalKeys.handoff(routeKey, 0, 1));
      return r.status === 'resolved' ? r : null;
    });
    expect((ended.metadata as any).resolved_by).toBe(rig.users.get('press-01'));
    expect(dispatchesFor(routeKey)).toHaveLength(1);
    expect(dispatchesFor(routeKey)[0].args.units[0].arrival).toMatchObject({ visitId: 'visit-9' });

    await finishRoute(routeKey, 'H1', handle);
  }, 90_000);
});
