import { describe, it, expect, afterEach } from 'vitest';

import { JOB_EVENT, OP } from '../../../lib/machines/protocol';
import { dispatchArgs, sleep, startHarness, until, type Harness } from '../../helpers/machine-line-fixtures';

let h: Harness;
afterEach(async () => h?.stop());

/** Dispatch U1 to the press (from entry) and the cutter (from the press). */
async function pressThenCut(): Promise<void> {
  await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
  await h.command('cut-01', OP.DISPATCH, dispatchArgs('cut-01', 'U1', { from: 'press-01' }));
}

describe('mock floor: the handoff', () => {
  it('moves a unit press → cut: ready, released, arrived', async () => {
    h = await startHarness();
    await pressThenCut();
    expect(await until(() => h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)[0])).toMatchObject({ unitId: 'U1', peer: 'press-01' });
    expect(h.recorder.jobs('cut-01', JOB_EVENT.READY)[0]).toMatchObject({ peer: 'press-01' });
    expect(h.recorder.jobs('press-01', JOB_EVENT.RELEASED)[0]).toMatchObject({ peer: 'cut-01' });
    expect(h.recorder.violations()).toEqual([]);
  });

  it('the sender keeps a finished unit until the receiver is dispatched', async () => {
    h = await startHarness();
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    await until(() => h.recorder.jobs('press-01', JOB_EVENT.FINISHED)[0]);
    await sleep(20);
    expect(h.recorder.jobs('press-01', JOB_EVENT.RELEASED)).toHaveLength(0);
    await h.command('cut-01', OP.DISPATCH, dispatchArgs('cut-01', 'U1', { from: 'press-01' }));
    await until(() => h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)[0]);
  });

  it('a unit taken off the line at the last machine is released to nobody', async () => {
    h = await startHarness();
    await h.command('inspect-01', OP.DISPATCH, dispatchArgs('inspect-01', 'U1', { carrierId: null }));
    await until(() => h.recorder.jobs('inspect-01', JOB_EVENT.FINISHED)[0]);
    expect(await h.line.unload('inspect-01', { unitId: 'U1' })).toBe(true);
    expect(h.recorder.jobs('inspect-01', JOB_EVENT.RELEASED)[0]).toMatchObject({ peer: null });
  });

  it('manual arrival delivers an entry unit and refuses one that was not dispatched', async () => {
    h = await startHarness({ autoArriveAtEntry: false });
    expect(await h.line.arrive('press-01', { unitId: 'NOPE' })).toBe(false);
    expect(h.line.machine('press-01').alarms.list()[0].code).toBe('UNIT-NOT-DISPATCHED');
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    expect(await h.line.arrive('press-01', { unitId: 'U1', carrierId: 'CR-U1' })).toBe(true);
  });
});

describe('mock floor: transfer faults', () => {
  it('jam: the sender reports it and holds the unit until the alarm clears', async () => {
    h = await startHarness();
    h.line.armTransfer('press-01', { fault: 'jam' });
    await pressThenCut();
    expect(await until(() => h.recorder.jobs('press-01', JOB_EVENT.TRANSFER_FAILED)[0])).toMatchObject({ failure: 'jam', peer: 'cut-01' });
    const alarm = h.line.machine('press-01').alarms.list()[0];
    expect(alarm).toMatchObject({ code: 'TRANSFER-JAM', level: 'critical', autoClears: false });
    await sleep(20);
    expect(h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)).toHaveLength(0);
    await h.line.clearAlarm('press-01', { alarmId: alarm.alarmId });
    await until(() => h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)[0]);
  });

  it('incomplete: the receiver reports it and a re-dispatch completes the move', async () => {
    h = await startHarness();
    h.line.armTransfer('cut-01', { fault: 'incomplete' });
    await pressThenCut();
    expect(await until(() => h.recorder.jobs('cut-01', JOB_EVENT.TRANSFER_FAILED)[0])).toMatchObject({ failure: 'incomplete-handshake' });
    await h.command('cut-01', OP.DISPATCH, dispatchArgs('cut-01', 'U1', { from: 'press-01' }));
    await until(() => h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)[0]);
  });

  it('carrier mismatch: the receiver refuses the unit and raises a warning', async () => {
    h = await startHarness();
    h.line.armTransfer('cut-01', { fault: 'carrier_mismatch' });
    await pressThenCut();
    expect(await until(() => h.recorder.jobs('cut-01', JOB_EVENT.TRANSFER_FAILED)[0])).toMatchObject({ failure: 'carrier-mismatch' });
    expect(h.line.machine('cut-01').alarms.list()[0].code).toBe('CARRIER-MISMATCH');
  });

  it('stall: nothing is reported until the receiver is dispatched again', async () => {
    h = await startHarness();
    h.line.armTransfer('press-01', { fault: 'stall' });
    await pressThenCut();
    await until(() => h.recorder.jobs('press-01', JOB_EVENT.FINISHED)[0]);
    await sleep(30);
    expect(h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)).toHaveLength(0);
    expect(h.recorder.jobs('press-01', JOB_EVENT.TRANSFER_FAILED)).toHaveLength(0);
    await h.command('cut-01', OP.DISPATCH, dispatchArgs('cut-01', 'U1', { from: 'press-01' }));
    await until(() => h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)[0]);
  });

  it('a dropped link fires the will, queues reliable messages, and flushes them on restore', async () => {
    h = await startHarness();
    const presence = 'line/v1/site-1/line-1/press-01/presence';
    await h.line.network('press-01', { mode: 'drop' });
    expect(JSON.parse(h.broker.retained(presence)[0].payload).body).toEqual({ online: false });
    await h.line.alarm('press-01', { code: 'LOW-FILM', level: 'warning' });
    expect(h.line.machine('press-01').snapshot().link.outbox).toBeGreaterThan(0);
    await h.line.network('press-01', { mode: 'restore' });
    expect(h.line.machine('press-01').snapshot().link.outbox).toBe(0);
    expect(JSON.parse(h.broker.retained(presence)[0].payload).body).toEqual({ online: true, software: '1.0.0' });
  });
});
