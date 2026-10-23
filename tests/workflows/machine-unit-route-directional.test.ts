import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Durable } from '@hotmeshio/hotmesh';

import { getPool } from '../../lib/db';
import * as escalationApi from '../../api/escalations';
import { CHANNEL, OP } from '../../lib/machines/protocol';
import { identOf } from '../../lib/machines/line';
import { lineSteps } from '../../examples/workflows/machine-line/workflows/route';
import { ROW_TYPE, dispatchCommandId, signalKeys } from '../../services/machines/contracts';
import { until } from '../helpers/machine-line-fixtures';
import { DIRECTION, WIRE_ROOT, sendAsMachine } from '../helpers/machine-line-directional';
import { eventually, startWorkflowRig, type WorkflowRig } from '../helpers/machine-line-workflow-rig';

// The unit workflow and real rows, with machines that speak a protocol of
// their own: direction in the topic, UUID addresses, receipts, two-phase
// replies and strict validation. The workflow never sees any of it.

let rig: WorkflowRig;
beforeAll(async () => { rig = await startWorkflowRig({ taskQueue: 'test-machine-route-directional' }); }, 60_000);
afterAll(async () => rig?.stop(), 20_000);

const steps = () => lineSteps(rig.line);
const newKey = () => `R${Durable.guid().slice(0, 8)}`;
const addressOf = (machineId: string) => identOf(rig.line, machineId).address!;

const fromMachine = (machineId: string, channel: string, body: Record<string, any>) =>
  sendAsMachine(rig.harness.broker, rig.line, machineId, channel, body);

async function receiveAtExit(routeKey: string, step: number, units: string[], at = 'inspect-01'): Promise<void> {
  const exit = await rig.rowBySignal(signalKeys.handoff(routeKey, step, 1));
  for (const unitId of units) await eventually(() => rig.harness.line.unload(at, { unitId }));
  expect((await escalationApi.resolveEscalation({ id: exit.id, resolverPayload: { received: true, receiver: 'person' } }, { userId: rig.personId })).status).toBe(200);
}

