import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

const { Connection } = Durable;

export const postgres_options = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'longtail',
};

export async function connectPostgres() {
  return Connection.connect({
    class: Postgres,
    options: postgres_options,
  });
}

export async function dropTables(client: any): Promise<void> {
  await client.query('DROP TABLE IF EXISTS lt_mcp_servers CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_config_lifecycle CASCADE');
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
  await client.query('TRUNCATE lt_config_lifecycle CASCADE');
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
