/**
 * Workflow schedules, end to end: saving a config keeps its schedule running,
 * and turning a schedule off and on again starts runs again.
 *
 * Runs on minute ticks, so it takes several minutes.
 * Requires: docker compose up -d --build
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ApiClient, log, pgQuery, poll } from './helpers';

const WORKFLOW = 'basicEcho';
const EVERY_MINUTE = '* * * * *';
const TICK_WAIT_MS = 150_000;

let api: ApiClient;
let original: Record<string, any>;

async function save(changes: Record<string, unknown>): Promise<void> {
  const { status, data } = await api.put(`/api/workflows/${WORKFLOW}/config`, { ...original, ...changes });
  expect(status, JSON.stringify(data)).toBe(200);
}

async function runsSince(since: Date): Promise<number> {
  const rows = await pgQuery(
    `SELECT count(*)::int AS n FROM durable.jobs WHERE key LIKE $1 AND created_at >= $2`,
    [`%:${WORKFLOW}-cron-%`, since],
  );
  return rows[0].n;
}

const waitForRun = (since: Date) =>
  poll(`a ${WORKFLOW} run after ${since.toISOString()}`, async () => (await runsSince(since)) > 0, TICK_WAIT_MS, 5_000);

async function cronRow(): Promise<{ job_id: string; schedule: string | null } | undefined> {
  return (await pgQuery('SELECT job_id, schedule FROM lt_workflow_crons WHERE workflow_type = $1', [WORKFLOW]))[0];
}

async function jobStatus(jobId: string): Promise<number | undefined> {
  const rows = await pgQuery('SELECT status FROM hmsh.jobs WHERE key = $1 AND is_live', [`hmsh:hmsh:j:${jobId}`]);
  return rows[0]?.status;
}

beforeAll(async () => {
  api = new ApiClient();
  await api.login('superadmin', 'l0ngt@1l');
  const { data } = await api.get(`/api/workflows/${WORKFLOW}/config`);
  original = data;
  log('setup', `saved ${WORKFLOW} config; cron_schedule=${original.cron_schedule}`);
});

afterAll(async () => {
  await api.put(`/api/workflows/${WORKFLOW}/config`, original);
});

describe('workflow schedules', () => {
  let jobId: string;

  it('runs a schedule once it is saved', async () => {
    const since = new Date();
    await save({ cron_schedule: EVERY_MINUTE });
    const row = await cronRow();
    expect(row?.schedule).toBe(EVERY_MINUTE);
    jobId = row!.job_id;
    await waitForRun(since);
  }, TICK_WAIT_MS + 10_000);

  it('keeps the schedule running through a save that does not change it', async () => {
    await save({ cron_schedule: EVERY_MINUTE, description: 'edited by the cron test' });
    expect((await cronRow())?.job_id).toBe(jobId);
    await waitForRun(new Date());
  }, TICK_WAIT_MS + 10_000);

  it('stops the schedule when it is turned off', async () => {
    await save({ cron_schedule: null });
    expect(await cronRow()).toEqual({ job_id: jobId, schedule: null });
    const since = new Date(Date.now() + 5_000);
    await new Promise((r) => setTimeout(r, 70_000));
    expect(await runsSince(since)).toBe(0);
  }, 90_000);

  it('runs again when it is turned back on, under a new job', async () => {
    const since = new Date();
    await save({ cron_schedule: EVERY_MINUTE });
    const row = await cronRow();
    expect(row?.job_id).not.toBe(jobId);
    jobId = row!.job_id;
    await waitForRun(since);
  }, TICK_WAIT_MS + 10_000);

  it('moves an edited schedule to a new job and interrupts the old one', async () => {
    await save({ cron_schedule: '*/2 * * * *' });
    const row = await cronRow();
    expect(row).toMatchObject({ schedule: '*/2 * * * *' });
    expect(row!.job_id).not.toBe(jobId);
    expect(await jobStatus(jobId)).toBeLessThan(0);
    expect(await jobStatus(row!.job_id)).toBeGreaterThan(0);
  });
});
