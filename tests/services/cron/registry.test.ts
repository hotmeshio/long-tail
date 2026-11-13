import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

// The registry arms each schedule once, registers one worker per topic, and
// starts a run only from the job its schedule runs under now.
const mocks = vi.hoisted(() => ({
  cron: vi.fn().mockResolvedValue(true),
  interrupt: vi.fn().mockResolvedValue(true),
  getContext: vi.fn(),
  startScheduledRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@hotmeshio/hotmesh', async (actual) => {
  const real = await actual<typeof import('@hotmeshio/hotmesh')>();
  return { ...real, Virtual: { ...real.Virtual, cron: mocks.cron, interrupt: mocks.interrupt, getContext: mocks.getContext } };
});
vi.mock('../../../services/cron/workflow-run', () => ({ startScheduledRun: mocks.startScheduledRun }));
vi.mock('../../../services/iam/principal', () => ({ resolvePrincipal: vi.fn().mockResolvedValue(null) }));

import { migrate } from '../../../lib/db/migrate';
import { cronRegistry } from '../../../services/cron';
import { legacyCronId } from '../../../services/cron/workflow-schedule';
import { cronRowOf, removeCronTestRows, saveScheduledConfig } from '../../helpers/workflow-cron';

const PREFIX = `cronReg${Date.now()}`;
let n = 0;
const nextType = () => `${PREFIX}_${++n}`;
const HOURLY = '0 * * * *';

const armedIds = () => mocks.cron.mock.calls.map(([params]) => params.options.id);
const callbackFor = (type: string) =>
  mocks.cron.mock.calls.find(([params]) => params.topic === `lt.cron.${type}` && params.callback)?.[0].callback;

async function tick(type: string, jobId: string): Promise<void> {
  mocks.getContext.mockReturnValue({ workflowId: jobId, guid: 'g-1' });
  await callbackFor(type)();
}

describe('cronRegistry', () => {
  beforeAll(async () => { await migrate(); }, 30_000);
  beforeEach(() => { vi.clearAllMocks(); cronRegistry.clear(); });
  afterAll(async () => { await removeCronTestRows(PREFIX); });

  it('arms a schedule with no recorded job under its original id at startup', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    await cronRegistry.connect();
    expect(armedIds()).toContain(legacyCronId(type));
    expect(await cronRowOf(type)).toBeUndefined();
  });

  it('re-arms the recorded job at startup without moving it', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    await cronRegistry.restartCron({ workflow_type: type });
    const { job_id } = (await cronRowOf(type))!;
    cronRegistry.clear();
    vi.clearAllMocks();
    await cronRegistry.connect();
    expect(armedIds()).toContain(job_id);
    expect(armedIds()).not.toContain(legacyCronId(type));
    expect((await cronRowOf(type))!.job_id).toBe(job_id);
  });

  it('touches no job when a save leaves the schedule unchanged', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    await cronRegistry.restartCron({ workflow_type: type });
    vi.clearAllMocks();
    await saveScheduledConfig(type, HOURLY, { description: 'edited' });
    await cronRegistry.restartCron({ workflow_type: type });
    expect(mocks.cron).not.toHaveBeenCalled();
    expect(mocks.interrupt).not.toHaveBeenCalled();
  });

  it('registers one worker per topic however often the schedule moves', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    await cronRegistry.restartCron({ workflow_type: type });
    await saveScheduledConfig(type, '0 2 * * *');
    await cronRegistry.restartCron({ workflow_type: type });
    const calls = mocks.cron.mock.calls.filter(([p]) => p.topic === `lt.cron.${type}`);
    expect(calls).toHaveLength(2);
    expect(calls.filter(([p]) => p.callback)).toHaveLength(1);
    expect(mocks.interrupt).toHaveBeenCalledWith(expect.objectContaining({ options: { id: calls[0][0].options.id } }));
  });

  it('starts a run from the current job and skips a replaced one', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    await cronRegistry.restartCron({ workflow_type: type });
    const { job_id } = (await cronRowOf(type))!;

    await tick(type, job_id);
    expect(mocks.startScheduledRun).toHaveBeenCalledWith(expect.objectContaining({ workflow_type: type }), 'g-1', null);

    mocks.startScheduledRun.mockClear();
    await tick(type, legacyCronId(type));
    expect(mocks.startScheduledRun).not.toHaveBeenCalled();
  });

  it('stops the schedule when its config is deleted', async () => {
    const type = nextType();
    await saveScheduledConfig(type, HOURLY);
    await cronRegistry.restartCron({ workflow_type: type });
    const { job_id } = (await cronRowOf(type))!;
    const { deleteWorkflowConfig } = await import('../../../api/workflows/config');
    expect((await deleteWorkflowConfig({ type })).status).toBe(200);
    expect(mocks.interrupt).toHaveBeenCalledWith(expect.objectContaining({ options: { id: job_id } }));
    expect(await cronRowOf(type)).toEqual({ job_id, schedule: null });
  });
});
