import { describe, it, expect, afterEach } from 'vitest';

import { JOB_EVENT, OP } from '../../../examples/workflows/machine-line/protocol';
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
