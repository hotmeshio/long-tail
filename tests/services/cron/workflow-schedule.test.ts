import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { deleteWorkflowConfig } from '../../../services/config';
import { legacyCronId, reconcileWorkflowCron } from '../../../services/cron/workflow-schedule';
import { RecordingCronOps, cronRowOf, removeCronTestRows, saveScheduledConfig } from '../../helpers/workflow-cron';

// Reconciling a workflow's cron job with its stored config, against Postgres.
const PREFIX = `cronRec${Date.now()}`;
let n = 0;
const nextType = () => `${PREFIX}_${++n}`;
const HOURLY = '0 * * * *';
const DAILY = '0 2 * * *';

describe('reconcileWorkflowCron', () => {
  beforeAll(async () => { await migrate(); }, 30_000);
  afterAll(async () => { await removeCronTestRows(PREFIX); });

  it('writes nothing for a config that never had a schedule', async () => {
    const type = nextType();
    await saveScheduledConfig(type, null);
    const ops = new RecordingCronOps();
    expect(await reconcileWorkflowCron(type, ops, false)).toEqual({ action: 'unchanged', jobId: null });
    expect(ops.armed).toEqual([]);
    expect(ops.interrupted).toEqual([]);
    expect(await cronRowOf(type)).toBeUndefined();
  });

  it('arms a fresh job for a new schedule and retires the original id', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    const ops = new RecordingCronOps();
    const result = await reconcileWorkflowCron(type, ops, false);
    expect(result).toMatchObject({ action: 'armed', replaced: legacyCronId(type) });
    expect(ops.armed).toEqual([{ jobId: (result as any).jobId, schedule: HOURLY }]);
    expect((result as any).jobId).toMatch(new RegExp(`^${legacyCronId(type)}-[0-9a-f-]{36}$`));
    expect(ops.interrupted).toEqual([legacyCronId(type)]);
    expect(await cronRowOf(type)).toEqual({ job_id: (result as any).jobId, schedule: HOURLY });
  });

  it('leaves a running schedule alone when the save does not change it', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    const first = await reconcileWorkflowCron(type, new RecordingCronOps(), false);
    await saveScheduledConfig(type, HOURLY, { description: 'edited' });
    const ops = new RecordingCronOps();
    expect(await reconcileWorkflowCron(type, ops, false)).toEqual({ action: 'unchanged', jobId: (first as any).jobId });
    expect(ops.armed).toEqual([]);
    expect(ops.interrupted).toEqual([]);
  });

  it('moves a changed schedule to a new job and interrupts the old one', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    const first = await reconcileWorkflowCron(type, new RecordingCronOps(), false) as any;
    await saveScheduledConfig(type, DAILY);
    const ops = new RecordingCronOps();
    const second = await reconcileWorkflowCron(type, ops, false) as any;
    expect(second).toMatchObject({ action: 'armed', replaced: first.jobId });
    expect(second.jobId).not.toBe(first.jobId);
    expect(ops.interrupted).toEqual([first.jobId]);
    expect(await cronRowOf(type)).toEqual({ job_id: second.jobId, schedule: DAILY });
  });

  it('stops a schedule, then arms a never-used id when it is turned on again', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    const first = await reconcileWorkflowCron(type, new RecordingCronOps(), false) as any;

    await saveScheduledConfig(type, null);
    const off = new RecordingCronOps();
    expect(await reconcileWorkflowCron(type, off, false)).toEqual({ action: 'stopped', jobId: first.jobId });
    expect(off.interrupted).toEqual([first.jobId]);
    expect(await cronRowOf(type)).toEqual({ job_id: first.jobId, schedule: null });

    await saveScheduledConfig(type, HOURLY);
    const on = new RecordingCronOps();
    const again = await reconcileWorkflowCron(type, on, false) as any;
    expect(again).toMatchObject({ action: 'armed', replaced: null });
    expect(again.jobId).not.toBe(first.jobId);
    expect(on.interrupted).toEqual([]);
  });

  it('stops a schedule whose config was deleted', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    const first = await reconcileWorkflowCron(type, new RecordingCronOps(), false) as any;
    await deleteWorkflowConfig(type);
    const ops = new RecordingCronOps();
    expect(await reconcileWorkflowCron(type, ops, false)).toEqual({ action: 'stopped', jobId: first.jobId });
    expect(ops.interrupted).toEqual([first.jobId]);
  });

  it('stops the original id only when this process armed it', async () => {
    const type = nextType();
    await saveScheduledConfig(type, null);
    const ops = new RecordingCronOps();
    expect(await reconcileWorkflowCron(type, ops, true)).toEqual({ action: 'stopped', jobId: legacyCronId(type) });
    expect(ops.interrupted).toEqual([legacyCronId(type)]);
    expect(await cronRowOf(type)).toEqual({ job_id: legacyCronId(type), schedule: null });
  });

  it('changes nothing when arming fails', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    const first = await reconcileWorkflowCron(type, new RecordingCronOps(), false) as any;
    await saveScheduledConfig(type, DAILY);
    const ops = new RecordingCronOps();
    ops.armError = new Error('arm failed');
    await expect(reconcileWorkflowCron(type, ops, false)).rejects.toThrow('arm failed');
    expect(ops.interrupted).toEqual([]);
    expect(await cronRowOf(type)).toEqual({ job_id: first.jobId, schedule: HOURLY });
  });

  it('arms one job when saves on several containers reconcile at once', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    const ops = new RecordingCronOps();
    const results = await Promise.all(Array.from({ length: 6 }, () => reconcileWorkflowCron(type, ops, false)));
    expect(ops.armed).toHaveLength(1);
    expect(results.filter((r) => r.action === 'armed')).toHaveLength(1);
    expect(await cronRowOf(type)).toEqual({ job_id: ops.armed[0].jobId, schedule: HOURLY });
  });
});
