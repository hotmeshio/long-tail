import { describe, it, expect, afterEach } from 'vitest';

import { ROW_TYPE } from '../../../examples/workflows/machine-line/contracts';
import { JOB_EVENT, OP } from '../../../examples/workflows/machine-line/protocol';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { sleep, until } from '../../helpers/machine-line-fixtures';

let rig: LineRig;
afterEach(async () => rig?.stop());

describe('gateway: alarms and liveness are rows for people', () => {
  it('an operator resolving an alarm row acknowledges the alarm at the machine', async () => {
    rig = await startRig();
    const alarmId = await rig.line.emergencyStop('press-01');
    const row = await until(() => rig.lt.ofType(ROW_TYPE.ALARM)[0]);
    expect(row).toMatchObject({ subtype: 'emergency', role: 'line-operator', priority: 1 });
    rig.lt.personResolves(row.id, { decision: 'acknowledge' }, 'op-7');
    await until(() => rig.line.machine('press-01').alarms.list()[0]?.ackedBy === 'op-7');
    expect(rig.line.machine('press-01').alarms.list()[0].alarmId).toBe(alarmId);
  });

  it('warnings stay in the stream; one row per alarm however often it republishes', async () => {
    rig = await startRig();
    await rig.line.alarm('press-01', { code: 'LOW-FILM', level: 'warning' });
    const alarmId = await rig.line.fault('press-01', { code: 'F-101' });
    await rig.line.machine('press-01').alarms.acknowledge(alarmId, 'op-1');
    await sleep(20);
    expect(rig.lt.ofType(ROW_TYPE.ALARM)).toHaveLength(1);
    expect(rig.lt.ofType(ROW_TYPE.ALARM)[0].metadata).toMatchObject({ code: 'F-101', autoClears: false });
  });

  it('a machine dark past the debounce gets an offline row; coming back resolves it and asks for a snapshot', async () => {
    rig = await startRig();
    await rig.line.network('cut-01', { mode: 'drop' });
    const row = await until(() => rig.lt.ofType(ROW_TYPE.MACHINE_OFFLINE)[0]);
    expect(row.metadata.machineId).toBe('cut-01');
    await rig.line.network('cut-01', { mode: 'restore' });
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ decision: 'restored' });
    await until(() => rig.recorder.commands('cut-01', OP.SNAPSHOT)[0]);
  });

  it('a short blip under the debounce raises nothing', async () => {
    rig = await startRig({}, { offlineDebounceMs: 80 });
    await rig.line.network('cut-01', { mode: 'drop' });
    await rig.line.network('cut-01', { mode: 'restore' });
    await sleep(120);
    expect(rig.lt.ofType(ROW_TYPE.MACHINE_OFFLINE)).toHaveLength(0);
  });
});

describe('gateway: restart and replay', () => {
  it('a gateway restarted mid-handoff replays the arrival and resolves exactly once', async () => {
    rig = await startRig();
    await rig.handoff('U1', null, 'press-01');
    const row = rig.park('U1', 'press-01', 'cut-01');
    await until(() => rig.lt.rows.get(row.id)!.assigned_to === 'cut-01');
    await rig.gateway.stop();

    await until(() => rig.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)[0]);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');

    rig.gateway = await rig.startGateway();
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ received: true, receiver: 'cut-01' });
    await sleep(20);
    expect(rig.lt.calls.filter((c) => c.verb === 'resolve' && c.id === row.id)).toHaveLength(1);
  });

  it('boot reconciliation re-sends an interrupted dispatch with the same cmdId', async () => {
    rig = await startRig();
    await rig.gateway.stop();
    const row = rig.park('U1', null, 'press-01');
    rig.gateway = await rig.startGateway();
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ received: true });
    expect(new Set(rig.recorder.commands('press-01').map((c) => c.cmdId))).toEqual(new Set([`${row.id}:dispatch`]));
  });
});
