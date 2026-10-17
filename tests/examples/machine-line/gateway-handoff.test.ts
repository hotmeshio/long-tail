import { describe, it, expect, afterEach } from 'vitest';

import { ROW_TYPE } from '../../../examples/workflows/machine-line/contracts';
import { JOB_EVENT, OP } from '../../../examples/workflows/machine-line/protocol';
import { facetsFor, startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { until } from '../../helpers/machine-line-fixtures';

let rig: LineRig;
afterEach(async () => rig?.stop());

describe('gateway: the golden path', () => {
  it('runs one unit entry → press → cut → inspect → exit, each machine claiming and resolving its own handoff', async () => {
    rig = await startRig();
    const intoPress = await rig.handoff('U1', null, 'press-01');
    const intoCut = await rig.handoff('U1', 'press-01', 'cut-01');
    const intoInspect = await rig.handoff('U1', 'cut-01', 'inspect-01');

    // The receiving machine resolves each row once every unit's arrival is held.
    for (const [row, machine] of [[intoPress, 'press-01'], [intoCut, 'cut-01'], [intoInspect, 'inspect-01']] as const) {
      expect(row.status).toBe('resolved');
      expect(row.resolved_by).toBe(machine);
      expect(row.resolver_payload).toEqual({ received: true, receiver: machine, units: ['U1'] });
    }
    expect(rig.lt.calls.filter((c) => c.verb === 'claim').map((c) => c.as)).toEqual(['press-01', 'cut-01', 'inspect-01']);
    expect(intoCut.items.map((i) => [i.itemKey, i.actor])).toEqual([['released:U1', 'press-01'], ['arrived:U1', 'cut-01']]);
    expect(intoCut.items[0].payload).toMatchObject({ event: 'finished', result: 'ok', jobId: 'U1-press-01' });
    expect(intoCut.items[1].payload).toMatchObject({ unitId: 'U1', carrierId: 'CR-U1', from: 'press-01' });

    // The final handoff goes to a person: the same row type, resolved from the dashboard.
    const exit = rig.park('U1', 'inspect-01', null);
    await until(() => rig.lt.rows.get(exit.id)!.items.some((i) => i.itemKey === 'released:U1'));
    await rig.line.unload('inspect-01', { unitId: 'U1' });
    rig.lt.personResolves(exit.id, { received: true, receiver: 'person-1' });
    expect(rig.lt.rows.get(exit.id)!.status).toBe('resolved');
    expect(rig.recorder.violations()).toEqual([]);
  });

  it('dispatches with the carrier, the sender and an expiry, and never twice for one row', async () => {
    rig = await startRig();
    await rig.handoff('U1', null, 'press-01');
    const [dispatch] = rig.recorder.commands('press-01', OP.DISPATCH);
    expect(dispatch.args).toMatchObject({ jobId: 'U1-press-01', units: [{ unitId: 'U1', carrierId: 'CR-U1' }], from: null, recipe: { id: 'RCP-BOND-A', version: '2' } });
    expect(dispatch.args.expiresAt).toMatch(/Z$/);
    expect(rig.recorder.commands('press-01', OP.DISPATCH)).toHaveLength(1);
  });
});

describe('gateway: error roads', () => {
  it('a refused dispatch resolves dispatch-refused as the machine', async () => {
    rig = await startRig();
    const row = rig.lt.park('line-bond', { ...facetsFor('U1', null, 'press-01'), recipeVersion: '99' });
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'dispatch-refused' });
    expect(ended.resolved_by).toBe('press-01');
  });

  it('no reply with no work done resolves no-reply after the retries, all with one cmdId', async () => {
    rig = await startRig();
    rig.line.config('press-01', { replyMode: 'drop' });
    await rig.line.machine('press-01').enable(false);
    const ended = await rig.handoff('U1', null, 'press-01');
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'no-reply' });
    const sent = rig.recorder.commands('press-01', OP.DISPATCH);
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((c) => c.cmdId)).size).toBe(1);
  });

  it('a lost reply on a dispatch the machine ran anyway: the arrival wins', async () => {
    rig = await startRig({}, { replyTimeoutMs: 200 });
    rig.line.config('press-01', { replyMode: 'drop' });
    const ended = await rig.handoff('U1', null, 'press-01');
    expect(ended.items.map((i) => i.itemKey)).toEqual(['arrived:U1']);
    await rig.gateway.idle();
    expect(rig.lt.rows.get(ended.id)!.resolver_payload).toMatchObject({ received: true });
  });

  it('a rejected unit at the sender resolves sender-rejected and withdraws the receiver dispatch', async () => {
    rig = await startRig();
    await rig.handoff('U1', null, 'press-01');
    rig.line.arm('press-01', { result: 'reject', reason: 'BOND-WEAK' });
    const ended = await rig.handoff('U1', 'press-01', 'cut-01');
    // The receiver holds the claim, so it resolves; the payload names the sender that reported it.
    expect(ended.resolver_payload).toMatchObject({ received: false, unitId: 'U1', errorCode: 'sender-rejected', reason: 'BOND-WEAK', reportedBy: 'press-01' });
    expect(ended.resolved_by).toBe('cut-01');
    await until(() => rig.recorder.commands('cut-01', OP.CANCEL)[0]);
  });

  it('a jam resolves jam, raises an operator alarm row, and a retry after clearing completes', async () => {
    rig = await startRig();
    await rig.handoff('U1', null, 'press-01');
    rig.line.armTransfer('press-01', { fault: 'jam' });
    const first = await rig.handoff('U1', 'press-01', 'cut-01');
    expect(first.resolver_payload).toMatchObject({ received: false, errorCode: 'jam' });
    const alarm = await until(() => rig.lt.ofType(ROW_TYPE.ALARM)[0]);
    expect(alarm).toMatchObject({ role: 'line-operator', subtype: 'critical' });
    expect(alarm.metadata).toMatchObject({ code: 'TRANSFER-JAM', autoClears: false, jobId: 'U1-press-01' });

    await rig.line.clearAlarm('press-01', { alarmId: alarm.metadata.alarmId });
    expect((await rig.lt.ended(alarm.id)).resolver_payload).toMatchObject({ decision: 'cleared' });
    const retry = await rig.handoff('U1', 'press-01', 'cut-01', 2);
    expect(retry.items.map((i) => i.itemKey)).toContain('arrived:U1');
  });

  it('an incomplete handshake resolves incomplete-handshake', async () => {
    rig = await startRig();
    await rig.handoff('U1', null, 'press-01');
    rig.line.armTransfer('cut-01', { fault: 'incomplete' });
    expect((await rig.handoff('U1', 'press-01', 'cut-01')).resolver_payload).toMatchObject({ errorCode: 'incomplete-handshake' });
  });

  it('a row that times out withdraws its dispatch', async () => {
    rig = await startRig();
    await rig.handoff('U1', null, 'press-01');
    rig.line.armTransfer('press-01', { fault: 'stall' });
    const row = rig.park('U1', 'press-01', 'cut-01');
    await until(() => rig.lt.rows.get(row.id)!.assigned_to === 'cut-01');
    rig.lt.expire(row.id);
    await until(() => rig.recorder.commands('cut-01', OP.CANCEL)[0]);
    await until(() => rig.recorder.jobs('press-01', JOB_EVENT.FINISHED)[0]);
    expect(rig.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)).toHaveLength(0);
  });
});
