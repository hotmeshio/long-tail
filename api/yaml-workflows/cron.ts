import * as yamlDb from '../../services/yaml-workflow/db';
import { cronRegistry } from '../../services/cron';
import type { LTApiResult } from '../../types/sdk';
import { isNotFoundError } from './helpers';

/**
 * Set or update the cron schedule for a YAML workflow.
 *
 * Persists the schedule in the DB and restarts the in-process cron timer via the
 * cron registry so the change takes effect immediately.
 *
 * @param input.id — UUID of the workflow to schedule
 * @param input.cron_schedule — cron expression (e.g. "0 * * * *")
 * @param input.cron_envelope — optional payload passed to each scheduled invocation
 * @param input.execute_as — optional identity override for scheduled executions
 * @returns `{ status: 200, data: YamlWorkflow }` the updated workflow record with cron fields set
 */
export async function setCronSchedule(input: {
  id: string;
  cron_schedule: string;
  cron_envelope?: any;
  execute_as?: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }

    if (!input.cron_schedule || typeof input.cron_schedule !== 'string') {
      return { status: 400, error: 'cron_schedule is required' };
    }

    const updated = await yamlDb.updateCronSchedule(
      wf.id,
      input.cron_schedule.trim(),
      input.cron_envelope ?? null,
      input.execute_as ?? null,
    );

    if (updated) {
      await cronRegistry.restartYamlCron(updated);
    }

    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Remove the cron schedule from a YAML workflow.
 *
 * Stops the in-process cron timer first, then clears the schedule fields in the DB.
 *
 * @param input.id — UUID of the workflow to unschedule
 * @returns `{ status: 200, data: YamlWorkflow }` the updated workflow record with cron fields cleared
 */
export async function clearCronSchedule(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }

    await cronRegistry.stopYamlCron(wf.id);
    const updated = await yamlDb.clearCronSchedule(wf.id);

    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * List all YAML workflows that have a cron schedule, with their live timer status.
 *
 * Fetches all cron-scheduled workflows from the DB and cross-references with the
 * in-process cron registry to determine which timers are actually running.
 *
 * @returns `{ status: 200, data: { schedules: Array<{ id, name, graph_topic, app_id, cron_schedule, execute_as, active }> } }`
 */
export async function getCronStatus(): Promise<LTApiResult> {
  try {
    const workflows = await yamlDb.getCronScheduledWorkflows();
    const activeTypes = cronRegistry.activeWorkflowTypes;

    const schedules = workflows.map((wf) => ({
      id: wf.id,
      name: wf.name,
      graph_topic: wf.graph_topic,
      app_id: wf.app_id,
      cron_schedule: wf.cron_schedule,
      execute_as: wf.execute_as,
      active: activeTypes.includes(`yaml:${wf.id}`),
    }));

    return { status: 200, data: { schedules } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
