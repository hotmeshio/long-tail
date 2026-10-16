import { describe, it, expect, afterEach } from 'vitest';

import { JOB_EVENT, OP } from '../../../examples/workflows/machine-line/protocol';
import { dispatchArgs, sleep, startHarness, until, type Harness } from '../../helpers/machine-line-fixtures';

let h: Harness;
afterEach(async () => h?.stop());

describe('mock cell: dispatch', () => {
  it('refuses missing arguments and a recipe version it does not hold', async () => {
    h = await startHarness();
    const missing = await h.command('press-01', OP.DISPATCH, { unitId: 'U1' });
    expect(missing).toMatchObject({ status: 'refused' });
    expect(missing?.reason).toMatch(/missing jobId/);
    expect(await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1', { recipe: { id: 'RCP-BOND-A', version: '99' } })))
      .toMatchObject({ status: 'refused', reason: expect.stringMatching(/not held/) });
  });

  it('answers a repeated cmdId without running it twice', async () => {
    h = await startHarness({ autoArriveAtEntry: false });
    const first = await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'), 'cmd-1');
    const again = await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'), 'cmd-1');
    expect(first).toMatchObject({ status: 'accepted' });
    expect(again?.reason).toMatch(/repeat/);
    expect(h.recorder.jobs('press-01', JOB_EVENT.QUEUED)).toHaveLength(1);
  });

  it('treats a new command for a queued jobId as idempotent', async () => {
    h = await startHarness({ autoArriveAtEntry: false });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    expect(await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'))).toMatchObject({ status: 'accepted', reason: 'job already queued' });
  });

  it('refuses an expired command and verifies the artifact by checksum', async () => {
    h = await startHarness({ autoArriveAtEntry: false });
    const expired = await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1', { expiresAt: '2000-01-01T00:00:00.000Z' }));
    expect(expired?.reason).toMatch(/expired/);
    const stored = h.line.payloads.put(Buffer.from('unit file'));
    expect(await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U2', { artifact: { url: stored.url, sha256: 'beef' } })))
      .toMatchObject({ status: 'failed', reason: 'artifact checksum mismatch' });
    expect(await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U3', { artifact: { url: stored.url, sha256: stored.sha256 } })))
      .toMatchObject({ status: 'accepted' });
  });

  it('withdraws a queued job and refuses to cancel an unknown one', async () => {
    h = await startHarness({ autoArriveAtEntry: false });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    expect(await h.command('press-01', OP.CANCEL, { jobId: 'U1-press-01' })).toMatchObject({ status: 'accepted' });
    expect(h.recorder.jobs('press-01', JOB_EVENT.WITHDRAWN)).toHaveLength(1);
    expect(await h.command('press-01', OP.CANCEL, { jobId: 'U1-press-01' })).toMatchObject({ status: 'refused' });
  });

  it('drops replies when told to (a lost reply)', async () => {
    h = await startHarness();
    h.line.config('press-01', { replyMode: 'drop' });
    expect(await h.command('press-01', OP.ENABLE)).toBeNull();
  });
});

describe('mock cell: the job lifecycle', () => {
  it('runs a unit from line entry to finished with measurements and material lots', async () => {
    h = await startHarness();
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    const done = await until(() => h.recorder.jobs('press-01', JOB_EVENT.FINISHED)[0]);
    expect(done).toMatchObject({ result: 'ok', jobId: 'U1-press-01' });
    expect(done.materials.map((x: any) => x.material)).toEqual(['BONDING-FILM', 'TOP-LAYER']);
    expect(done.measurements.every((x: any) => x.ok)).toBe(true);
    const events = h.recorder.jobs('press-01').map((j) => j.event);
    expect(events).toEqual(expect.arrayContaining([JOB_EVENT.QUEUED, JOB_EVENT.READY, JOB_EVENT.ARRIVED, JOB_EVENT.STARTED, JOB_EVENT.FINISHED]));
    expect(h.recorder.violations()).toEqual([]);
  });

  it('an armed reject finishes with a reason and an out-of-range measurement', async () => {
    h = await startHarness();
    h.line.arm('press-01', { result: 'reject', reason: 'BOND-WEAK' });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    const done = await until(() => h.recorder.jobs('press-01', JOB_EVENT.FINISHED)[0]);
    expect(done).toMatchObject({ result: 'reject', reason: 'BOND-WEAK' });
    expect(done.measurements.some((x: any) => !x.ok)).toBe(true);
    expect(h.recorder.violations()).toEqual([]);
  });

  it('a disabled machine holds work until it is enabled', async () => {
    h = await startHarness({ startEnabled: false });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    await sleep(30);
    expect(h.recorder.jobs('press-01', JOB_EVENT.STARTED)).toHaveLength(0);
    await h.command('press-01', OP.ENABLE);
    await until(() => h.recorder.jobs('press-01', JOB_EVENT.FINISHED)[0]);
  });

  it('an emergency stop holds the unit in process until an operator resets', async () => {
    h = await startHarness();
    h.line.config('press-01', { cycleSec: 200 });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    await until(() => h.recorder.jobs('press-01', JOB_EVENT.STARTED)[0]);
    await h.line.emergencyStop('press-01');
    expect(await until(() => h.recorder.jobs('press-01', JOB_EVENT.FINISHED)[0])).toMatchObject({ result: 'hold', reason: 'E-STOP' });
    expect(h.line.machine('press-01').mode).toBe('emergency-stop');
    await h.line.reset('press-01');
    expect(h.line.machine('press-01').mode).toBe('idle');
    expect(h.line.machine('press-01').alarms.list()).toEqual([]);
    expect(h.recorder.violations()).toEqual([]);
  });

  it('publishes a retained snapshot that follows the queue, and on request', async () => {
    h = await startHarness({ autoArriveAtEntry: false });
    await h.command('press-01', OP.DISPATCH, dispatchArgs('press-01', 'U1'));
    const snap = await until(() => h.recorder.of('press-01', 'snapshot').map((e) => e.body).find((b) => b.jobs.length === 1));
    expect(snap).toMatchObject({ mode: 'idle', enabled: true, jobs: [{ jobId: 'U1-press-01', status: 'queued' }] });
    expect(await h.command('press-01', OP.SNAPSHOT)).toMatchObject({ status: 'accepted' });
  });
});
