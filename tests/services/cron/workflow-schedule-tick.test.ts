import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { legacyCronId, reconcileWorkflowCron, scheduledConfigFor } from '../../../services/cron/workflow-schedule';
import { RecordingCronOps, removeCronTestRows, saveScheduledConfig } from '../../helpers/workflow-cron';

// A tick runs only under the job its schedule runs under now.
const PREFIX = `cronTick${Date.now()}`;
let n = 0;
const nextType = () => `${PREFIX}_${++n}`;
const HOURLY = '0 * * * *';

describe('scheduledConfigFor', () => {
  beforeAll(async () => { await migrate(); }, 30_000);
  afterAll(async () => { await removeCronTestRows(PREFIX); });

  it('runs a schedule with no recorded job under its original id', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    expect(await scheduledConfigFor(type, legacyCronId(type))).toMatchObject({ workflow_type: type, cron_schedule: HOURLY });
    expect(await scheduledConfigFor(type, `${legacyCronId(type)}-other`)).toBeNull();
  });

  it('runs only the recorded job once a schedule moves', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    const { jobId } = await reconcileWorkflowCron(type, new RecordingCronOps(), false) as any;
    expect(await scheduledConfigFor(type, jobId)).not.toBeNull();
    expect(await scheduledConfigFor(type, legacyCronId(type))).toBeNull();
  });

  it('skips every job once the schedule is off or the workflow is not invocable', async () => {
    const off = nextType();
    await saveScheduledConfig(off, null);
    expect(await scheduledConfigFor(off, legacyCronId(off))).toBeNull();

    const closed = nextType();
    await saveScheduledConfig(closed, HOURLY, { invocable: false });
    expect(await scheduledConfigFor(closed, legacyCronId(closed))).toBeNull();
  });

  it('skips a job whose config was deleted', async () => {
    expect(await scheduledConfigFor(`${PREFIX}_missing`, legacyCronId(`${PREFIX}_missing`))).toBeNull();
  });

  it('reads the config as stored at the tick', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY, { envelope_schema: { data: { v: 1 }, metadata: {} } });
    await saveScheduledConfig(type, HOURLY, { envelope_schema: { data: { v: 2 }, metadata: {} } });
    expect((await scheduledConfigFor(type, legacyCronId(type)))?.envelope_schema).toEqual({ data: { v: 2 }, metadata: {} });
  });

  it('waits for a reconcile in progress, so a job it just armed runs', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    const ops = new RecordingCronOps();
    let open!: () => void;
    ops.armGate = new Promise<void>((resolve) => { open = resolve; });
    const reconciling = reconcileWorkflowCron(type, ops, false);
    await new Promise((r) => setTimeout(r, 100));

    // A tick during the reconcile blocks, then reads what it committed
    let ticked = false;
    const legacyTick = scheduledConfigFor(type, legacyCronId(type)).then((c) => { ticked = true; return c; });
    await new Promise((r) => setTimeout(r, 200));
    expect(ticked).toBe(false);

    open();
    const { jobId } = await reconciling as any;
    expect(await legacyTick).toBeNull();
    expect(await scheduledConfigFor(type, jobId)).not.toBeNull();
  });
});
