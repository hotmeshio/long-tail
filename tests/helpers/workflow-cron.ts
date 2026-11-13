import { getPool } from '../../lib/db';
import { upsertWorkflowConfig } from '../../services/config';
import type { CronJobOps } from '../../services/cron/workflow-schedule';
import type { LTWorkflowConfig } from '../../types';

/** Records every arm and interrupt; `armGate` holds an arm open until released. */
export class RecordingCronOps implements CronJobOps {
  armed: Array<{ jobId: string; schedule: string }> = [];
  interrupted: string[] = [];
  armError: Error | null = null;
  armGate: Promise<void> | null = null;

  async arm(_workflowType: string, jobId: string, schedule: string): Promise<void> {
    if (this.armGate) await this.armGate;
    if (this.armError) throw this.armError;
    this.armed.push({ jobId, schedule });
  }

  async interrupt(_workflowType: string, jobId: string): Promise<void> {
    this.interrupted.push(jobId);
  }
}

/** Store a scheduled workflow config; pass `null` for no schedule. */
export async function saveScheduledConfig(
  workflowType: string,
  cronSchedule: string | null,
  extra: Partial<LTWorkflowConfig> = {},
): Promise<void> {
  await upsertWorkflowConfig({
    workflow_type: workflowType,
    invocable: true,
    task_queue: 'cron-test',
    default_role: 'reviewer',
    roles: [],
    invocation_roles: [],
    consumes: [],
    cron_schedule: cronSchedule,
    ...extra,
  } as LTWorkflowConfig);
}

export async function cronRowOf(workflowType: string): Promise<{ job_id: string; schedule: string | null } | undefined> {
  const { rows } = await getPool().query('SELECT job_id, schedule FROM lt_workflow_crons WHERE workflow_type = $1', [workflowType]);
  return rows[0];
}

export async function removeCronTestRows(prefix: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM lt_workflow_crons WHERE workflow_type LIKE $1', [`${prefix}%`]);
  await pool.query('DELETE FROM lt_config_workflows WHERE workflow_type LIKE $1', [`${prefix}%`]);
}
