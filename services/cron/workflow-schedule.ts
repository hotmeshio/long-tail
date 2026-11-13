import { randomUUID } from 'crypto';

import { getPool } from '../../lib/db';
import { getWorkflowConfig } from '../config';
import type { LTWorkflowConfig } from '../../types';
import {
  AWAIT_WORKFLOW_CRON,
  CRON_LOCK_CLASS,
  GET_SCHEDULE_CONFIG,
  GET_WORKFLOW_CRON,
  LIST_WORKFLOW_CRONS,
  LOCK_WORKFLOW_CRON,
  RECORD_WORKFLOW_CRON,
} from './sql';

export const CRON_ID_PREFIX = 'lt-cron';

/** Arms and interrupts the HotMesh cron job behind a workflow schedule. */
export interface CronJobOps {
  arm(workflowType: string, jobId: string, schedule: string): Promise<void>;
  interrupt(workflowType: string, jobId: string): Promise<void>;
}

export type CronReconcileResult =
  | { action: 'unchanged'; jobId: string | null }
  | { action: 'armed'; jobId: string; replaced: string | null }
  | { action: 'stopped'; jobId: string };

export interface WorkflowCronRow {
  workflow_type: string;
  job_id: string;
  schedule: string | null;
}

type ScheduleFields = Pick<LTWorkflowConfig, 'cron_schedule' | 'invocable' | 'task_queue'>;

/** The job id a schedule runs under until it has a lt_workflow_crons row. */
export function legacyCronId(workflowType: string): string {
  return `${CRON_ID_PREFIX}-${workflowType}`;
}

/** The schedule a config asks for, or null when it should not run. */
export function scheduleOf(config: ScheduleFields | null | undefined): string | null {
  return config?.cron_schedule && config.invocable && config.task_queue ? config.cron_schedule : null;
}

/** The job that should be running for a recorded row, or the original id when there is none. */
function currentJobId(workflowType: string, row: Omit<WorkflowCronRow, 'workflow_type'> | undefined): string | null {
  if (!row) return legacyCronId(workflowType);
  return row.schedule ? row.job_id : null;
}

export async function listWorkflowCrons(): Promise<WorkflowCronRow[]> {
  const { rows } = await getPool().query(LIST_WORKFLOW_CRONS);
  return rows;
}

/**
 * Bring a workflow's cron job in line with its stored config.
 *
 * Runs under a per-workflow advisory lock, so saves on any container apply
 * one at a time against the latest committed config. A schedule that hasn't
 * changed is left running. A new schedule gets a fresh job id, armed before
 * the id is recorded; the replaced job is interrupted after the commit. A
 * job that is never recorded, or is replaced, skips its ticks (see
 * `scheduledConfigFor`).
 *
 * `legacyArmed` says whether this process armed the original id. A workflow
 * with no row is only stopped then, so saving a config that never had a
 * schedule writes nothing.
 */
export async function reconcileWorkflowCron(
  workflowType: string,
  ops: CronJobOps,
  legacyArmed: boolean,
): Promise<CronReconcileResult> {
  const client = await getPool().connect();
  let result: CronReconcileResult;
  let release: string | null = null;
  try {
    await client.query('BEGIN');
    await client.query(LOCK_WORKFLOW_CRON, [CRON_LOCK_CLASS, workflowType]);
    const { rows: configs } = await client.query(GET_SCHEDULE_CONFIG, [workflowType]);
    const { rows: crons } = await client.query(GET_WORKFLOW_CRON, [workflowType]);
    const desired = scheduleOf(configs[0]);
    const row = crons[0] as WorkflowCronRow | undefined;

    if (desired) {
      if (row && row.schedule === desired) {
        result = { action: 'unchanged', jobId: row.job_id };
      } else {
        const jobId = `${legacyCronId(workflowType)}-${randomUUID()}`;
        await ops.arm(workflowType, jobId, desired);
        await client.query(RECORD_WORKFLOW_CRON, [workflowType, jobId, desired]);
        release = currentJobId(workflowType, row);
        result = { action: 'armed', jobId, replaced: release };
      }
    } else if (row?.schedule) {
      await client.query(RECORD_WORKFLOW_CRON, [workflowType, row.job_id, null]);
      release = row.job_id;
      result = { action: 'stopped', jobId: row.job_id };
    } else if (!row && legacyArmed) {
      release = legacyCronId(workflowType);
      await client.query(RECORD_WORKFLOW_CRON, [workflowType, release, null]);
      result = { action: 'stopped', jobId: release };
    } else {
      result = { action: 'unchanged', jobId: null };
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (release) await ops.interrupt(workflowType, release);
  return result;
}

/**
 * The config a cron tick runs with, or null when `jobId` is not the job the
 * schedule runs under now (replaced, stopped, or never recorded). Waits for
 * a reconcile in progress, so a job it just armed reads its own id.
 */
export async function scheduledConfigFor(
  workflowType: string,
  jobId: string,
): Promise<LTWorkflowConfig | null> {
  const pool = getPool();
  await pool.query(AWAIT_WORKFLOW_CRON, [CRON_LOCK_CLASS, workflowType]);
  const { rows } = await pool.query(GET_WORKFLOW_CRON, [workflowType]);
  const config = await getWorkflowConfig(workflowType);
  if (!scheduleOf(config)) return null;
  return currentJobId(workflowType, rows[0]) === jobId ? config : null;
}
