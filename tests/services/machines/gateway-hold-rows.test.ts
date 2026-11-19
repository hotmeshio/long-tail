import { describe, it, expect, afterEach } from 'vitest';

import { OP } from '../../../lib/machines/protocol';
import { commandTarget, holdRow } from '../../../services/machines/commands';
import { ROW_TYPE } from '../../../services/machines/contracts';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { sleep, until } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const dispatchedTo = (machineId: string) => rig.recorder.commands(machineId, OP.DISPATCH).map((c) => c.args.jobId);
const hold = (machineId = 'press-01') => rig.lt.parkRow(holdRow(commandTarget(DEFAULT_LINE, machineId), 'fresh plate') as any);

describe('a machine-hold row', () => {
  it('names its machine, line and reason', () => {
    expect(holdRow(commandTarget(DEFAULT_LINE, 'press-01'), 'fresh plate')).toMatchObject({
      type: ROW_TYPE.MACHINE_HOLD, role: 'line-bond', description: 'press-01 held: fresh plate',
      metadata: { siteId: 'site-1', lineId: 'line-1', machineId: 'press-01', reason: 'fresh plate' },
    });
  });

  it('keeps every dispatch from its machine while open, and the waiting row goes when it ends', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const held = hold();
    await sleep(30);
    const row = rig.park('U1', null, 'press-01');
    await sleep(80);
    expect(dispatchedTo('press-01')).toEqual([]);
    expect(rig.lt.rows.get(row.id)).toMatchObject({ status: 'pending' });
    rig.lt.personResolves(held.id, { done: true });
    await until(() => dispatchedTo('press-01').length === 1);
  });

  it('holds only its own machine', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    hold();
    await sleep(30);
    rig.park('U1', null, 'cut-01');
    await until(() => dispatchedTo('cut-01').length === 1);
  });

  it('a cancelled hold frees the machine too', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const held = hold();
    await sleep(30);
    rig.park('U1', null, 'press-01');
    await sleep(50);
    rig.lt.cancel(held.id);
    await until(() => dispatchedTo('press-01').length === 1);
  });

  it('still holds after a takeover, read back from Long Tail', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const held = hold();
    await sleep(30);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    rig.park('U1', null, 'press-01');
    await sleep(80);
    expect(dispatchedTo('press-01')).toEqual([]);
    expect(rig.gateway.state.holdRows.get(held.id)).toBe('press-01');
    rig.lt.personResolves(held.id, { done: true });
    await until(() => dispatchedTo('press-01').length === 1);
  });

  it('is never noted on by job lifecycle', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, { lifecycle: true });
    const held = hold();
    await sleep(30);
    expect(rig.lt.rows.get(held.id)!.items).toEqual([]);
  });
});
