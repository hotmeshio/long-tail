import { getPool } from '../db';
import type { LTWorkflowConfig } from '../../types';
import { getWorkflowConfig } from './read';
import {
  ENSURE_ROLE_EXISTS,
  UPSERT_WORKFLOW,
  DELETE_CONFIG_ROLES,
  INSERT_CONFIG_ROLE,
  DELETE_INVOCATION_ROLES,
  INSERT_INVOCATION_ROLE,
  DELETE_LIFECYCLE,
  INSERT_LIFECYCLE_BEFORE,
  INSERT_LIFECYCLE_AFTER,
  DELETE_WORKFLOW,
} from './sql';

export async function upsertWorkflowConfig(
  config: LTWorkflowConfig,
): Promise<LTWorkflowConfig> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Ensure all referenced roles exist in lt_roles (FK constraints)
    const allRoles = new Set([
      config.default_role,
      ...config.roles,
      ...config.invocation_roles,
    ]);
    for (const role of allRoles) {
      await client.query(ENSURE_ROLE_EXISTS, [role]);
    }

    // Upsert the workflow row
    await client.query(UPSERT_WORKFLOW, [
        config.workflow_type,
        config.is_lt,
        config.is_container,
        config.invocable,
        config.task_queue,
        config.default_role,
        config.default_modality,
        config.description,
        config.consumes,
        config.envelope_schema ?? null,
        config.resolver_schema ?? null,
        config.cron_schedule ?? null,
      ],
    );

    // Replace roles
    await client.query(DELETE_CONFIG_ROLES, [config.workflow_type]);
    for (const role of config.roles) {
      await client.query(INSERT_CONFIG_ROLE, [config.workflow_type, role]);
    }

    // Replace invocation roles
    await client.query(DELETE_INVOCATION_ROLES, [config.workflow_type]);
    for (const role of config.invocation_roles) {
      await client.query(INSERT_INVOCATION_ROLE, [config.workflow_type, role]);
    }

    // Replace lifecycle hooks
    await client.query(DELETE_LIFECYCLE, [config.workflow_type]);
    for (const hook of config.lifecycle.onBefore) {
      await client.query(INSERT_LIFECYCLE_BEFORE, [
        config.workflow_type,
        hook.target_workflow_type,
        hook.target_task_queue,
        hook.ordinal,
      ]);
    }
    for (const hook of config.lifecycle.onAfter) {
      await client.query(INSERT_LIFECYCLE_AFTER, [
        config.workflow_type,
        hook.target_workflow_type,
        hook.target_task_queue,
        hook.ordinal,
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return (await getWorkflowConfig(config.workflow_type))!;
}

export async function deleteWorkflowConfig(
  workflowType: string,
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_WORKFLOW, [workflowType]);
  return (rowCount ?? 0) > 0;
}
