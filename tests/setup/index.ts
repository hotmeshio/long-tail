import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

const { Connection } = Durable;

// ── Safety guard ─────────────────────────────────────────────────────────────
// Fail fast if the test process somehow targets the dev database.
// vitest.config.ts hardcodes POSTGRES_DB=longtail_test, but this guard
// catches misconfigurations (e.g., shell env overrides, .env changes).
const _testDb = process.env.POSTGRES_DB || 'longtail_test';
if (_testDb !== 'longtail_test') {
  throw new Error(
    `[test-setup] POSTGRES_DB is "${_testDb}" — tests MUST run against "longtail_test". ` +
    `Check your .env file and shell environment.`,
  );
}

export const postgres_options = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5415', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: 'longtail_test',
};

export async function connectPostgres() {
  return Connection.connect({
    class: Postgres,
    options: postgres_options,
  });
}

export async function dropTables(client: any): Promise<void> {
  await client.query('DROP TABLE IF EXISTS lt_mcp_servers CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_config_invocation_roles CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_config_roles CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_config_workflows CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_user_roles CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_users CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_escalations CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_tasks CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_migrations CASCADE');
}

export async function truncateTables(client: any): Promise<void> {
  await client.query('TRUNCATE lt_mcp_servers CASCADE');
  await client.query('TRUNCATE lt_config_invocation_roles CASCADE');
  await client.query('TRUNCATE lt_config_roles CASCADE');
  await client.query('TRUNCATE lt_config_workflows CASCADE');
  await client.query('TRUNCATE lt_user_roles CASCADE');
  await client.query('TRUNCATE lt_users CASCADE');
  await client.query('TRUNCATE lt_escalations CASCADE');
  await client.query('TRUNCATE lt_tasks CASCADE');
}

export function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll for escalations by workflowId until at least one appears or timeout.
 * Used for tests that depend on async workflow completion (e.g., OpenAI Vision).
 */
export async function waitForEscalation(
  workflowId: string,
  timeoutMs = 45_000,
  intervalMs = 2_000,
): Promise<import('../../types').LTEscalationRecord[]> {
  const { getEscalationsByWorkflowId } = await import('../../services/escalation');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const escalations = await getEscalationsByWorkflowId(workflowId);
    if (escalations.length > 0) return escalations;
    await sleepFor(intervalMs);
  }
  throw new Error(`No escalation found for workflow ${workflowId} within ${timeoutMs}ms`);
}

/**
 * Poll for escalations by originId until at least one appears or timeout.
 * Used for orchestrator tests where the escalation is created by a child workflow.
 */
export async function waitForEscalationByOriginId(
  originId: string,
  timeoutMs = 45_000,
  intervalMs = 2_000,
): Promise<import('../../types').LTEscalationRecord[]> {
  const { getEscalationsByOriginId } = await import('../../services/escalation');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const escalations = await getEscalationsByOriginId(originId);
    if (escalations.length > 0) return escalations;
    await sleepFor(intervalMs);
  }
  throw new Error(`No escalation found for origin ${originId} within ${timeoutMs}ms`);
}

/**
 * Poll until an escalation reaches the expected status (default: 'resolved').
 */
export async function waitForEscalationStatus(
  escalationId: string,
  status = 'resolved',
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<import('../../types').LTEscalationRecord> {
  const { getEscalation } = await import('../../services/escalation');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const esc = await getEscalation(escalationId);
    if (esc && esc.status === status) return esc;
    await sleepFor(intervalMs);
  }
  throw new Error(`Escalation ${escalationId} did not reach status "${status}" within ${timeoutMs}ms`);
}

/**
 * Poll until a task reaches the expected status (default: 'completed').
 */
export async function waitForTaskStatus(
  taskIdOrWorkflowId: string,
  status = 'completed',
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<import('../../types').LTTaskRecord> {
  const { getTask, getTaskByWorkflowId } = await import('../../services/task');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Try by task ID first, then by workflow ID
    let task = await getTask(taskIdOrWorkflowId);
    if (!task) task = await getTaskByWorkflowId(taskIdOrWorkflowId);
    if (task && task.status === status) return task;
    await sleepFor(intervalMs);
  }
  throw new Error(`Task ${taskIdOrWorkflowId} did not reach status "${status}" within ${timeoutMs}ms`);
}
