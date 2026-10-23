import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Durable } from '@hotmeshio/hotmesh';

import * as escalationApi from '../../api/escalations';
import * as userService from '../../services/user';
import { CHANNEL } from '../../lib/machines/protocol';
import { lineSteps } from '../../examples/workflows/machine-line/workflows/route';
import { DECISION, ROW_TYPE, signalKeys } from '../../services/machines/contracts';
import { ADDRESS_PROPERTY } from '../../services/machines/identities';
import { sendAsMachine } from '../helpers/machine-line-directional';
import { eventually, startWorkflowRig, type WorkflowRig } from '../helpers/machine-line-workflow-rig';

// A line that names stations only: each machine's address is learned from its
// own messages and kept on the station's bot account. A second machine
// claiming a station waits for a person, through the real escalation API.

let rig: WorkflowRig;
beforeAll(async () => {
  rig = await startWorkflowRig({ taskQueue: 'test-machine-route-registration', learned: true });
}, 60_000);
afterAll(async () => rig?.stop(), 20_000);

const addressOf = (machineId: string) => rig.machines.machines.find((m) => m.machineId === machineId)!.address!;
const propertyOf = async (machineId: string) => (await userService.getUser(rig.users.get(machineId)!))?.metadata?.[ADDRESS_PROPERTY];
const STRANGER = '9e9e9e9e-0000-4000-8000-000000000009';

describe('machine unit route: a line that learns its addresses', () => {
  it('each station learns its machine\'s address, keeps it on its bot account, and the route runs end to end', async () => {
    for (const m of rig.line.machines) await eventually(async () => (await propertyOf(m.machineId)) === addressOf(m.machineId));
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    const handle = await rig.start(routeKey, ['L1'], { steps: lineSteps(rig.line) });
    const exit = await rig.rowBySignal(signalKeys.handoff(routeKey, lineSteps(rig.line).length, 1), 30_000);
    await eventually(() => rig.harness.line.unload('inspect-01', { unitId: 'L1' }));
    expect((await escalationApi.resolveEscalation({ id: exit.id, resolverPayload: { received: true, receiver: 'person' } }, { userId: rig.personId })).status).toBe(200);
    expect((await handle.result() as { data: { status: string } }).data.status).toBe('complete');
  }, 90_000);

  it('another machine claiming a station opens one row for the operator; approving it moves the station to that machine', async () => {
    const stranger = { ...rig.machines, machines: rig.machines.machines.map((m) => (m.machineId === 'cut-01' ? { ...m, address: STRANGER } : m)) };
    const claim = sendAsMachine(rig.harness.broker, stranger, 'cut-01', CHANNEL.PRESENCE, { online: true, software: '1.0.0' });
    claim.again();
    const pending = async () => ((await escalationApi.listEscalations(
      { type: ROW_TYPE.MACHINE_REGISTRATION, status: 'pending', facets: { lineId: rig.line.lineId }, limit: 10 }, { userId: rig.personId },
    )).data as any).escalations as Record<string, any>[];
    const [row] = await eventually(async () => {
      const rows = await pending();
      return rows.length ? rows : undefined;
    });
    expect((await pending())).toHaveLength(1);
    expect(row).toMatchObject({ role: 'line-operator' });
    expect(await propertyOf('cut-01')).toBe(addressOf('cut-01'));

    const approved = await escalationApi.resolveEscalation({ id: row.id, resolverPayload: { decision: DECISION.APPROVE } }, { userId: rig.personId });
    expect(approved.status).toBe(200);
    await eventually(async () => (await propertyOf('cut-01')) === STRANGER);
    expect(rig.gateway.state.stationAt(STRANGER)).toBe('cut-01');
  }, 60_000);
});
