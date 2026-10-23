import { describe, it, expect, afterEach } from 'vitest';

import { JOB_EVENT, OP } from '../../../lib/machines/protocol';
import { dispatchArgs, sleep, startHarness, until, type Harness } from '../../helpers/machine-line-fixtures';

let h: Harness;
afterEach(async () => h?.stop());

describe('mock jobs: several units in one job', () => {
  it('starts only when every unit is present, and reports each unit', async () => {
    h = await startHarness({ autoArriveAtEntry: false });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', ['U1', 'U2']));
    expect(await h.line.arrive('press-01', { unitId: 'U1', carrierId: 'CR-U1' })).toBe(true);
    await sleep(20);
    expect(h.recorder.jobs('press-01', JOB_EVENT.STARTED)).toHaveLength(0);
    expect(await h.line.arrive('press-01', { unitId: 'U2', carrierId: 'CR-U2' })).toBe(true);
    await until(() => h.recorder.jobs('press-01', JOB_EVENT.FINISHED).length === 2);
    expect(h.recorder.jobs('press-01', JOB_EVENT.FINISHED).map((j) => [j.jobId, j.unitId])).toEqual([['U1-press-01', 'U1'], ['U1-press-01', 'U2']]);
    expect(h.recorder.violations()).toEqual([]);
  });

  it('moves both units to the next machine, one transfer at a time', async () => {
    h = await startHarness();
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', ['U1', 'U2']));
    await h.command('cut-01', OP.DISPATCH, dispatchArgs('cut-01', ['U1', 'U2'], { from: 'press-01' }));
    await until(() => h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED).length === 2);
    await until(() => h.recorder.jobs('cut-01', JOB_EVENT.FINISHED).length === 2);
  });
});

describe('mock jobs: cancel, withdraw, restart', () => {
  it('cancel mid-cycle stops at a safe point and holds the units', async () => {
    h = await startHarness();
    h.line.config('press-01', { cycleSec: 500 });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    await until(() => h.recorder.jobs('press-01', JOB_EVENT.STARTED)[0]);
    expect(await h.command('press-01', OP.CANCEL, { jobId: 'U1-press-01' })).toMatchObject({ status: 'accepted' });
    expect(h.recorder.jobs('press-01', JOB_EVENT.FINISHED)[0]).toMatchObject({ result: 'hold', reason: 'cancelled' });
  });

  it('cancelling a job still waiting for its units leaves the ones already present for a person to take back', async () => {
    h = await startHarness({ autoArriveAtEntry: false });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', ['U1', 'U2']));
    expect(await h.line.arrive('press-01', { unitId: 'U1', carrierId: 'CR-U1' })).toBe(true);
    expect(await h.command('press-01', OP.CANCEL, { jobId: 'U1-press-01' })).toMatchObject({ status: 'accepted', reason: 'withdrew U1-press-01' });
    expect(await h.line.unload('press-01', { unitId: 'U1' })).toBe(true);
    expect(await h.line.unload('press-01', { unitId: 'U2' })).toBe(false);
  });

  it('the machine can give up a queued job by itself', async () => {
    h = await startHarness({ autoArriveAtEntry: false });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    expect(await h.line.withdraw('press-01', { jobId: 'U1-press-01' })).toBe(true);
    expect(h.recorder.jobs('press-01', JOB_EVENT.WITHDRAWN)[0]).toMatchObject({ unitId: 'U1' });
  });

  it('a controller restart loses the queue and reports a new boot id', async () => {
    h = await startHarness({ autoArriveAtEntry: false });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    const before = h.line.machine('press-01').bootId;
    await h.line.restart('press-01');
    const snap = await until(() => h.recorder.of('press-01', 'snapshot').map((e) => e.body).find((b) => b.bootId !== before));
    expect(snap.jobs).toEqual([]);
    expect(await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'))).toMatchObject({ status: 'accepted', reason: 'queued U1-press-01' });
  });

  it('an unreadable id at the receiver is refused and reported', async () => {
    h = await startHarness();
    h.line.armTransfer('cut-01', { fault: 'unreadable' });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    await h.command('cut-01', OP.DISPATCH, dispatchArgs('cut-01', 'U1', { from: 'press-01' }));
    expect(await until(() => h.recorder.jobs('cut-01', JOB_EVENT.TRANSFER_FAILED)[0])).toMatchObject({ failure: 'unreadable-id' });
  });
});

describe('mock jobs: repeated dispatch', () => {
  it('a repeat while a unit is on its way does not send it twice', async () => {
    h = await startHarness({ arrivalDelaySec: 40 });
    const args = dispatchArgs('press-01', 'U1');
    await h.command('press-01', OP.DISPATCH, args);
    await until(() => h.recorder.jobs('press-01', JOB_EVENT.READY)[0]);
    expect(await h.command('press-01', OP.DISPATCH, args, 'cmd-repeat')).toMatchObject({ status: 'accepted' });
    await h.command('cut-01', OP.DISPATCH, dispatchArgs('cut-01', 'U1', { from: 'press-01' }));
    await until(() => h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)[0]);
    expect(h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED).map((j) => j.peer)).toEqual(['press-01']);
    expect(h.recorder.jobs('press-01', JOB_EVENT.RELEASED).map((j) => j.peer)).toEqual(['cut-01']);
  });
});

describe('mock jobs: a withdrawn entry job', () => {
  it('a new job for the same units still gets them from line entry', async () => {
    h = await startHarness({ autoArriveAtEntry: true, arrivalDelaySec: 1 });
    await h.line.network('press-01', { mode: 'drop' });
    await h.line.network('press-01', { mode: 'restore' });
    const first = dispatchArgs('press-01', 'U1');
    h.line.config('press-01', { cycleSec: 500 });
    await h.line.machine('press-01').enable(false);
    await h.command('press-01', OP.DISPATCH, first);
    expect(await h.command('press-01', OP.CANCEL, { jobId: first.jobId })).toMatchObject({ status: 'accepted' });
    await h.line.machine('press-01').enable(true);
    await h.command('press-01', OP.DISPATCH, { ...first, jobId: 'U1-press-01-a2' });
    await until(() => h.recorder.jobs('press-01', JOB_EVENT.ARRIVED).find((j) => j.jobId === 'U1-press-01-a2'));
  });
});

describe('mock jobs: drills', () => {
  it('disarm drops armed results and transfer faults, so the next job runs clean', async () => {
    h = await startHarness();
    h.line.arm('press-01', { result: 'reject', reason: 'armed' });
    h.line.armTransfer('press-01', { fault: 'jam' });
    h.line.disarm('press-01');
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    await h.command('cut-01', OP.DISPATCH, dispatchArgs('cut-01', 'U1', { from: 'press-01' }));
    await until(() => h.recorder.jobs('cut-01', JOB_EVENT.ARRIVED)[0]);
    expect(h.recorder.jobs('press-01', JOB_EVENT.FINISHED)[0]).toMatchObject({ result: 'ok' });
    expect(h.line.machine('press-01').alarms.list()).toEqual([]);
  });
});
