import { isDeepStrictEqual } from 'node:util';

import { getPool } from '../../lib/db';
import type { LTWorkflowConfig } from '../../types';
import { getWorkflowConfig } from './read';
import { loggerRegistry } from '../../lib/logger';
import {
  ENSURE_ROLE_EXISTS,
  UPSERT_WORKFLOW,
  SEED_WORKFLOW_CONFIG,
  SEED_CONFIG_ROLE,
  SEED_INVOCATION_ROLE,
  DELETE_CONFIG_ROLES,
  INSERT_CONFIG_ROLE,
  DELETE_INVOCATION_ROLES,
  INSERT_INVOCATION_ROLE,
  DELETE_WORKFLOW,
} from './sql';

/**
 * Certification fallback for writers that omit the explicit flag (older SDKs,
 * seed blocks without `certified`): derived from roles/consumes presence —
 * the rule that governed the tier before the flag existed.
 */
function resolveCertified(config: LTWorkflowConfig): boolean {
  return (
    config.certified ??
    ((config.roles?.length ?? 0) > 0 || (config.consumes?.length ?? 0) > 0)
  );
}

/**
 * Full replace of one workflow config in a single transaction: FK role
 * ensures, the workflow row upsert, and replace semantics for the roles and
 * invocation-roles side tables. Both the admin upsert and the startup apply
 * write through here — they differ only in how `certified` resolves.
 */
async function replaceWorkflowConfig(
  config: LTWorkflowConfig,
  certified: boolean,
): Promise<void> {
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
        config.invocable,
        config.task_queue,
        config.default_role,
        config.description,
        config.consumes,
        config.envelope_schema ?? null,
        config.resolver_schema ?? null,
        config.cron_schedule ?? null,
        config.tool_tags || [],
        config.execute_as ?? null,
        certified,
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

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function upsertWorkflowConfig(
  config: LTWorkflowConfig & { lifecycle?: any },
): Promise<LTWorkflowConfig> {
  await replaceWorkflowConfig(config, resolveCertified(config));
  return (await getWorkflowConfig(config.workflow_type))!;
}

export async function deleteWorkflowConfig(
  workflowType: string,
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_WORKFLOW, [workflowType]);
  return (rowCount ?? 0) > 0;
}

/**
 * Seed a workflow config at startup (insert-if-absent).
 * DB is the source of truth — if the row already exists, log drift warnings
 * but do not overwrite. Returns true if inserted, false if already existed.
 */
export async function seedWorkflowConfig(
  config: LTWorkflowConfig,
): Promise<boolean> {
  const pool = getPool();

  // Ensure referenced roles exist
  const allRoles = new Set([
    config.default_role,
    ...config.roles,
    ...config.invocation_roles,
  ]);
  for (const role of allRoles) {
    await pool.query(ENSURE_ROLE_EXISTS, [role]);
  }

  // Insert-if-absent
  const { rowCount } = await pool.query(SEED_WORKFLOW_CONFIG, [
    config.workflow_type,
    config.invocable,
    config.task_queue,
    config.default_role,
    config.description,
    config.consumes,
    config.envelope_schema ?? null,
    config.resolver_schema ?? null,
    config.cron_schedule ?? null,
    config.tool_tags || [],
    config.execute_as ?? null,
    resolveCertified(config),
  ]);

  const inserted = (rowCount ?? 0) > 0;

  if (inserted) {
    // Seed roles (also insert-if-absent)
    for (const role of config.roles) {
      await pool.query(SEED_CONFIG_ROLE, [config.workflow_type, role]);
    }
    for (const role of config.invocation_roles) {
      await pool.query(SEED_INVOCATION_ROLE, [config.workflow_type, role]);
    }
  } else {
    // Drift detection — compare key fields
    const existing = await getWorkflowConfig(config.workflow_type);
    if (existing) {
      const drifts: string[] = [];
      if (config.description && existing.description !== config.description) drifts.push('description');
      if (config.invocable !== existing.invocable) drifts.push('invocable');
      if (resolveCertified(config) !== existing.certified) drifts.push('certified');
      if (config.default_role !== existing.default_role) drifts.push('default_role');
      if (JSON.stringify(config.envelope_schema) !== JSON.stringify(existing.envelope_schema)) drifts.push('envelope_schema');
      if (JSON.stringify(config.resolver_schema) !== JSON.stringify(existing.resolver_schema)) drifts.push('resolver_schema');
      if (drifts.length) {
        loggerRegistry.warn(`[long-tail] config drift: ${config.workflow_type} — ${drifts.join(', ')} differ between code and DB`);
      }
    }
  }

  return inserted;
}

/** Order-insensitive comparison for role lists and other unordered arrays. */
function sortedEqual(a: string[], b: string[]): boolean {
  return isDeepStrictEqual([...a].sort(), [...b].sort());
}

/**
 * Apply a workflow config at startup (code is source of truth).
 *
 * The declared config is diffed against the stored row — jsonb fields as
 * parsed values, role lists order-insensitively — and written through the
 * same full-replace transaction the admin surface uses only when something
 * actually differs. `certified` is explicit-only on this path: an omitted
 * flag registers the workflow as NOT certified.
 */
export async function applyWorkflowConfig(
  config: LTWorkflowConfig,
): Promise<'applied' | 'unchanged'> {
  const certified = config.certified ?? false;
  const existing = await getWorkflowConfig(config.workflow_type);

  if (existing) {
    const unchanged =
      existing.invocable === config.invocable &&
      existing.task_queue === config.task_queue &&
      existing.default_role === config.default_role &&
      (existing.description ?? null) === (config.description ?? null) &&
      existing.certified === certified &&
      (existing.cron_schedule ?? null) === (config.cron_schedule ?? null) &&
      (existing.execute_as ?? null) === (config.execute_as ?? null) &&
      sortedEqual(existing.consumes ?? [], config.consumes ?? []) &&
      sortedEqual(existing.tool_tags ?? [], config.tool_tags ?? []) &&
      sortedEqual(existing.roles ?? [], config.roles ?? []) &&
      sortedEqual(existing.invocation_roles ?? [], config.invocation_roles ?? []) &&
      isDeepStrictEqual(existing.envelope_schema ?? null, config.envelope_schema ?? null) &&
      isDeepStrictEqual(existing.resolver_schema ?? null, config.resolver_schema ?? null);
    if (unchanged) return 'unchanged';
  }

  await replaceWorkflowConfig(config, certified);
  return 'applied';
}