describe('machine unit route over a directional protocol', () => {
  it('two units ride the line; every job event is confirmed after it lands', async () => {
    const routeKey = newKey();
    const handle = await rig.start(routeKey, ['A1', 'A2'], { steps: steps() });
    await receiveAtExit(routeKey, 3, ['A1', 'A2']);
    const final = await handle.result() as { data: { status: string; history: any[] } };
    expect(final.data.status).toBe('complete');
    expect(final.data.history.map((h) => [h.to, h.received])).toEqual([['press-01', true], ['cut-01', true], ['inspect-01', true], ['exit', true]]);

    const intoCut = await rig.rowBySignal(signalKeys.handoff(routeKey, 1, 1));
    expect(intoCut.assigned_to).toBe(rig.users.get('cut-01'));
    expect((intoCut.metadata as any).resolved_by).toBe(rig.users.get('cut-01'));

    // Commands went down on the machine's UUID topic; receipts too, naming each arrival.
    // The recorder reads the mock's side of the relay, where machines are named by address.
    const dispatches = rig.harness.recorder.commands(addressOf('cut-01'), OP.DISPATCH).filter((c) => c.args.jobId.startsWith(routeKey));
    expect(dispatches).toHaveLength(1);
    const arrivals = rig.harness.recorder.of(addressOf('cut-01'), 'job').filter((e) => e.body.event === 'arrived' && e.body.jobId.startsWith(routeKey));
    await until(() => arrivals.every((a) => rig.receipts.some((r) => r.ids.includes(a.id))), 5_000);
    const receipt = rig.receipts.find((r) => r.ids.includes(arrivals[0].id))!;
    expect(receipt.topic).toBe(`${WIRE_ROOT}/${rig.line.siteId}/${rig.line.lineId}/${DIRECTION.TO_MACHINE}/${addressOf('cut-01')}/receipt`);
  }, 90_000);

  it('a job that fails after acceptance ends the handoff as dispatch-failed, and the operator decides', async () => {
    const routeKey = newKey();
    rig.harness.line.armTransfer('press-01', { fault: 'stall' });
    const handle = await rig.start(routeKey, ['F1'], { steps: steps() });
    const intoCut = await rig.rowBySignal(signalKeys.handoff(routeKey, 1, 1));
    await eventually(async () => (await rig.rowBySignal(signalKeys.handoff(routeKey, 1, 1))).assigned_to);
    fromMachine('cut-01', CHANNEL.REPLY, { cmdId: dispatchCommandId(intoCut.id), status: 'failed', reason: 'artifact checksum mismatch' });

    const decide = await rig.rowBySignal(signalKeys.handoffError(routeKey, 1, 1));
    expect(decide).toMatchObject({ role: 'line-operator', type: 'handoff-error', subtype: 'dispatch-failed' });
    const ended = await rig.rowBySignal(signalKeys.handoff(routeKey, 1, 1));
    expect(ended.status).toBe('resolved');
    expect((ended.metadata as any).resolved_by).toBe(rig.users.get('cut-01'));
    expect((await escalationApi.resolveEscalation({ id: decide.id, resolverPayload: { decision: 'scrap', note: 'bad file' } }, { userId: rig.personId })).status).toBe(200);
    const final = await handle.result() as { data: Record<string, any> };
    expect(final.data).toMatchObject({ status: 'scrapped', at: 'press-01' });
    rig.harness.line.disarm('press-01');
    await eventually(() => rig.harness.line.unload('press-01', { unitId: 'F1' }));
  }, 90_000);

  it('a machine whose replies are lost is asked what it holds, and its bot claims the row', async () => {
    const routeKey = newKey();
    rig.harness.line.armTransfer('press-01', { fault: 'stall' });
    rig.harness.line.config('cut-01', { replyMode: 'drop' });
    const handle = await rig.start(routeKey, ['Q1'], { steps: steps() });
    try {
      const claimed = await eventually(async () => {
        const row = await rig.rowBySignal(signalKeys.handoff(routeKey, 1, 1));
        return row.assigned_to ? row : null;
      }, 20_000);
      expect(claimed).toMatchObject({ status: 'pending', assigned_to: rig.users.get('cut-01') });
      expect(rig.harness.recorder.commands(addressOf('cut-01'), OP.SNAPSHOT).length).toBeGreaterThan(0);
    } finally {
      rig.harness.line.config('cut-01', { replyMode: 'normal' });
      rig.harness.line.disarm('press-01');
      await handle.terminate();
      await eventually(() => rig.harness.line.unload('press-01', { unitId: 'Q1' }));
    }
  }, 90_000);

  it('a broken message is held for a person on one row, with the message attached, and confirmed', async () => {
    const broken = { event: 'arrived', jobId: `${newKey()}-press-01`, unitId: 'V1', carrierId: 'CR-V1' };
    const { id, again } = fromMachine('press-01', CHANNEL.JOB, broken);
    again();
    const rows = async () => (await getPool().query(
      `SELECT * FROM lt_escalations WHERE type = $1 AND metadata->>'lineId' = $2 AND metadata->>'machineId' = 'press-01'`,
      [ROW_TYPE.CONTRACT_VIOLATION, rig.line.lineId],
    )).rows;
    const [held] = await eventually(async () => ((await rows()).length ? rows() : null));
    expect(held).toMatchObject({ role: 'line-operator', status: 'pending' });
    expect(held.metadata).toMatchObject({ kind: 'job', messageId: id });
    const attached = typeof held.escalation_payload === "string" ? JSON.parse(held.escalation_payload) : held.escalation_payload;
    expect(attached.id).toBe(id);
    await until(() => rig.receipts.some((r) => r.ids.includes(id)), 5_000);
    expect(await rows()).toHaveLength(1);
  }, 60_000);
});
