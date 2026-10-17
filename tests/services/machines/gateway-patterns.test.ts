import { describe, it, expect, afterEach } from 'vitest';

import { ROW_TYPE } from '../../../services/machines/contracts';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { JOB_EVENT, OP } from '../../../lib/machines/protocol';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { sleep, until } from '../../helpers/machine-line-fixtures';

let rig: LineRig;
afterEach(async () => rig?.stop());

const claimed = (r: LineRig, id: string, by: string) => until(() => r.lt.rows.get(id)!.assigned_to === by);

describe('gateway: one job, several units', () => {
  it('resolves a handoff only when every unit has arrived', async () => {
    rig = await startRig();
    const intoPress = await rig.handoff(['U1', 'U2'], null, 'press-01');
    expect(intoPress.resolver_payload).toEqual({ received: true, receiver: 'press-01', units: ['U1', 'U2'] });
    const intoCut = await rig.handoff(['U1', 'U2'], 'press-01', 'cut-01');
    expect(intoCut.items.map((i) => i.itemKey)).toEqual(expect.arrayContaining(['released:U1', 'released:U2', 'arrived:U1', 'arrived:U2']));
    expect(rig.lt.calls.filter((c) => c.verb === 'resolve' && c.id === intoCut.id)).toHaveLength(1);
  });
});

describe('gateway: refusals and give-ups', () => {
  it('a machine on a software version the line does not allow is refused before dispatch', async () => {
    const line = structuredClone(DEFAULT_LINE);
    line.machines[0].allowedSoftware = ['2.0.0'];
    rig = await startRig({}, {}, line);
    const ended = await rig.handoff('U1', null, 'press-01');
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'software-unsupported' });
    expect(rig.recorder.commands('press-01', OP.DISPATCH)).toHaveLength(0);
  });

  it('a machine giving up a queued job resolves withdrawn', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = rig.park('U1', null, 'press-01');
    await claimed(rig, row.id, 'press-01');
    await rig.line.withdraw('press-01', { jobId: 'U1-press-01' });
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ received: false, errorCode: 'withdrawn', unitId: 'U1' });
  });

  it('an unreadable id resolves unreadable-id', async () => {
    rig = await startRig();
    await rig.handoff('U1', null, 'press-01');
    rig.line.armTransfer('cut-01', { fault: 'unreadable' });
    expect((await rig.handoff('U1', 'press-01', 'cut-01')).resolver_payload).toMatchObject({ errorCode: 'unreadable-id' });
  });
});

describe('gateway: cancel mid-cycle', () => {
  it('cancelling a row stops the sender at a safe point and the held unit is not chased', async () => {
    rig = await startRig();
    await rig.handoff('U1', null, 'press-01');
    rig.line.config('press-01', { cycleSec: 500 });
    const row = rig.park('U1', 'press-01', 'cut-01');
    await claimed(rig, row.id, 'cut-01');
    await until(() => rig.recorder.jobs('press-01', JOB_EVENT.STARTED)[0]);
    rig.lt.cancel(row.id);
    expect(await until(() => rig.recorder.jobs('press-01', JOB_EVENT.FINISHED)[0])).toMatchObject({ result: 'hold', reason: 'cancelled' });
    await until(() => rig.recorder.jobs('cut-01', JOB_EVENT.WITHDRAWN)[0]);
    await rig.gateway.idle();
    expect(rig.lt.calls.filter((c) => c.id === row.id && c.verb !== 'claim')).toEqual([]);
  });
});

describe('gateway: resume attribution, quiet machines, restarts', () => {
  it('records who cleared a stopping alarm at the machine', async () => {
    rig = await startRig();
    await rig.line.fault('press-01', { code: 'F-101' });
    const row = await until(() => rig.lt.ofType(ROW_TYPE.ALARM)[0]);
    await rig.line.maintenanceEnd('press-01', { by: 'tech-9' });
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ decision: 'cleared', clearedBy: 'tech-9' });
  });

  it('a supply running out is an alarm row like any other stopping alarm', async () => {
    rig = await startRig();
    await rig.line.alarm('press-01', { code: 'SUPPLY-EMPTY', level: 'critical', text: 'Bonding film empty' });
    expect((await until(() => rig.lt.ofType(ROW_TYPE.ALARM)[0])).metadata).toMatchObject({ code: 'SUPPLY-EMPTY', level: 'critical' });
  });

  it('a connected machine that goes quiet gets a row; its next message resolves it', async () => {
    rig = await startRig({}, { quietMs: 30 });
    const quiet = await until(() => rig.lt.ofType(ROW_TYPE.MACHINE_QUIET).find((r) => r.metadata.machineId === 'cut-01'));
    await rig.line.alarm('cut-01', { code: 'NOTE', level: 'info' });
    expect((await rig.lt.ended(quiet.id)).resolver_payload).toMatchObject({ decision: 'restored' });
  });

  it('a machine that restarts and loses its queue gets its open dispatch again', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = rig.park('U1', null, 'press-01');
    await claimed(rig, row.id, 'press-01');
    await rig.line.restart('press-01');
    await until(() => rig.recorder.commands('press-01', OP.DISPATCH).length === 2);
    expect(new Set(rig.recorder.commands('press-01', OP.DISPATCH).map((c) => c.cmdId))).toEqual(new Set([`${row.id}:dispatch`]));
    await until(() => rig.line.machine('press-01').cell.jobs.has('U1-press-01'));
    await rig.line.arrive('press-01', { unitId: 'U1', carrierId: 'CR-U1' });
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ received: true, units: ['U1'] });
    await sleep(10);
  });
});
